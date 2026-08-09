import { 
  getSourceFileFromDB, 
  saveSourceFileToDB, 
  base64ToBlob, 
  computeSha256 
} from "../utils/sourceFileDb";

export interface PreviewLoadResult {
  available: boolean;
  state: "LOADING" | "AVAILABLE" | "MISSING" | "ERROR" | "UNSUPPORTED";
  previewType?: "PDF" | "IMAGE" | "UNSUPPORTED";
  mimeType?: string;
  objectUrl?: string;
  fileName?: string;
  fileHash?: string;
  fileSize?: number;
  message?: string;
}

/**
 * Revokes a temporary preview object URL safely to avoid memory leaks.
 */
export function revokePreviewUrl(objectUrl: string | null | undefined): void {
  if (objectUrl && objectUrl.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      // ignore
    }
  }
}

/**
 * Loads the original invoice source document for preview.
 * 1. Queries IndexedDB (boonHuatApp1Data / invoiceSourceFiles)
 * 2. Fallbacks to server endpoint GET /api/invoices/:id/file if missing in IndexedDB
 * 3. Creates a temporary Object URL from the retrieved Blob
 */
export async function loadInvoicePreview(recordId: string): Promise<PreviewLoadResult> {
  if (!recordId || !recordId.trim()) {
    return {
      available: false,
      state: "MISSING",
      message: "The original invoice file was not saved with this record."
    };
  }

  try {
    // 1. Try local IndexedDB
    const dbRecord = await getSourceFileFromDB(recordId);
    if (dbRecord && dbRecord.blob && dbRecord.blob.size > 0) {
      const mime = dbRecord.mimeType || dbRecord.blob.type || "application/pdf";
      const isPdf = mime.toLowerCase().includes("pdf");
      const isImg = mime.toLowerCase().includes("image") || mime.toLowerCase().includes("jpeg") || mime.toLowerCase().includes("png") || mime.toLowerCase().includes("jpg");

      if (!isPdf && !isImg) {
        return {
          available: false,
          state: "UNSUPPORTED",
          previewType: "UNSUPPORTED",
          mimeType: mime,
          fileName: dbRecord.fileName,
          message: "Preview is not available for this file type."
        };
      }

      const objectUrl = URL.createObjectURL(dbRecord.blob);
      return {
        available: true,
        state: "AVAILABLE",
        previewType: isPdf ? "PDF" : "IMAGE",
        mimeType: mime,
        objectUrl,
        fileName: dbRecord.fileName,
        fileHash: dbRecord.fileHash,
        fileSize: dbRecord.fileSize
      };
    }

    // 2. Fallback to Server
    const res = await fetch(`/api/invoices/${encodeURIComponent(recordId)}/file`, {
      credentials: "include"
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && data.fileDataUrl) {
        const mime = data.mimeType || "application/pdf";
        const blob = base64ToBlob(data.fileDataUrl, mime);

        // Cache Blob in IndexedDB for subsequent instant access
        await saveSourceFileToDB({
          recordId,
          fileName: data.fileName || "invoice.pdf",
          mimeType: mime,
          fileSize: data.fileSize || blob.size,
          fileHash: data.fileHash || "",
          blob,
          savedAt: new Date().toISOString()
        });

        const isPdf = mime.toLowerCase().includes("pdf");
        const isImg = mime.toLowerCase().includes("image") || mime.toLowerCase().includes("jpeg") || mime.toLowerCase().includes("png") || mime.toLowerCase().includes("jpg");

        if (!isPdf && !isImg) {
          return {
            available: false,
            state: "UNSUPPORTED",
            previewType: "UNSUPPORTED",
            mimeType: mime,
            fileName: data.fileName,
            message: "Preview is not available for this file type."
          };
        }

        const objectUrl = URL.createObjectURL(blob);
        return {
          available: true,
          state: "AVAILABLE",
          previewType: isPdf ? "PDF" : "IMAGE",
          mimeType: mime,
          objectUrl,
          fileName: data.fileName,
          fileHash: data.fileHash,
          fileSize: data.fileSize
        };
      }
    }

    return {
      available: false,
      state: "MISSING",
      message: "The original invoice file was not saved with this record."
    };
  } catch (err: any) {
    console.error("[PreviewService] Error loading preview:", err);
    return {
      available: false,
      state: "ERROR",
      message: "The original invoice could not be displayed."
    };
  }
}

/**
 * Saves a source file attachment for a legacy/missing record or replacement without re-running extraction.
 */
export async function attachSourceFileOnlyApi(
  recordId: string,
  file: File,
  replacementReason?: string
): Promise<{ success: boolean; hashMatched: boolean; fileHash: string; message?: string }> {
  const hash = await computeSha256(file);
  const blob = file;

  // 1. Read Base64 for Server Persistence
  const reader = new FileReader();
  const base64Promise = new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const fileBase64 = await base64Promise;

  // 2. Save in IndexedDB
  await saveSourceFileToDB({
    recordId,
    fileName: file.name,
    mimeType: file.type || "application/pdf",
    fileSize: file.size,
    fileHash: hash,
    blob,
    savedAt: new Date().toISOString()
  });

  // 3. Save on Server
  const res = await fetch(`/api/invoices/${encodeURIComponent(recordId)}/source-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      fileMimeType: file.type || "application/pdf",
      fileSize: file.size,
      fileBase64,
      fileHash: hash,
      replacementReason
    }),
    credentials: "include"
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to attach source file to record.");
  }

  const serverRes = await res.json();
  return {
    success: true,
    hashMatched: serverRes.hashMatched ?? true,
    fileHash: hash,
    message: serverRes.message
  };
}

/**
 * Log audit event helper for preview actions.
 */
export async function logPreviewAuditEventApi(payload: {
  actionType: 
    | "INVOICE_PREVIEW_OPENED" 
    | "INVOICE_PREVIEW_FAILED" 
    | "INVOICE_SOURCE_FILE_ATTACHED" 
    | "INVOICE_SOURCE_FILE_REPLACED"
    | "LEGACY_SOURCE_FILE_BATCH_STARTED"
    | "LEGACY_SOURCE_FILE_BATCH_COMPLETED";
  recordId?: string;
  invoiceNumber?: string;
  filename?: string;
  result: "SUCCESS" | "FAILURE" | "INFO";
  reason?: string;
}): Promise<void> {
  try {
    await fetch("/api/audit/preview-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include"
    });
  } catch (err) {
    // non-blocking
  }
}

/**
 * IndexedDB storage manager for original invoice source files.
 * Database: boonHuatApp1Data
 * Store: invoiceSourceFiles
 * Key: recordId
 */

export interface InvoiceSourceFile {
  recordId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileHash: string;
  blob: Blob;
  savedAt: string;
  attachedBy?: string;
}

const DB_NAME = "boonHuatApp1Data";
const STORE_NAME = "invoiceSourceFiles";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "recordId" });
      }
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      resolve(db);
    };

    request.onerror = (event) => {
      dbPromise = null;
      reject((event.target as IDBOpenDBRequest).error);
    };
  });

  return dbPromise;
}

/**
 * Saves a source document Blob to IndexedDB under recordId.
 */
export async function saveSourceFileToDB(item: {
  recordId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileHash: string;
  blob: Blob;
  savedAt?: string;
  attachedBy?: string;
}): Promise<boolean> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const recordToSave: InvoiceSourceFile = {
      recordId: item.recordId,
      fileName: item.fileName,
      mimeType: item.mimeType,
      fileSize: item.fileSize,
      fileHash: item.fileHash,
      blob: item.blob,
      savedAt: item.savedAt || new Date().toISOString(),
      attachedBy: item.attachedBy || "Madam Lim"
    };

    return new Promise((resolve) => {
      const request = store.put(recordToSave);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn("[IndexedDB] Failed to save source file to DB:", err);
    return false;
  }
}

/**
 * Retrieves the source document Blob from IndexedDB by recordId.
 */
export async function getSourceFileFromDB(recordId: string): Promise<InvoiceSourceFile | null> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve) => {
      const request = store.get(recordId);
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => {
        resolve(null);
      };
    });
  } catch (err) {
    console.warn("[IndexedDB] Failed to retrieve source file from DB:", err);
    return null;
  }
}

/**
 * Deletes a stored source file from IndexedDB by recordId.
 */
export async function deleteSourceFileFromDB(recordId: string): Promise<boolean> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve) => {
      const request = store.delete(recordId);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn("[IndexedDB] Failed to delete source file from DB:", err);
    return false;
  }
}

/**
 * Computes SHA-256 hash of a Blob or File.
 */
export async function computeSha256(fileOrBlob: File | Blob): Promise<string> {
  const buffer = await fileOrBlob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Converts Data URL or Base64 string to Blob.
 */
export function base64ToBlob(base64Data: string, fallbackMime = "application/pdf"): Blob {
  let mime = fallbackMime;
  let cleanBase64 = base64Data;

  if (base64Data.startsWith("data:")) {
    const parts = base64Data.split(",");
    const match = parts[0].match(/:(.*?);/);
    if (match && match[1]) {
      mime = match[1];
    }
    cleanBase64 = parts[1] || "";
  }

  const binaryStr = atob(cleanBase64);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

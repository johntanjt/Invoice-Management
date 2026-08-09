import { InvoiceRecord, ExtractionResult } from "../types";
import { fetchInvoicesApi, checkSessionApi, logTransferAuditEventApi } from "./api";

export const APP2_PUBLISHED_URL = "https://remix-remix-remix-remix-remix-remix-remix-boon-hu-2930.ai.studio";
export const APP2_ORIGIN = new URL(APP2_PUBLISHED_URL).origin;

export type TransferStatus =
  | "READY"
  | "PREPARING"
  | "OPENING_APP2"
  | "WAITING_FOR_APP2"
  | "TRANSFER_RECEIVED"
  | "TRANSFER_FAILED";

export interface TransferState {
  status: TransferStatus | "IDLE" | "CONNECTING" | "SENDING" | "SUCCESS" | "ERROR";
  message?: string;
  importedCount?: number;
  transferId?: string;
  errorType?: "POPUP_BLOCKED" | "NO_READY" | "NO_ACK" | "NO_INVOICES" | "TOO_LARGE" | "INVALID_DATA" | "UNKNOWN";
}

/**
 * URL-safe Base64 UTF-8 encoder required by App 2
 */
export function encodeUrlSafeBase64(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Backward compatibility helper for encodeBase64Url
 */
export const encodeBase64Url = encodeUrlSafeBase64;

/**
 * Send single current extracted invoice data to 3-Way Match URL (?extractedInvoice=<base64>)
 */
export function sendSingleExtractedInvoiceTo3WayMatch(data: {
  supplierName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  lineItems?: any[] | null;
  totalDue?: number | string | null;
  printedTotalAmount?: number | string | null;
}): string {
  const lineItems = (data.lineItems || []).map((item: any, idx: number) => ({
    lineNumber: item.lineNumber || idx + 1,
    description: item.description || "",
    quantity: item.quantity != null ? Number(item.quantity) : 0,
    unitPrice: item.unitPrice != null ? Number(item.unitPrice) : 0,
    amount: item.amount != null ? Number(item.amount) : (item.printedLineAmount != null ? Number(item.printedLineAmount) : (item.calculatedLineAmount != null ? Number(item.calculatedLineAmount) : 0)),
    unitOfMeasure: item.unitOfMeasure || ""
  }));

  const totalDueVal = data.totalDue != null 
    ? Number(data.totalDue) 
    : (data.printedTotalAmount != null ? Number(data.printedTotalAmount) : 0);

  const payload = {
    supplierName: data.supplierName || "",
    invoiceNumber: data.invoiceNumber || "",
    invoiceDate: data.invoiceDate || "",
    lineItems,
    totalDue: totalDueVal
  };

  const encoded = encodeUrlSafeBase64(payload);
  const targetUrl = `${APP2_PUBLISHED_URL}?extractedInvoice=${encodeURIComponent(encoded)}`;

  window.open(targetUrl, "_blank", "noopener,noreferrer");

  return "Opening 3-Way Match with this invoice...";
}

/**
 * Filter invoices eligible for transfer to App 2
 */
export function filterApp2EligibleInvoices(invoices: InvoiceRecord[]): InvoiceRecord[] {
  return invoices.filter((inv) => {
    // 1. Must not be soft-deleted
    if (inv.isDeleted) return false;

    // 2. Must be completed processing
    if (inv.processingStatus !== "COMPLETED") return false;

    // 3. Exclude explicit blocking or unreviewed statuses
    if (
      inv.app1Status === "REVIEW_REQUIRED" ||
      inv.app1Status === "REJECTED_BY_HUMAN" ||
      inv.app1Status === "CANNOT_PROCESS"
    ) {
      return false;
    }

    // Exclude unreviewed duplicates
    if (inv.duplicateCheckStatus === "POSSIBLE_DUPLICATE" || inv.duplicateCheckStatus === "EXACT_DUPLICATE") {
      if (inv.reviewDecision?.decision !== "APPROVE") {
        return false;
      }
    }

    // 4. Exclude records with blocking issues
    const hasBlockingIssue = (inv.issues || []).some((issue) => issue.severity === "BLOCKING");
    if (hasBlockingIssue) return false;

    // 5. Check if status is READY_FOR_APP2 or manually approved exception
    const isReadyStatus = inv.app1Status === "READY_FOR_APP2";
    const isManuallyApproved =
      inv.reviewDecision?.decision === "APPROVE" ||
      inv.reviewDecision?.newStatus === "READY_FOR_APP2" ||
      (inv as any).humanDecision === "APPROVED_FOR_APP2";

    if (!isReadyStatus && !isManuallyApproved) return false;

    // 6. Must have extracted data
    if (!inv.extractedData) return false;

    return true;
  });
}

/**
 * Build wrapped transfer package envelope structure
 */
export function buildTransferPackage(eligibleInvoices: InvoiceRecord[], customTransferId?: string) {
  const transferId = customTransferId || `tr_app1_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const invoices = eligibleInvoices.map((inv) => {
    const ext = (inv.extractedData || {}) as ExtractionResult;
    const approvedBy = inv.reviewDecision?.reviewedBy || (inv as any).approvedBy || "Madam Lim";
    const approvedAt = inv.reviewDecision?.reviewedAt || (inv as any).approvedAt || inv.uploadedAt || new Date().toISOString();
    const reviewNotes = inv.reviewDecision?.reviewNotes || (inv as any).approvalReason || (inv as any).reviewNotes || "";

    const lineItems = (ext.lineItems || []).map((item: any, idx: number) => ({
      lineNumber: item.lineNumber || idx + 1,
      description: item.description || "Line Item",
      quantity: item.quantity != null ? Number(item.quantity) : 0,
      unitOfMeasure: item.unitOfMeasure || "",
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : 0,
      lineAmount: item.printedLineAmount != null
        ? Number(item.printedLineAmount)
        : (item.calculatedLineAmount != null
          ? Number(item.calculatedLineAmount)
          : (item.lineAmount != null
            ? Number(item.lineAmount)
            : ((item.quantity || 0) * (item.unitPrice || 0))))
    }));

    const calculatedSubtotal = inv.calculatedSubtotal != null
      ? Number(inv.calculatedSubtotal)
      : (ext.printedSubtotal != null ? Number(ext.printedSubtotal) : 0);

    const taxAmount = ext.printedTaxAmount != null ? Number(ext.printedTaxAmount) : 0;

    const totalAmount = ext.printedTotalAmount != null
      ? Number(ext.printedTotalAmount)
      : (inv.calculatedTotal != null ? Number(inv.calculatedTotal) : 0);

    return {
      app1RecordId: inv.id,
      app1Status: inv.app1Status || "READY_FOR_APP2",
      supplierName: ext.supplierName || "",
      invoiceNumber: ext.invoiceNumber || "",
      invoiceDate: ext.invoiceDate || "",
      dueDate: ext.dueDate || null,
      poReference: ext.poReference || "",
      currency: ext.currency || "SGD",
      lineItems,
      calculatedSubtotal,
      taxAmount,
      totalAmount,
      sourceFileName: inv.filename || inv.sourceFileName || "invoice.pdf",
      approvedBy,
      approvedAt,
      reviewNotes
    };
  });

  return {
    type: "BOON_HUAT_APP1_APPROVED_INVOICES",
    version: 1,
    sourceApp: "APP1",
    destinationApp: "APP2",
    transferId,
    sentAt: new Date().toISOString(),
    approvedInvoiceCount: invoices.length,
    invoices
  };
}

/**
 * Validate that every invoice in the package contains required transfer fields using camelCase
 */
export function validateInvoicesForTransfer(invoices: any[]): { valid: boolean; error?: string } {
  for (const inv of invoices) {
    const hasSupplier = Boolean(inv.supplierName && String(inv.supplierName).trim() && inv.supplierName !== "Unknown Supplier");
    const hasInvNum = Boolean(inv.invoiceNumber && String(inv.invoiceNumber).trim() && inv.invoiceNumber !== "N/A");
    const hasInvDate = Boolean(inv.invoiceDate && String(inv.invoiceDate).trim() && inv.invoiceDate !== "N/A");
    const hasPoRef = Boolean(inv.poReference && String(inv.poReference).trim() && inv.poReference !== "N/A");
    const hasTotal = inv.totalAmount != null && !isNaN(Number(inv.totalAmount)) && Number(inv.totalAmount) > 0;
    const hasLineItems = Array.isArray(inv.lineItems) && inv.lineItems.length > 0;

    if (!hasSupplier || !hasInvNum || !hasInvDate || !hasPoRef || !hasTotal || !hasLineItems) {
      return {
        valid: false,
        error: "Complete the required invoice review before sending this invoice to the 3-Way Match app."
      };
    }
  }
  return { valid: true };
}

/**
 * Send approved invoices to App 2 using URL Parameter (`invoiceData`) and postMessage protocol
 */
export async function initiateApp2DirectTransfer(
  onStateChange: (state: TransferState) => void,
  onSuccessRefresh?: () => Promise<void>,
  targetInvoices?: InvoiceRecord[]
): Promise<void> {
  // Step 1: Set status PREPARING
  onStateChange({
    status: "PREPARING",
    message: "PREPARING TRANSFER…"
  });

  // Step 2: Confirm App 1 session & load active invoice records (or use provided targetInvoices)
  let freshInvoices: InvoiceRecord[] = [];
  try {
    const sessionRes = await checkSessionApi();
    if (!sessionRes.isAuthenticated && !sessionRes.authenticated) {
      onStateChange({
        status: "TRANSFER_FAILED",
        message: "Your session has expired. Please sign in again.",
        errorType: "UNKNOWN"
      });
      return;
    }

    if (targetInvoices && targetInvoices.length > 0) {
      freshInvoices = targetInvoices;
    } else {
      const res = await fetchInvoicesApi(false);
      freshInvoices = res.invoices;
    }
  } catch (err: any) {
    onStateChange({
      status: "TRANSFER_FAILED",
      message: err.message || "Failed to load active invoice records.",
      errorType: "UNKNOWN"
    });
    return;
  }

  // Step 3: Filter eligible invoices
  const eligibleInvoices = filterApp2EligibleInvoices(freshInvoices);
  const approvedCount = eligibleInvoices.length;

  if (approvedCount === 0) {
    void logTransferAuditEventApi({
      actionType: "APP2_TRANSFER_FAILED",
      result: "FAILURE",
      reason: "No invoices are currently ready for App 2."
    });
    onStateChange({
      status: "TRANSFER_FAILED",
      message: "No invoices are currently ready for App 2.",
      errorType: "NO_INVOICES"
    });
    return;
  }

  // Step 4: Build transfer package & validate required fields
  const transferPackage = buildTransferPackage(eligibleInvoices);
  const validationResult = validateInvoicesForTransfer(transferPackage.invoices);

  if (!validationResult.valid) {
    const errMsg = validationResult.error || "Complete the required invoice review before sending this invoice to the 3-Way Match app.";
    void logTransferAuditEventApi({
      actionType: "APP2_TRANSFER_FAILED",
      result: "FAILURE",
      reason: errMsg
    });
    onStateChange({
      status: "TRANSFER_FAILED",
      message: errMsg,
      errorType: "INVALID_DATA"
    });
    return;
  }

  // Step 5: Encode payload and construct destination URL safely with `invoiceData` parameter
  const encodedPayload = encodeUrlSafeBase64(transferPackage);
  const destinationUrl = new URL(APP2_PUBLISHED_URL);
  destinationUrl.searchParams.set("invoiceData", encodedPayload);

  const fullUrlString = destinationUrl.toString();

  // Step 6: Check URL size threshold (12,000 chars)
  if (fullUrlString.length > 12000) {
    const sizeErrMsg = "TRANSFER TOO LARGE FOR DIRECT LINK\nToo many invoices are selected for direct transfer. Reduce the selected invoices or use the existing export/import fallback.";
    void logTransferAuditEventApi({
      actionType: "APP2_TRANSFER_FAILED",
      result: "FAILURE",
      reason: "Transfer payload exceeds maximum direct URL length threshold of 12,000 characters."
    });
    onStateChange({
      status: "TRANSFER_FAILED",
      message: sizeErrMsg,
      errorType: "TOO_LARGE"
    });
    return;
  }

  const transferId = transferPackage.transferId;
  const invoiceNumbers = transferPackage.invoices.map((i) => i.invoiceNumber).join(", ");

  // Audit event: APP2_TRANSFER_CREATED & APP2_TRANSFER_OPENED
  void logTransferAuditEventApi({
    actionType: "APP2_TRANSFER_CREATED",
    result: "INFO",
    transferId,
    approvedInvoiceCount: approvedCount,
    reason: `Created transfer package with ${approvedCount} invoice(s): ${invoiceNumbers}`
  });

  onStateChange({
    status: "OPENING_APP2",
    message: "OPENING 3-WAY MATCH…"
  });

  // Step 7: Open popup window directly in current user gesture thread
  let app2Window: Window | null = null;
  try {
    app2Window = window.open(fullUrlString, "_blank");
    if (app2Window) {
      try {
        app2Window.opener = null;
      } catch (e) {
        // ignore
      }
    }
  } catch (err) {
    app2Window = null;
  }

  void logTransferAuditEventApi({
    actionType: "APP2_TRANSFER_OPENED",
    result: "INFO",
    transferId,
    approvedInvoiceCount: approvedCount,
    reason: `Opened published App 2 window with transferId ${transferId}`
  });

  onStateChange({
    status: "WAITING_FOR_APP2",
    transferId,
    message: "OPENING 3-WAY MATCH…"
  });

  // Track postMessage responses for handshake
  let hasReceivedAck = false;
  let timeoutTimer: any = null;

  const cleanup = () => {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    window.removeEventListener("message", handleMessage);
  };

  // 15-second timeout handler for postMessage confirmation
  timeoutTimer = setTimeout(() => {
    cleanup();
    if (!hasReceivedAck) {
      // Data was already sent in URL parameter. Show non-definitive notification
      if (onSuccessRefresh) {
        void onSuccessRefresh();
      }

      onStateChange({
        status: "SUCCESS",
        transferId,
        importedCount: approvedCount,
        message: "App 2 was opened. Import confirmation has not yet been received."
      });
    }
  }, 15000);

  function handleMessage(event: MessageEvent) {
    // Validate origin safely
    if (event.origin !== APP2_ORIGIN && !event.origin.includes("ai.studio")) return;
    if (!event.data || typeof event.data !== "object") return;

    // Handle ready event
    if (event.data.type === "BOON_HUAT_APP2_READY") {
      try {
        if (app2Window) {
          app2Window.postMessage(
            { ...transferPackage, nonce: event.data.nonce },
            "*"
          );
        }
      } catch (err) {
        // ignore
      }
      return;
    }

    // Handle import ACK event
    if (event.data.type === "BOON_HUAT_APP2_IMPORT_ACK") {
      if (event.data.transferId !== transferId) return;

      hasReceivedAck = true;
      cleanup();

      if (event.data.success !== false) {
        void logTransferAuditEventApi({
          actionType: "APP2_TRANSFER_ACKNOWLEDGED",
          result: "SUCCESS",
          transferId,
          approvedInvoiceCount: approvedCount,
          reason: `App 2 acknowledged import of ${approvedCount} invoice(s)`
        });

        if (onSuccessRefresh) {
          void onSuccessRefresh();
        }

        onStateChange({
          status: "TRANSFER_RECEIVED",
          transferId,
          importedCount: approvedCount,
          message: "TRANSFER RECEIVED BY APP 2"
        });
      } else {
        void logTransferAuditEventApi({
          actionType: "APP2_TRANSFER_FAILED",
          result: "FAILURE",
          transferId,
          approvedInvoiceCount: approvedCount,
          reason: "App 2 responded with import failure."
        });

        onStateChange({
          status: "TRANSFER_FAILED",
          message: "App 2 failed to import the transferred invoices.",
          errorType: "NO_ACK"
        });
      }
    }
  }

  window.addEventListener("message", handleMessage);
}

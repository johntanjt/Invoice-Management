import { InvoiceRecord, AuditEvent, DashboardSummary, AuthenticatedUser } from "../types";

export async function loginApi(profileId: string, passcode: string): Promise<{
  success: boolean;
  authenticated?: boolean;
  user?: AuthenticatedUser;
  userName?: string;
  inactivityTimeoutMinutes?: number;
  lastActivityAt?: string;
  expiresAt?: string;
  message?: string;
  error?: string;
}> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, passcode }),
    credentials: "include"
  });
  return res.json();
}

export async function checkSessionApi(): Promise<{
  success?: boolean;
  authenticated?: boolean;
  isAuthenticated?: boolean;
  user?: AuthenticatedUser;
  userName?: string;
  inactivityTimeoutMinutes?: number;
  lastActivityAt?: string;
  expiresAt?: string;
  code?: string;
  message?: string;
}> {
  const res = await fetch("/api/auth/session", { credentials: "include" });
  return res.json();
}

export async function updateActivityApi(): Promise<{
  success: boolean;
  lastActivityAt?: string;
  expiresAt?: string;
  inactivityTimeoutMinutes?: number;
  code?: string;
  message?: string;
}> {
  const res = await fetch("/api/auth/activity", {
    method: "POST",
    credentials: "include"
  });
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("SESSION_EXPIRED");
    }
  }
  return res.json();
}

export async function updateSessionTimeoutApi(inactivityTimeoutMinutes: number): Promise<{
  success: boolean;
  inactivityTimeoutMinutes?: number;
  message?: string;
  error?: string;
}> {
  const res = await fetch("/api/settings/session-timeout", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inactivityTimeoutMinutes }),
    credentials: "include"
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("SESSION_EXPIRED");
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to update timeout setting.");
  }
  return res.json();
}

export async function logSessionAuditEventApi(payload: {
  actionType: string;
  result?: "SUCCESS" | "FAILURE" | "INFO";
  reason?: string;
  previousValue?: string;
  newValue?: string;
}): Promise<void> {
  try {
    await fetch("/api/audit/session-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include"
    });
  } catch (err) {
    console.warn("Failed to log session audit event:", err);
  }
}

export async function logoutApi(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}

export async function fetchInvoicesApi(includeDeleted = false): Promise<{ invoices: InvoiceRecord[]; summary: DashboardSummary }> {
  const res = await fetch(`/api/invoices?includeDeleted=${includeDeleted}`, { credentials: "include" });
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("SESSION_EXPIRED");
    }
    throw new Error("Failed to fetch invoices.");
  }
  return res.json();
}

export async function processFileApi(payload: {
  filename: string;
  fileMimeType: string;
  fileSize: number;
  fileBase64: string;
  skipDuplicateEvaluation?: boolean;
}): Promise<{ isExactDuplicate: boolean; message?: string; existingInvoice?: InvoiceRecord; record?: InvoiceRecord }> {
  const res = await fetch("/api/invoices/process-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include"
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("SESSION_EXPIRED");
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to process file.");
  }
  return res.json();
}

export async function syncLocalStorageApi(payload: {
  invoices: InvoiceRecord[];
  poCsvData?: string;
  grnCsvData?: string;
  auditEvents?: AuditEvent[];
}): Promise<{ invoices: InvoiceRecord[]; summary: DashboardSummary; auditTrail: AuditEvent[]; poCsvData?: string; grnCsvData?: string }> {
  const res = await fetch("/api/invoices/sync-localstorage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include"
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("SESSION_EXPIRED");
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to sync local storage.");
  }
  return res.json();
}

export async function savePoGrnCsvApi(payload: {
  poCsvData?: string;
  grnCsvData?: string;
}): Promise<{ success: boolean; poCsvData: string; grnCsvData: string }> {
  const res = await fetch("/api/data/po-grn-csv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include"
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("SESSION_EXPIRED");
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save PO/GRN CSV data.");
  }
  return res.json();
}

export async function evaluateDuplicatesApi(): Promise<{ invoices: InvoiceRecord[]; summary: DashboardSummary }> {
  const res = await fetch("/api/invoices/evaluate-duplicates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include"
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("SESSION_EXPIRED");
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to evaluate duplicates.");
  }
  return res.json();
}

export async function reviewInvoiceApi(id: string, payload: {
  decision: "APPROVE" | "REJECT" | "HOLD" | "CORRECT";
  reviewNotes: string;
  correctedFields?: Record<string, any>;
}): Promise<{ success: boolean; record: InvoiceRecord }> {
  const res = await fetch(`/api/invoices/${id}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include"
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("SESSION_EXPIRED");
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to review invoice.");
  }
  return res.json();
}

export async function authoriseActionApi(payload: {
  passcode: string;
  action: "DELETE_INVOICE" | "DELETE_SELECTED" | "DELETE_ALL" | string;
}): Promise<{ success: boolean; authorised: boolean; message?: string }> {
  const res = await fetch("/api/auth/authorise-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include"
  });
  if (!res.ok) {
    if (res.status === 401) {
      const err = await res.json().catch(() => ({}));
      if (err.authorised === false) {
        return { success: false, authorised: false, message: err.message || "Incorrect action passcode." };
      }
      throw new Error("SESSION_EXPIRED");
    }
    const err = await res.json().catch(() => ({}));
    return { success: false, authorised: false, message: err.message || "Authorisation failed." };
  }
  return res.json();
}

export async function softDeleteSingleInvoiceApi(recordId: string, payload: {
  deletionReason: string;
  confirmationPhrase: "DELETE";
  passcode?: string;
}): Promise<{ success: boolean; record?: InvoiceRecord }> {
  const res = await fetch(`/api/invoices/${recordId}/soft-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include"
  });
  if (!res.ok) {
    if (res.status === 401) {
      const err = await res.json().catch(() => ({}));
      if (err.message && err.message.includes("passcode")) {
        throw new Error("Incorrect action passcode.");
      }
      throw new Error("SESSION_EXPIRED");
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to delete invoice.");
  }
  return res.json();
}

export async function softDeleteSelectedInvoicesApi(payload: {
  recordIds: string[];
  deletionReason: string;
  confirmationPhrase: "DELETE SELECTED";
  passcode?: string;
}): Promise<{ success: boolean; deletedCount: number }> {
  const res = await fetch("/api/invoices/bulk-soft-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include"
  });
  if (!res.ok) {
    if (res.status === 401) {
      const err = await res.json().catch(() => ({}));
      if (err.message && err.message.includes("passcode")) {
        throw new Error("Incorrect action passcode.");
      }
      throw new Error("SESSION_EXPIRED");
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to delete selected invoices.");
  }
  return res.json();
}

export async function softDeleteAllInvoicesApi(payload: {
  deletionReason: string;
  confirmationPhrase: "DELETE ALL INVOICES";
  passcode?: string;
}): Promise<{ success: boolean; deletedCount: number }> {
  const res = await fetch("/api/invoices/soft-delete-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include"
  });
  if (!res.ok) {
    if (res.status === 401) {
      const err = await res.json().catch(() => ({}));
      if (err.message && err.message.includes("passcode")) {
        throw new Error("Incorrect action passcode.");
      }
      throw new Error("SESSION_EXPIRED");
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to delete all invoices.");
  }
  return res.json();
}

export async function deleteInvoiceApi(id: string, payload: {
  passcode: string;
  reason: string;
  phrase: "DELETE";
}): Promise<{ success: boolean }> {
  return softDeleteSingleInvoiceApi(id, {
    deletionReason: payload.reason,
    confirmationPhrase: payload.phrase,
    passcode: payload.passcode
  });
}

export async function deleteSelectedInvoicesApi(payload: {
  passcode: string;
  reason: string;
  phrase: "DELETE SELECTED";
  ids: string[];
}): Promise<{ success: boolean; deletedCount: number }> {
  return softDeleteSelectedInvoicesApi({
    recordIds: payload.ids,
    deletionReason: payload.reason,
    confirmationPhrase: payload.phrase,
    passcode: payload.passcode
  });
}

export async function deleteAllInvoicesApi(payload: {
  passcode: string;
  reason: string;
  phrase: "DELETE ALL INVOICES";
}): Promise<{ success: boolean; deletedCount: number }> {
  return softDeleteAllInvoicesApi({
    deletionReason: payload.reason,
    confirmationPhrase: payload.phrase,
    passcode: payload.passcode
  });
}

export async function restoreInvoiceApi(id: string, payload: {
  passcode: string;
  reason: string;
}): Promise<{ success: boolean; record: InvoiceRecord }> {
  const res = await fetch(`/api/invoices/${id}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include"
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("SESSION_EXPIRED");
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to restore invoice.");
  }
  return res.json();
}

export async function fetchAuditTrailApi(): Promise<{ auditTrail: AuditEvent[] }> {
  const res = await fetch("/api/audit", { credentials: "include" });
  if (!res.ok) {
    if (res.status === 401) throw new Error("SESSION_EXPIRED");
    throw new Error("Failed to fetch audit trail.");
  }
  return res.json();
}

export async function notifyApp2OpenedApi(): Promise<void> {
  await fetch("/api/audit/app2-opened", { method: "POST", credentials: "include" });
}

export async function logTransferAuditEventApi(payload: {
  actionType: "APP2_TRANSFER_STARTED" | "APPROVED_INVOICES_SENT_TO_APP2" | "APP2_TRANSFER_CONFIRMED" | "APP2_TRANSFER_FAILED";
  result: "SUCCESS" | "FAILURE" | "INFO";
  transferId?: string;
  approvedInvoiceCount?: number;
  approvedInvoiceTotal?: number;
  reason?: string;
}): Promise<void> {
  await fetch("/api/audit/transfer-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include"
  }).catch(() => {});
}

export async function downloadApprovedInvoiceWorkbook(): Promise<{ success: boolean; message?: string }> {
  try {
    const res = await fetch("/api/exports/app1-workbook", {
      method: "GET",
      credentials: "include"
    });

    if (!res.ok) {
      if (res.status === 401) {
        return { success: false, message: "Your session has expired. Please sign in again." };
      }
      const errData = await res.json().catch(() => ({}));
      return {
        success: false,
        message: errData.message || errData.error || "The approved-invoice workbook could not be generated."
      };
    }

    const contentType = res.headers.get("Content-Type") || "";
    if (
      !contentType.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") &&
      !contentType.includes("octet-stream") &&
      !contentType.includes("spreadsheet")
    ) {
      const errData = await res.json().catch(() => ({}));
      return {
        success: false,
        message: errData.message || errData.error || "The server did not return a valid Excel workbook."
      };
    }

    const blob = await res.blob();
    if (!blob || blob.size === 0) {
      return { success: false, message: "The server returned an empty workbook file." };
    }

    // Extract filename from Content-Disposition header if available
    let filename = "";
    const disposition = res.headers.get("Content-Disposition");
    if (disposition && disposition.includes("filename=")) {
      const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
      if (matches && matches[1]) {
        filename = matches[1].replace(/['"]/g, "").trim();
      }
    }

    if (!filename) {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const min = String(now.getMinutes()).padStart(2, "0");
      filename = `Boon_Huat_App1_Invoice_Review_${yyyy}-${mm}-${dd}_${hh}${min}.xlsx`;
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || "Network error while downloading the approved-invoice workbook."
    };
  }
}

export async function downloadXlsxWorkbook(): Promise<{ success: boolean; message?: string }> {
  return downloadApprovedInvoiceWorkbook();
}

export async function retryInvoiceApi(recordId: string, payload?: {
  fileBase64?: string;
  filename?: string;
  fileMimeType?: string;
  manualHashOverride?: boolean;
}): Promise<{
  success: boolean;
  code?: string;
  message?: string;
  error?: string;
  record?: InvoiceRecord;
  summary?: DashboardSummary;
  invoices?: InvoiceRecord[];
}> {
  const res = await fetch(`/api/invoices/${encodeURIComponent(recordId)}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
    credentials: "include"
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("SESSION_EXPIRED");
    const err = await res.json().catch(() => ({}));
    return {
      success: false,
      code: err.code || "RETRY_FAILED",
      message: err.message || err.error || "Failed to retry invoice processing.",
      error: err.error || err.message,
      record: err.record
    };
  }
  return res.json();
}

export async function retryBatchInvoicesApi(payload?: {
  recordIds?: string[];
}): Promise<{
  success: boolean;
  totalCompleted: number;
  successfullyProcessed: number;
  stillRequiresReview: number;
  failedAgain: number;
  paused: number;
  summary?: DashboardSummary;
  invoices?: InvoiceRecord[];
  message?: string;
}> {
  const res = await fetch("/api/invoices/retry-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
    credentials: "include"
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("SESSION_EXPIRED");
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to batch retry invoices.");
  }
  return res.json();
}


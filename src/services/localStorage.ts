import { InvoiceRecord, AuditEvent, ReviewDecision } from "../types";

const KEYS = {
  INVOICE_HISTORY: "app1_invoice_history",
  PO_CSV_DATA: "app1_po_csv_data",
  GRN_CSV_DATA: "app1_grn_csv_data",
  MANUAL_OVERRIDES: "app1_manual_overrides",
  AUDIT_TRAIL: "app1_audit_trail"
};

/**
 * Strips heavy fileDataUrl before saving to localStorage to stay within browser storage limits.
 */
export function sanitizeInvoicesForStorage(invoices: InvoiceRecord[]): InvoiceRecord[] {
  return invoices.map((inv) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { fileDataUrl, ...rest } = inv;
    return rest as InvoiceRecord;
  });
}

/**
 * Persists all invoice records and manual override decisions into browser localStorage.
 */
export function saveInvoicesToLocalStorage(invoices: InvoiceRecord[]): void {
  try {
    const sanitized = sanitizeInvoicesForStorage(invoices);
    localStorage.setItem(KEYS.INVOICE_HISTORY, JSON.stringify(sanitized));

    // Persist scoped manual overrides map by invoice ID
    const overridesMap: Record<string, ReviewDecision> = {};
    for (const inv of invoices) {
      if (inv.reviewDecision) {
        overridesMap[inv.id] = inv.reviewDecision;
      }
    }
    localStorage.setItem(KEYS.MANUAL_OVERRIDES, JSON.stringify(overridesMap));
  } catch (err) {
    console.warn("[LocalStorage] Failed to persist invoice records:", err);
  }
}

/**
 * Loads persisted invoice records and scoped manual overrides from browser localStorage.
 */
export function loadInvoicesFromLocalStorage(): InvoiceRecord[] {
  try {
    const rawHistory = localStorage.getItem(KEYS.INVOICE_HISTORY);
    if (!rawHistory) return [];

    const invoices: InvoiceRecord[] = JSON.parse(rawHistory);
    const overridesRaw = localStorage.getItem(KEYS.MANUAL_OVERRIDES);
    const overridesMap: Record<string, ReviewDecision> = overridesRaw ? JSON.parse(overridesRaw) : {};

    return invoices.map((inv) => {
      // Restore scoped override decision if stored separately
      if (!inv.reviewDecision && overridesMap[inv.id]) {
        inv.reviewDecision = overridesMap[inv.id];
      }
      return inv;
    });
  } catch (err) {
    console.warn("[LocalStorage] Failed to load invoice history:", err);
    return [];
  }
}

/**
 * Persists PO CSV data into browser localStorage.
 */
export function savePoCsvToLocalStorage(csvData: string): void {
  try {
    localStorage.setItem(KEYS.PO_CSV_DATA, csvData || "");
  } catch (err) {
    console.warn("[LocalStorage] Failed to save PO CSV data:", err);
  }
}

/**
 * Loads persisted PO CSV data from browser localStorage.
 */
export function loadPoCsvFromLocalStorage(): string {
  try {
    return localStorage.getItem(KEYS.PO_CSV_DATA) || "";
  } catch (err) {
    return "";
  }
}

/**
 * Persists GRN CSV data into browser localStorage.
 */
export function saveGrnCsvToLocalStorage(csvData: string): void {
  try {
    localStorage.setItem(KEYS.GRN_CSV_DATA, csvData || "");
  } catch (err) {
    console.warn("[LocalStorage] Failed to save GRN CSV data:", err);
  }
}

/**
 * Loads persisted GRN CSV data from browser localStorage.
 */
export function loadGrnCsvFromLocalStorage(): string {
  try {
    return localStorage.getItem(KEYS.GRN_CSV_DATA) || "";
  } catch (err) {
    return "";
  }
}

/**
 * Persists audit trail events into browser localStorage.
 */
export function saveAuditEventsToLocalStorage(events: AuditEvent[]): void {
  try {
    localStorage.setItem(KEYS.AUDIT_TRAIL, JSON.stringify(events || []));
  } catch (err) {
    console.warn("[LocalStorage] Failed to save audit trail:", err);
  }
}

/**
 * Loads audit trail events from browser localStorage.
 */
export function loadAuditEventsFromLocalStorage(): AuditEvent[] {
  try {
    const raw = localStorage.getItem(KEYS.AUDIT_TRAIL);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

/**
 * Clears all persisted session data from browser localStorage if requested.
 */
export function clearLocalStorageSession(): void {
  try {
    localStorage.removeItem(KEYS.INVOICE_HISTORY);
    localStorage.removeItem(KEYS.PO_CSV_DATA);
    localStorage.removeItem(KEYS.GRN_CSV_DATA);
    localStorage.removeItem(KEYS.MANUAL_OVERRIDES);
    localStorage.removeItem(KEYS.AUDIT_TRAIL);
  } catch (err) {
    console.warn("[LocalStorage] Failed to clear session data:", err);
  }
}

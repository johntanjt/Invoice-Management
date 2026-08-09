import { InvoiceData, InvoiceLineItem } from "../types";

/**
 * Reverses App1's encodeBase64Url() (used for the ?invoiceData= batch payload):
 * base64url -> base64 -> binary string -> UTF-8 JSON string
 */
export function decodeBase64Url(value: string): any {
  let base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

/**
 * Reverses App1's plain btoa() encoding (used for the ?extractedInvoice= single-invoice payload).
 * Note: URLSearchParams already undoes the encodeURIComponent() wrapper App1 applied, so `value`
 * here is the raw base64 string with no further decodeURIComponent needed.
 */
export function decodePlainBase64(value: string): any {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

const normaliseSupplier = (val: string) => (val || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
const normaliseInvoiceNumber = (val: string) => (val || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalisePOReference = (val: string) => (val || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Maps a single App1 invoice object (from either the batch `invoices[]` array or the
 * single-invoice payload) into App2's InvoiceData shape.
 */
export function mapApp1InvoiceToApp2(inv: {
  app1RecordId?: string;
  app1Status?: string;
  supplierName?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string | null;
  poReference?: string;
  currency?: string;
  lineItems?: any[];
  calculatedSubtotal?: number | null;
  taxAmount?: number | null;
  totalAmount?: number | null;
  sourceFileName?: string;
  approvedBy?: string;
  approvedAt?: string;
  reviewNotes?: string | null;
}): InvoiceData {
  const supplierName = inv.supplierName || "";
  const invoiceNumber = inv.invoiceNumber || "";
  const poReference = inv.poReference || "";

  const lines: InvoiceLineItem[] = (inv.lineItems || []).map((li: any, idx: number) => ({
    record_id: `${inv.app1RecordId || invoiceNumber || "LINE"}_L${li.lineNumber || idx + 1}`,
    line_number: li.lineNumber || idx + 1,
    description: li.description || "",
    quantity: li.quantity != null ? Number(li.quantity) : 0,
    unit_price: li.unitPrice != null ? Number(li.unitPrice) : 0,
    // App1's batch payload uses "lineAmount"; the single-invoice payload uses "amount"
    line_total: li.lineAmount != null ? Number(li.lineAmount) : (li.amount != null ? Number(li.amount) : 0),
  }));

  const totalAmount = inv.totalAmount != null ? Number(inv.totalAmount) : 0;
  const subtotal = inv.calculatedSubtotal != null ? Number(inv.calculatedSubtotal) : totalAmount;

  return {
    record_id: inv.app1RecordId || `INV_${normaliseSupplier(supplierName)}_${normaliseInvoiceNumber(invoiceNumber)}_${normalisePOReference(poReference)}`,
    status: "READY_FOR_3_WAY_MATCH",
    check_result: "READY",
    supplier_name: supplierName,
    invoice_number: invoiceNumber,
    invoice_date: inv.invoiceDate || "",
    due_date: inv.dueDate || "",
    po_number: poReference,
    currency: inv.currency || "SGD",
    subtotal,
    tax_amount: inv.taxAmount != null ? Number(inv.taxAmount) : 0,
    total_amount: totalAmount,
    file_format: "URL_TRANSFER",
    document_style: "APP1_LIVE_HANDOFF",
    source_filename: inv.sourceFileName || "app1-live-transfer",
    source_invoice_link: "",
    extraction_status: "COMPLETED",
    duplicate_status: "CLEAR",
    human_decision: null,
    approval_type: "APP1_APPROVED",
    approved_by: inv.approvedBy || "App 1 System",
    approval_date: inv.approvedAt || new Date().toISOString(),
    review_notes: inv.reviewNotes || "Received via App 1 live URL transfer",
    processing_status: inv.app1Status || "READY_FOR_APP2",
    lines,
    importIssues: [],
    hasLineItems: lines.length > 0,
    lineItemStatus: lines.length > 0 ? "INCLUDED" : "NOT_INCLUDED_IN_APP1_EXPORT",
  };
}

export interface ParsedApp1UrlPayload {
  invoices: InvoiceData[];
  transferId: string;
}

/**
 * Reads window.location.search for either App1 handoff format and returns mapped
 * InvoiceData[] ready to merge into App2 state. Returns null if neither param is present.
 */
export function parseApp1UrlPayload(): ParsedApp1UrlPayload | null {
  const params = new URLSearchParams(window.location.search);
  const batchParam = params.get("invoiceData");
  const singleParam = params.get("extractedInvoice");

  if (batchParam) {
    const pkg = decodeBase64Url(batchParam);
    if (pkg?.type !== "BOON_HUAT_APP1_APPROVED_INVOICES") {
      throw new Error("Unrecognised transfer payload type received from App 1.");
    }
    const invoices = (pkg.invoices || []).map(mapApp1InvoiceToApp2);
    return { invoices, transferId: pkg.transferId || "" };
  }

  if (singleParam) {
    const single = decodePlainBase64(singleParam);
    const invoices = [
      mapApp1InvoiceToApp2({
        supplierName: single.supplierName,
        invoiceNumber: single.invoiceNumber,
        invoiceDate: single.invoiceDate,
        poReference: single.poReference || "",
        lineItems: single.lineItems || [],
        totalAmount: single.totalDue,
      }),
    ];
    return { invoices, transferId: "" };
  }

  return null;
}

/** Strips ?invoiceData=/?extractedInvoice= from the URL bar after a successful import. */
export function clearApp1TransferParams(): void {
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);
}

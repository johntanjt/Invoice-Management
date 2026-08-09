import { 
  InvoiceRecord, 
  ExtractionResult, 
  ValidationIssue, 
  App1Status, 
  FieldConfidence,
  LineItem
} from "../types.js";

/**
 * Checks if a value is a system placeholder or missing value
 */
export function isPlaceholderValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  const cleaned = value.trim().toUpperCase();
  if (cleaned === "") return true;
  const placeholders = [
    "UNKNOWN",
    "PENDING REVIEW",
    "PENDING_REVIEW",
    "SUPPLIER (PENDING REVIEW)",
    "SUPPLIER (PENDING_REVIEW)",
    "SUPPLIER PENDING REVIEW",
    "UNKNOWN SUPPLIER",
    "NOT EXTRACTED",
    "NOT_EXTRACTED",
    "UNAVAILABLE"
  ];
  return placeholders.includes(cleaned);
}

/**
 * Checks if an invoice number is missing, placeholder, or truncated prefix (e.g. WSIS, AA)
 */
export function isInvalidInvoiceNumber(invNum: string | null | undefined): boolean {
  if (!invNum || isPlaceholderValue(invNum)) return true;
  const cleaned = invNum.trim();
  if (cleaned.length < 3) return true;
  // Purely letters with no digits (e.g., "WSIS", "AA", "TBMW", "NKHS", "INV", "DOC")
  if (/^[A-Za-z]+$/.test(cleaned)) return true;
  return false;
}

/**
 * Normalises PO references to identify missing or placeholders
 */
export function isPoReferenceMissing(poRef: string | null | undefined): boolean {
  if (!poRef || isPlaceholderValue(poRef)) return true;
  const cleaned = poRef.trim().toUpperCase();
  const missingValues = ["N/A", "NA", "NONE", "NOT AVAILABLE", "NOT_AVAILABLE", "-", "N.A."];
  return cleaned === "" || missingValues.includes(cleaned);
}

/**
 * Normalises string for duplicate matching
 */
export function normaliseString(str: string | null | undefined): string {
  if (!str) return "";
  return str.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Calculates deterministic line amounts and totals
 */
export function calculateInvoiceAmounts(extracted: ExtractionResult) {
  let calculatedSubtotal = 0;
  const processedLineItems: LineItem[] = [];

  for (const item of extracted.lineItems || []) {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPrice) || 0;
    const calculatedLineAmount = Math.round(qty * price * 100) / 100;
    
    calculatedSubtotal += calculatedLineAmount;

    const printedLineAmount = item.printedLineAmount != null ? Number(item.printedLineAmount) : null;
    const matches = printedLineAmount != null 
      ? Math.abs(calculatedLineAmount - printedLineAmount) <= 0.01 
      : true;

    processedLineItems.push({
      ...item,
      quantity: item.quantity != null ? Number(item.quantity) : null,
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      printedLineAmount,
      calculatedLineAmount,
      amountMatches: matches
    });
  }

  calculatedSubtotal = Math.round(calculatedSubtotal * 100) / 100;

  const printedSubtotal = extracted.printedSubtotal != null ? Number(extracted.printedSubtotal) : null;
  const tax = extracted.printedTaxAmount != null ? Number(extracted.printedTaxAmount) : 0;
  const discount = extracted.printedDiscount != null ? Number(extracted.printedDiscount) : 0;
  const charges = extracted.printedAdditionalCharges != null ? Number(extracted.printedAdditionalCharges) : 0;

  const calculatedTotal = Math.round((calculatedSubtotal + tax - discount + charges) * 100) / 100;

  const printedTotal = extracted.printedTotalAmount != null ? Number(extracted.printedTotalAmount) : null;

  let amountCheckStatus: "PASS" | "FAIL" | "WARNING" | "NOT_RUN" = "PASS";
  let subtotalCheckStatus: "MATCH" | "MISMATCH" | "NOT_STATED" = "MATCH";
  const taxTreatment: "STATED" | "NOT_STATED" = extracted.printedTaxAmount != null ? "STATED" : "NOT_STATED";

  if (printedSubtotal == null) {
    subtotalCheckStatus = "NOT_STATED";
  } else {
    subtotalCheckStatus = Math.abs(calculatedSubtotal - printedSubtotal) <= 0.01 ? "MATCH" : "MISMATCH";
  }

  if (printedTotal != null && Math.abs(calculatedTotal - printedTotal) > 0.01) {
    amountCheckStatus = "FAIL";
  }

  return {
    processedLineItems,
    calculatedSubtotal,
    calculatedTotal,
    amountCheckStatus,
    subtotalCheckStatus,
    taxTreatment
  };
}

/**
 * Validates extracted fields and identifies blocking issues
 */
export function validateInvoiceFields(extracted: ExtractionResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Document Type
  if (!extracted.documentType || extracted.documentType !== "INVOICE") {
    issues.push({
      code: "INVALID_DOC_TYPE",
      severity: "BLOCKING",
      message: "Document is not classified as a valid supplier invoice.",
      field: "documentType",
      actualValue: extracted.documentType || "NULL",
      recommendedAction: "Verify if document is a valid invoice or reject."
    });
  }

  // 2. Supplier Name
  if (!extracted.supplierName || isPlaceholderValue(extracted.supplierName)) {
    issues.push({
      code: "MISSING_SUPPLIER_NAME",
      severity: "BLOCKING",
      message: "Supplier name is missing or unreadable.",
      field: "supplierName",
      recommendedAction: "Enter supplier name manually during review."
    });
  }

  // 3. Invoice Number
  if (!extracted.invoiceNumber || isInvalidInvoiceNumber(extracted.invoiceNumber)) {
    issues.push({
      code: "MISSING_INVOICE_NUMBER",
      severity: "BLOCKING",
      message: "Invoice number is missing or unreadable.",
      field: "invoiceNumber",
      recommendedAction: "Enter invoice number manually during review."
    });
  }

  // 4. Invoice Date
  if (!extracted.invoiceDate || isPlaceholderValue(extracted.invoiceDate)) {
    issues.push({
      code: "MISSING_INVOICE_DATE",
      severity: "BLOCKING",
      message: "Invoice date is missing or invalid.",
      field: "invoiceDate",
      recommendedAction: "Enter invoice date manually during review."
    });
  }

  // 5. PO Reference (BLOCKING if missing or N/A)
  if (isPoReferenceMissing(extracted.poReference)) {
    issues.push({
      code: "MISSING_PO_REFERENCE",
      severity: "BLOCKING",
      message: "PO reference is missing or stated as N/A.",
      field: "poReference",
      actualValue: extracted.poReference || "N/A",
      recommendedAction: "Obtain valid PO reference or provide manual approval reason."
    });
  }

  // 6. Currency
  if (!extracted.currency || isPlaceholderValue(extracted.currency)) {
    issues.push({
      code: "MISSING_CURRENCY",
      severity: "BLOCKING",
      message: "Invoice currency is missing.",
      field: "currency",
      recommendedAction: "Specify currency during review."
    });
  }

  // 7. Total Amount
  if (extracted.printedTotalAmount == null || isNaN(Number(extracted.printedTotalAmount))) {
    issues.push({
      code: "MISSING_TOTAL_AMOUNT",
      severity: "BLOCKING",
      message: "Invoice total amount is missing or invalid.",
      field: "printedTotalAmount",
      recommendedAction: "Verify total amount from invoice preview."
    });
  }

  // 8. Line Items
  if (!extracted.lineItems || extracted.lineItems.length === 0) {
    issues.push({
      code: "NO_LINE_ITEMS",
      severity: "BLOCKING",
      message: "No usable line items extracted.",
      field: "lineItems",
      recommendedAction: "Review invoice line items manually."
    });
  }

  return issues;
}

/**
 * Calculates possible content duplicate score between two invoices
 */
export function calculatePossibleDuplicateScore(inv1: InvoiceRecord, inv2: InvoiceRecord): number {
  if (inv1.id === inv2.id) return 0;
  if (!inv1.extractedData || !inv2.extractedData) return 0;

  const ext1 = inv1.extractedData;
  const ext2 = inv2.extractedData;

  // First requirement: same normalised supplier name
  const supp1 = normaliseString(ext1.supplierName);
  const supp2 = normaliseString(ext2.supplierName);
  if (!supp1 || !supp2 || (supp1 !== supp2 && !supp1.includes(supp2) && !supp2.includes(supp1))) {
    return 0;
  }

  let score = 0;

  // Same PO Reference: 20 pts
  const po1 = normaliseString(ext1.poReference);
  const po2 = normaliseString(ext2.poReference);
  if (po1 && po2 && po1 === po2 && !isPoReferenceMissing(ext1.poReference)) {
    score += 20;
  }

  // Same Invoice Date: 10 pts
  if (ext1.invoiceDate && ext2.invoiceDate && ext1.invoiceDate === ext2.invoiceDate) {
    score += 10;
  }

  // Same Currency: 5 pts
  if (ext1.currency && ext2.currency && ext1.currency.toUpperCase() === ext2.currency.toUpperCase()) {
    score += 5;
  }

  // Same Total within SGD 0.01: 20 pts
  if (ext1.printedTotalAmount != null && ext2.printedTotalAmount != null) {
    if (Math.abs(Number(ext1.printedTotalAmount) - Number(ext2.printedTotalAmount)) <= 0.01) {
      score += 20;
    }
  }

  // Line items comparison
  const lines1 = ext1.lineItems || [];
  const lines2 = ext2.lineItems || [];
  if (lines1.length > 0 && lines2.length > 0) {
    const l1 = lines1[0];
    const l2 = lines2[0];

    // Same item description: 15 pts
    const desc1 = normaliseString(l1.description);
    const desc2 = normaliseString(l2.description);
    if (desc1 && desc2 && (desc1 === desc2 || desc1.includes(desc2) || desc2.includes(desc1))) {
      score += 15;
    }

    // Same quantity: 10 pts
    if (l1.quantity != null && l2.quantity != null && l1.quantity === l2.quantity) {
      score += 10;
    }

    // Same unit price: 10 pts
    if (l1.unitPrice != null && l2.unitPrice != null && Math.abs(l1.unitPrice - l2.unitPrice) <= 0.01) {
      score += 10;
    }

    // Same line amount: 10 pts
    if (l1.printedLineAmount != null && l2.printedLineAmount != null && Math.abs(l1.printedLineAmount - l2.printedLineAmount) <= 0.01) {
      score += 10;
    }
  }

  return score;
}

/**
 * Re-evaluates duplicate checks and derives final status across all active invoices
 */
export function reevaluateAllDuplicatesAndStatuses(invoices: InvoiceRecord[]): void {
  const active = invoices.filter(i => !i.isDeleted && i.processingStatus === "COMPLETED" && i.extractedData);

  // 1. Clear previous duplicate flags and duplicate issues
  for (const record of active) {
    record.duplicateCheckStatus = "CLEAN";
    record.possibleDuplicateOf = undefined;
    record.issues = (record.issues || []).filter(issue => issue.code !== "POSSIBLE_DUPLICATE");
  }

  // 2. Evaluate all active pairs
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const recA = active[i];
      const recB = active[j];

      const score = calculatePossibleDuplicateScore(recA, recB);
      if (score >= 75) {
        recA.duplicateCheckStatus = "POSSIBLE_DUPLICATE";
        recB.duplicateCheckStatus = "POSSIBLE_DUPLICATE";

        const numA = recA.extractedData?.invoiceNumber || recA.id;
        const numB = recB.extractedData?.invoiceNumber || recB.id;

        recA.possibleDuplicateOf = {
          invoiceId: recB.id,
          invoiceNumber: numB,
          supplierName: recB.extractedData?.supplierName || "Unknown",
          score
        };
        recB.possibleDuplicateOf = {
          invoiceId: recA.id,
          invoiceNumber: numA,
          supplierName: recA.extractedData?.supplierName || "Unknown",
          score
        };

        const msgA = `Possible content duplicate of ${numB}.`;
        const msgB = `Possible content duplicate of ${numA}.`;

        if (!recA.issues.some(iss => iss.code === "POSSIBLE_DUPLICATE" && iss.message === msgA)) {
          recA.issues.push({
            code: "POSSIBLE_DUPLICATE",
            severity: "BLOCKING",
            message: msgA,
            recommendedAction: "Compare both invoices to ensure no duplicate payment."
          });
        }

        if (!recB.issues.some(iss => iss.code === "POSSIBLE_DUPLICATE" && iss.message === msgB)) {
          recB.issues.push({
            code: "POSSIBLE_DUPLICATE",
            severity: "BLOCKING",
            message: msgB,
            recommendedAction: "Compare both invoices to ensure no duplicate payment."
          });
        }
      }
    }
  }

  // 3. Re-derive App 1 Status for all records
  for (const record of invoices) {
    if (record.isDeleted) {
      record.app1Status = "DELETED" as any;
    } else {
      record.app1Status = deriveApp1Status(record);
    }
  }
}

/**
 * Derives the central App 1 Status according to strict priority rules
 */
export function deriveApp1Status(record: InvoiceRecord): App1Status {
  // Human decision overrides standard status
  if (record.reviewDecision) {
    if (record.reviewDecision.decision === "REJECT") {
      return "REJECTED_BY_HUMAN";
    }
    if (record.reviewDecision.decision === "APPROVE") {
      return "READY_FOR_APP2";
    }
    if (record.reviewDecision.decision === "HOLD") {
      return "REVIEW_REQUIRED";
    }
  }

  // Processing or extraction failures
  if (record.processingStatus === "FAILED" || !record.extractedData) {
    return "CANNOT_PROCESS";
  }

  // Check blocking issues
  const blockingIssues = (record.issues || []).filter(i => i.severity === "BLOCKING");
  if (blockingIssues.length > 0) {
    return "REVIEW_REQUIRED";
  }

  // Check amount checks status
  if (record.amountCheckStatus === "FAIL") {
    return "REVIEW_REQUIRED";
  }

  // Check possible duplicates
  if (record.duplicateCheckStatus === "POSSIBLE_DUPLICATE") {
    return "REVIEW_REQUIRED";
  }

  // Missing essential fields
  const ext = record.extractedData;
  if (
    !ext ||
    !ext.supplierName ||
    isPlaceholderValue(ext.supplierName) ||
    !ext.invoiceNumber ||
    isInvalidInvoiceNumber(ext.invoiceNumber) ||
    !ext.invoiceDate ||
    isPlaceholderValue(ext.invoiceDate) ||
    isPoReferenceMissing(ext.poReference) ||
    !ext.currency ||
    isPlaceholderValue(ext.currency) ||
    ext.printedTotalAmount == null
  ) {
    return "REVIEW_REQUIRED";
  }

  return "READY_FOR_APP2";
}

/**
 * Normalises status strings to canonical App1Status
 */
export function normalizeApp1Status(status: string | undefined | null): App1Status {
  if (!status) return "REVIEW_REQUIRED";
  const s = status.trim().toUpperCase().replace(/\s+/g, "_");
  if (
    s === "READY_FOR_APP2" ||
    s === "READY_FOR_APP_2" ||
    s === "APPROVED_FOR_APP2" ||
    s === "APPROVED" ||
    s === "READY"
  ) {
    return "READY_FOR_APP2";
  }
  if (s === "REJECTED_BY_HUMAN" || s === "REJECTED") {
    return "REJECTED_BY_HUMAN";
  }
  if (s === "CANNOT_PROCESS" || s === "FAILED") {
    return "CANNOT_PROCESS";
  }
  return "REVIEW_REQUIRED";
}

/**
 * Determines invoices eligible for App 2 Excel workbook export according to strict rules
 */
export function getApp2EligibleInvoices(records: InvoiceRecord[]): InvoiceRecord[] {
  return records.filter((r) => {
    // Exclude deleted records
    if (r.isDeleted === true) return false;

    // Exclude incomplete/failed/paused processing states
    if (
      r.processingStatus === "FAILED" ||
      r.processingStatus === "PAUSED" ||
      r.processingStatus === "QUEUED" ||
      r.processingStatus === "EXTRACTING" ||
      r.processingStatus === "VALIDATING"
    ) {
      return false;
    }

    // Re-derive central status dynamically
    const derivedStatus = deriveApp1Status(r);
    r.app1Status = derivedStatus;
    const normalized = normalizeApp1Status(derivedStatus);

    // Explicitly exclude non-ready statuses
    if (
      normalized === "REVIEW_REQUIRED" ||
      normalized === "CANNOT_PROCESS" ||
      normalized === "REJECTED_BY_HUMAN"
    ) {
      return false;
    }

    if (normalized === "READY_FOR_APP2") {
      return true;
    }

    // Include manually approved exceptions
    const isApprovedException =
      (r.reviewDecision?.decision === "APPROVE" ||
        r.reviewDecision?.newStatus === "READY_FOR_APP2" ||
        (r as any).humanDecision === "APPROVED_FOR_APP2") &&
      Boolean(r.reviewDecision?.reviewedBy || (r as any).approvedBy) &&
      Boolean(r.reviewDecision?.reviewedAt || (r as any).approvedAt) &&
      Boolean(
        (r.reviewDecision?.reviewNotes && r.reviewDecision.reviewNotes.trim() !== "") ||
          (r as any).approvalReason
      );

    return isApprovedException;
  });
}

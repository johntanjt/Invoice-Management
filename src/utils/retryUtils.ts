import { InvoiceRecord } from "../types";

export function isEligibleForRetry(invoice: InvoiceRecord): boolean {
  if (!invoice || invoice.isDeleted) return false;
  
  // Currently processing states
  if (["QUEUED", "EXTRACTING", "VALIDATING"].includes(invoice.processingStatus)) {
    return false;
  }
  
  // Explicitly forbidden statuses
  if (invoice.app1Status === "REJECTED_BY_HUMAN") return false;
  if (invoice.app1Status === "READY_FOR_APP2") return false;

  // Primary failure or paused conditions
  if (invoice.processingStatus === "FAILED" || invoice.processingStatus === "PAUSED") {
    return true;
  }
  if (invoice.app1Status === "CANNOT_PROCESS") {
    return true;
  }

  // Extraction failure/incomplete issue checks
  const hasExtractionIssue = invoice.issues?.some(
    i => i.code === "EXTRACTION_FAILED" || 
         i.code === "EXTRACTION_INCOMPLETE" || 
         (i.message && i.message.toLowerCase().includes("extraction"))
  );

  if (invoice.app1Status === "REVIEW_REQUIRED") {
    const isExtractionIncompleteReason = invoice.issues?.some(
      i => (i.code === "EXTRACTION_INCOMPLETE" || i.message === "Invoice extraction is incomplete and requires verification.")
    );
    return Boolean(isExtractionIncompleteReason || hasExtractionIssue);
  }

  return Boolean(hasExtractionIssue);
}

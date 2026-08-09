export type ProcessingStatus = 
  | "QUEUED"
  | "EXTRACTING"
  | "VALIDATING"
  | "COMPLETED"
  | "FAILED"
  | "PAUSED";

export type App1Status = 
  | "READY_FOR_APP2"
  | "REVIEW_REQUIRED"
  | "CANNOT_PROCESS"
  | "REJECTED_BY_HUMAN";

export interface LineItem {
  lineNumber: number;
  description: string | null;
  quantity: number | null;
  unitOfMeasure: string | null;
  unitPrice: number | null;
  printedLineAmount: number | null;
  calculatedLineAmount?: number | null;
  amountMatches?: boolean;
}

export interface FieldConfidence {
  supplierName: number;
  invoiceNumber: number;
  invoiceDate: number;
  poReference: number;
  totalAmount: number;
}

export interface ExtractionResult {
  documentType: "INVOICE" | "OTHER" | null;
  supplierName: string | null;
  supplierAddress: string | null;
  billToName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  poReference: string | null;
  poReferenceSourceText?: string | null;
  currency: string | null;
  lineItems: LineItem[];
  printedSubtotal: number | null;
  printedTaxAmount: number | null;
  printedDiscount: number | null;
  printedAdditionalCharges: number | null;
  printedTotalAmount: number | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  fieldConfidence: FieldConfidence;
}

export interface ValidationIssue {
  code: string;
  severity: "BLOCKING" | "WARNING";
  message: string;
  field?: string;
  expectedValue?: string | number | null;
  actualValue?: string | number | null;
  financialEffect?: string;
  recommendedAction?: string;
}

export interface ReviewDecision {
  reviewedBy: string; // "Madam Lim"
  reviewedAt: string;
  decision: "APPROVE" | "REJECT" | "HOLD" | "CORRECT";
  reviewNotes: string;
  previousStatus: App1Status;
  newStatus: App1Status;
  correctedFields?: Record<string, any>;
}

export interface PossibleDuplicateInfo {
  invoiceId: string;
  invoiceNumber: string;
  supplierName: string;
  score: number;
}

export interface RetryAttempt {
  retryAttemptId: string;
  recordId: string;
  attemptNumber: number;
  startedAt: string;
  completedAt?: string;
  initiatedBy: string;
  previousProcessingStatus: ProcessingStatus;
  previousApp1Status: App1Status;
  sourceFileName: string;
  result: "SUCCESS" | "FAILED" | "PAUSED";
  failureReason?: string;
  newProcessingStatus?: ProcessingStatus;
  newApp1Status?: App1Status;
}

export interface InvoiceRecord {
  id: string;
  filename: string;
  fileHash: string; // SHA-256 64 hex chars
  fileMimeType: string;
  fileSize: number;
  fileDataUrl?: string; // Stored base64 data URL for preview
  uploadedAt: string;
  processingStatus: ProcessingStatus;
  app1Status: App1Status;
  processingError?: string;
  
  extractedData?: ExtractionResult;
  calculatedSubtotal?: number | null;
  calculatedTotal?: number | null;
  
  amountCheckStatus: "PASS" | "FAIL" | "WARNING" | "NOT_RUN";
  subtotalCheckStatus: "MATCH" | "MISMATCH" | "NOT_STATED";
  taxTreatment: "STATED" | "NOT_STATED";
  
  duplicateCheckStatus: "CLEAN" | "POSSIBLE_DUPLICATE" | "EXACT_DUPLICATE";
  possibleDuplicateOf?: PossibleDuplicateInfo;
  
  issues: ValidationIssue[];
  reviewDecision?: ReviewDecision;
  
  retryHistory?: RetryAttempt[];

  isDeleted: boolean;
  deletedAt?: string;
  deletedBy?: string;
  deletionReason?: string;
  previousStatus?: App1Status;

  sourceFileStored?: boolean;
  sourceFileRecordId?: string;
  sourceFileName?: string;
  sourceMimeType?: string;
  sourceFileSize?: number;
  sourceFileHash?: string;
  previewAvailable?: boolean;
}

export interface StaffProfile {
  profileId: string;
  displayName: string;
  role: string;
  department: string;
  initials: string;
}

export const STAFF_PROFILES: StaffProfile[] = [
  {
    profileId: "MADAM_LIM",
    displayName: "Madam Lim",
    role: "ACCOUNTS EXECUTIVE",
    department: "Accounts Department",
    initials: "ML"
  },
  {
    profileId: "PROCUREMENT_OFFICER",
    displayName: "Procurement Officer",
    role: "PROCUREMENT STAFF",
    department: "Procurement Department",
    initials: "PO"
  },
  {
    profileId: "WAREHOUSE_OFFICER",
    displayName: "Warehouse Officer",
    role: "WAREHOUSE STAFF",
    department: "Warehouse & Logistics",
    initials: "WO"
  },
  {
    profileId: "ACCOUNTS_MANAGER",
    displayName: "Accounts Manager",
    role: "ACCOUNTS MANAGER",
    department: "Accounts Department",
    initials: "AM"
  },
  {
    profileId: "SYSTEM_ADMINISTRATOR",
    displayName: "System Administrator",
    role: "SYSTEM ADMIN",
    department: "IT & Systems",
    initials: "SA"
  }
];

export interface AuthenticatedUser {
  profileId: string;
  displayName: string;
  role: string;
  department: string;
  initials: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  user: string;
  role?: string;
  profileId?: string;
  actionType: string;
  recordId?: string;
  invoiceNumber?: string;
  supplier?: string;
  supplierName?: string;
  previousValue?: string;
  newValue?: string;
  reason?: string;
  deletionReason?: string;
  result: "SUCCESS" | "FAILURE" | "INFO";
  [key: string]: any;
}

export interface UserSession {
  isAuthenticated: boolean;
  username: string;
  user?: AuthenticatedUser;
  expiresAt: string;
}

export interface DashboardSummary {
  totalActiveInvoices: number;
  readyForApp2Count: number;
  reviewRequiredCount: number;
  rejectedCount: number;
  cannotProcessCount: number;
  possibleDuplicateCount: number;
  amountIssueCount: number;
  totalActiveValue: number;
  readyForApp2Value: number;
}

export interface InvoiceLineItem {
  record_id?: string;
  line_number?: number;
  description?: string;
  quantity?: number;
  unit_price?: number;
  line_total?: number;
  [key: string]: any;
}

export interface InvoiceData {
  record_id: string;
  status: string;
  check_result: string;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  po_number: string;
  currency: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  file_format: string;
  document_style: string;
  source_filename: string;
  source_invoice_link: string;
  extraction_status: string;
  duplicate_status: string;
  human_decision: string | null;
  approval_type: string;
  approved_by: string;
  approval_date: string;
  review_notes: string;
  processing_status: string;
  lines: InvoiceLineItem[];
  importIssues: any[];
  hasLineItems: boolean;
  lineItemStatus: string;
  [key: string]: any;
}

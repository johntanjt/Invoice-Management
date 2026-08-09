import React, { useState, useEffect, useRef } from "react";
import { 
  X, 
  CheckCircle2, 
  XCircle, 
  PauseCircle, 
  Edit3, 
  AlertTriangle, 
  FileText, 
  Tag, 
  Eye, 
  Info, 
  ExternalLink, 
  Send, 
  RotateCw,
  Upload,
  AlertCircle,
  FileCheck,
  RefreshCw
} from "lucide-react";
import { InvoiceRecord } from "../types";
import { sendSingleExtractedInvoiceTo3WayMatch } from "../services/app2DirectTransfer";
import { isEligibleForRetry } from "../utils/retryUtils";
import { 
  loadInvoicePreview, 
  revokePreviewUrl, 
  attachSourceFileOnlyApi, 
  logPreviewAuditEventApi,
  PreviewLoadResult 
} from "../services/previewService";
import { computeSha256 } from "../utils/sourceFileDb";

interface InvoiceDetailModalProps {
  invoice: InvoiceRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onReviewDecision: (
    id: string,
    decision: "APPROVE" | "REJECT" | "HOLD" | "CORRECT",
    reviewNotes: string,
    correctedFields?: Record<string, any>
  ) => Promise<void>;
  onRetryProcessing?: (invoice: InvoiceRecord) => void;
}

export const InvoiceDetailModal: React.FC<InvoiceDetailModalProps> = ({
  invoice,
  isOpen,
  onClose,
  onReviewDecision,
  onRetryProcessing
}) => {
  if (!isOpen || !invoice) return null;

  const ext = invoice.extractedData;
  const issues = invoice.issues || [];

  // Edit Mode state
  const [isEditing, setIsEditing] = useState(false);
  const [supplierName, setSupplierName] = useState(ext?.supplierName || "");
  const [invoiceNumber, setInvoiceNumber] = useState(ext?.invoiceNumber || "");
  const [invoiceDate, setInvoiceDate] = useState(ext?.invoiceDate || "");
  const [poReference, setPoReference] = useState(ext?.poReference || "");
  const [printedTotalAmount, setPrintedTotalAmount] = useState(ext?.printedTotalAmount?.toString() || "");
  const [currency, setCurrency] = useState(ext?.currency || "SGD");

  // Notes state
  const [reviewNotes, setReviewNotes] = useState(invoice.reviewDecision?.reviewNotes || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [confirmationMsg, setConfirmationMsg] = useState<string | null>(null);

  // Document Preview State
  const [previewState, setPreviewState] = useState<"LOADING" | "AVAILABLE" | "MISSING" | "ERROR" | "UNSUPPORTED">("LOADING");
  const [previewData, setPreviewData] = useState<PreviewLoadResult | null>(null);
  const activeObjectUrlRef = useRef<string | null>(null);

  // Legacy Record File Reselection State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileHash, setSelectedFileHash] = useState<string | null>(null);
  const [hashMatchStatus, setHashMatchStatus] = useState<"MATCH" | "MISMATCH" | null>(null);
  const [replacementReason, setReplacementReason] = useState("");
  const [isAttachingFile, setIsAttachingFile] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Shared preview loader
  const fetchPreview = async (recordId: string) => {
    // Revoke previous URL if any
    if (activeObjectUrlRef.current) {
      revokePreviewUrl(activeObjectUrlRef.current);
      activeObjectUrlRef.current = null;
    }

    setPreviewState("LOADING");
    setAttachError(null);

    const result = await loadInvoicePreview(recordId);
    setPreviewData(result);
    setPreviewState(result.state);

    if (result.available && result.objectUrl) {
      activeObjectUrlRef.current = result.objectUrl;
      logPreviewAuditEventApi({
        actionType: "INVOICE_PREVIEW_OPENED",
        recordId,
        invoiceNumber: ext?.invoiceNumber || undefined,
        filename: invoice.filename,
        result: "SUCCESS"
      });
    } else if (result.state === "ERROR") {
      logPreviewAuditEventApi({
        actionType: "INVOICE_PREVIEW_FAILED",
        recordId,
        invoiceNumber: ext?.invoiceNumber || undefined,
        filename: invoice.filename,
        result: "FAILURE",
        reason: result.message
      });
    }
  };

  // Sync state & load preview whenever selected invoice changes
  useEffect(() => {
    if (invoice) {
      setSupplierName(invoice.extractedData?.supplierName || "");
      setInvoiceNumber(invoice.extractedData?.invoiceNumber || "");
      setInvoiceDate(invoice.extractedData?.invoiceDate || "");
      setPoReference(invoice.extractedData?.poReference || "");
      setPrintedTotalAmount(invoice.extractedData?.printedTotalAmount?.toString() || "");
      setCurrency(invoice.extractedData?.currency || "SGD");
      setReviewNotes(invoice.reviewDecision?.reviewNotes || "");
      setIsEditing(false);
      setActionError("");
      setConfirmationMsg(null);
      setSelectedFile(null);
      setSelectedFileHash(null);
      setHashMatchStatus(null);
      setReplacementReason("");
      setAttachError(null);

      fetchPreview(invoice.id);
    }

    return () => {
      if (activeObjectUrlRef.current) {
        revokePreviewUrl(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }
    };
  }, [invoice.id, invoice.reviewDecision]);

  const handleRetryPreview = () => {
    if (invoice) {
      fetchPreview(invoice.id);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAttachError(null);
    setSelectedFile(file);

    try {
      const hash = await computeSha256(file);
      setSelectedFileHash(hash);

      if (invoice.fileHash && invoice.fileHash.trim()) {
        const matches = invoice.fileHash.trim().toLowerCase() === hash.toLowerCase();
        setHashMatchStatus(matches ? "MATCH" : "MISMATCH");
      } else {
        setHashMatchStatus("MATCH");
      }
    } catch (err) {
      setAttachError("Failed to calculate SHA-256 hash for selected file.");
    }
  };

  const handleSavePreviewOnly = async () => {
    if (!selectedFile || !invoice) return;

    if (hashMatchStatus === "MISMATCH" && !replacementReason.trim()) {
      setAttachError("Please provide a reason for replacing the original source document.");
      return;
    }

    setIsAttachingFile(true);
    setAttachError(null);

    try {
      await attachSourceFileOnlyApi(invoice.id, selectedFile, replacementReason);
      setSelectedFile(null);
      setSelectedFileHash(null);
      setHashMatchStatus(null);
      setReplacementReason("");
      
      // Refresh preview immediately
      await fetchPreview(invoice.id);
      setConfirmationMsg("Original invoice preview attached successfully.");
    } catch (err: any) {
      setAttachError(err.message || "Failed to attach source file.");
    } finally {
      setIsAttachingFile(false);
    }
  };

  const handleSaveAndReprocess = () => {
    if (!invoice) return;
    if (onRetryProcessing) {
      onClose();
      onRetryProcessing(invoice);
    }
  };

  const handleSendTo3WayMatch = () => {
    const currentSupplier = isEditing ? supplierName : (ext?.supplierName || "");
    const currentInvNum = isEditing ? invoiceNumber : (ext?.invoiceNumber || "");
    const currentInvDate = isEditing ? invoiceDate : (ext?.invoiceDate || "");
    const currentTotal = isEditing 
      ? (parseFloat(printedTotalAmount) || 0)
      : (ext?.printedTotalAmount ?? 0);

    const msg = sendSingleExtractedInvoiceTo3WayMatch({
      supplierName: currentSupplier,
      invoiceNumber: currentInvNum,
      invoiceDate: currentInvDate,
      lineItems: ext?.lineItems || [],
      totalDue: currentTotal
    });

    setConfirmationMsg(msg);
    setTimeout(() => {
      setConfirmationMsg(null);
    }, 5000);
  };

  const handleAction = async (decision: "APPROVE" | "REJECT" | "HOLD" | "CORRECT") => {
    setActionError("");
    if ((decision === "APPROVE" || decision === "REJECT") && !reviewNotes.trim()) {
      setActionError("Please provide review notes before submitting this decision.");
      return;
    }

    try {
      setIsSubmitting(true);
      const correctedFields = isEditing ? {
        supplierName,
        invoiceNumber,
        invoiceDate,
        poReference,
        printedTotalAmount: printedTotalAmount ? parseFloat(printedTotalAmount) : null,
        currency
      } : undefined;

      await onReviewDecision(invoice.id, decision, reviewNotes, correctedFields);
      setIsEditing(false);
      onClose();
    } catch (err: any) {
      setActionError(err.message || "Failed to save review decision.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full h-[90vh] flex flex-col overflow-hidden border border-slate-200">
        
        {/* Modal Top Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center font-bold">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-lg text-white">
                  {ext?.invoiceNumber || invoice.filename}
                </h2>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  invoice.app1Status === "READY_FOR_APP2"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : invoice.app1Status === "REVIEW_REQUIRED"
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    : invoice.app1Status === "REJECTED_BY_HUMAN"
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                    : "bg-slate-700 text-slate-300"
                }`}>
                  {invoice.app1Status === "READY_FOR_APP2" && "Ready for App 2"}
                  {invoice.app1Status === "REVIEW_REQUIRED" && "Review Required"}
                  {invoice.app1Status === "REJECTED_BY_HUMAN" && "Rejected"}
                  {invoice.app1Status === "CANNOT_PROCESS" && "Cannot Process"}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Supplier: <span className="text-slate-200 font-medium">{ext?.supplierName || "Unknown"}</span> • File: {invoice.filename}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSendTo3WayMatch}
              className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
              title="Encodes extracted invoice data as base64 and opens 3-Way Match tool"
            >
              <Send className="w-3.5 h-3.5 text-indigo-200" />
              <span>Send to 3-Way Match</span>
              <ExternalLink className="w-3 h-3 text-indigo-200" />
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Main Body (Split 2 Columns) */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden bg-slate-50">
          
          {/* LEFT COLUMN: Original Invoice Document Preview */}
          <div className="md:col-span-6 border-b md:border-b-0 md:border-r border-slate-200 bg-slate-800 flex flex-col p-4 overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-slate-700 mb-3 text-slate-300 text-xs font-semibold">
              <span className="flex items-center gap-1.5 text-teal-400">
                <Eye className="w-4 h-4" /> Original Invoice Document Preview
              </span>
              <span className="text-slate-400 uppercase font-mono text-[10px]">
                {previewData?.mimeType || invoice.fileMimeType || "Document"}
              </span>
            </div>

            <div className="flex-1 bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center p-2 relative">
              
              {/* STATE 1: LOADING */}
              {previewState === "LOADING" && (
                <div className="flex flex-col items-center justify-center text-slate-400 space-y-3 p-6 text-center">
                  <RotateCw className="w-8 h-8 animate-spin text-teal-400" />
                  <p className="text-sm font-medium">Loading original invoice…</p>
                </div>
              )}

              {/* STATE 2: AVAILABLE */}
              {previewState === "AVAILABLE" && previewData?.objectUrl && (
                previewData.previewType === "PDF" ? (
                  <iframe 
                    src={previewData.objectUrl} 
                    title={`Invoice ${ext?.invoiceNumber || invoice.filename}`} 
                    className="w-full h-full rounded-lg border-0 bg-white"
                  />
                ) : (
                  <div className="w-full h-full overflow-auto flex items-center justify-center p-2">
                    <img 
                      src={previewData.objectUrl} 
                      alt={`Original invoice ${ext?.invoiceNumber || invoice.filename}`} 
                      className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
                    />
                  </div>
                )
              )}

              {/* STATE 3: MISSING / LEGACY RECORD FILE RESELECTION */}
              {(previewState === "MISSING" || previewState === "UNSUPPORTED") && (
                <div className="flex flex-col items-center justify-center text-center p-6 space-y-4 max-w-md mx-auto">
                  <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-bold text-slate-200">
                      The original invoice file was not saved with this record.
                    </h4>
                    <p className="text-xs text-slate-400 mt-1">
                      Select the original source file (PDF, JPG, or PNG) to enable original document preview.
                    </p>
                  </div>

                  {/* File Selection Controls */}
                  {!selectedFile ? (
                    <div>
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileSelected} 
                        accept=".pdf,image/jpeg,image/png,image/jpg" 
                        className="hidden" 
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer shadow-sm transition-all"
                      >
                        <Upload className="w-4 h-4" />
                        <span>Select Original Invoice</span>
                      </button>
                    </div>
                  ) : (
                    <div className="w-full space-y-3 bg-slate-800 p-4 rounded-xl border border-slate-700 text-left">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-200 truncate max-w-[200px]">
                          {selectedFile.name}
                        </span>
                        <span className="text-slate-400 font-mono text-[10px]">
                          {(selectedFile.size / 1024).toFixed(1)} KB
                        </span>
                      </div>

                      {/* File Match Validation Results */}
                      {hashMatchStatus === "MATCH" && (
                        <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                          <FileCheck className="w-4 h-4 shrink-0 text-emerald-400" />
                          <span>Original invoice verified.</span>
                        </div>
                      )}

                      {hashMatchStatus === "MISMATCH" && (
                        <div className="space-y-2">
                          <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                            <span>The selected file does not match the original invoice record.</span>
                          </div>
                          
                          <div>
                            <label className="block text-[11px] font-bold text-slate-300 mb-1">
                              Reason for Replacement (Required):
                            </label>
                            <input
                              type="text"
                              value={replacementReason}
                              onChange={(e) => setReplacementReason(e.target.value)}
                              placeholder="e.g. Corrected invoice resupplied by vendor..."
                              className="w-full p-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100"
                            />
                          </div>
                        </div>
                      )}

                      {attachError && (
                        <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                          {attachError}
                        </div>
                      )}

                      {/* Choice Buttons */}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFile(null);
                            setSelectedFileHash(null);
                            setHashMatchStatus(null);
                            setReplacementReason("");
                            setAttachError(null);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold cursor-pointer"
                        >
                          Select Another File
                        </button>

                        <button
                          type="button"
                          onClick={handleSavePreviewOnly}
                          disabled={isAttachingFile || (hashMatchStatus === "MISMATCH" && !replacementReason.trim())}
                          className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer transition-all"
                        >
                          {isAttachingFile ? "Saving..." : hashMatchStatus === "MISMATCH" ? "Save as Replacement File" : "Save Preview Only"}
                        </button>

                        {onRetryProcessing && (
                          <button
                            type="button"
                            onClick={handleSaveAndReprocess}
                            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold cursor-pointer transition-all"
                          >
                            Save and Reprocess Invoice
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                </div>
              )}

              {/* STATE 4: ERROR STATE WITH RETRY PREVIEW BUTTON */}
              {previewState === "ERROR" && (
                <div className="flex flex-col items-center justify-center text-center p-6 space-y-4 max-w-md mx-auto">
                  <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-200">
                      The original invoice could not be displayed.
                    </h4>
                    <p className="text-xs text-slate-400 mt-1">
                      {previewData?.message || "An error occurred while loading the source document Blob."}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleRetryPreview}
                    className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer shadow-sm transition-all"
                  >
                    <RotateCw className="w-4 h-4" />
                    <span>Retry Preview</span>
                  </button>
                </div>
              )}

            </div>
          </div>

          {/* RIGHT COLUMN: Extracted Data & Validation Issues */}
          <div className="md:col-span-6 p-6 overflow-y-auto space-y-6 bg-white">
            
            {actionError && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                {actionError}
              </div>
            )}

            {confirmationMsg && (
              <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs font-bold flex items-center justify-between gap-2 animate-in fade-in duration-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>{confirmationMsg}</span>
                </div>
                <button
                  onClick={() => setConfirmationMsg(null)}
                  className="text-indigo-500 hover:text-indigo-800 text-xs font-normal cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Validation Issues Banner */}
            {issues.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                <div className="flex items-center gap-2 text-amber-800 font-bold text-xs uppercase tracking-wide">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  Validation Issues Identified ({issues.length})
                </div>
                <ul className="space-y-1.5 pl-6 list-disc text-xs text-amber-900 font-medium">
                  {issues.map((iss, idx) => (
                    <li key={idx}>
                      <span className="font-semibold">{iss.message}</span>
                      {iss.recommendedAction && (
                        <p className="text-[11px] text-amber-700 mt-0.5">
                          💡 Action: {iss.recommendedAction}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Possible Duplicate Banner */}
            {invoice.duplicateCheckStatus === "POSSIBLE_DUPLICATE" && invoice.possibleDuplicateOf && (
              <div className="p-4 rounded-xl bg-purple-50 border border-purple-200 space-y-1">
                <div className="flex items-center gap-2 text-purple-900 font-bold text-xs">
                  <Info className="w-4 h-4 text-purple-600" />
                  Possible Content Duplicate Flagged
                </div>
                <p className="text-xs text-purple-800">
                  Matches Invoice <span className="font-bold">{invoice.possibleDuplicateOf.invoiceNumber}</span> from supplier <span className="font-bold">{invoice.possibleDuplicateOf.supplierName}</span> with similarity score of <span className="font-bold text-purple-900">{invoice.possibleDuplicateOf.score}/100</span>.
                </p>
              </div>
            )}

            {/* Fields Form / View */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Tag className="w-4 h-4 text-teal-600" /> Key Invoice Fields
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSendTo3WayMatch}
                    className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition-colors border border-indigo-200 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Send to 3-Way Match</span>
                  </button>
                  <button
                    onClick={() => setIsEditing(!isEditing)}
                    className="flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 px-2.5 py-1.5 rounded-lg transition-colors border border-teal-200 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    {isEditing ? "Cancel Edit" : "Correct Information"}
                  </button>
                </div>
              </div>

              {isEditing ? (
                <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                  <div>
                    <label className="font-medium text-slate-700">Supplier Name</label>
                    <input
                      type="text"
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      className="w-full mt-1 p-2 rounded-lg border border-slate-300 bg-white font-medium"
                    />
                  </div>
                  <div>
                    <label className="font-medium text-slate-700">Invoice Number</label>
                    <input
                      type="text"
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                      className="w-full mt-1 p-2 rounded-lg border border-slate-300 bg-white font-medium"
                    />
                  </div>
                  <div>
                    <label className="font-medium text-slate-700">Invoice Date</label>
                    <input
                      type="date"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                      className="w-full mt-1 p-2 rounded-lg border border-slate-300 bg-white font-medium"
                    />
                  </div>
                  <div>
                    <label className="font-medium text-slate-700">PO Reference</label>
                    <input
                      type="text"
                      value={poReference}
                      onChange={(e) => setPoReference(e.target.value)}
                      className="w-full mt-1 p-2 rounded-lg border border-slate-300 bg-white font-medium"
                    />
                  </div>
                  <div>
                    <label className="font-medium text-slate-700">Total Amount</label>
                    <input
                      type="number"
                      step="0.01"
                      value={printedTotalAmount}
                      onChange={(e) => setPrintedTotalAmount(e.target.value)}
                      className="w-full mt-1 p-2 rounded-lg border border-slate-300 bg-white font-medium"
                    />
                  </div>
                  <div>
                    <label className="font-medium text-slate-700">Currency</label>
                    <input
                      type="text"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full mt-1 p-2 rounded-lg border border-slate-300 bg-white font-medium"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-slate-500 font-medium block">Supplier Name</span>
                    <span className="font-bold text-slate-900 text-sm mt-0.5 block">{ext?.supplierName || "—"}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-slate-500 font-medium block">Invoice Number</span>
                    <span className="font-bold text-slate-900 text-sm mt-0.5 block">{ext?.invoiceNumber || "—"}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-slate-500 font-medium block">Invoice Date</span>
                    <span className="font-semibold text-slate-900 mt-0.5 block">{ext?.invoiceDate || "—"}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-slate-500 font-medium block">PO Reference</span>
                    <span className={`font-semibold mt-0.5 block ${!ext?.poReference || ext.poReference === "N/A" ? "text-amber-600 font-bold" : "text-slate-900"}`}>
                      {ext?.poReference || "N/A"}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 col-span-2 flex items-center justify-between">
                    <div>
                      <span className="text-teal-800 font-medium block">Total Payable Amount</span>
                      <span className="font-black text-teal-900 text-lg mt-0.5 block">
                        {ext?.currency || "SGD"} {ext?.printedTotalAmount != null ? Number(ext.printedTotalAmount).toFixed(2) : "0.00"}
                      </span>
                    </div>
                    {invoice.amountCheckStatus === "PASS" ? (
                      <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded-lg flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Arithmetic Passed
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 bg-amber-100 text-amber-800 text-[11px] font-bold rounded-lg flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Amount Warning
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Line Items Table */}
            <div>
              <h4 className="font-bold text-slate-900 text-xs mb-2">Line Items Breakdown</h4>
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white text-xs">
                <table className="w-full text-left">
                  <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">#</th>
                      <th className="p-2.5">Description</th>
                      <th className="p-2.5">Qty</th>
                      <th className="p-2.5">Unit Price</th>
                      <th className="p-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ext?.lineItems && ext.lineItems.length > 0 ? (
                      ext.lineItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2.5 text-slate-500 font-mono">{item.lineNumber || idx + 1}</td>
                          <td className="p-2.5 font-medium text-slate-800">{item.description || "N/A"}</td>
                          <td className="p-2.5 text-slate-600">{item.quantity ?? "—"}</td>
                          <td className="p-2.5 text-slate-600">{item.unitPrice != null ? `$${item.unitPrice.toFixed(2)}` : "—"}</td>
                          <td className="p-2.5 text-right font-semibold text-slate-900">
                            {item.printedLineAmount != null ? `$${item.printedLineAmount.toFixed(2)}` : (item.calculatedLineAmount != null ? `$${item.calculatedLineAmount.toFixed(2)}` : "—")}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="p-3 text-center text-slate-400">No line items extracted</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Madam Lim's Review Notes Input */}
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Madam Lim's Review Notes / Decision Justification
              </label>
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Enter review explanation or reason for approval / rejection..."
                rows={2}
                className="w-full p-3 rounded-xl border border-slate-300 text-xs text-slate-900 focus:ring-2 focus:ring-teal-500"
              />
            </div>

            {/* Decision Action Buttons */}
            <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleAction("HOLD")}
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <PauseCircle className="w-4 h-4 text-slate-500" /> Keep on Hold
                </button>

                {onRetryProcessing && isEligibleForRetry(invoice) && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onRetryProcessing(invoice);
                    }}
                    disabled={isSubmitting}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-colors shadow-sm cursor-pointer"
                  >
                    <RotateCw className="w-4 h-4" /> Retry Processing
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleAction("REJECT")}
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
                >
                  <XCircle className="w-4 h-4" /> Reject Invoice
                </button>

                <button
                  type="button"
                  onClick={() => handleAction(isEditing ? "CORRECT" : "APPROVE")}
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-colors shadow-md shadow-teal-900/20 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {isEditing ? "Save Corrections & Validate" : "Approve for App 2"}
                </button>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};

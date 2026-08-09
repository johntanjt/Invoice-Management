import React, { useState, useRef } from "react";
import { 
  Upload, 
  FileText, 
  Search, 
  Filter, 
  Eye, 
  Trash2, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  XCircle, 
  Download, 
  ExternalLink,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Info,
  Loader2,
  Send,
  RotateCw,
  Paperclip,
  Link2
} from "lucide-react";
import { InvoiceRecord, DashboardSummary } from "../types";
import { processFileApi, evaluateDuplicatesApi } from "../services/api";
import { sendSingleExtractedInvoiceTo3WayMatch } from "../services/app2DirectTransfer";
import { isEligibleForRetry } from "../utils/retryUtils";
import { saveSourceFileToDB, getSourceFileFromDB, base64ToBlob, computeSha256 } from "../utils/sourceFileDb";
import { attachSourceFileOnlyApi, logPreviewAuditEventApi } from "../services/previewService";
import { RetryProcessingModal } from "../components/RetryProcessingModal";
import { BatchRetryModal } from "../components/BatchRetryModal";

interface InvoiceRecordsPageProps {
  invoices: InvoiceRecord[];
  summary: DashboardSummary;
  supplierFilter?: string | null;
  onClearSupplierFilter?: () => void;
  onRefresh: () => Promise<void>;
  onOpenDetailModal: (inv: InvoiceRecord) => void;
  onRequestDelete: (inv: InvoiceRecord) => void;
  onRequestDeleteSelected?: (selectedInvoices: InvoiceRecord[]) => void;
  onSendToApp2: () => void;
  onExportXlsx: () => void;
  isTransferring?: boolean;
  isExporting?: boolean;
}

interface FailedFileItem {
  filename: string;
  fileMimeType: string;
  fileSize: number;
  fileBase64: string;
  errorMsg: string;
}

interface BatchProgress {
  isProcessing: boolean;
  phase: "EXTRACTION" | "MATCHING" | "COMPLETE";
  totalFiles: number;
  completedFiles: number;
  readyCount: number;
  reviewCount: number;
  failedCount: number;
  failedFiles: FailedFileItem[];
  currentFilename?: string;
}

export const InvoiceRecordsPage: React.FC<InvoiceRecordsPageProps> = ({
  invoices,
  summary,
  supplierFilter,
  onClearSupplierFilter,
  onRefresh,
  onOpenDetailModal,
  onRequestDelete,
  onRequestDeleteSelected,
  onSendToApp2,
  onExportXlsx,
  isTransferring = false,
  isExporting = false
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const legacyFileInputRef = useRef<HTMLInputElement>(null);

  // Batch Progress state
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);

  // Bulk Attachment Modal State
  interface BulkAttachResultItem {
    filename: string;
    status: "ATTACHED" | "UNMATCHED" | "ERROR";
    targetRecordId?: string;
    invoiceNumber?: string;
    supplier?: string;
    message?: string;
  }

  interface BulkAttachModalState {
    isOpen: boolean;
    isProcessing: boolean;
    totalFiles: number;
    completedFiles: number;
    attachedCount: number;
    unmatchedCount: number;
    results: BulkAttachResultItem[];
  }

  const [bulkAttachModal, setBulkAttachModal] = useState<BulkAttachModalState | null>(null);

  // Exact Duplicate / Missing Source Modal State
  const [duplicateModal, setDuplicateModal] = useState<{
    isOpen: boolean;
    existingInvoice: InvoiceRecord | null;
    isMissingSource?: boolean;
    pendingFile?: { filename: string; fileMimeType: string; fileSize: number; fileBase64: string };
  }>({ isOpen: false, existingInvoice: null });

  // Filters, Search & Selection
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [expandedTechRow, setExpandedTechRow] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [singleToast, setSingleToast] = useState<string | null>(null);

  // Retry Modal State
  const [retryModalInvoice, setRetryModalInvoice] = useState<InvoiceRecord | null>(null);
  const [isBatchRetryOpen, setIsBatchRetryOpen] = useState(false);

  const eligibleFailedInvoices = invoices.filter(isEligibleForRetry);

  const openRetryProcessingModal = (recordId: string) => {
    if (!recordId || recordId.trim() === "") return;
    const inv = invoices.find((i) => i.id === recordId);
    if (inv) {
      setRetryModalInvoice(inv);
    }
  };

  const handleSavePreviewOnly = async () => {
    if (!duplicateModal.existingInvoice || !duplicateModal.pendingFile) return;
    try {
      const pending = duplicateModal.pendingFile;
      const blob = base64ToBlob(pending.fileBase64, pending.fileMimeType);
      const fileObj = new File([blob], pending.filename, { type: pending.fileMimeType });

      await attachSourceFileOnlyApi(duplicateModal.existingInvoice.id, fileObj);
      await onRefresh();
      setSingleToast(`Attached original document to invoice #${duplicateModal.existingInvoice.extractedData?.invoiceNumber || duplicateModal.existingInvoice.id}.`);
    } catch (err: any) {
      setSingleToast(`Failed to attach document: ${err.message || "Error saving preview"}`);
    } finally {
      setDuplicateModal({ isOpen: false, existingInvoice: null });
    }
  };

  const handleSaveAndReprocess = async () => {
    if (!duplicateModal.existingInvoice || !duplicateModal.pendingFile) return;
    try {
      const pending = duplicateModal.pendingFile;
      const blob = base64ToBlob(pending.fileBase64, pending.fileMimeType);
      const fileObj = new File([blob], pending.filename, { type: pending.fileMimeType });

      await attachSourceFileOnlyApi(duplicateModal.existingInvoice.id, fileObj);
      openRetryProcessingModal(duplicateModal.existingInvoice.id);
    } catch (err: any) {
      setSingleToast(`Failed to attach document: ${err.message || "Error saving preview"}`);
    } finally {
      setDuplicateModal({ isOpen: false, existingInvoice: null });
    }
  };

  const handleLegacyFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    setBulkAttachModal({
      isOpen: true,
      isProcessing: true,
      totalFiles: files.length,
      completedFiles: 0,
      attachedCount: 0,
      unmatchedCount: 0,
      results: []
    });

    await logPreviewAuditEventApi({
      actionType: "LEGACY_SOURCE_FILE_BATCH_STARTED",
      result: "INFO",
      reason: `Started bulk attachment pass for ${files.length} source file(s)`
    });

    const results: BulkAttachResultItem[] = [];
    let attachedCount = 0;
    let unmatchedCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const hash = await computeSha256(file);

        // Match 1: Source File Hash or File Hash
        let matchedInv = invoices.find(inv => 
          !inv.isDeleted && 
          ((inv.fileHash && inv.fileHash.toLowerCase() === hash.toLowerCase()) || 
           (inv.sourceFileHash && inv.sourceFileHash.toLowerCase() === hash.toLowerCase()))
        );

        // Match 2: Exact Normalized Invoice Number
        const cleanString = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
        const baseNameClean = cleanString(file.name.replace(/\.[^/.]+$/, ""));

        if (!matchedInv) {
          matchedInv = invoices.find(inv => {
            if (inv.isDeleted) return false;
            const invNum = inv.extractedData?.invoiceNumber;
            if (!invNum) return false;
            const invNumClean = cleanString(invNum);
            return invNumClean === baseNameClean || baseNameClean === invNumClean;
          });
        }

        // Match 3: Supplier + Invoice Number or Substring in filename
        if (!matchedInv) {
          matchedInv = invoices.find(inv => {
            if (inv.isDeleted) return false;
            const invNum = inv.extractedData?.invoiceNumber;
            if (!invNum) return false;
            const invNumClean = cleanString(invNum);
            return baseNameClean.includes(invNumClean) || invNumClean.includes(baseNameClean);
          });
        }

        if (matchedInv) {
          await attachSourceFileOnlyApi(matchedInv.id, file);
          attachedCount++;
          results.push({
            filename: file.name,
            status: "ATTACHED",
            targetRecordId: matchedInv.id,
            invoiceNumber: matchedInv.extractedData?.invoiceNumber || matchedInv.filename,
            supplier: matchedInv.extractedData?.supplierName || "Unknown"
          });
        } else {
          unmatchedCount++;
          results.push({
            filename: file.name,
            status: "UNMATCHED",
            message: "No matching invoice record found"
          });
        }
      } catch (err: any) {
        unmatchedCount++;
        results.push({
          filename: file.name,
          status: "ERROR",
          message: err.message || "Failed to process file"
        });
      }

      setBulkAttachModal(prev => prev ? {
        ...prev,
        completedFiles: i + 1,
        attachedCount,
        unmatchedCount,
        results: [...results]
      } : null);
    }

    await logPreviewAuditEventApi({
      actionType: "LEGACY_SOURCE_FILE_BATCH_COMPLETED",
      result: "SUCCESS",
      reason: `Completed bulk attachment pass: ${attachedCount} attached, ${unmatchedCount} unmatched out of ${files.length} file(s)`
    });

    setBulkAttachModal(prev => prev ? { ...prev, isProcessing: false } : null);
    await onRefresh();
  };

  const handleSendSingleTo3Way = (inv: InvoiceRecord) => {
    const ext = inv.extractedData;
    const msg = sendSingleExtractedInvoiceTo3WayMatch({
      supplierName: ext?.supplierName,
      invoiceNumber: ext?.invoiceNumber,
      invoiceDate: ext?.invoiceDate,
      lineItems: ext?.lineItems,
      totalDue: ext?.printedTotalAmount
    });
    setSingleToast(msg);
    setTimeout(() => setSingleToast(null), 4000);
  };

  // Process a batch of file items (Phase 1: Rate-limited Extraction, Phase 2: Local Matching)
  const processBatchItems = async (fileItems: Array<{ filename: string; fileMimeType: string; fileSize: number; fileBase64: string }>) => {
    const total = fileItems.length;
    if (total === 0) return;

    const failedList: FailedFileItem[] = [];
    let completed = 0;
    let ready = 0;
    let review = 0;
    let failed = 0;

    setBatchProgress({
      isProcessing: true,
      phase: "EXTRACTION",
      totalFiles: total,
      completedFiles: 0,
      readyCount: 0,
      reviewCount: 0,
      failedCount: 0,
      failedFiles: []
    });

    // PHASE 1: Run all extraction calls (rate-limited & model-rotated round-robin)
    for (const item of fileItems) {
      setBatchProgress(prev => prev ? { ...prev, currentFilename: item.filename } : null);

      try {
        const payload = {
          filename: item.filename,
          fileMimeType: item.fileMimeType,
          fileSize: item.fileSize,
          fileBase64: item.fileBase64,
          skipDuplicateEvaluation: true // Skip duplicate evaluation during extraction pass
        };

        const res = await processFileApi(payload);

        if (res.isExactDuplicate && res.existingInvoice) {
          let isMissingSource = !res.existingInvoice.sourceFileStored || !res.existingInvoice.previewAvailable;
          try {
            const existingBlob = await getSourceFileFromDB(res.existingInvoice.id);
            if (!existingBlob || !existingBlob.blob || existingBlob.blob.size === 0) {
              isMissingSource = true;
            }
          } catch (e) {
            isMissingSource = true;
          }

          setDuplicateModal({
            isOpen: true,
            existingInvoice: res.existingInvoice,
            isMissingSource,
            pendingFile: item
          });
          completed++;
        } else if (res.record) {
          // Save source document Blob to IndexedDB under recordId
          try {
            const blob = base64ToBlob(item.fileBase64, item.fileMimeType);
            const saved = await saveSourceFileToDB({
              recordId: res.record.id,
              fileName: item.filename,
              mimeType: item.fileMimeType,
              fileSize: item.fileSize,
              fileHash: res.record.fileHash,
              blob,
              savedAt: new Date().toISOString()
            });

            if (!saved) {
              setSingleToast("Invoice data was extracted, but the original document preview could not be saved.");
            }
          } catch (storageErr) {
            console.warn("Failed to save source file blob to IndexedDB:", storageErr);
            setSingleToast("Invoice data was extracted, but the original document preview could not be saved.");
          }

          completed++;
          if (res.record.processingStatus === "FAILED" || res.record.app1Status === "CANNOT_PROCESS") {
            failed++;
            failedList.push({ ...item, errorMsg: res.record.processingError || "Extraction failed" });
          } else if (res.record.app1Status === "READY_FOR_APP2") {
            ready++;
          } else {
            review++;
          }
        } else {
          completed++;
          failed++;
          failedList.push({ ...item, errorMsg: res.message || "Extraction failed" });
        }
      } catch (err: any) {
        completed++;
        failed++;
        failedList.push({ ...item, errorMsg: err.message || "Extraction failed" });
      }

      setBatchProgress(prev => prev ? {
        ...prev,
        completedFiles: completed,
        readyCount: ready,
        reviewCount: review,
        failedCount: failed,
        failedFiles: [...failedList]
      } : null);
    }

    // PHASE 2: Local 3-Way Matching & Duplicate Detection (Instant pass once all extractions complete)
    setBatchProgress(prev => prev ? {
      ...prev,
      phase: "MATCHING",
      currentFilename: undefined
    } : null);

    try {
      await evaluateDuplicatesApi();
    } catch (err) {
      console.warn("Phase 2 duplicate evaluation error:", err);
    }

    await onRefresh();

    setBatchProgress({
      isProcessing: false,
      phase: "COMPLETE",
      totalFiles: total,
      completedFiles: completed,
      readyCount: ready,
      reviewCount: review,
      failedCount: failed,
      failedFiles: failedList
    });
  };

  // File Upload Handler
  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    const items: Array<{ filename: string; fileMimeType: string; fileSize: number; fileBase64: string }> = [];

    for (const file of fileList) {
      try {
        const fileBase64 = await readFileAsBase64(file);
        items.push({
          filename: file.name,
          fileMimeType: file.type || "application/pdf",
          fileSize: file.size,
          fileBase64
        });
      } catch (err) {
        console.warn(`Failed to read file ${file.name}:`, err);
      }
    }

    await processBatchItems(items);
  };

  // Retry failed files only handler
  const handleRetryFailedFiles = async () => {
    if (!batchProgress || batchProgress.failedFiles.length === 0) return;
    const itemsToRetry = [...batchProgress.failedFiles];
    await processBatchItems(itemsToRetry);
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  // Filtered Invoices
  const filteredInvoices = invoices.filter((inv) => {
    const ext = inv.extractedData;
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = 
      !searchTerm ||
      inv.filename.toLowerCase().includes(searchLower) ||
      (ext?.supplierName && ext.supplierName.toLowerCase().includes(searchLower)) ||
      (ext?.invoiceNumber && ext.invoiceNumber.toLowerCase().includes(searchLower)) ||
      (ext?.poReference && ext.poReference.toLowerCase().includes(searchLower));

    const matchesStatus = 
      statusFilter === "ALL" || 
      inv.app1Status === statusFilter;

    let matchesSupplier = true;
    if (supplierFilter) {
      const rawSupp = ext?.supplierName?.trim().toLowerCase().replace(/\s+/g, " ") || "unknown supplier";
      const filterSupp = supplierFilter.trim().toLowerCase().replace(/\s+/g, " ");
      matchesSupplier = rawSupp === filterSupp || rawSupp.includes(filterSupp);
    }

    return matchesSearch && matchesStatus && matchesSupplier;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      
      {/* SECTION 1: Upload Supplier Invoices */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Upload className="w-5 h-5 text-teal-600" /> Upload Supplier Invoices
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Upload PDF, JPEG, JPG, or PNG supplier invoices. Batch upload all 20 invoices in one step.
          </p>
        </div>

        {/* Drop Zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFilesSelected(e.dataTransfer.files);
          }}
          className="border-2 border-dashed border-teal-300 hover:border-teal-500 bg-teal-50/40 hover:bg-teal-50 rounded-2xl p-8 text-center cursor-pointer transition-all group"
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => handleFilesSelected(e.target.files)}
            multiple
            accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf"
            className="hidden"
          />
          <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center mx-auto mb-3 shadow-md group-hover:scale-110 transition-transform">
            <Upload className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-900 text-sm">
            Drag & Drop Supplier Invoices or <span className="text-teal-700 underline">Browse Files</span>
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Supports PDF, JPEG, JPG, PNG • Multiple batch files supported
          </p>
        </div>

        {/* Legacy / Restore Source Files Option */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Paperclip className="w-4 h-4 text-indigo-600" /> Attach Original Files to Existing Records
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Select the original invoice files to restore document previews without creating duplicate invoice records.
            </p>
          </div>
          <button
            onClick={() => legacyFileInputRef.current?.click()}
            className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="Attach original PDF/Image source files to existing records missing previews"
          >
            <Paperclip className="w-4 h-4 text-indigo-600" />
            <span>Attach Source Files to Records</span>
          </button>
          <input
            type="file"
            ref={legacyFileInputRef}
            onChange={(e) => void handleLegacyFilesSelected(e.target.files)}
            multiple
            accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf"
            className="hidden"
          />
        </div>
      </div>

      {/* SECTION 2: Live Processing Progress & Two-Phase Multi-Model Banner */}
      {batchProgress && (
        <div className="bg-slate-900 text-white rounded-3xl p-5 shadow-lg border border-slate-800 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center font-bold shrink-0">
                <RefreshCw className={`w-5 h-5 ${batchProgress.isProcessing ? "animate-spin" : ""}`} />
              </div>
              <div>
                <h4 className="font-bold text-sm text-white">
                  {batchProgress.phase === "EXTRACTION" ? "Phase 1: Extracting Invoices with Gemini Flash Model Rotation…" :
                   batchProgress.phase === "MATCHING" ? "Phase 2: Evaluating 3-Way Matching & Duplicates (Local Pass)…" :
                   "Batch Processing Complete"}
                </h4>
                <p className="text-xs text-teal-300 font-medium mt-0.5">
                  {batchProgress.phase === "EXTRACTION" && batchProgress.currentFilename ? (
                    <span>Currently extracting: <span className="font-mono text-white">{batchProgress.currentFilename}</span> ({batchProgress.completedFiles + 1} of {batchProgress.totalFiles})</span>
                  ) : (
                    <span>{batchProgress.completedFiles} of {batchProgress.totalFiles} files processed</span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 bg-purple-950 text-purple-300 text-[11px] font-bold rounded-full border border-purple-800 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                Round-Robin Model Rotation (Rate-Limited 5 req/min)
              </span>
              {!batchProgress.isProcessing && (
                <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 text-xs font-bold rounded-full border border-emerald-500/30">
                  Batch Complete
                </span>
              )}
            </div>
          </div>

          {/* Live Progress Bar */}
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                batchProgress.phase === "MATCHING" ? "bg-purple-500 animate-pulse" :
                batchProgress.failedCount > 0 ? "bg-gradient-to-r from-teal-500 to-amber-500" : "bg-teal-500"
              }`}
              style={{
                width: `${batchProgress.totalFiles > 0 ? Math.round((batchProgress.completedFiles / batchProgress.totalFiles) * 100) : 0}%`
              }}
            />
          </div>

          {/* Live / Final Summary Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs pt-2 border-t border-slate-800">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-slate-300 font-medium">
                Total: <strong className="text-white">{batchProgress.totalFiles}</strong>
              </span>
              <span className="text-emerald-400 font-bold">
                ✓ Ready for App 2: {batchProgress.readyCount}
              </span>
              <span className="text-amber-400 font-bold">
                ⚠ Review Required: {batchProgress.reviewCount}
              </span>
              <span className="text-rose-400 font-bold">
                ✗ Failed: {batchProgress.failedCount}
              </span>
            </div>

            {!batchProgress.isProcessing && (
              <span className="text-[11px] text-slate-400 italic">
                Processed: {batchProgress.completedFiles} / Successful: {batchProgress.readyCount + batchProgress.reviewCount} / Failed: {batchProgress.failedCount}
              </span>
            )}
          </div>

          {/* Failed Files Alert & Retry Panel */}
          {batchProgress.failedFiles.length > 0 && (
            <div className="p-4 bg-rose-950/90 border border-rose-800 rounded-2xl space-y-3 text-xs">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="font-bold text-rose-200 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>Extraction Alert: {batchProgress.failedFiles.length} file(s) failed processing.</span>
                </div>
                {!batchProgress.isProcessing && (
                  <button
                    onClick={handleRetryFailedFiles}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl transition-colors shrink-0 shadow-md cursor-pointer flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry Failed Files ({batchProgress.failedFiles.length})</span>
                  </button>
                )}
              </div>

              <div className="space-y-1 pl-5">
                {batchProgress.failedFiles.map((file, idx) => (
                  <div key={idx} className="text-[11px] text-rose-300 font-mono flex items-center justify-between gap-2">
                    <span className="truncate">• {file.filename}</span>
                    <span className="text-rose-400 shrink-0 text-[10px]">{file.errorMsg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active Supplier Filter Notice */}
      {supplierFilter && (
        <div className="p-4 bg-teal-50 border border-teal-200 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs text-teal-950 font-semibold shadow-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-normal">Filtering by Supplier:</span>
            <span className="font-bold bg-teal-200 text-teal-900 px-2.5 py-1 rounded-lg text-xs">{supplierFilter}</span>
            <span className="text-slate-500 text-[11px]">({filteredInvoices.length} {filteredInvoices.length === 1 ? "invoice" : "invoices"} found)</span>
          </div>
          {onClearSupplierFilter && (
            <button
              onClick={onClearSupplierFilter}
              className="px-3 py-1.5 bg-teal-700 hover:bg-teal-800 text-white rounded-xl font-bold text-xs transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <span>✕ Clear Filter</span>
            </button>
          )}
        </div>
      )}

      {/* SECTION 3: Search, Filters, and Bulk Actions */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        
        {/* Search Bar */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search supplier name, invoice number, PO reference..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        {/* Status Filter, Excel Export & Delete Selected */}
        <div className="flex items-center gap-3">
          <button
            disabled={isExporting}
            onClick={() => void onExportXlsx()}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Download Excel Backup of Approved Invoices"
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>{isExporting ? "Exporting…" : "Download Excel Backup"}</span>
          </button>

          {selectedIds.length > 0 && (
            <button
              onClick={() => {
                const selectedInvoices = invoices.filter((i) => selectedIds.includes(i.id));
                if (onRequestDeleteSelected) {
                  onRequestDeleteSelected(selectedInvoices);
                } else if (selectedInvoices.length > 0) {
                  onRequestDelete(selectedInvoices[0]);
                }
              }}
              className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer animate-in fade-in"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete Selected ({selectedIds.length})</span>
            </button>
          )}

          {eligibleFailedInvoices.length >= 1 && (
            <button
              onClick={() => setIsBatchRetryOpen(true)}
              className="px-3.5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Retry processing for all failed invoices"
            >
              <RotateCw className="w-4 h-4" />
              <span>Retry All Failed Invoices ({eligibleFailedInvoices.length})</span>
            </button>
          )}

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="ALL">All Statuses ({invoices.length})</option>
              <option value="READY_FOR_APP2">Ready for App 2 ({summary.readyForApp2Count})</option>
              <option value="REVIEW_REQUIRED">Review Required ({summary.reviewRequiredCount})</option>
              <option value="CANNOT_PROCESS">Cannot Process ({summary.cannotProcessCount})</option>
              <option value="REJECTED_BY_HUMAN">Rejected ({summary.rejectedCount})</option>
            </select>
          </div>
        </div>

      </div>

      {singleToast && (
        <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-950 font-bold text-xs flex items-center justify-between gap-2 animate-in fade-in duration-200 shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-indigo-600 shrink-0" />
            <span>{singleToast}</span>
          </div>
          <button onClick={() => setSingleToast(null)} className="text-indigo-600 hover:text-indigo-900 text-xs font-normal cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* SECTION 4: Simple Invoice Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-200 font-bold uppercase tracking-wider text-[11px] border-b border-slate-800">
              <tr>
                <th className="p-3.5 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={filteredInvoices.length > 0 && selectedIds.length === filteredInvoices.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(filteredInvoices.map((i) => i.id));
                      } else {
                        setSelectedIds([]);
                      }
                    }}
                    className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 cursor-pointer"
                  />
                </th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Supplier</th>
                <th className="p-3.5">Invoice Number</th>
                <th className="p-3.5">Invoice Date</th>
                <th className="p-3.5">PO Reference</th>
                <th className="p-3.5 text-right">Total Amount</th>
                <th className="p-3.5">Main Issue</th>
                <th className="p-3.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredInvoices.map((inv) => {
                const ext = inv.extractedData;
                const mainIssue = inv.issues?.[0]?.message || inv.processingError || "None";
                const isTechExpanded = expandedTechRow === inv.id;
                const isSelected = selectedIds.includes(inv.id);

                return (
                  <React.Fragment key={inv.id}>
                    <tr className={`hover:bg-slate-50 transition-colors ${isSelected ? "bg-rose-50/40" : ""}`}>
                      {/* Checkbox */}
                      <td className="p-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds([...selectedIds, inv.id]);
                            } else {
                              setSelectedIds(selectedIds.filter((id) => id !== inv.id));
                            }
                          }}
                          className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 cursor-pointer"
                        />
                      </td>

                      {/* Status */}
                      <td className="p-3.5 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          inv.app1Status === "READY_FOR_APP2"
                            ? "bg-emerald-100 text-emerald-900"
                            : inv.app1Status === "REVIEW_REQUIRED"
                            ? "bg-amber-100 text-amber-900"
                            : inv.app1Status === "REJECTED_BY_HUMAN"
                            ? "bg-rose-100 text-rose-900"
                            : "bg-slate-100 text-slate-800"
                        }`}>
                          {inv.app1Status === "READY_FOR_APP2" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                          {inv.app1Status === "REVIEW_REQUIRED" && <AlertCircle className="w-3.5 h-3.5 text-amber-600" />}
                          {inv.app1Status === "REJECTED_BY_HUMAN" && <XCircle className="w-3.5 h-3.5 text-rose-600" />}
                          {inv.app1Status === "CANNOT_PROCESS" && <AlertTriangle className="w-3.5 h-3.5 text-slate-500" />}
                          
                          {inv.app1Status === "READY_FOR_APP2" && "Ready for App 2"}
                          {inv.app1Status === "REVIEW_REQUIRED" && "Review Required"}
                          {inv.app1Status === "REJECTED_BY_HUMAN" && "Rejected"}
                          {inv.app1Status === "CANNOT_PROCESS" && "Cannot Process"}
                        </span>
                      </td>

                      {/* Supplier */}
                      <td className="p-3.5 font-bold text-slate-900 max-w-[180px] truncate">
                        {ext?.supplierName || "Unknown Supplier"}
                      </td>

                      {/* Invoice Number */}
                      <td className="p-3.5 font-mono text-slate-800 font-semibold">
                        {ext?.invoiceNumber || "N/A"}
                      </td>

                      {/* Invoice Date */}
                      <td className="p-3.5 text-slate-600 font-medium">
                        {ext?.invoiceDate || "N/A"}
                      </td>

                      {/* PO Reference */}
                      <td className="p-3.5">
                        <span className={`font-mono text-[11px] ${!ext?.poReference || ext.poReference === "N/A" ? "text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-200" : "text-slate-800 font-semibold"}`}>
                          {ext?.poReference || "N/A"}
                        </span>
                      </td>

                      {/* Total Amount */}
                      <td className="p-3.5 text-right font-black text-slate-900 font-mono text-sm">
                        {ext?.currency || "SGD"} ${ext?.printedTotalAmount != null ? Number(ext.printedTotalAmount).toFixed(2) : "0.00"}
                      </td>

                      {/* Main Issue */}
                      <td className="p-3.5 max-w-[220px] truncate text-slate-600 font-medium">
                        {mainIssue !== "None" ? (
                          <span className="text-amber-800 font-medium" title={mainIssue}>
                            ⚠ {mainIssue}
                          </span>
                        ) : (
                          <span className="text-slate-400">None</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="p-3.5 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => onOpenDetailModal(inv)}
                            className="px-2.5 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                            title="View / Review Invoice Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>{inv.app1Status === "REVIEW_REQUIRED" ? "Review" : "View"}</span>
                          </button>

                          <button
                            onClick={() => handleSendSingleTo3Way(inv)}
                            className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-bold text-xs flex items-center gap-1 transition-colors border border-indigo-200 cursor-pointer"
                            title="Send extracted invoice to 3-Way Match"
                          >
                            <Send className="w-3.5 h-3.5 text-indigo-600" />
                            <span>3-Way Match</span>
                          </button>

                          {isEligibleForRetry(inv) && (
                            <button
                              onClick={() => openRetryProcessingModal(inv.id)}
                              className="px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-xs flex items-center gap-1 transition-colors border border-amber-200 cursor-pointer"
                              title="Retry Invoice Processing"
                            >
                              <RotateCw className="w-3.5 h-3.5 text-amber-700" />
                              <span>Retry Processing</span>
                            </button>
                          )}

                          <button
                            onClick={() => onRequestDelete(inv)}
                            className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs flex items-center gap-1 transition-colors border border-rose-200 cursor-pointer"
                            title="Delete Invoice"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>

                          <button
                            onClick={() => setExpandedTechRow(isTechExpanded ? null : inv.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                            title="Toggle Technical Details"
                          >
                            {isTechExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Technical Details Panel */}
                    {isTechExpanded && (
                      <tr className="bg-slate-50 border-y border-slate-200">
                        <td colSpan={9} className="p-4 text-xs font-mono text-slate-600 space-y-1">
                          <div className="flex flex-wrap items-center gap-4">
                            <span><strong className="text-slate-900">Record ID:</strong> {inv.id}</span>
                            <span><strong className="text-slate-900">SHA-256 Hash:</strong> {inv.fileHash.substring(0, 16)}...</span>
                            <span><strong className="text-slate-900">Uploaded:</strong> {new Date(inv.uploadedAt).toLocaleString("en-SG")}</span>
                            <span><strong className="text-slate-900">File Size:</strong> {(inv.fileSize / 1024).toFixed(1)} KB</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {filteredInvoices.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400 font-medium">
                    No supplier invoices found. Upload invoices above to begin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 5: Export Buttons */}
      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        <button
          disabled={isTransferring}
          onClick={() => {
            void onExportXlsx();
          }}
          className="flex items-center gap-2 px-5 py-3 rounded-2xl border border-slate-300 text-slate-800 hover:bg-slate-100 font-bold text-xs transition-colors shadow-xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {isTransferring ? <Loader2 className="w-4 h-4 animate-spin text-teal-600" /> : <Download className="w-4 h-4 text-teal-600" />}
          <span>{isTransferring ? "Generating Excel…" : "Export Approved Invoices"}</span>
        </button>

        <button
          disabled={isTransferring}
          onClick={() => {
            onSendToApp2();
          }}
          className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-md transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {isTransferring ? <Loader2 className="w-4 h-4 animate-spin text-purple-200" /> : <ExternalLink className="w-4 h-4 text-purple-200" />}
          <span>{isTransferring ? "Preparing App 2…" : "Export Approved Invoices and Open App 2"}</span>
        </button>
      </div>

      {/* Exact Duplicate / Missing Source Dialog */}
      {duplicateModal.isOpen && duplicateModal.existingInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <div className="p-3 bg-amber-100 rounded-2xl shrink-0">
                {duplicateModal.isMissingSource ? <Link2 className="w-6 h-6 text-amber-700" /> : <AlertTriangle className="w-6 h-6 text-amber-600" />}
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  {duplicateModal.isMissingSource ? "Invoice Record Found — Original Document Missing" : "Duplicate File Detected"}
                </h3>
                <p className="text-xs text-amber-800 font-semibold mt-0.5">
                  {duplicateModal.isMissingSource ? "Invoice record found. Original document preview is missing." : "This invoice has already been uploaded."}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed font-medium">
              {duplicateModal.isMissingSource ? (
                <>
                  An existing record for supplier <strong className="text-slate-900">{duplicateModal.existingInvoice.extractedData?.supplierName || "Unknown"}</strong> (Invoice #{duplicateModal.existingInvoice.extractedData?.invoiceNumber || "N/A"}) exists, but its original source file was not saved. Attach this file to restore document preview.
                </>
              ) : (
                <>
                  SHA-256 file hash matches existing record for supplier <strong className="text-slate-800">{duplicateModal.existingInvoice.extractedData?.supplierName || "Unknown"}</strong> (Invoice #{duplicateModal.existingInvoice.extractedData?.invoiceNumber || "N/A"}).
                </>
              )}
            </p>

            {duplicateModal.isMissingSource ? (
              <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
                <button
                  onClick={() => setDuplicateModal({ isOpen: false, existingInvoice: null })}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                >
                  Keep Existing Record
                </button>
                <button
                  onClick={handleSavePreviewOnly}
                  className="px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer"
                  title="Save source document against existing record ID without changing extracted data or status"
                >
                  Save Preview Only
                </button>
                <button
                  onClick={handleSaveAndReprocess}
                  className="px-3.5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-xs cursor-pointer"
                  title="Save source document and rerun retry extraction"
                >
                  Save & Reprocess Invoice
                </button>
              </div>
            ) : (
              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  onClick={() => setDuplicateModal({ isOpen: false, existingInvoice: null })}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                >
                  Keep Existing Record
                </button>
                <button
                  onClick={() => {
                    const inv = duplicateModal.existingInvoice;
                    setDuplicateModal({ isOpen: false, existingInvoice: null });
                    if (inv) onOpenDetailModal(inv);
                  }}
                  className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold cursor-pointer"
                >
                  View Existing Invoice
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bulk Attachment Results Modal */}
      {bulkAttachModal && bulkAttachModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl p-6 max-w-xl w-full shadow-2xl border border-slate-200 space-y-5">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-2xl">
                  <Paperclip className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Bulk Attach Original Invoice Files</h3>
                  <p className="text-xs text-slate-500">Restoring document previews for existing records</p>
                </div>
              </div>
              {bulkAttachModal.isProcessing && (
                <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
              )}
            </div>

            {bulkAttachModal.isProcessing ? (
              <div className="space-y-3 py-4 text-center">
                <p className="text-xs font-semibold text-slate-700">
                  Matching and attaching files ({bulkAttachModal.completedFiles} of {bulkAttachModal.totalFiles})...
                </p>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-indigo-600 h-full transition-all duration-200"
                    style={{ width: `${Math.round((bulkAttachModal.completedFiles / bulkAttachModal.totalFiles) * 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                    <div className="text-lg font-black text-slate-900">{bulkAttachModal.totalFiles}</div>
                    <div className="text-[11px] font-semibold text-slate-500">Files Checked</div>
                  </div>
                  <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200">
                    <div className="text-lg font-black text-emerald-800">{bulkAttachModal.attachedCount}</div>
                    <div className="text-[11px] font-semibold text-emerald-700">Source Files Attached</div>
                  </div>
                  <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200">
                    <div className="text-lg font-black text-amber-800">{bulkAttachModal.unmatchedCount}</div>
                    <div className="text-[11px] font-semibold text-amber-700">Unmatched</div>
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto space-y-2 border border-slate-200 rounded-2xl p-3 bg-slate-50/50 text-xs">
                  {bulkAttachModal.results.map((res, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-100 shadow-2xs text-xs">
                      <div className="truncate pr-2 font-mono text-slate-800 font-medium">
                        {res.filename}
                      </div>
                      <div>
                        {res.status === "ATTACHED" ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Attached ({res.invoiceNumber})
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">
                            Unmatched
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end pt-2 border-t border-slate-100">
                  <button
                    onClick={() => setBulkAttachModal(null)}
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Retry Processing Single Invoice Modal */}
      <RetryProcessingModal
        invoice={retryModalInvoice}
        isOpen={Boolean(retryModalInvoice)}
        onClose={() => setRetryModalInvoice(null)}
        onSuccess={async () => {
          await onRefresh();
        }}
      />

      {/* Batch Retry Invoices Modal */}
      <BatchRetryModal
        isOpen={isBatchRetryOpen}
        eligibleCount={eligibleFailedInvoices.length}
        eligibleRecordIds={eligibleFailedInvoices.map((i) => i.id)}
        onClose={() => setIsBatchRetryOpen(false)}
        onSuccess={async () => {
          await onRefresh();
        }}
      />

    </div>
  );
};

import React, { useState, useRef } from "react";
import { InvoiceRecord } from "../types";
import { retryInvoiceApi } from "../services/api";
import { saveSourceFileToDB, base64ToBlob } from "../utils/sourceFileDb";
import { 
  RotateCw, 
  X, 
  AlertTriangle, 
  FileText, 
  Upload, 
  CheckCircle2, 
  AlertCircle 
} from "lucide-react";

interface RetryProcessingModalProps {
  invoice: InvoiceRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedInvoice?: InvoiceRecord) => void;
}

export const RetryProcessingModal: React.FC<RetryProcessingModalProps> = ({
  invoice,
  isOpen,
  onClose,
  onSuccess
}) => {
  if (!isOpen || !invoice) return null;

  const [isRetrying, setIsRetrying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Replacement file states
  const [replacementFile, setReplacementFile] = useState<{
    base64: string;
    filename: string;
    mimeType: string;
    hash: string;
  } | null>(null);
  const [hashMismatchWarning, setHashMismatchWarning] = useState(false);
  const [manualHashOverride, setManualHashOverride] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasSourceFile = Boolean(invoice.fileDataUrl) || Boolean(replacementFile);

  const computeSha256 = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    setHashMismatchWarning(false);
    setManualHashOverride(false);

    try {
      const hash = await computeSha256(file);
      const reader = new FileReader();

      reader.onload = () => {
        const base64 = reader.result as string;
        setReplacementFile({
          base64,
          filename: file.name,
          mimeType: file.type || "application/pdf",
          hash
        });

        // Check hash against existing record
        if (invoice.fileHash && invoice.fileHash.toLowerCase() !== hash.toLowerCase()) {
          setHashMismatchWarning(true);
        }
      };

      reader.readAsDataURL(file);
    } catch (err: any) {
      setErrorMessage("Failed to read the selected file. Please try again.");
    }
  };

  const handleRetry = async () => {
    if (isRetrying) return;
    if (!hasSourceFile) {
      setErrorMessage("The original invoice file is no longer available. Select the invoice file again to retry processing.");
      return;
    }

    if (hashMismatchWarning && !manualHashOverride) {
      setErrorMessage("Please confirm that you want to continue with the selected file, or select another file.");
      return;
    }

    setIsRetrying(true);
    setErrorMessage(null);
    setInfoMessage("Scanning invoice and extracting fields...");

    try {
      const payload: {
        fileBase64?: string;
        filename?: string;
        fileMimeType?: string;
        manualHashOverride?: boolean;
      } = {};

      if (replacementFile) {
        payload.fileBase64 = replacementFile.base64;
        payload.filename = replacementFile.filename;
        payload.fileMimeType = replacementFile.mimeType;
        payload.manualHashOverride = manualHashOverride;
      }

      const response = await retryInvoiceApi(invoice.id, payload);

      if (response.success && response.record) {
        if (replacementFile) {
          try {
            const blob = base64ToBlob(replacementFile.base64, replacementFile.mimeType);
            await saveSourceFileToDB({
              recordId: response.record.id,
              fileName: replacementFile.filename,
              mimeType: replacementFile.mimeType,
              fileSize: blob.size,
              fileHash: replacementFile.hash,
              blob,
              savedAt: new Date().toISOString()
            });
          } catch (storageErr) {
            console.warn("Failed to save replacement file blob to IndexedDB:", storageErr);
          }
        }

        setInfoMessage(null);
        setIsRetrying(false);
        onSuccess(response.record);
        onClose();
      } else if (response.code === "MISSING_SOURCE_FILE") {
        setInfoMessage(null);
        setIsRetrying(false);
        setErrorMessage("The original invoice file is no longer available. Select the invoice file again to retry processing.");
      } else if (response.code === "FILE_MISMATCH") {
        setInfoMessage(null);
        setIsRetrying(false);
        setHashMismatchWarning(true);
        setErrorMessage("The selected file does not match the original invoice. Confirm that you selected the correct file.");
      } else if (response.code === "QUOTA_PAUSED") {
        setInfoMessage(null);
        setIsRetrying(false);
        setErrorMessage("Processing paused because the AI service is temporarily unavailable.");
        if (response.record) onSuccess(response.record);
      } else {
        setInfoMessage(null);
        setIsRetrying(false);
        setErrorMessage(response.message || response.error || "Invoice processing could not be completed after retry.");
        if (response.record) onSuccess(response.record);
      }
    } catch (err: any) {
      setIsRetrying(false);
      setInfoMessage(null);
      if (err.message === "SESSION_EXPIRED") {
        window.location.reload();
      } else {
        setErrorMessage(err.message || "An unexpected error occurred during retry processing.");
      }
    }
  };

  const failureReason = invoice.processingError || invoice.issues?.find(i => i.severity === "BLOCKING")?.message || "Invoice processing incomplete.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center space-x-2 text-slate-800 font-semibold text-lg">
            <RotateCw className={`w-5 h-5 text-indigo-600 ${isRetrying ? "animate-spin" : ""}`} />
            <span>Retry Invoice Processing</span>
          </div>
          <button
            onClick={onClose}
            disabled={isRetrying}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          <p className="text-sm text-slate-600 leading-relaxed">
            This will scan the invoice again and replace the previous system-generated extraction and validation results.
          </p>

          {/* Invoice Summary Box */}
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 space-y-2 text-sm">
            <div className="flex justify-between items-center text-slate-700">
              <span className="font-medium text-slate-500">Record ID:</span>
              <span className="font-mono text-xs font-semibold bg-slate-200 text-slate-800 px-2 py-0.5 rounded">
                {invoice.id}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-700">
              <span className="font-medium text-slate-500">Source File:</span>
              <span className="font-medium text-slate-800 truncate max-w-[220px]" title={replacementFile?.filename || invoice.filename}>
                {replacementFile?.filename || invoice.filename}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-700">
              <span className="font-medium text-slate-500">Supplier Name:</span>
              <span className="font-medium text-slate-800 truncate max-w-[220px]">
                {invoice.extractedData?.supplierName || "N/A"}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-700">
              <span className="font-medium text-slate-500">Invoice Number:</span>
              <span className="font-medium text-slate-800">
                {invoice.extractedData?.invoiceNumber || "N/A"}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-700">
              <span className="font-medium text-slate-500">Previous Result:</span>
              <span className="font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                {invoice.processingStatus} ({invoice.app1Status})
              </span>
            </div>
            <div className="pt-2 border-t border-slate-200">
              <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Previous Failure Reason:
              </span>
              <p className="text-xs text-rose-700 font-medium bg-rose-50 p-2 rounded border border-rose-200 leading-relaxed">
                {failureReason}
              </p>
            </div>
          </div>

          {/* Source File Check / Replacement UI */}
          {!invoice.fileDataUrl && !replacementFile && (
            <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg space-y-3">
              <div className="flex items-start space-x-2 text-amber-800">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed font-medium">
                  The original invoice file is no longer available. Select the invoice file again to retry processing.
                </div>
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-xs font-medium flex items-center justify-center space-x-2 transition-colors shadow-xs"
              >
                <Upload className="w-4 h-4" />
                <span>Select Invoice File</span>
              </button>
            </div>
          )}

          {replacementFile && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-xs text-emerald-800">
              <div className="flex items-center space-x-2 truncate">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-medium truncate">{replacementFile.filename} selected</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setReplacementFile(null);
                  setHashMismatchWarning(false);
                  setManualHashOverride(false);
                }}
                className="text-slate-500 hover:text-slate-700 underline font-medium text-[11px] shrink-0"
              >
                Change
              </button>
            </div>
          )}

          {/* Hash Mismatch Warning */}
          {hashMismatchWarning && !manualHashOverride && (
            <div className="p-4 bg-rose-50 border border-rose-300 rounded-lg space-y-3">
              <div className="flex items-start space-x-2 text-rose-800">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed font-semibold">
                  The selected file does not match the original invoice. Confirm that you selected the correct file.
                </div>
              </div>
              <div className="flex items-center space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setReplacementFile(null);
                    setHashMismatchWarning(false);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-md text-xs font-medium hover:bg-slate-50 transition-colors shadow-xs"
                >
                  Select Another File
                </button>
                <button
                  type="button"
                  onClick={() => setManualHashOverride(true)}
                  className="px-3 py-1.5 bg-rose-600 text-white rounded-md text-xs font-medium hover:bg-rose-700 transition-colors shadow-xs"
                >
                  Continue with This File
                </button>
              </div>
            </div>
          )}

          {manualHashOverride && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800 font-medium flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Manual file override confirmed. Standard processing will proceed.</span>
            </div>
          )}

          {/* Info & Error Messages */}
          {infoMessage && (
            <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-md text-xs text-indigo-700 font-medium flex items-center space-x-2">
              <RotateCw className="w-4 h-4 text-indigo-600 animate-spin shrink-0" />
              <span>{infoMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-700 font-medium flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 px-6 py-4 bg-slate-50 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            disabled={isRetrying}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying || (!hasSourceFile) || (hashMismatchWarning && !manualHashOverride)}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50 flex items-center space-x-2"
          >
            <RotateCw className={`w-4 h-4 ${isRetrying ? "animate-spin" : ""}`} />
            <span>{isRetrying ? "Retrying..." : "Retry Processing"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

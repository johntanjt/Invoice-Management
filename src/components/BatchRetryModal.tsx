import React, { useState } from "react";
import { InvoiceRecord } from "../types";
import { retryBatchInvoicesApi } from "../services/api";
import { RotateCw, X, CheckCircle2, AlertTriangle, AlertCircle, Play } from "lucide-react";

interface BatchRetryModalProps {
  isOpen: boolean;
  eligibleCount: number;
  eligibleRecordIds?: string[];
  onClose: () => void;
  onSuccess: (updatedInvoices?: InvoiceRecord[]) => void;
}

export const BatchRetryModal: React.FC<BatchRetryModalProps> = ({
  isOpen,
  eligibleCount,
  eligibleRecordIds,
  onClose,
  onSuccess
}) => {
  if (!isOpen) return null;

  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<{
    totalCompleted: number;
    successfullyProcessed: number;
    stillRequiresReview: number;
    failedAgain: number;
    paused: number;
  } | null>(null);

  const handleStartBatch = async () => {
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const res = await retryBatchInvoicesApi({ recordIds: eligibleRecordIds });
      if (res.success) {
        setBatchResult({
          totalCompleted: res.totalCompleted,
          successfullyProcessed: res.successfullyProcessed,
          stillRequiresReview: res.stillRequiresReview,
          failedAgain: res.failedAgain,
          paused: res.paused
        });
        if (res.invoices) {
          onSuccess(res.invoices);
        }
      }
    } catch (err: any) {
      if (err.message === "SESSION_EXPIRED") {
        window.location.reload();
      } else {
        setErrorMessage(err.message || "Failed to batch retry invoices.");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center space-x-2 text-slate-800 font-semibold text-lg">
            <RotateCw className={`w-5 h-5 text-indigo-600 ${isProcessing ? "animate-spin" : ""}`} />
            <span>Retry All Failed Invoices</span>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {!batchResult ? (
            <>
              <p className="text-sm text-slate-700 font-medium">
                Retry processing for <span className="font-bold text-indigo-600">{eligibleCount}</span> failed invoice{eligibleCount !== 1 ? "s" : ""}?
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                This will scan each failed invoice again, extract data fields, and run duplicate and amount checks. Results will be updated immediately.
              </p>

              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-700 font-medium flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center space-x-2 text-emerald-800">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span className="text-sm font-semibold">Batch retry completed</span>
              </div>

              <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 space-y-2 text-xs">
                <div className="flex justify-between items-center text-slate-700">
                  <span className="font-medium text-slate-500">Total Processed:</span>
                  <span className="font-bold text-slate-800">{batchResult.totalCompleted}</span>
                </div>
                <div className="flex justify-between items-center text-emerald-700">
                  <span className="font-medium text-slate-500">Ready for App 2:</span>
                  <span className="font-bold">{batchResult.successfullyProcessed}</span>
                </div>
                <div className="flex justify-between items-center text-amber-700">
                  <span className="font-medium text-slate-500">Requires Review:</span>
                  <span className="font-bold">{batchResult.stillRequiresReview}</span>
                </div>
                {batchResult.paused > 0 && (
                  <div className="flex justify-between items-center text-purple-700">
                    <span className="font-medium text-slate-500">Paused (Rate Limit):</span>
                    <span className="font-bold">{batchResult.paused}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-rose-700">
                  <span className="font-medium text-slate-500">Failed Again:</span>
                  <span className="font-bold">{batchResult.failedAgain}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 px-6 py-4 bg-slate-50 border-t border-slate-200">
          {!batchResult ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={isProcessing}
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStartBatch}
                disabled={isProcessing || eligibleCount === 0}
                className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50 flex items-center space-x-2"
              >
                <RotateCw className={`w-4 h-4 ${isProcessing ? "animate-spin" : ""}`} />
                <span>{isProcessing ? "Processing Batch..." : "Start Batch Retry"}</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-900 transition-colors shadow-sm"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

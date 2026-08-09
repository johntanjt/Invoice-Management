import React, { useState } from "react";
import { 
  AlertCircle, 
  Eye, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Info,
  Building,
  Tag,
  Send,
  ExternalLink,
  RotateCw
} from "lucide-react";
import { InvoiceRecord } from "../types";
import { sendSingleExtractedInvoiceTo3WayMatch } from "../services/app2DirectTransfer";
import { isEligibleForRetry } from "../utils/retryUtils";
import { RetryProcessingModal } from "../components/RetryProcessingModal";

interface ReviewRequiredPageProps {
  invoices: InvoiceRecord[];
  onOpenDetailModal: (inv: InvoiceRecord) => void;
  onRefresh?: () => Promise<void>;
}

export const ReviewRequiredPage: React.FC<ReviewRequiredPageProps> = ({
  invoices,
  onOpenDetailModal,
  onRefresh
}) => {
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [retryInvoice, setRetryInvoice] = useState<InvoiceRecord | null>(null);

  const reviewInvoices = invoices.filter(
    (i) => !i.isDeleted && (i.app1Status === "REVIEW_REQUIRED" || i.app1Status === "CANNOT_PROCESS")
  );

  const handleSendTo3Way = (inv: InvoiceRecord) => {
    const ext = inv.extractedData;
    const msg = sendSingleExtractedInvoiceTo3WayMatch({
      supplierName: ext?.supplierName,
      invoiceNumber: ext?.invoiceNumber,
      invoiceDate: ext?.invoiceDate,
      lineItems: ext?.lineItems,
      totalDue: ext?.printedTotalAmount
    });
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      
      {/* Header Banner */}
      <div className="bg-amber-500 text-slate-950 p-6 rounded-3xl shadow-md flex items-center justify-between gap-4">
        <div>
          <span className="text-xs font-black uppercase tracking-wider bg-slate-950 text-amber-400 px-3 py-1 rounded-full">
            Exception Review Queue
          </span>
          <h2 className="text-2xl font-black mt-2 tracking-tight">
            Review Required Invoices ({reviewInvoices.length})
          </h2>
          <p className="text-xs text-slate-900 font-medium mt-1">
            Invoices with missing PO references, content duplicates, or extraction warnings requiring Madam Lim's approval.
          </p>
        </div>
        <div className="w-12 h-12 rounded-2xl bg-slate-950 text-amber-400 flex items-center justify-center font-bold shrink-0">
          <AlertCircle className="w-6 h-6" />
        </div>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-950 font-bold text-xs flex items-center justify-between gap-2 animate-in fade-in duration-200 shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-indigo-600 shrink-0" />
            <span>{toastMsg}</span>
          </div>
          <button onClick={() => setToastMsg(null)} className="text-indigo-600 hover:text-indigo-900 text-xs font-normal cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Review Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {reviewInvoices.map((inv) => {
          const ext = inv.extractedData;
          const issues = inv.issues || [];
          const mainIssue = issues[0]?.message || inv.processingError || "Requires manual verification";
          const isDuplicate = inv.duplicateCheckStatus === "POSSIBLE_DUPLICATE";

          return (
            <div 
              key={inv.id}
              className="bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all p-6 space-y-4 flex flex-col justify-between"
            >
              <div className="space-y-3">
                {/* Top Badge & Invoice Header */}
                <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                      {ext?.supplierName || "Unknown Supplier"}
                    </span>
                    <h3 className="font-bold text-slate-900 text-base font-mono mt-0.5">
                      Invoice #{ext?.invoiceNumber || "N/A"}
                    </h3>
                  </div>

                  <span className={`px-3 py-1 rounded-full text-xs font-bold shrink-0 ${
                    isDuplicate ? "bg-purple-100 text-purple-900" : "bg-amber-100 text-amber-900"
                  }`}>
                    {isDuplicate ? "Content Duplicate" : "Missing Info / Check"}
                  </span>
                </div>

                {/* Main Issue Highlight */}
                <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block">
                    Main Verification Issue:
                  </span>
                  <p className="text-xs font-bold text-amber-950">
                    ⚠ {mainIssue}
                  </p>
                  {issues[0]?.recommendedAction && (
                    <p className="text-[11px] text-amber-800 font-medium pt-1">
                      💡 Recommended: {issues[0].recommendedAction}
                    </p>
                  )}
                </div>

                {/* Key Extraction Summary */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-slate-500 block">Invoice Date</span>
                    <span className="font-bold text-slate-800">{ext?.invoiceDate || "N/A"}</span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-slate-500 block">PO Reference</span>
                    <span className={`font-mono font-bold ${!ext?.poReference || ext.poReference === "N/A" ? "text-amber-700" : "text-slate-800"}`}>
                      {ext?.poReference || "N/A"}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-teal-50 border border-teal-100 col-span-2 flex items-center justify-between">
                    <span className="text-teal-800 font-semibold">Total Amount</span>
                    <span className="font-black text-teal-900 text-sm font-mono">
                      {ext?.currency || "SGD"} ${ext?.printedTotalAmount != null ? Number(ext.printedTotalAmount).toFixed(2) : "0.00"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                <button
                  onClick={() => onOpenDetailModal(inv)}
                  className="flex-1 py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                >
                  <Eye className="w-4 h-4 text-teal-400" />
                  <span>Review Document</span>
                </button>

                {isEligibleForRetry(inv) && (
                  <button
                    onClick={() => setRetryInvoice(inv)}
                    className="px-3.5 py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0"
                    title="Retry Invoice Processing"
                  >
                    <RotateCw className="w-4 h-4" />
                    <span>Retry</span>
                  </button>
                )}

                <button
                  onClick={() => handleSendTo3Way(inv)}
                  className="px-4 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0"
                  title="Send extracted invoice to 3-Way Match"
                >
                  <Send className="w-4 h-4 text-indigo-200" />
                  <span>Send to 3-Way</span>
                  <ExternalLink className="w-3.5 h-3.5 text-indigo-200" />
                </button>
              </div>

            </div>
          );
        })}

        {reviewInvoices.length === 0 && (
          <div className="col-span-full bg-white rounded-3xl p-12 text-center border border-slate-200 space-y-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
            <h3 className="font-bold text-slate-900 text-base">No Invoices Require Review</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              All active invoices are clean and ready for App 2 export!
            </p>
          </div>
        )}
      </div>

      <RetryProcessingModal
        invoice={retryInvoice}
        isOpen={Boolean(retryInvoice)}
        onClose={() => setRetryInvoice(null)}
        onSuccess={async () => {
          if (onRefresh) await onRefresh();
        }}
      />

    </div>
  );
};

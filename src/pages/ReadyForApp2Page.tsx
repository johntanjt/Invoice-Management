import React, { useState, useEffect } from "react";
import { 
  CheckCircle2, 
  Download, 
  ExternalLink, 
  Eye, 
  Building2, 
  Info, 
  Loader2,
  XCircle,
  RefreshCw,
  Send,
  CheckSquare,
  Square
} from "lucide-react";
import { InvoiceRecord } from "../types";
import { TransferState } from "../services/app2DirectTransfer";

interface ReadyForApp2PageProps {
  invoices: InvoiceRecord[];
  onOpenDetailModal: (inv: InvoiceRecord) => void;
  onExportXlsx: () => void;
  onSendToApp2: (selectedInvoices?: InvoiceRecord[]) => void;
  transferState?: TransferState;
  onDismissTransferState?: () => void;
  isExporting?: boolean;
}

export const ReadyForApp2Page: React.FC<ReadyForApp2PageProps> = ({
  invoices,
  onOpenDetailModal,
  onExportXlsx,
  onSendToApp2,
  transferState = { status: "IDLE" } as TransferState,
  onDismissTransferState,
  isExporting = false
}) => {
  const readyInvoices = invoices.filter(
    (i) => !i.isDeleted && i.app1Status === "READY_FOR_APP2"
  );

  // Selected invoices state (default to all selected)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    // Synchronize selected IDs when readyInvoices change
    setSelectedIds(readyInvoices.map((i) => i.id));
  }, [invoices]);

  const selectedInvoices = readyInvoices.filter((inv) => selectedIds.includes(inv.id));
  const isAllSelected = readyInvoices.length > 0 && selectedIds.length === readyInvoices.length;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(readyInvoices.map((i) => i.id));
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const totalValue = readyInvoices.reduce((acc, inv) => {
    const val = inv.extractedData?.printedTotalAmount != null 
      ? Number(inv.extractedData.printedTotalAmount) 
      : (inv.calculatedTotal || 0);
    return acc + val;
  }, 0);

  const selectedValue = selectedInvoices.reduce((acc, inv) => {
    const val = inv.extractedData?.printedTotalAmount != null 
      ? Number(inv.extractedData.printedTotalAmount) 
      : (inv.calculatedTotal || 0);
    return acc + val;
  }, 0);

  const isTransferring =
    transferState.status === "PREPARING" ||
    transferState.status === "OPENING_APP2" ||
    transferState.status === "WAITING_FOR_APP2" ||
    transferState.status === "CONNECTING" ||
    transferState.status === "SENDING";

  const buttonLabel = selectedInvoices.length === 1
    ? "SEND TO 3-WAY MATCH"
    : selectedInvoices.length > 1
    ? `SEND ${selectedInvoices.length} TO 3-WAY MATCH`
    : "SEND TO 3-WAY MATCH";

  const handleSendApprovedInvoicesToApp2 = () => {
    if (isTransferring || selectedInvoices.length === 0) return;
    void onSendToApp2(selectedInvoices);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      
      {/* Top Banner */}
      <div className="bg-emerald-600 text-white p-6 rounded-3xl shadow-lg flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider bg-emerald-950 text-emerald-300 px-3 py-1 rounded-full">
            Validated Batch
          </span>
          <h2 className="text-2xl font-black mt-2 tracking-tight">
            Approved Invoices
          </h2>
          <p className="text-xs text-emerald-100 font-medium mt-1">
            Invoices validated and approved for transfer to App 2. ({selectedInvoices.length} of {readyInvoices.length} selected)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            disabled={isTransferring || selectedInvoices.length === 0}
            onClick={() => {
              void handleSendApprovedInvoicesToApp2();
            }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isTransferring ? (
              <Loader2 className="w-4 h-4 animate-spin text-purple-200" />
            ) : (
              <Building2 className="w-4 h-4 text-purple-200" />
            )}
            <span>
              {isTransferring
                ? (transferState.message || "PREPARING TRANSFER…")
                : buttonLabel}
            </span>
            {!isTransferring && <ExternalLink className="w-4 h-4 text-purple-200" />}
          </button>
        </div>
      </div>

      {/* Transfer Status Banner Alerts */}
      {(transferState.status === "TRANSFER_RECEIVED" || transferState.status === "SUCCESS") && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-2xl flex items-center justify-between text-xs text-emerald-900 font-bold shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{transferState.message || "TRANSFER RECEIVED BY APP 2"}</span>
          </div>
          {onDismissTransferState && (
            <button onClick={onDismissTransferState} className="text-emerald-700 hover:text-emerald-900 font-bold text-xs cursor-pointer">
              ✕ Dismiss
            </button>
          )}
        </div>
      )}

      {(transferState.status === "TRANSFER_FAILED" || transferState.status === "ERROR") && (
        <div className="p-4 bg-rose-50 border border-rose-300 rounded-2xl flex items-start justify-between text-xs text-rose-900 font-bold shadow-sm">
          <div className="flex items-start gap-2">
            <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="whitespace-pre-line">{transferState.message}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <button
              onClick={() => void handleSendApprovedInvoicesToApp2()}
              className="flex items-center gap-1.5 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs shadow-xs cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Try Again
            </button>
            {onDismissTransferState && (
              <button onClick={onDismissTransferState} className="text-rose-700 hover:text-rose-900 font-bold text-xs cursor-pointer">
                ✕ Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {/* App 2 Integration Notice */}
      <div className="p-4 rounded-2xl bg-purple-50 border border-purple-200 flex items-start gap-3 text-purple-900 text-xs">
        <Info className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold block text-sm">App 2 Integration Notice:</span>
          Select invoices using the checkboxes below, then click "SEND TO 3-WAY MATCH" to transfer approved invoices to App 2 for three-way matching.
        </div>
      </div>

      {/* Ready Invoices Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-slate-900 text-sm">
              Approved & Verified Invoices Table
            </h3>
            {readyInvoices.length > 0 && (
              <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                {selectedInvoices.length} of {readyInvoices.length} selected
              </span>
            )}
          </div>
          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
            Selected Total: SGD ${selectedValue.toFixed(2)} (Batch Total: SGD ${totalValue.toFixed(2)})
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-200 font-bold uppercase tracking-wider text-[11px] border-b border-slate-800">
              <tr>
                <th className="p-3.5 w-12 text-center">
                  <button
                    onClick={handleToggleSelectAll}
                    title={isAllSelected ? "Deselect All" : "Select All"}
                    className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    {isAllSelected ? (
                      <CheckSquare className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                </th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Supplier Name</th>
                <th className="p-3.5">Invoice Number</th>
                <th className="p-3.5">Invoice Date</th>
                <th className="p-3.5">PO Reference</th>
                <th className="p-3.5 text-right">Total Amount</th>
                <th className="p-3.5">Approved By / Date</th>
                <th className="p-3.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {readyInvoices.map((inv) => {
                const ext = inv.extractedData;
                const approvedBy = inv.reviewDecision?.reviewedBy || "System Auto-Check";
                const approvedDate = inv.reviewDecision?.reviewedAt
                  ? new Date(inv.reviewDecision.reviewedAt).toLocaleDateString("en-SG")
                  : new Date(inv.uploadedAt).toLocaleDateString("en-SG");

                const isSentToApp2 = Boolean(inv.lastTransferredAt);
                const isSelected = selectedIds.includes(inv.id);

                return (
                  <tr
                    key={inv.id}
                    className={`transition-colors ${
                      isSelected ? "bg-purple-50/40 hover:bg-purple-50/70" : "hover:bg-slate-50"
                    }`}
                  >
                    <td className="p-3.5 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelect(inv.id)}
                        className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500 cursor-pointer"
                      />
                    </td>
                    <td className="p-3.5 whitespace-nowrap space-y-1">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-900">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Ready for App 2
                      </span>

                      {isSentToApp2 && (
                        <div className="block">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-purple-100 text-purple-900 border border-purple-200">
                            <Send className="w-3 h-3 text-purple-700" />
                            SENT TO 3-WAY MATCH
                          </span>
                          {inv.lastTransferredAt && (
                            <span className="block text-[10px] text-purple-700 font-mono mt-0.5">
                              Transferred: {new Date(inv.lastTransferredAt).toLocaleString("en-SG")}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-3.5 font-bold text-slate-900">{ext?.supplierName || "Unknown"}</td>
                    <td className="p-3.5 font-mono text-slate-800 font-semibold">{ext?.invoiceNumber || "N/A"}</td>
                    <td className="p-3.5 text-slate-600">{ext?.invoiceDate || "N/A"}</td>
                    <td className="p-3.5 font-mono text-slate-800 font-semibold">{ext?.poReference || "N/A"}</td>
                    <td className="p-3.5 text-right font-black text-slate-900 font-mono">
                      {ext?.currency || "SGD"} ${ext?.printedTotalAmount != null ? Number(ext.printedTotalAmount).toFixed(2) : "0.00"}
                    </td>
                    <td className="p-3.5 text-slate-600">
                      <span className="font-semibold text-slate-800 block">{approvedBy}</span>
                      <span className="text-[10px] text-slate-400">{approvedDate}</span>
                    </td>
                    <td className="p-3.5 text-center">
                      <button
                        onClick={() => onOpenDetailModal(inv)}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" /> View
                      </button>
                    </td>
                  </tr>
                );
              })}

              {readyInvoices.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400 font-medium">
                    No approved invoices ready for App 2.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

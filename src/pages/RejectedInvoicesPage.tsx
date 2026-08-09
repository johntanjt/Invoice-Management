import React from "react";
import { XCircle, Eye } from "lucide-react";
import { InvoiceRecord } from "../types";

interface RejectedInvoicesPageProps {
  invoices: InvoiceRecord[];
  onOpenDetailModal: (inv: InvoiceRecord) => void;
}

export const RejectedInvoicesPage: React.FC<RejectedInvoicesPageProps> = ({
  invoices,
  onOpenDetailModal
}) => {
  const rejectedInvoices = invoices.filter(
    (i) => !i.isDeleted && i.app1Status === "REJECTED_BY_HUMAN"
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      
      {/* Header Banner */}
      <div className="bg-rose-600 text-white p-6 rounded-3xl shadow-md flex items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider bg-rose-950 text-rose-200 px-3 py-1 rounded-full">
            Rejected Records
          </span>
          <h2 className="text-2xl font-black mt-2 tracking-tight">
            Rejected Invoices ({rejectedInvoices.length})
          </h2>
          <p className="text-xs text-rose-100 font-medium mt-1">
            Supplier invoices explicitly rejected by Madam Lim during human exception review.
          </p>
        </div>
        <div className="w-12 h-12 rounded-2xl bg-rose-950 text-rose-300 flex items-center justify-center font-bold shrink-0">
          <XCircle className="w-6 h-6" />
        </div>
      </div>

      {/* Rejected Invoices Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-200 font-bold uppercase tracking-wider text-[11px] border-b border-slate-800">
              <tr>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Supplier Name</th>
                <th className="p-3.5">Invoice Number</th>
                <th className="p-3.5 text-right">Total Amount</th>
                <th className="p-3.5">Rejection Reason</th>
                <th className="p-3.5">Rejected By</th>
                <th className="p-3.5">Rejection Date</th>
                <th className="p-3.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rejectedInvoices.map((inv) => {
                const ext = inv.extractedData;
                const decision = inv.reviewDecision;

                return (
                  <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-900">
                        <XCircle className="w-3.5 h-3.5 text-rose-600" />
                        Rejected
                      </span>
                    </td>
                    <td className="p-3.5 font-bold text-slate-900">{ext?.supplierName || "Unknown"}</td>
                    <td className="p-3.5 font-mono text-slate-800 font-semibold">{ext?.invoiceNumber || "N/A"}</td>
                    <td className="p-3.5 text-right font-black text-slate-900 font-mono">
                      {ext?.currency || "SGD"} ${ext?.printedTotalAmount != null ? Number(ext.printedTotalAmount).toFixed(2) : "0.00"}
                    </td>
                    <td className="p-3.5 text-rose-900 font-semibold max-w-[240px]">
                      {decision?.reviewNotes || "Rejected by user"}
                    </td>
                    <td className="p-3.5 font-bold text-slate-800">
                      {decision?.reviewedBy || "Madam Lim"}
                    </td>
                    <td className="p-3.5 text-slate-600 font-medium">
                      {decision?.reviewedAt ? new Date(decision.reviewedAt).toLocaleDateString("en-SG") : "N/A"}
                    </td>
                    <td className="p-3.5 text-center">
                      <button
                        onClick={() => onOpenDetailModal(inv)}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs flex items-center gap-1 mx-auto"
                      >
                        <Eye className="w-3.5 h-3.5" /> View
                      </button>
                    </td>
                  </tr>
                );
              })}

              {rejectedInvoices.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400 font-medium">
                    No rejected invoices recorded.
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

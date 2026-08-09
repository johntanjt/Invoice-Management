import React, { useState, useMemo } from "react";
import { ChevronRight, Upload, Loader2, Building2, ArrowUpDown, Info, Eye } from "lucide-react";
import { DashboardSummary, AuditEvent, InvoiceRecord } from "../types";
import { NavTab } from "../components/Sidebar";

export interface SupplierPayable {
  supplierName: string;
  normalizedName: string;
  invoiceCount: number;
  approvedAmount: number;
  underReviewAmount: number;
  totalPotentialAmount: number;
  invoiceIds: string[];
}

export function calculateSupplierPayables(invoices: InvoiceRecord[]): SupplierPayable[] {
  const activeInvoices = invoices.filter((i) => !i.isDeleted);
  const supplierMap = new Map<string, SupplierPayable>();

  activeInvoices.forEach((inv) => {
    // Exclude rejected invoices
    if (inv.app1Status === "REJECTED_BY_HUMAN") return;

    // Total amount from printed total or calculated total
    const totalAmount = inv.extractedData?.printedTotalAmount ?? inv.calculatedTotal ?? null;

    // Exclude failed or cannot process records without totals
    if (totalAmount === null || totalAmount === undefined) {
      if (inv.app1Status === "CANNOT_PROCESS" || inv.processingStatus === "FAILED" || inv.processingStatus === "PAUSED") {
        return;
      }
    }

    const rawSupplier = (inv.extractedData?.supplierName || "Unknown Supplier").trim();
    if (!rawSupplier) return;

    const normalizedKey = rawSupplier.toLowerCase().replace(/\s+/g, " ");

    if (!supplierMap.has(normalizedKey)) {
      supplierMap.set(normalizedKey, {
        supplierName: rawSupplier,
        normalizedName: normalizedKey,
        invoiceCount: 0,
        approvedAmount: 0,
        underReviewAmount: 0,
        totalPotentialAmount: 0,
        invoiceIds: []
      });
    }

    const item = supplierMap.get(normalizedKey)!;

    // Prevent double counting by record id
    if (item.invoiceIds.includes(inv.id)) return;
    item.invoiceIds.push(inv.id);
    item.invoiceCount += 1;

    const val = typeof totalAmount === "number" && !isNaN(totalAmount) ? totalAmount : 0;
    const roundedVal = Math.round(val * 100) / 100;

    // Approved if status is READY_FOR_APP2 or explicitly approved by human
    const isApproved = inv.app1Status === "READY_FOR_APP2" || inv.reviewDecision?.decision === "APPROVE";

    if (isApproved) {
      item.approvedAmount += roundedVal;
    } else {
      item.underReviewAmount += roundedVal;
    }

    item.approvedAmount = Math.round(item.approvedAmount * 100) / 100;
    item.underReviewAmount = Math.round(item.underReviewAmount * 100) / 100;
    item.totalPotentialAmount = Math.round((item.approvedAmount + item.underReviewAmount) * 100) / 100;
  });

  return Array.from(supplierMap.values());
}

type SortOption = "total-desc" | "approved-desc" | "count-desc" | "name-asc";

const formatSgd = (val: number): string => {
  return `SGD ${val.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

interface DashboardPageProps {
  summary: DashboardSummary;
  invoices?: InvoiceRecord[];
  recentAuditEvents: AuditEvent[];
  setActiveTab: (tab: NavTab) => void;
  onSendToApp2: () => void;
  onSelectSupplierFilter?: (supplierName: string) => void;
  isTransferring?: boolean;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  summary,
  invoices = [],
  recentAuditEvents,
  setActiveTab,
  onSendToApp2,
  onSelectSupplierFilter,
  isTransferring = false
}) => {
  const [sortOption, setSortOption] = useState<SortOption>("total-desc");

  const suppliers = useMemo(() => {
    return calculateSupplierPayables(invoices);
  }, [invoices]);

  const sortedSuppliers = useMemo(() => {
    const list = [...suppliers];
    list.sort((a, b) => {
      if (sortOption === "total-desc") return b.totalPotentialAmount - a.totalPotentialAmount;
      if (sortOption === "approved-desc") return b.approvedAmount - a.approvedAmount;
      if (sortOption === "count-desc") return b.invoiceCount - a.invoiceCount;
      if (sortOption === "name-asc") return a.supplierName.localeCompare(b.supplierName);
      return 0;
    });
    return list;
  }, [suppliers, sortOption]);

  const topSupplier = useMemo(() => {
    if (suppliers.length === 0) return null;
    return [...suppliers].sort((a, b) => b.totalPotentialAmount - a.totalPotentialAmount)[0];
  }, [suppliers]);

  const maxTotalAmount = useMemo(() => {
    if (suppliers.length === 0) return 0;
    return Math.max(...suppliers.map((s) => s.totalPotentialAmount));
  }, [suppliers]);

  return (
    <div className="p-8 space-y-8 max-w-[1400px] mx-auto">
      
      {/* 4 Summary Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        
        {/* Card 1: Total Active Invoices */}
        <div
          onClick={() => setActiveTab("records")}
          className="bg-white p-5 rounded-xl border border-slate-200 card-shadow cursor-pointer hover:border-slate-300 transition-colors"
        >
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Total Active Invoices
          </p>
          <p className="text-3xl font-bold text-slate-900 mt-2">
            {summary.totalActiveInvoices}
          </p>
          <div className="mt-2 text-xs font-medium text-slate-400">
            Processed from latest batch
          </div>
        </div>

        {/* Card 2: Approved Invoices */}
        <div
          onClick={() => setActiveTab("ready")}
          className="bg-white p-5 rounded-xl border border-teal-100 card-shadow ring-1 ring-teal-500/10 cursor-pointer hover:bg-teal-50 transition-colors"
        >
          <p className="text-xs font-bold text-teal-600 uppercase tracking-wider">
            Approved Invoices
          </p>
          <p className="text-3xl font-bold text-slate-900 mt-2">
            {summary.readyForApp2Count}
          </p>
          <div className="mt-2 text-xs font-medium text-teal-600/70">
            Click to view and export
          </div>
        </div>

        {/* Card 3: Review Required */}
        <div
          onClick={() => setActiveTab("review")}
          className="bg-white p-5 rounded-xl border border-orange-100 card-shadow ring-1 ring-orange-500/10 cursor-pointer hover:bg-orange-50 transition-colors"
        >
          <p className="text-xs font-bold text-orange-600 uppercase tracking-wider">
            Review Required
          </p>
          <p className="text-3xl font-bold text-slate-900 mt-2">
            {summary.reviewRequiredCount}
          </p>
          <div className="mt-2 text-xs font-medium text-orange-600/70">
            Requires your attention
          </div>
        </div>

        {/* Card 4: Rejected Invoices */}
        <div
          onClick={() => setActiveTab("rejected")}
          className="bg-white p-5 rounded-xl border border-red-100 card-shadow ring-1 ring-red-500/10 cursor-pointer hover:bg-red-50 transition-colors"
        >
          <p className="text-xs font-bold text-red-600 uppercase tracking-wider">
            Rejected Invoices
          </p>
          <p className="text-3xl font-bold text-red-600 mt-2">
            {summary.rejectedCount}
          </p>
          <div className="mt-2 text-xs font-medium text-red-600/70">
            Invoices rejected this month
          </div>
        </div>

      </div>

      {/* SECTION: Amount Owed by Supplier */}
      <div className="bg-white rounded-xl border border-slate-200 card-shadow p-6 space-y-6">
        
        {/* Header & Sort Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-teal-600" /> Amount Owed by Supplier
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Summary of active supplier invoice amounts.
            </p>
          </div>

          {suppliers.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-semibold text-slate-600">Sort by:</span>
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as SortOption)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer"
              >
                <option value="total-desc">Highest Total Amount</option>
                <option value="approved-desc">Highest Approved Amount</option>
                <option value="count-desc">Most Invoices</option>
                <option value="name-asc">Supplier Name A–Z</option>
              </select>
            </div>
          )}
        </div>

        {/* Highlight Card for Top Supplier */}
        {topSupplier && topSupplier.totalPotentialAmount > 0 && (
          <div className="p-4 rounded-xl bg-gradient-to-r from-teal-900 via-slate-900 to-indigo-950 text-white shadow-sm flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-teal-500/20 text-teal-300 border border-teal-500/30 px-2.5 py-0.5 rounded-full">
                Highest Supplier Balance
              </span>
              <h4 className="text-lg font-bold mt-1 text-white">
                {topSupplier.supplierName}
              </h4>
            </div>
            <div className="text-right">
              <div className="text-xl font-black text-teal-300">
                {formatSgd(topSupplier.totalPotentialAmount)}
              </div>
              <p className="text-xs text-slate-300 mt-0.5 font-medium">
                across {topSupplier.invoiceCount} {topSupplier.invoiceCount === 1 ? "invoice" : "invoices"}
              </p>
            </div>
          </div>
        )}

        {/* Supplier Table or Empty State */}
        {sortedSuppliers.length === 0 ? (
          <div className="py-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
            <p className="text-xs font-medium text-slate-500">
              No active supplier invoice amounts are available.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4">Supplier</th>
                  <th className="py-3 px-4 text-center">Number of Invoices</th>
                  <th className="py-3 px-4 text-right">Approved Amount</th>
                  <th className="py-3 px-4 text-right">Under Review Amount</th>
                  <th className="py-3 px-4 text-right">Total Potential Amount</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {sortedSuppliers.map((s) => {
                  const barPercentage = maxTotalAmount > 0 ? (s.totalPotentialAmount / maxTotalAmount) * 100 : 0;
                  return (
                    <tr key={s.normalizedName} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        {s.supplierName}
                      </td>
                      <td className="py-3.5 px-4 text-center font-semibold text-slate-700">
                        {s.invoiceCount}
                      </td>
                      <td className="py-3.5 px-4 text-right font-semibold text-emerald-700">
                        {formatSgd(s.approvedAmount)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-semibold text-orange-600">
                        {formatSgd(s.underReviewAmount)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-slate-900">
                        <div>{formatSgd(s.totalPotentialAmount)}</div>
                        <div className="w-24 bg-slate-100 h-1.5 rounded-full overflow-hidden ml-auto mt-1">
                          <div
                            className="bg-teal-500 h-full rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(100, Math.max(0, barPercentage))}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => {
                            if (onSelectSupplierFilter) {
                              onSelectSupplierFilter(s.supplierName);
                            } else {
                              setActiveTab("records");
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 font-bold text-xs inline-flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" /> View Invoices
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Info Note */}
        <div className="flex items-start gap-2 pt-2 text-[11px] text-slate-500">
          <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <span>
            Amounts under review are not yet confirmed for payment and may include possible duplicate invoices.
          </span>
        </div>

      </div>

      {/* Main Workflow & Activity Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Workflow Actions (8 Columns) */}
        <div className="col-span-12 lg:col-span-8 bg-white rounded-xl border border-slate-200 card-shadow p-6 flex flex-col">
          <h3 className="text-lg font-semibold text-slate-800 mb-6">Workflow Actions</h3>
          <div className="flex flex-col gap-4 flex-1">
            
            {/* Action 1 */}
            <div
              onClick={() => setActiveTab("records")}
              className="group relative flex items-center p-5 bg-slate-50 rounded-xl border border-slate-200 hover:border-teal-500 hover:bg-white cursor-pointer transition-all"
            >
              <div className="w-12 h-12 bg-teal-100 text-teal-600 rounded-lg flex items-center justify-center mr-5 font-bold text-xl shrink-0">
                1
              </div>
              <div className="min-w-0">
                <h4 className="font-bold text-slate-800">Upload Invoices</h4>
                <p className="text-sm text-slate-500 truncate">
                  Batch process new supplier invoices (PDF, JPEG, PNG)
                </p>
              </div>
              <ChevronRight className="ml-auto w-6 h-6 text-slate-300 group-hover:text-teal-500 shrink-0" />
            </div>

            {/* Action 2 */}
            <div
              onClick={() => setActiveTab("review")}
              className="group relative flex items-center p-5 bg-slate-50 rounded-xl border border-slate-200 hover:border-purple-500 hover:bg-white cursor-pointer transition-all"
            >
              <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-lg flex items-center justify-center mr-5 font-bold text-xl shrink-0">
                2
              </div>
              <div className="min-w-0">
                <h4 className="font-bold text-slate-800">Review Exceptions</h4>
                <p className="text-sm text-slate-500 truncate">
                  Resolve duplicates and missing information ({summary.reviewRequiredCount} pending)
                </p>
              </div>
              <ChevronRight className="ml-auto w-6 h-6 text-slate-300 group-hover:text-purple-500 shrink-0" />
            </div>

            {/* Action 3 */}
            <div
              onClick={() => {
                if (!isTransferring) void onSendToApp2();
              }}
              className={`group relative flex items-center p-5 bg-teal-600 text-white rounded-xl shadow-md transition-all ${
                isTransferring ? "opacity-60 cursor-not-allowed" : "hover:bg-teal-700 cursor-pointer"
              }`}
            >
              <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center mr-5 font-bold text-xl shrink-0">
                {isTransferring ? <Loader2 className="w-6 h-6 animate-spin text-white" /> : "3"}
              </div>
              <div className="flex-1 min-w-0 mr-2">
                <h4 className="font-bold">{isTransferring ? "Transferring to App 2…" : "Send Approved Invoices to App 2"}</h4>
                <p className="text-sm text-white/80 truncate">
                  Direct transfer {summary.readyForApp2Count} approved records to App 2
                </p>
              </div>
              {!isTransferring && <Upload className="ml-auto w-6 h-6 text-white/90 shrink-0" />}
            </div>

          </div>
        </div>

        {/* Recent Activity (4 Columns) */}
        <div className="col-span-12 lg:col-span-4 bg-white rounded-xl border border-slate-200 card-shadow p-6 flex flex-col">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Recent Activity</h3>
          
          <div className="space-y-4 flex-1 overflow-y-auto max-h-[320px]">
            {recentAuditEvents.slice(0, 5).map((ev, index) => {
              const dotColor = 
                ev.result === "SUCCESS" ? "bg-teal-500" :
                ev.result === "FAILURE" ? "bg-rose-500" :
                index % 3 === 0 ? "bg-purple-500" :
                index % 3 === 1 ? "bg-orange-500" : "bg-slate-300";

              return (
                <div key={ev.id} className="flex items-start space-x-3">
                  <div className={`w-2 h-2 rounded-full ${dotColor} mt-1.5 flex-shrink-0`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">
                      {ev.reason || `${ev.actionType} by ${ev.user}`}
                    </p>
                    <p className="text-[10px] text-slate-400 uppercase font-mono">
                      {new Date(ev.timestamp).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              );
            })}

            {recentAuditEvents.length === 0 && (
              <div className="text-xs text-slate-400 italic py-4">
                No recent activity logged.
              </div>
            )}
          </div>

          <div className="mt-auto pt-4 border-t border-slate-100">
            <button
              onClick={() => setActiveTab("audit")}
              className="text-xs text-teal-600 font-bold hover:underline cursor-pointer"
            >
              View All Audit Events &rarr;
            </button>
          </div>
        </div>

      </div>

    </div>
  );
};


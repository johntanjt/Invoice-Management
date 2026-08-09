import React, { useState } from "react";
import { History, Search, Filter, ShieldCheck, Lock } from "lucide-react";
import { AuditEvent } from "../types";

interface AuditTrailPageProps {
  auditEvents: AuditEvent[];
}

export const AuditTrailPage: React.FC<AuditTrailPageProps> = ({ auditEvents }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");

  const filteredEvents = auditEvents.filter((ev) => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = 
      !searchTerm ||
      ev.actionType.toLowerCase().includes(searchLower) ||
      ev.user.toLowerCase().includes(searchLower) ||
      (ev.invoiceNumber && ev.invoiceNumber.toLowerCase().includes(searchLower)) ||
      (ev.supplierName && ev.supplierName.toLowerCase().includes(searchLower)) ||
      (ev.reason && ev.reason.toLowerCase().includes(searchLower));

    const matchesAction = actionFilter === "ALL" || ev.actionType === actionFilter;

    return matchesSearch && matchesAction;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      
      {/* Header Banner */}
      <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-xl flex items-center justify-between gap-4 border border-slate-800">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider bg-teal-950 text-teal-400 border border-teal-800 px-3 py-1 rounded-full flex items-center gap-1.5 w-max">
            <Lock className="w-3 h-3 inline" /> Immutable Log
          </span>
          <h2 className="text-2xl font-black mt-2 tracking-tight">
            System Audit Trail ({auditEvents.length} Events)
          </h2>
          <p className="text-xs text-slate-300 font-medium mt-1">
            Append-only, immutable activity log tracking every upload, review, override, deletion, and export.
          </p>
        </div>

        <div className="w-12 h-12 rounded-2xl bg-teal-500/20 text-teal-400 border border-teal-500/30 flex items-center justify-center font-bold shrink-0">
          <History className="w-6 h-6" />
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search action, user, invoice number, supplier, or reason..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-500" />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="ALL">All Action Types</option>
            <option value="INVOICE_UPLOAD">Uploads</option>
            <option value="HUMAN_REVIEW">Human Reviews</option>
            <option value="INVOICE_RETRY_REQUESTED">Retry Requested</option>
            <option value="INVOICE_RETRY_STARTED">Retry Started</option>
            <option value="INVOICE_RETRY_COMPLETED">Retry Completed</option>
            <option value="INVOICE_RETRY_FAILED">Retry Failed</option>
            <option value="INVOICE_RETRY_PAUSED">Retry Paused</option>
            <option value="INVOICE_SOURCE_FILE_RESELECTED">File Reselected</option>
            <option value="INVOICE_SOURCE_FILE_OVERRIDE_CONFIRMED">File Override Confirmed</option>
            <option value="INVOICE_SOFT_DELETED">Single Soft Deletions</option>
            <option value="BULK_INVOICE_SOFT_DELETED">Bulk Soft Deletions</option>
            <option value="ALL_ACTIVE_INVOICES_SOFT_DELETED">Clear All Soft Deletions</option>
            <option value="DELETE_SINGLE">Single Deletions</option>
            <option value="DELETE_MULTIPLE">Bulk Deletions</option>
            <option value="DELETE_ALL">Clear All</option>
            <option value="RESTORE_RECORD">Restorations</option>
            <option value="APP2_OPENED">App 2 Opened</option>
            <option value="SESSION_TIMEOUT_SETTING_CHANGED">Timeout Setting Changed</option>
            <option value="SESSION_TIMEOUT_WARNING_DISPLAYED">Timeout Warning Displayed</option>
            <option value="SESSION_EXTENDED_BY_USER">Session Extended</option>
            <option value="SESSION_AUTOMATIC_LOGOUT">Automatic Logout</option>
          </select>
        </div>
      </div>

      {/* Audit Log Table (Strictly NO delete/edit controls) */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-200 font-bold uppercase tracking-wider text-[11px] border-b border-slate-800">
              <tr>
                <th className="p-3.5">Timestamp</th>
                <th className="p-3.5">User</th>
                <th className="p-3.5">Action Type</th>
                <th className="p-3.5">Invoice #</th>
                <th className="p-3.5">Supplier</th>
                <th className="p-3.5">Previous / New State</th>
                <th className="p-3.5">Reason / Notes</th>
                <th className="p-3.5 text-center">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEvents.map((ev) => (
                <tr key={ev.id} className="hover:bg-slate-50 transition-colors font-mono">
                  <td className="p-3.5 text-slate-500 whitespace-nowrap">
                    {new Date(ev.timestamp).toLocaleString("en-SG")}
                  </td>
                  <td className="p-3.5 font-bold text-slate-900 font-sans">{ev.user}</td>
                  <td className="p-3.5">
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-bold text-[11px] border border-slate-200">
                      {ev.actionType}
                    </span>
                  </td>
                  <td className="p-3.5 font-bold text-slate-800">{ev.invoiceNumber || "—"}</td>
                  <td className="p-3.5 font-sans font-semibold text-slate-800">{ev.supplierName || "—"}</td>
                  <td className="p-3.5 text-slate-600 font-sans max-w-[200px] truncate">
                    {ev.previousValue && <span className="text-slate-400">{ev.previousValue} &rarr; </span>}
                    {ev.newValue && <span className="font-bold text-teal-800">{ev.newValue}</span>}
                    {!ev.previousValue && !ev.newValue && "—"}
                  </td>
                  <td className="p-3.5 font-sans text-slate-700 max-w-[240px]">
                    {ev.reason || "N/A"}
                  </td>
                  <td className="p-3.5 text-center">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      ev.result === "SUCCESS" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                    }`}>
                      {ev.result}
                    </span>
                  </td>
                </tr>
              ))}

              {filteredEvents.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400 font-medium font-sans">
                    No audit events match your search filters.
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

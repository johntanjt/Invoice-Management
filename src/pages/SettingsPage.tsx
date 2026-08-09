import React, { useState } from "react";
import { 
  Settings as SettingsIcon, 
  Trash2, 
  RotateCcw, 
  ShieldAlert, 
  Server, 
  Lock, 
  CheckCircle2, 
  Info 
} from "lucide-react";
import { InvoiceRecord } from "../types";
import { PasscodeModal } from "../components/PasscodeModal";
import { DeleteInvoiceModal } from "../components/DeleteInvoiceModal";

interface SettingsPageProps {
  invoices: InvoiceRecord[];
  inactivityTimeoutMinutes: number;
  onSaveTimeoutSetting: (minutes: number) => Promise<void>;
  onResetTimeoutSetting: () => Promise<void>;
  onDeleteSelected: (passcode: string, reason: string, ids: string[]) => Promise<void>;
  onDeleteAll: (passcode: string, reason: string) => Promise<void>;
  onRestore: (id: string, passcode: string, reason: string) => Promise<void>;
  onRefreshData?: () => Promise<void>;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  invoices,
  inactivityTimeoutMinutes,
  onSaveTimeoutSetting,
  onResetTimeoutSetting,
  onDeleteSelected,
  onDeleteAll,
  onRestore,
  onRefreshData
}) => {
  const activeInvoices = invoices.filter((i) => !i.isDeleted);
  const deletedInvoices = invoices.filter((i) => i.isDeleted);

  // Selection state for multi-delete
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Timeout setting dropdown local state & feedback
  const [selectedTimeout, setSelectedTimeout] = useState<number>(inactivityTimeoutMinutes);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Synchronize dropdown when external setting changes
  React.useEffect(() => {
    setSelectedTimeout(inactivityTimeoutMinutes);
  }, [inactivityTimeoutMinutes]);

  const handleSaveTimeout = async () => {
    setIsSaving(true);
    setFeedbackMessage(null);
    try {
      await onSaveTimeoutSetting(selectedTimeout);
      setFeedbackMessage(`Automatic sign-out updated to ${selectedTimeout} ${selectedTimeout === 1 ? "minute" : "minutes"}.`);
    } catch (err: any) {
      setFeedbackMessage(`Failed to update setting: ${err.message || "Unknown error"}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetTimeout = async () => {
    setIsSaving(true);
    setFeedbackMessage(null);
    try {
      setSelectedTimeout(5);
      await onResetTimeoutSetting();
      setFeedbackMessage("Automatic sign-out reset to 5 minutes.");
    } catch (err: any) {
      setFeedbackMessage(`Failed to reset setting: ${err.message || "Unknown error"}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Modal states
  const [deleteSelectedModalOpen, setDeleteSelectedModalOpen] = useState(false);
  const [deleteAllModalOpen, setDeleteAllModalOpen] = useState(false);

  // Restore Modal state
  const [restoreModal, setRestoreModal] = useState<{
    isOpen: boolean;
    invoice: InvoiceRecord | null;
  }>({ isOpen: false, invoice: null });

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(activeInvoices.map((i) => i.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      
      {/* Header Banner */}
      <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-xl flex items-center justify-between gap-4 border border-slate-800">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider bg-slate-800 text-slate-300 px-3 py-1 rounded-full">
            System Maintenance
          </span>
          <h2 className="text-2xl font-black mt-2 tracking-tight">
            Settings & Data Management
          </h2>
          <p className="text-xs text-slate-300 font-medium mt-1">
            Bulk invoice deletion, record restoration, and system status information.
          </p>
        </div>

        <div className="w-12 h-12 rounded-2xl bg-slate-800 text-slate-200 flex items-center justify-center font-bold shrink-0">
          <SettingsIcon className="w-6 h-6" />
        </div>
      </div>

      {/* SECTION 0: Security and Session */}
      <div id="settings-security-session-section" className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-5">
        <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
          <div>
            <h3 id="settings-security-session-title" className="font-bold text-slate-900 text-base flex items-center gap-2">
              <Lock className="w-5 h-5 text-indigo-600" /> Security and Session
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure automatic sign-out thresholds and session safety rules.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h4 className="font-bold text-slate-800 text-sm">Automatic Sign-Out</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              For security, the application will sign you out after a period of inactivity.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-200">
            <div className="space-y-1">
              <label htmlFor="timeout-select" className="text-xs font-bold text-slate-700 block">
                Sign out after:
              </label>
              <select
                id="timeout-select"
                value={selectedTimeout}
                onChange={(e) => setSelectedTimeout(Number(e.target.value))}
                className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 font-bold text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 cursor-pointer"
              >
                <option value={1}>1 minute</option>
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                id="save-timeout-setting-btn"
                onClick={handleSaveTimeout}
                disabled={isSaving}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                Save Setting
              </button>

              <button
                id="reset-timeout-setting-btn"
                onClick={handleResetTimeout}
                disabled={isSaving}
                className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                Reset to Default
              </button>
            </div>
          </div>

          {feedbackMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{feedbackMessage}</span>
            </div>
          )}

          <div id="current-timeout-display" className="text-xs font-bold text-slate-600 font-mono bg-slate-100 p-3 rounded-xl border border-slate-200 inline-block">
            Current automatic sign-out time: {inactivityTimeoutMinutes} {inactivityTimeoutMinutes === 1 ? "minute" : "minutes"}
          </div>
        </div>
      </div>

      {/* SECTION 1: Bulk Deletion & Data Management */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-rose-600" /> Protected Data Deletion Actions
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Requires Madam Lim's passcode (1111) and mandatory written justification.
            </p>
            <p className="text-xs text-rose-700 font-medium mt-1">
              This moves all active invoices to Deleted Records. The audit trail will remain permanently available.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setDeleteSelectedModalOpen(true)}
              disabled={selectedIds.length === 0}
              className="px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold text-xs disabled:opacity-40 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete Selected ({selectedIds.length})</span>
            </button>

            <button
              onClick={() => setDeleteAllModalOpen(true)}
              disabled={activeInvoices.length === 0}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs disabled:opacity-40 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete All Active Invoices</span>
            </button>
          </div>
        </div>

        {/* Selection Table */}
        <div className="border border-slate-200 rounded-2xl overflow-hidden text-xs">
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between font-bold text-slate-700">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.length === activeInvoices.length && activeInvoices.length > 0}
                onChange={handleSelectAll}
                className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500"
              />
              <span>Select All Active Invoices ({activeInvoices.length})</span>
            </label>
            <span className="text-slate-500 font-normal">
              {selectedIds.length} items selected for deletion
            </span>
          </div>

          <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
            {activeInvoices.map((inv) => {
              const ext = inv.extractedData;
              const isSelected = selectedIds.includes(inv.id);

              return (
                <div
                  key={inv.id}
                  onClick={() => handleToggleSelect(inv.id)}
                  className={`p-3 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 transition-colors ${
                    isSelected ? "bg-rose-50/50" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}} // handled by row click
                      className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500"
                    />
                    <div>
                      <span className="font-bold text-slate-900 block">{ext?.supplierName || "Unknown"}</span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        Invoice #{ext?.invoiceNumber || "N/A"} • Uploaded {new Date(inv.uploadedAt).toLocaleDateString("en-SG")}
                      </span>
                    </div>
                  </div>

                  <span className="font-black text-slate-900 font-mono">
                    {ext?.currency || "SGD"} ${ext?.printedTotalAmount != null ? Number(ext.printedTotalAmount).toFixed(2) : "0.00"}
                  </span>
                </div>
              );
            })}

            {activeInvoices.length === 0 && (
              <div className="p-6 text-center text-slate-400 font-medium">
                No active invoices available for bulk deletion.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 2: Soft Deleted Records & Restoration */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div>
          <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-teal-600" /> Soft-Deleted Records ({deletedInvoices.length})
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Read-only deleted invoices audit view. Records can be restored using Madam Lim's passcode (1111).
          </p>
        </div>

        <div className="border border-slate-200 rounded-2xl overflow-hidden text-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="p-3">Supplier</th>
                  <th className="p-3">Invoice Number</th>
                  <th className="p-3">Invoice Date</th>
                  <th className="p-3">PO Reference</th>
                  <th className="p-3 text-right">Total Amount</th>
                  <th className="p-3">Previous Status</th>
                  <th className="p-3">Deleted By</th>
                  <th className="p-3">Deleted Date</th>
                  <th className="p-3">Deletion Reason</th>
                  <th className="p-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {deletedInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="p-3 font-bold text-slate-800 max-w-[140px] truncate">{inv.extractedData?.supplierName || "Unknown"}</td>
                    <td className="p-3 font-mono font-semibold">{inv.extractedData?.invoiceNumber || "N/A"}</td>
                    <td className="p-3 text-slate-600">{inv.extractedData?.invoiceDate || "N/A"}</td>
                    <td className="p-3 font-mono text-slate-600">{inv.extractedData?.poReference || "N/A"}</td>
                    <td className="p-3 text-right font-black font-mono">
                      {inv.extractedData?.currency || "SGD"} ${inv.extractedData?.printedTotalAmount != null ? Number(inv.extractedData.printedTotalAmount).toFixed(2) : "0.00"}
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 uppercase">
                        {(inv.previousStatus || inv.app1Status || "UNKNOWN").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="p-3 font-semibold text-slate-700">{inv.deletedBy || "Madam Lim"}</td>
                    <td className="p-3 text-slate-500 whitespace-nowrap">{inv.deletedAt ? new Date(inv.deletedAt).toLocaleString("en-SG") : "N/A"}</td>
                    <td className="p-3 text-rose-700 font-semibold max-w-[180px] truncate" title={inv.deletionReason || inv.deletedReason || "N/A"}>
                      {inv.deletionReason || inv.deletedReason || "N/A"}
                    </td>
                    <td className="p-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => setRestoreModal({ isOpen: true, invoice: inv })}
                          className="px-2.5 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-xs transition-colors flex items-center gap-1 cursor-pointer"
                          title="Restore Record"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Restore
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {deletedInvoices.length === 0 && (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-slate-400 font-medium">
                      No soft-deleted records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* SECTION 3: System Status & Information */}
      <div className="bg-slate-900 text-slate-200 rounded-3xl p-6 border border-slate-800 space-y-4">
        <h3 className="font-bold text-white text-base flex items-center gap-2">
          <Server className="w-5 h-5 text-teal-400" /> Application Environment Status
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
          <div className="p-3 bg-slate-800 rounded-xl border border-slate-700">
            <span className="text-slate-400 block">App Version</span>
            <span className="font-bold text-white text-sm">App 1 • Boon Huat Intake</span>
          </div>

          <div className="p-3 bg-slate-800 rounded-xl border border-slate-700">
            <span className="text-slate-400 block">Server Port</span>
            <span className="font-bold text-teal-400 text-sm">3000 (Cloud Run Proxy)</span>
          </div>

          <div className="p-3 bg-slate-800 rounded-xl border border-slate-700">
            <span className="text-slate-400 block">Active Passcode</span>
            <span className="font-bold text-emerald-400 text-sm">Configured (1111)</span>
          </div>
        </div>
      </div>

      {/* Modal for Delete Selected */}
      <DeleteInvoiceModal
        isOpen={deleteSelectedModalOpen}
        mode="SELECTED"
        selectedInvoices={activeInvoices.filter((i) => selectedIds.includes(i.id))}
        onConfirm={async () => {
          setDeleteSelectedModalOpen(false);
          setSelectedIds([]);
          if (onRefreshData) await onRefreshData();
        }}
        onCancel={() => setDeleteSelectedModalOpen(false)}
      />

      {/* Modal for Delete All Active Invoices */}
      <DeleteInvoiceModal
        isOpen={deleteAllModalOpen}
        mode="ALL"
        activeInvoices={activeInvoices}
        onConfirm={async () => {
          setDeleteAllModalOpen(false);
          setSelectedIds([]);
          if (onRefreshData) await onRefreshData();
        }}
        onCancel={() => setDeleteAllModalOpen(false)}
      />

      {/* Passcode Modal for Restore Record */}
      <PasscodeModal
        isOpen={restoreModal.isOpen}
        onClose={() => setRestoreModal({ isOpen: false, invoice: null })}
        title="Restore Invoice Record"
        description={`Restore invoice ${restoreModal.invoice?.extractedData?.invoiceNumber || ""} back to active workspace.`}
        confirmButtonText="Confirm Restore"
        isDangerous={false}
        onConfirm={async (passcode, reason) => {
          if (restoreModal.invoice) {
            await onRestore(restoreModal.invoice.id, passcode, reason);
          }
        }}
      />

    </div>
  );
};

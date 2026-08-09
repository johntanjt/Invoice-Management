import React, { useState, useEffect } from "react";
import { AlertTriangle, Lock, Eye, EyeOff, X, Trash2, CheckCircle2 } from "lucide-react";
import { InvoiceRecord } from "../types";
import { authoriseActionApi, softDeleteSingleInvoiceApi, softDeleteSelectedInvoicesApi, softDeleteAllInvoicesApi } from "../services/api";

export type DeleteModalMode = "SINGLE" | "SELECTED" | "ALL";

interface DeleteInvoiceModalProps {
  isOpen: boolean;
  mode: DeleteModalMode;
  targetInvoice?: InvoiceRecord | null;
  selectedInvoices?: InvoiceRecord[];
  activeInvoices?: InvoiceRecord[];
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const DeleteInvoiceModal: React.FC<DeleteInvoiceModalProps> = ({
  isOpen,
  mode,
  targetInvoice,
  selectedInvoices = [],
  activeInvoices = [],
  onConfirm,
  onCancel
}) => {
  const [passcode, setPasscode] = useState("");
  const [showPasscode, setShowPasscode] = useState(false);
  const [reason, setReason] = useState("");
  const [phraseInput, setPhraseInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPasscode("");
      setReason("");
      setPhraseInput("");
      setErrorMsg("");
      setIsDeleting(false);
    }
  }, [isOpen, mode, targetInvoice]);

  if (!isOpen) return null;

  const requiredPhrase =
    mode === "SINGLE"
      ? "DELETE"
      : mode === "SELECTED"
      ? "DELETE SELECTED"
      : "DELETE ALL INVOICES";

  const isPhraseCorrect = phraseInput.trim() === requiredPhrase;
  const isReasonProvided = reason.trim().length > 0;
  const isPasscodeEntered = passcode.trim().length > 0;
  const canSubmit = isPasscodeEntered && isReasonProvided && isPhraseCorrect && !isDeleting;

  // Single Invoice Details
  const singleSupplier = targetInvoice?.extractedData?.supplierName || "Unknown Supplier";
  const singleInvNumber = targetInvoice?.extractedData?.invoiceNumber || "N/A";
  const singleAmount = targetInvoice?.extractedData?.printedTotalAmount != null
    ? `${targetInvoice.extractedData?.currency || "SGD"} $${Number(targetInvoice.extractedData.printedTotalAmount).toFixed(2)}`
    : "SGD $0.00";
  const singleStatus = targetInvoice?.app1Status || "UNKNOWN";

  // Selected Invoices Details
  const selectedCount = selectedInvoices.length;
  const selectedTotalValue = selectedInvoices.reduce(
    (acc, inv) => acc + (inv.extractedData?.printedTotalAmount || 0),
    0
  );
  const selectedNumbers = selectedInvoices
    .map((inv) => `#${inv.extractedData?.invoiceNumber || "N/A"}`)
    .slice(0, 5)
    .join(", ") + (selectedInvoices.length > 5 ? ` (+${selectedInvoices.length - 5} more)` : "");

  const selectedStatusCounts = selectedInvoices.reduce<Record<string, number>>((acc, inv) => {
    acc[inv.app1Status] = (acc[inv.app1Status] || 0) + 1;
    return acc;
  }, {});
  const selectedStatusSummary = Object.entries(selectedStatusCounts)
    .map(([status, count]) => `${count} ${status.replace(/_/g, " ")}`)
    .join(", ");

  // All Active Details
  const allActiveCount = activeInvoices.length;
  const allReadyCount = activeInvoices.filter((i) => i.app1Status === "READY_FOR_APP2").length;
  const allReviewCount = activeInvoices.filter((i) => i.app1Status === "REVIEW_REQUIRED" || i.app1Status === "CANNOT_PROCESS").length;
  const allRejectedCount = activeInvoices.filter((i) => i.app1Status === "REJECTED_BY_HUMAN").length;
  const allTotalValue = activeInvoices.reduce(
    (acc, inv) => acc + (inv.extractedData?.printedTotalAmount || 0),
    0
  );

  const getLoadingButtonText = () => {
    if (mode === "SINGLE") return "Deleting Invoice…";
    if (mode === "SELECTED") return "Deleting Selected Invoices…";
    return "Deleting All Active Invoices…";
  };

  const getModalTitle = () => {
    if (mode === "SINGLE") return "Delete Invoice";
    if (mode === "SELECTED") return `Delete ${selectedCount} Selected Invoices`;
    return "Delete All Active Invoices";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!isPasscodeEntered) {
      setErrorMsg("Incorrect action passcode.");
      return;
    }
    if (!isReasonProvided) {
      setErrorMsg("Enter a reason for deletion.");
      return;
    }
    if (!isPhraseCorrect) {
      setErrorMsg("Enter the required confirmation phrase exactly.");
      return;
    }

    try {
      setIsDeleting(true);

      // Step 1: Authorise action server-side first
      const actionType =
        mode === "SINGLE"
          ? "DELETE_INVOICE"
          : mode === "SELECTED"
          ? "DELETE_SELECTED"
          : "DELETE_ALL";

      const authRes = await authoriseActionApi({ passcode, action: actionType });
      if (!authRes.authorised) {
        setErrorMsg("Incorrect action passcode.");
        setIsDeleting(false);
        return;
      }

      // Step 2: Call appropriate soft-delete endpoint
      if (mode === "SINGLE") {
        if (!targetInvoice) throw new Error("No target invoice selected.");
        await softDeleteSingleInvoiceApi(targetInvoice.id, {
          deletionReason: reason,
          confirmationPhrase: "DELETE",
          passcode
        });
      } else if (mode === "SELECTED") {
        const recordIds = selectedInvoices.map((i) => i.id);
        await softDeleteSelectedInvoicesApi({
          recordIds,
          deletionReason: reason,
          confirmationPhrase: "DELETE SELECTED",
          passcode
        });
      } else {
        await softDeleteAllInvoicesApi({
          deletionReason: reason,
          confirmationPhrase: "DELETE ALL INVOICES",
          passcode
        });
      }

      // Step 3: Trigger callback
      await Promise.resolve(onConfirm());
    } catch (err: any) {
      console.error("Deletion error:", err);
      if (err.message === "SESSION_EXPIRED") {
        setErrorMsg("Your session has expired. Please sign in again.");
      } else if (err.message && err.message.includes("audit")) {
        setErrorMsg("The deletion was not completed because the audit event could not be recorded.");
      } else {
        setErrorMsg(err.message || "The deletion could not be completed. No invoice data was changed.");
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-rose-50 border-b border-rose-100 p-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-rose-100 text-rose-700 rounded-2xl shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">{getModalTitle()}</h3>
              <p className="text-xs text-rose-800 font-medium mt-0.5">
                Authorised action requires passcode & audit reason for Madam Lim
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!isDeleting) onCancel();
            }}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-rose-100/50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Display Summary Box */}
        <div className="p-5 space-y-4">
          {mode === "SINGLE" && (
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-500 font-medium block">Supplier</span>
                  <strong className="text-slate-900 font-bold block truncate">{singleSupplier}</strong>
                </div>
                <div>
                  <span className="text-slate-500 font-medium block">Invoice Number</span>
                  <strong className="text-slate-900 font-mono font-bold block">{singleInvNumber}</strong>
                </div>
                <div>
                  <span className="text-slate-500 font-medium block">Total Amount</span>
                  <strong className="text-teal-700 font-mono font-bold block">{singleAmount}</strong>
                </div>
                <div>
                  <span className="text-slate-500 font-medium block">Current Status</span>
                  <span className="px-2 py-0.5 bg-slate-200 text-slate-800 rounded font-bold text-[11px] inline-block">
                    {singleStatus.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
            </div>
          )}

          {mode === "SELECTED" && (
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-500 font-medium block">Selected Invoices</span>
                  <strong className="text-slate-900 font-bold block">{selectedCount} invoice(s)</strong>
                </div>
                <div>
                  <span className="text-slate-500 font-medium block">Combined Value</span>
                  <strong className="text-teal-700 font-mono font-bold block">SGD ${selectedTotalValue.toFixed(2)}</strong>
                </div>
              </div>
              <div>
                <span className="text-slate-500 font-medium block">Status Breakdown</span>
                <span className="text-slate-800 font-semibold">{selectedStatusSummary || "N/A"}</span>
              </div>
              <div>
                <span className="text-slate-500 font-medium block">Selected Numbers</span>
                <span className="font-mono text-slate-700 text-[11px] block">{selectedNumbers}</span>
              </div>
            </div>
          )}

          {mode === "ALL" && (
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-500 font-medium block">Total Active Invoices</span>
                  <strong className="text-slate-900 font-bold block text-sm">{allActiveCount}</strong>
                </div>
                <div>
                  <span className="text-slate-500 font-medium block">Total Active Value</span>
                  <strong className="text-teal-700 font-mono font-bold block text-sm">SGD ${allTotalValue.toFixed(2)}</strong>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1 pt-1 border-t border-slate-200 text-[11px]">
                <div className="text-emerald-700 font-bold">Ready: {allReadyCount}</div>
                <div className="text-amber-700 font-bold">Review: {allReviewCount}</div>
                <div className="text-rose-700 font-bold">Rejected: {allRejectedCount}</div>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold">
                {errorMsg}
              </div>
            )}

            {/* Action Passcode */}
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Action Passcode <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPasscode ? "text" : "password"}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="Enter Madam Lim's action passcode"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPasscode(!showPasscode)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPasscode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Mandatory Reason */}
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Reason for Deletion <span className="text-rose-500">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Enter mandatory deletion justification for audit trail..."
                rows={2}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
                required
              />
            </div>

            {/* Confirmation Phrase */}
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Type <span className="font-mono text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded font-black">{requiredPhrase}</span> to confirm <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={phraseInput}
                onChange={(e) => setPhraseInput(e.target.value)}
                placeholder={`Type ${requiredPhrase}`}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
                required
              />
            </div>

            {/* Actions */}
            <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => void onCancel()}
                disabled={isDeleting}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white font-bold text-xs shadow-md transition-colors cursor-pointer flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>{getLoadingButtonText()}</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>
                      {mode === "SINGLE"
                        ? "Delete Invoice"
                        : mode === "SELECTED"
                        ? "Delete Selected Invoices"
                        : "Delete All Active Invoices"}
                    </span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

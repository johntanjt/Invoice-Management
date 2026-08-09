import React, { useState } from "react";
import { Lock, Eye, EyeOff, AlertTriangle, X } from "lucide-react";

interface PasscodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  requiredPhrase?: string; // e.g. "DELETE", "DELETE SELECTED", "DELETE ALL INVOICES"
  onConfirm: (passcode: string, reason: string) => Promise<void> | void;
  confirmButtonText?: string;
  isDangerous?: boolean;
}

export const PasscodeModal: React.FC<PasscodeModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  requiredPhrase,
  onConfirm,
  confirmButtonText = "Confirm Action",
  isDangerous = true
}) => {
  const [passcode, setPasscode] = useState("");
  const [showPasscode, setShowPasscode] = useState(false);
  const [reason, setReason] = useState("");
  const [phraseInput, setPhraseInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const phraseMatches = !requiredPhrase || phraseInput.trim() === requiredPhrase;
  const isReasonValid = reason.trim().length > 0;
  const canSubmit = passcode.trim().length > 0 && isReasonValid && phraseMatches && !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!canSubmit) return;

    try {
      setIsSubmitting(true);
      await Promise.resolve(onConfirm(passcode, reason));
      // Reset
      setPasscode("");
      setReason("");
      setPhraseInput("");
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Authorisation failed. Check passcode.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden">
        {/* Modal Header */}
        <div className={`p-5 flex items-start justify-between border-b ${isDangerous ? "bg-rose-50 border-rose-100" : "bg-teal-50 border-teal-100"}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${isDangerous ? "bg-rose-100 text-rose-700" : "bg-teal-100 text-teal-700"}`}>
              {isDangerous ? <AlertTriangle className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">{title}</h3>
              <p className="text-xs text-slate-600 mt-0.5">{description}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200/50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          {/* Action Passcode Field */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Authorisation Passcode <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPasscode ? "text" : "password"}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Enter passcode"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm font-mono"
                required
              />
              <button
                type="button"
                onClick={() => setShowPasscode(!showPasscode)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-medium"
              >
                {showPasscode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Mandatory Reason Field */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Mandatory Reason <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Provide reason for this action..."
              rows={2}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
              required
            />
          </div>

          {/* Required Phrase Field if applicable */}
          {requiredPhrase && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Type <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-rose-600 font-bold">{requiredPhrase}</span> to confirm <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={phraseInput}
                onChange={(e) => setPhraseInput(e.target.value)}
                placeholder={`Type ${requiredPhrase}`}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 text-sm font-mono"
                required
              />
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`px-4 py-2 rounded-xl font-semibold text-xs text-white shadow-md transition-all ${
                isDangerous
                  ? "bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300"
                  : "bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300"
              }`}
            >
              {isSubmitting ? "Verifying..." : confirmButtonText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

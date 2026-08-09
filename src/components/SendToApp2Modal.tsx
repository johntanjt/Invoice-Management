import React from "react";
import { Building2, X, AlertCircle } from "lucide-react";

interface SendToApp2ModalProps {
  isOpen: boolean;
  approvedCount: number;
  destination: string;
  onConfirm: () => void;
  onCancel: () => void;
  isSending?: boolean;
}

export const SendToApp2Modal: React.FC<SendToApp2ModalProps> = ({
  isOpen,
  approvedCount,
  destination,
  onConfirm,
  onCancel,
  isSending = false
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-base">
                SEND TO 3-WAY MATCH
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">
                App 1 → App 2 Transfer Confirmation
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={isSending}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Details */}
        <div className="space-y-3 text-xs">
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-semibold">Approved invoices:</span>
              <span className="font-extrabold text-slate-900 text-sm bg-purple-50 text-purple-900 px-2.5 py-0.5 rounded-full border border-purple-200">
                {approvedCount}
              </span>
            </div>

            <div className="flex justify-between items-center pt-1 border-t border-slate-200/60">
              <span className="text-slate-500 font-semibold">Destination:</span>
              <span className="font-bold text-slate-900 text-right">
                {destination}
              </span>
            </div>
          </div>

          <div className="p-3.5 bg-purple-50 border border-purple-200 rounded-2xl flex items-start gap-2.5 text-purple-950 font-medium">
            <AlertCircle className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
            <span>Only invoices that have completed App 1 review will be transferred.</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSending}
            className="px-4 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-700 text-xs hover:bg-slate-50 transition-colors cursor-pointer"
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSending}
            className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center gap-2"
          >
            <span>SEND TO APP 2</span>
          </button>
        </div>

      </div>
    </div>
  );
};

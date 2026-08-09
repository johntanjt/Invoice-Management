import React from "react";
import { Clock, AlertTriangle, LogOut, ShieldCheck } from "lucide-react";

interface SessionWarningModalProps {
  isOpen: boolean;
  secondsRemaining: number;
  inactivityTimeoutMinutes: number;
  hasUnsavedChanges?: boolean;
  onStaySignedIn: () => void;
  onSignOutNow: () => void;
}

export const SessionWarningModal: React.FC<SessionWarningModalProps> = ({
  isOpen,
  secondsRemaining,
  inactivityTimeoutMinutes,
  hasUnsavedChanges = false,
  onStaySignedIn,
  onSignOutNow
}) => {
  if (!isOpen) return null;

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const formattedTime = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const isOneMinuteTimeout = inactivityTimeoutMinutes === 1;

  return (
    <div
      id="session-warning-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 animate-fade-in"
    >
      <div
        id="session-warning-modal-card"
        className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden text-slate-900"
      >
        {/* Modal Header */}
        <div className="bg-amber-50 border-b border-amber-100 p-6 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider bg-amber-200/80 text-amber-900 px-2.5 py-0.5 rounded-full">
              Inactivity Alert
            </span>
            <h3 id="session-warning-title" className="text-xl font-black text-slate-900 mt-1">
              Session Expiring Soon
            </h3>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 text-sm">
          <p id="session-warning-message" className="text-slate-600 font-medium leading-relaxed">
            {isOneMinuteTimeout
              ? "You will be signed out shortly due to inactivity."
              : "You will be signed out in 1 minute because there has been no activity."}
          </p>

          {hasUnsavedChanges && (
            <div
              id="session-warning-unsaved-alert"
              className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-800 text-xs font-semibold"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>You have unsaved changes. Stay signed in to save them before the session expires.</span>
            </div>
          )}

          {/* Countdown Display */}
          <div
            id="session-warning-countdown-box"
            className="p-4 bg-slate-900 text-white rounded-2xl text-center space-y-1 shadow-inner"
          >
            <span className="text-xs text-slate-400 font-mono uppercase tracking-widest block">
              Time Remaining
            </span>
            <div
              id="session-warning-countdown"
              className="text-3xl font-black font-mono tracking-tight text-amber-400"
            >
              Signing out in {formattedTime}
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
          <button
            id="session-warning-signout-btn"
            onClick={onSignOutNow}
            className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out Now</span>
          </button>

          <button
            id="session-warning-stay-btn"
            onClick={onStaySignedIn}
            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs transition-transform active:scale-95 flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4 text-slate-950" />
            <span>Stay Signed In</span>
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from "react";
import { Lock, Eye, EyeOff, Building2, UserCheck } from "lucide-react";
import { loginApi } from "../services/api";
import { STAFF_PROFILES, StaffProfile, AuthenticatedUser } from "../types";

interface LoginPageProps {
  onLoginSuccess: (user: AuthenticatedUser, inactivityTimeoutMinutes?: number) => void;
  sessionExpiredMessage?: string;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, sessionExpiredMessage }) => {
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [passcode, setPasscode] = useState<string>("");
  const [showPasscode, setShowPasscode] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const selectedProfile: StaffProfile | undefined = STAFF_PROFILES.find(
    (p) => p.profileId === selectedProfileId
  );

  const isFormValid = Boolean(selectedProfileId && passcode.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!selectedProfileId) {
      setErrorMsg("Select a valid staff profile.");
      return;
    }

    if (!passcode.trim()) {
      setErrorMsg("Please enter your passcode.");
      return;
    }

    if (isLoading) return;

    try {
      setIsLoading(true);
      const res = await loginApi(selectedProfileId, passcode);
      if (res.success && res.user) {
        onLoginSuccess(res.user, res.inactivityTimeoutMinutes);
      } else {
        setErrorMsg(res.message || res.error || "Incorrect passcode.");
      }
    } catch (err: any) {
      setErrorMsg("Sign in failed. Please check server connection.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setSelectedProfileId("");
    setPasscode("");
    setErrorMsg("");
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
        
        {/* Top Header Card */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-teal-950 p-8 text-center relative overflow-hidden">
          <div className="w-16 h-16 rounded-2xl bg-teal-500/20 text-teal-400 border border-teal-500/30 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Building2 className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Boon Huat Invoice Management
          </h1>
          <p className="text-xs text-teal-300 font-medium mt-1 tracking-wide">
            Authorised Staff Access
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="p-8 space-y-5">
          
          {sessionExpiredMessage && (
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold text-center">
              {sessionExpiredMessage}
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold text-center">
              {errorMsg}
            </div>
          )}

          {/* Staff Profile Selection Dropdown */}
          <div>
            <label htmlFor="staff-profile-select" className="block text-xs font-bold text-slate-700 mb-1.5">
              Staff Profile
            </label>
            <div className="relative">
              <select
                id="staff-profile-select"
                value={selectedProfileId}
                onChange={(e) => {
                  setSelectedProfileId(e.target.value);
                  setErrorMsg("");
                }}
                disabled={isLoading}
                className="w-full px-4 py-3 rounded-2xl border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 font-semibold text-sm bg-slate-50 cursor-pointer disabled:opacity-50 appearance-none pr-10 shadow-xs"
              >
                <option value="">Select Profile…</option>
                {STAFF_PROFILES.map((p) => (
                  <option key={p.profileId} value={p.profileId}>
                    {p.displayName} — {p.role}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-xs">
                ▼
              </div>
            </div>
          </div>

          {/* Profile Summary Card (Only displayed when a profile is selected) */}
          {selectedProfile && (
            <div className="flex items-center gap-3.5 p-4 rounded-2xl bg-teal-50/80 border border-teal-200 text-slate-800">
              <div className="w-10 h-10 rounded-xl bg-teal-700 text-white flex items-center justify-center font-black text-sm shadow-xs shrink-0">
                {selectedProfile.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate">
                  {selectedProfile.displayName}
                </div>
                <div className="text-xs text-slate-600 font-medium truncate">
                  {selectedProfile.department}
                </div>
                <div className="text-[11px] text-teal-800 font-bold tracking-wide uppercase truncate mt-0.5">
                  {selectedProfile.role}
                </div>
              </div>
              <UserCheck className="w-5 h-5 text-teal-600 shrink-0" />
            </div>
          )}

          {/* Passcode Field */}
          <div>
            <label htmlFor="passcode-input" className="block text-xs font-bold text-slate-700 mb-1.5">
              Passcode
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                <Lock className="w-4 h-4" />
              </div>
              <input
                id="passcode-input"
                type={showPasscode ? "text" : "password"}
                value={passcode}
                onChange={(e) => {
                  setPasscode(e.target.value);
                  setErrorMsg("");
                }}
                disabled={isLoading}
                placeholder="Enter passcode"
                className="w-full pl-10 pr-12 py-3 rounded-2xl border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono text-sm shadow-xs disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPasscode(!showPasscode)}
                disabled={isLoading}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer disabled:opacity-50"
                title={showPasscode ? "Hide Passcode" : "Show Passcode"}
              >
                {showPasscode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Buttons: Clear and Sign In */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleClear}
              disabled={isLoading}
              className="w-1/3 py-3.5 rounded-2xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold text-sm transition-all disabled:opacity-50 cursor-pointer"
            >
              Clear
            </button>
            <button
              type="submit"
              disabled={isLoading || !isFormValid}
              className="w-2/3 py-3.5 rounded-2xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm shadow-lg shadow-teal-900/30 transition-all hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isLoading ? "Signing In…" : "Sign In"}
            </button>
          </div>
        </form>

        <div className="px-8 py-4 bg-slate-50 border-t border-slate-100 text-center">
          <p className="text-[11px] text-slate-500 font-medium">
            Protected Accounts Payable System • Boon Huat Pte Ltd
          </p>
        </div>

      </div>
    </div>
  );
};

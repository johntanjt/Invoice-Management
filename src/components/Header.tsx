import React from "react";
import { LogOut } from "lucide-react";
import { AuthenticatedUser } from "../types";

interface HeaderProps {
  pageTitle: string;
  pageSubtitle?: string;
  currentUser?: AuthenticatedUser | null;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({ pageTitle, currentUser, onLogout }) => {
  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-8 flex-shrink-0 sticky top-0 z-20">
      <div className="flex items-center space-x-2">
        <span className="text-slate-400 text-sm">Dashboard</span>
        <span className="text-slate-300">/</span>
        <span className="text-slate-800 font-medium text-sm underline underline-offset-4 decoration-teal-500">
          {pageTitle}
        </span>
      </div>

      <div className="flex items-center space-x-4">
        <div className="text-right pr-4 border-r border-slate-200">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Signed In As</p>
          <p className="text-xs font-bold text-slate-800">{currentUser?.displayName || "Authorised Staff"}</p>
          {currentUser?.role && (
            <p className="text-[10px] font-semibold text-teal-700 uppercase tracking-wider mt-0.5">{currentUser.role}</p>
          )}
        </div>
        <button
          onClick={onLogout}
          className="flex items-center text-slate-500 hover:text-red-600 transition-colors px-2 py-1 cursor-pointer"
        >
          <LogOut className="w-5 h-5 mr-1.5" />
          <span className="text-sm font-medium">Log Out</span>
        </button>
      </div>
    </header>
  );
};


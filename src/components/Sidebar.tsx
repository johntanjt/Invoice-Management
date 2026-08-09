import React, { useState } from "react";
import { 
  LayoutDashboard, 
  FileText, 
  AlertCircle, 
  CheckCircle2, 
  XCircle, 
  History, 
  Settings, 
  ChevronLeft,
  ChevronRight
} from "lucide-react";

export type NavTab = 
  | "dashboard" 
  | "records" 
  | "review" 
  | "ready" 
  | "rejected" 
  | "audit" 
  | "settings";

interface SidebarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  reviewCount: number;
  readyCount: number;
  rejectedCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  reviewCount,
  readyCount,
  rejectedCount
}) => {
  const [collapsed, setCollapsed] = useState(false);

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "records", label: "Invoice Records", icon: FileText },
    { 
      id: "ready", 
      label: "Approved Invoices", 
      icon: CheckCircle2,
      badge: readyCount > 0 ? readyCount : undefined,
      badgeColor: "bg-teal-500 text-slate-950 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
    },
    { 
      id: "review", 
      label: "Review Required", 
      icon: AlertCircle, 
      badge: reviewCount > 0 ? reviewCount : undefined,
      badgeColor: "bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full" 
    },
    { 
      id: "rejected", 
      label: "Rejected Invoices", 
      icon: XCircle,
      badge: rejectedCount > 0 ? rejectedCount : undefined,
      badgeColor: "bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full"
    },
    { id: "audit", label: "Audit Trail", icon: History },
    { id: "settings", label: "Settings", icon: Settings }
  ];

  return (
    <aside 
      className={`sidebar h-screen sticky top-0 flex-shrink-0 flex flex-col text-slate-300 transition-all duration-300 border-r border-slate-800 ${
        collapsed ? "w-20" : "w-64"
      }`}
    >
      {/* Brand Header */}
      <div className="p-6 mb-2 flex items-center justify-between">
        {!collapsed ? (
          <div>
            <h1 className="text-xl font-bold text-white leading-tight">
              Boon Huat<br />
              <span className="text-teal-400 font-medium text-sm">Invoice Management</span>
            </h1>
          </div>
        ) : (
          <div className="w-10 h-10 rounded-xl bg-teal-500 flex items-center justify-center text-slate-950 font-bold text-lg">
            BH
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors ml-2"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <div
              key={item.id}
              onClick={() => setActiveTab(item.id as NavTab)}
              className={`flex items-center px-4 py-3 text-sm font-medium transition-colors rounded-r-md cursor-pointer group justify-between ${
                isActive
                  ? "nav-active text-white"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
              title={collapsed ? item.label : undefined}
            >
              <div className="flex items-center min-w-0">
                <Icon className={`w-5 h-5 shrink-0 ${collapsed ? "mx-auto" : "mr-3"} ${
                  isActive ? "text-teal-400" : "opacity-60 group-hover:opacity-100"
                }`} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </div>
              {!collapsed && item.badge !== undefined && (
                <span className={item.badgeColor}>
                  {item.badge}
                </span>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
};


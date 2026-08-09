import React, { useState, useEffect, useCallback } from "react";
import { 
  checkSessionApi, 
  logoutApi, 
  fetchInvoicesApi, 
  fetchAuditTrailApi, 
  reviewInvoiceApi, 
  deleteInvoiceApi, 
  deleteSelectedInvoicesApi, 
  deleteAllInvoicesApi, 
  restoreInvoiceApi,
  downloadApprovedInvoiceWorkbook,
  notifyApp2OpenedApi,
  updateSessionTimeoutApi,
  logSessionAuditEventApi,
  syncLocalStorageApi
} from "./services/api";
import {
  loadInvoicesFromLocalStorage,
  saveInvoicesToLocalStorage,
  loadPoCsvFromLocalStorage,
  loadGrnCsvFromLocalStorage,
  loadAuditEventsFromLocalStorage,
  saveAuditEventsToLocalStorage
} from "./services/localStorage";

import { InvoiceRecord, AuditEvent, DashboardSummary, AuthenticatedUser } from "./types";
import { Sidebar, NavTab } from "./components/Sidebar";
import { Header } from "./components/Header";
import { PasscodeModal } from "./components/PasscodeModal";
import { DeleteInvoiceModal } from "./components/DeleteInvoiceModal";
import { InvoiceDetailModal } from "./components/InvoiceDetailModal";
import { RetryProcessingModal } from "./components/RetryProcessingModal";
import { SessionWarningModal } from "./components/SessionWarningModal";
import { useInactivityManager } from "./hooks/useInactivityManager";

import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { InvoiceRecordsPage } from "./pages/InvoiceRecordsPage";
import { ReviewRequiredPage } from "./pages/ReviewRequiredPage";
import { ReadyForApp2Page } from "./pages/ReadyForApp2Page";
import { RejectedInvoicesPage } from "./pages/RejectedInvoicesPage";
import { AuditTrailPage } from "./pages/AuditTrailPage";
import { SettingsPage } from "./pages/SettingsPage";
import { initiateApp2DirectTransfer, filterApp2EligibleInvoices, TransferState } from "./services/app2DirectTransfer";
import { SendToApp2Modal } from "./components/SendToApp2Modal";

export function App() {
  // Authentication & Session State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [username, setUsername] = useState<string>("");
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string>("");
  const [inactivityTimeoutMinutes, setInactivityTimeoutMinutes] = useState<number>(5);

  // App 2 Transfer State
  const [transferState, setTransferState] = useState<TransferState>({ status: "IDLE" });

  // Application Data State
  const [activeTab, setActiveTab] = useState<NavTab>("dashboard");
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(() => loadInvoicesFromLocalStorage());
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(() => loadAuditEventsFromLocalStorage());
  const [summary, setSummary] = useState<DashboardSummary>({
    totalActiveInvoices: 0,
    totalActiveValue: 0,
    readyForApp2Count: 0,
    readyForApp2Value: 0,
    reviewRequiredCount: 0,
    reviewRequiredValue: 0,
    cannotProcessCount: 0,
    rejectedCount: 0,
    possibleDuplicateCount: 0
  });

  // Automatically sync invoices & audit trail state to browser localStorage
  useEffect(() => {
    if (invoices.length > 0) {
      saveInvoicesToLocalStorage(invoices);
    }
  }, [invoices]);

  useEffect(() => {
    if (auditEvents.length > 0) {
      saveAuditEventsToLocalStorage(auditEvents);
    }
  }, [auditEvents]);

  // Modal States
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [selectedInvoicesToSend, setSelectedInvoicesToSend] = useState<InvoiceRecord[] | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [appRetryModalInvoice, setAppRetryModalInvoice] = useState<InvoiceRecord | null>(null);

  const [deleteSingleModalOpen, setDeleteSingleModalOpen] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState<InvoiceRecord | null>(null);

  const [deleteSelectedModalOpen, setDeleteSelectedModalOpen] = useState(false);
  const [selectedInvoicesToDelete, setSelectedInvoicesToDelete] = useState<InvoiceRecord[]>([]);

  // Export States
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Supplier Filter State (for drill-down from Dashboard to Invoice Records)
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);

  const APP2_URL = "https://ai.studio/apps/0e4c15a0-9b82-4e33-95c7-0873b11b06ed";

  // Check session on mount
  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      setIsCheckingAuth(true);
      const res = await checkSessionApi();
      if ((res.authenticated || res.isAuthenticated)) {
        setIsAuthenticated(true);
        const userObj: AuthenticatedUser = res.user || {
          profileId: "MADAM_LIM",
          displayName: res.userName || "Madam Lim",
          role: "ACCOUNTS EXECUTIVE",
          department: "Accounts Department",
          initials: "ML"
        };
        setCurrentUser(userObj);
        setUsername(userObj.displayName);
        if (res.inactivityTimeoutMinutes) {
          setInactivityTimeoutMinutes(res.inactivityTimeoutMinutes);
        }
        await refreshAllData();
      } else {
        setIsAuthenticated(false);
        setCurrentUser(null);
        if (res.code === "SESSION_INACTIVITY_TIMEOUT") {
          setSessionExpiredMessage("You were signed out because the application was inactive. Please sign in again.");
        }
      }
    } catch (err) {
      setIsAuthenticated(false);
      setCurrentUser(null);
    } finally {
      setIsCheckingAuth(false);
    }
  };

  const refreshAllData = async () => {
    try {
      const localInvoices = loadInvoicesFromLocalStorage();
      const localPoCsv = loadPoCsvFromLocalStorage();
      const localGrnCsv = loadGrnCsvFromLocalStorage();
      const localAudit = loadAuditEventsFromLocalStorage();

      // Sync LocalStorage state with server
      const synced = await syncLocalStorageApi({
        invoices: localInvoices,
        poCsvData: localPoCsv,
        grnCsvData: localGrnCsv,
        auditEvents: localAudit
      });

      setInvoices(synced.invoices);
      setSummary(synced.summary);
      setAuditEvents(synced.auditTrail);

      saveInvoicesToLocalStorage(synced.invoices);
      saveAuditEventsToLocalStorage(synced.auditTrail);
    } catch (err: any) {
      if (err.message === "SESSION_EXPIRED") {
        performAutomaticLogout("INACTIVITY_TIMEOUT");
      } else {
        try {
          const invoiceRes = await fetchInvoicesApi(true);
          setInvoices(invoiceRes.invoices);
          setSummary(invoiceRes.summary);
          saveInvoicesToLocalStorage(invoiceRes.invoices);
        } catch (e) {
          // preserve client local state
        }
      }
    }
  };

  const handleLoginSuccess = async (user: AuthenticatedUser, timeoutMinutes?: number) => {
    setIsAuthenticated(true);
    setCurrentUser(user);
    setUsername(user.displayName);
    if (timeoutMinutes) {
      setInactivityTimeoutMinutes(timeoutMinutes);
    }
    setSessionExpiredMessage("");
    await refreshAllData();
  };

  const performAutomaticLogout = useCallback(async (reason: "INACTIVITY_TIMEOUT" | "MANUAL") => {
    try {
      if (reason === "INACTIVITY_TIMEOUT") {
        await logSessionAuditEventApi({
          actionType: "SESSION_AUTOMATIC_LOGOUT",
          result: "INFO",
          reason: "User automatically signed out due to inactivity"
        });
      }
      await logoutApi();
    } catch (e) {
      // ignore
    }
    // Clear sensitive temporary application state & modals
    setDetailModalOpen(false);
    setSelectedInvoice(null);
    setDeleteSingleModalOpen(false);
    setInvoiceToDelete(null);
    setIsAuthenticated(false);
    setCurrentUser(null);

    if (reason === "INACTIVITY_TIMEOUT") {
      setSessionExpiredMessage("You were signed out because the application was inactive. Please sign in again.");
    } else {
      setSessionExpiredMessage("");
    }
  }, []);

  const handleTimeoutLogout = useCallback((reason: "INACTIVITY_TIMEOUT" | "MANUAL") => {
    performAutomaticLogout(reason);
  }, [performAutomaticLogout]);

  const handleTimeoutSettingUpdatedByBroadcast = useCallback((newMinutes: number) => {
    setInactivityTimeoutMinutes(newMinutes);
  }, []);

  const inactivityManager = useInactivityManager({
    isAuthenticated,
    inactivityTimeoutMinutes,
    hasUnsavedChanges: detailModalOpen || deleteSingleModalOpen,
    onLogout: handleTimeoutLogout,
    onTimeoutSettingUpdated: handleTimeoutSettingUpdatedByBroadcast
  });

  const handleLogout = async () => {
    inactivityManager.notifyManualLogout();
    await performAutomaticLogout("MANUAL");
  };

  const handleSaveTimeoutSetting = async (minutes: number) => {
    const res = await updateSessionTimeoutApi(minutes);
    if (res.success && res.inactivityTimeoutMinutes) {
      setInactivityTimeoutMinutes(res.inactivityTimeoutMinutes);
      inactivityManager.notifyTimeoutSettingChanged(res.inactivityTimeoutMinutes);
      await refreshAllData();
    }
  };

  const handleResetTimeoutSetting = async () => {
    const res = await updateSessionTimeoutApi(5);
    if (res.success && res.inactivityTimeoutMinutes) {
      setInactivityTimeoutMinutes(res.inactivityTimeoutMinutes);
      inactivityManager.notifyTimeoutSettingChanged(res.inactivityTimeoutMinutes);
      await refreshAllData();
    }
  };

  // Review decision callback
  const handleReviewDecision = async (
    id: string,
    decision: "APPROVE" | "REJECT" | "HOLD" | "CORRECT",
    reviewNotes: string,
    correctedFields?: Record<string, any>
  ) => {
    await reviewInvoiceApi(id, { decision, reviewNotes, correctedFields });
    await refreshAllData();
  };

  // Single delete callback
  const handleSingleDelete = async (passcode: string, reason: string) => {
    if (!invoiceToDelete) return;
    await deleteInvoiceApi(invoiceToDelete.id, {
      passcode,
      reason,
      phrase: "DELETE"
    });
    setInvoiceToDelete(null);
    await refreshAllData();
  };

  // Bulk delete selected callback
  const handleDeleteSelected = async (passcode: string, reason: string, ids: string[]) => {
    await deleteSelectedInvoicesApi({
      passcode,
      reason,
      phrase: "DELETE SELECTED",
      ids
    });
    await refreshAllData();
  };

  // Delete all callback
  const handleDeleteAll = async (passcode: string, reason: string) => {
    await deleteAllInvoicesApi({
      passcode,
      reason,
      phrase: "DELETE ALL INVOICES"
    });
    await refreshAllData();
  };

  // Restore callback
  const handleRestore = async (id: string, passcode: string, reason: string) => {
    await restoreInvoiceApi(id, { passcode, reason });
    await refreshAllData();
  };

  // Export Approved Invoices
  const handleExportApprovedInvoices = async () => {
    setIsExporting(true);
    setExportError(null);
    setExportNotice(null);

    try {
      const result = await downloadApprovedInvoiceWorkbook();
      if (!result.success) {
        setExportError(result.message || "The workbook could not be downloaded.");
      } else {
        setExportNotice("Invoice workbook downloaded successfully.");
        await refreshAllData();
      }
    } catch (err: any) {
      setExportError(err.message || "The workbook could not be downloaded.");
    } finally {
      setIsExporting(false);
    }
  };

  // Direct Transfer to App 2 with Confirmation Modal
  const handleSendToApp2 = (targetInvoices?: InvoiceRecord[]) => {
    const eligible = targetInvoices && targetInvoices.length > 0
      ? targetInvoices
      : filterApp2EligibleInvoices(invoices);

    if (eligible.length === 0) {
      setTransferState({
        status: "TRANSFER_FAILED",
        message: "No invoices are currently ready for App 2.",
        errorType: "NO_INVOICES"
      });
      return;
    }
    setSelectedInvoicesToSend(eligible);
    setSendModalOpen(true);
  };

  const handleConfirmSendToApp2 = () => {
    const target = selectedInvoicesToSend || filterApp2EligibleInvoices(invoices);
    setSendModalOpen(false);
    void initiateApp2DirectTransfer(
      (state) => {
        setTransferState(state);
      },
      async () => {
        await refreshAllData();
      },
      target
    );
  };

  // Render Loading Screen
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white p-4">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-xs font-semibold text-teal-400">Loading Boon Huat Invoice Management...</p>
        </div>
      </div>
    );
  }

  // Render Login Page if unauthenticated
  if (!isAuthenticated) {
    return (
      <LoginPage
        onLoginSuccess={handleLoginSuccess}
        sessionExpiredMessage={sessionExpiredMessage}
      />
    );
  }

  // Active non-deleted invoices
  const activeInvoices = invoices.filter((i) => !i.isDeleted);

  // Tab titles
  const tabTitles: Record<NavTab, { title: string; subtitle: string }> = {
    dashboard: { title: "Dashboard", subtitle: "Accounts intake and validation overview" },
    records: { title: "Invoice Records", subtitle: "Upload, check and manage supplier invoices" },
    ready: { title: "Approved Invoices", subtitle: "Invoices validated and approved for transfer to App 2." },
    review: { title: "Review Required", subtitle: "Human exception review for flagged invoices" },
    rejected: { title: "Rejected Invoices", subtitle: "Invoices rejected by human decision" },
    audit: { title: "Audit Trail", subtitle: "Immutable system activity and change history" },
    settings: { title: "Settings", subtitle: "Data deletion and record restoration" }
  };

  const handleTabChange = (tab: NavTab) => {
    if (tab !== "records") {
      setSupplierFilter(null);
    }
    setActiveTab(tab);
  };

  const handleSelectSupplierFilter = (supplierName: string) => {
    setSupplierFilter(supplierName);
    setActiveTab("records");
  };

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900">
      
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        reviewCount={summary.reviewRequiredCount}
        readyCount={summary.readyForApp2Count}
        rejectedCount={summary.rejectedCount}
      />

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        
        {/* Compact Header Bar */}
        <Header
          pageTitle={tabTitles[activeTab].title}
          pageSubtitle={tabTitles[activeTab].subtitle}
          currentUser={currentUser}
          onLogout={handleLogout}
        />

        {/* Global Export Status Banners */}
        {exportError && (
          <div className="max-w-7xl mx-auto px-6 pt-4 w-full">
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between text-xs text-rose-900 font-semibold shadow-xs">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-rose-200 text-rose-900 rounded font-bold text-[10px] uppercase">Export Error</span>
                <span>{exportError}</span>
              </div>
              <button onClick={() => setExportError(null)} className="text-rose-600 hover:text-rose-800 font-bold px-2 py-1 cursor-pointer">
                ✕ Dismiss
              </button>
            </div>
          </div>
        )}

        {exportNotice && (
          <div className="max-w-7xl mx-auto px-6 pt-4 w-full">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs text-emerald-900 font-semibold shadow-xs">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-emerald-200 text-emerald-900 rounded font-bold text-[10px] uppercase">Success</span>
                <span>{exportNotice}</span>
              </div>
              <button onClick={() => setExportNotice(null)} className="text-emerald-600 hover:text-emerald-800 font-bold px-2 py-1 cursor-pointer">
                ✕ Dismiss
              </button>
            </div>
          </div>
        )}

        {/* View Content */}
        <main className="flex-1 pb-12">
          {activeTab === "dashboard" && (
            <DashboardPage
              summary={summary}
              invoices={activeInvoices}
              recentAuditEvents={auditEvents}
              setActiveTab={handleTabChange}
              onSendToApp2={handleSendToApp2}
              onSelectSupplierFilter={handleSelectSupplierFilter}
              isTransferring={transferState.status === "CONNECTING" || transferState.status === "SENDING"}
            />
          )}

          {activeTab === "records" && (
            <InvoiceRecordsPage
              invoices={activeInvoices}
              summary={summary}
              supplierFilter={supplierFilter}
              onClearSupplierFilter={() => setSupplierFilter(null)}
              onRefresh={refreshAllData}
              onOpenDetailModal={(inv) => {
                setSelectedInvoice(inv);
                setDetailModalOpen(true);
              }}
              onRequestDelete={(inv) => {
                if (inv && inv.id) {
                  setInvoiceToDelete(inv);
                  setDeleteSingleModalOpen(true);
                }
              }}
              onRequestDeleteSelected={(selectedList) => {
                if (selectedList && selectedList.length > 0) {
                  setSelectedInvoicesToDelete(selectedList);
                  setDeleteSelectedModalOpen(true);
                }
              }}
              onSendToApp2={handleSendToApp2}
              onExportXlsx={handleExportApprovedInvoices}
              isTransferring={transferState.status === "CONNECTING" || transferState.status === "SENDING"}
              isExporting={isExporting}
            />
          )}

          {activeTab === "review" && (
            <ReviewRequiredPage
              invoices={activeInvoices}
              onOpenDetailModal={(inv) => {
                setSelectedInvoice(inv);
                setDetailModalOpen(true);
              }}
              onRefresh={refreshAllData}
            />
          )}

          {activeTab === "ready" && (
            <ReadyForApp2Page
              invoices={activeInvoices}
              onOpenDetailModal={(inv) => {
                setSelectedInvoice(inv);
                setDetailModalOpen(true);
              }}
              onExportXlsx={handleExportApprovedInvoices}
              onSendToApp2={handleSendToApp2}
              transferState={transferState}
              onDismissTransferState={() => setTransferState({ status: "IDLE" })}
              isExporting={isExporting}
            />
          )}

          {activeTab === "rejected" && (
            <RejectedInvoicesPage
              invoices={activeInvoices}
              onOpenDetailModal={(inv) => {
                setSelectedInvoice(inv);
                setDetailModalOpen(true);
              }}
            />
          )}

          {activeTab === "audit" && (
            <AuditTrailPage
              auditEvents={auditEvents}
            />
          )}

          {activeTab === "settings" && (
            <SettingsPage
              invoices={invoices}
              inactivityTimeoutMinutes={inactivityTimeoutMinutes}
              onSaveTimeoutSetting={handleSaveTimeoutSetting}
              onResetTimeoutSetting={handleResetTimeoutSetting}
              onDeleteSelected={handleDeleteSelected}
              onDeleteAll={handleDeleteAll}
              onRestore={handleRestore}
              onRefreshData={refreshAllData}
            />
          )}
        </main>
      </div>

      {/* Session Expiring Warning Modal */}
      <SessionWarningModal
        isOpen={inactivityManager.showWarningModal}
        secondsRemaining={inactivityManager.secondsRemaining}
        inactivityTimeoutMinutes={inactivityTimeoutMinutes}
        hasUnsavedChanges={detailModalOpen || deleteSingleModalOpen || deleteSelectedModalOpen}
        onStaySignedIn={inactivityManager.handleStaySignedIn}
        onSignOutNow={inactivityManager.handleSignOutNow}
      />

      {/* Invoice Detail / Review Modal */}
      <InvoiceDetailModal
        invoice={selectedInvoice}
        isOpen={detailModalOpen}
        onClose={() => {
          setDetailModalOpen(false);
          setSelectedInvoice(null);
        }}
        onReviewDecision={handleReviewDecision}
        onRetryProcessing={(inv) => setAppRetryModalInvoice(inv)}
      />

      {/* App-level Retry Processing Modal */}
      <RetryProcessingModal
        invoice={appRetryModalInvoice}
        isOpen={Boolean(appRetryModalInvoice)}
        onClose={() => setAppRetryModalInvoice(null)}
        onSuccess={refreshAllData}
      />

      {/* Single Invoice Delete Modal */}
      <DeleteInvoiceModal
        isOpen={deleteSingleModalOpen}
        mode="SINGLE"
        targetInvoice={invoiceToDelete}
        onConfirm={async () => {
          setDeleteSingleModalOpen(false);
          setInvoiceToDelete(null);
          await refreshAllData();
        }}
        onCancel={() => {
          setDeleteSingleModalOpen(false);
          setInvoiceToDelete(null);
        }}
      />

      {/* Bulk Selected Invoices Delete Modal */}
      <DeleteInvoiceModal
        isOpen={deleteSelectedModalOpen}
        mode="SELECTED"
        selectedInvoices={selectedInvoicesToDelete}
        onConfirm={async () => {
          setDeleteSelectedModalOpen(false);
          setSelectedInvoicesToDelete([]);
          await refreshAllData();
        }}
        onCancel={() => {
          setDeleteSelectedModalOpen(false);
          setSelectedInvoicesToDelete([]);
        }}
      />

      {/* App 2 Direct Transfer Confirmation Modal */}
      <SendToApp2Modal
        isOpen={sendModalOpen}
        approvedCount={selectedInvoicesToSend ? selectedInvoicesToSend.length : filterApp2EligibleInvoices(invoices).length}
        destination="Boon Huat 3-Way Match Checker"
        onConfirm={handleConfirmSendToApp2}
        onCancel={() => {
          setSendModalOpen(false);
          setSelectedInvoicesToSend(null);
        }}
      />

    </div>
  );
}

export default App;

import React, { useState, useEffect } from "react";
import { Database, FileText, Upload, CheckCircle2, RefreshCw, Trash2, HardDrive } from "lucide-react";
import { savePoCsvToLocalStorage, saveGrnCsvToLocalStorage, loadPoCsvFromLocalStorage, loadGrnCsvFromLocalStorage } from "../services/localStorage";
import { savePoGrnCsvApi } from "../services/api";

interface PoGrnCsvManagerProps {
  onRefreshData?: () => Promise<void>;
}

export const PoGrnCsvManager: React.FC<PoGrnCsvManagerProps> = ({ onRefreshData }) => {
  const [poCsv, setPoCsv] = useState<string>("");
  const [grnCsv, setGrnCsv] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setPoCsv(loadPoCsvFromLocalStorage());
    setGrnCsv(loadGrnCsvFromLocalStorage());
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: "PO" | "GRN") => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = (event.target?.result as string) || "";
      if (type === "PO") {
        setPoCsv(content);
      } else {
        setGrnCsv(content);
      }
    };
    reader.readAsText(file);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      savePoCsvToLocalStorage(poCsv);
      saveGrnCsvToLocalStorage(grnCsv);
      await savePoGrnCsvApi({ poCsvData: poCsv, grnCsvData: grnCsv });
      if (onRefreshData) await onRefreshData();
      setMessage("PO & GRN CSV data successfully updated and saved to LocalStorage.");
    } catch (err: any) {
      setMessage(`Saved locally. Server sync note: ${err.message || "Saved to LocalStorage"}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setPoCsv("");
    setGrnCsv("");
    savePoCsvToLocalStorage("");
    saveGrnCsvToLocalStorage("");
    try {
      await savePoGrnCsvApi({ poCsvData: "", grnCsvData: "" });
    } catch (err) {
      // ignore
    }
    if (onRefreshData) await onRefreshData();
    setMessage("PO & GRN CSV data cleared from LocalStorage.");
  };

  const poLineCount = poCsv.trim() ? poCsv.trim().split("\n").length - 1 : 0;
  const grnLineCount = grnCsv.trim() ? grnCsv.trim().split("\n").length - 1 : 0;

  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-5">
      <div className="border-b border-slate-100 pb-3 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
            <Database className="w-5 h-5 text-teal-600" /> PO & GRN CSV Reference Data (LocalStorage Persisted)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Reference PO and GRN CSV data automatically saved to LocalStorage and loaded on page start.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-sm transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <HardDrive className="w-3.5 h-3.5" />}
            <span>Save to LocalStorage</span>
          </button>

          <button
            onClick={handleClear}
            disabled={isSaving}
            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {message && (
        <div className="p-3 bg-teal-50 border border-teal-200 text-teal-800 text-xs font-semibold rounded-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* PO CSV Block */}
        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-teal-600" />
              <span className="font-bold text-slate-800 text-xs">Purchase Orders (PO) CSV</span>
            </div>
            <span className="text-[11px] font-mono font-bold text-slate-500">
              {poLineCount > 0 ? `${poLineCount} PO record(s)` : "No PO loaded"}
            </span>
          </div>

          <textarea
            value={poCsv}
            onChange={(e) => setPoCsv(e.target.value)}
            placeholder="Paste PO CSV content here... (e.g., PO_NUMBER,SUPPLIER,QTY,PRICE)"
            className="w-full h-32 p-3 text-xs font-mono bg-white rounded-xl border border-slate-300 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 resize-none"
          />

          <div className="flex items-center justify-between text-xs">
            <label className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg cursor-pointer font-bold flex items-center gap-1.5 shadow-2xs">
              <Upload className="w-3.5 h-3.5 text-teal-600" />
              <span>Upload PO CSV</span>
              <input type="file" accept=".csv,.txt" onChange={(e) => handleFileUpload(e, "PO")} className="hidden" />
            </label>
            <span className="text-[10px] text-slate-400">Auto-persisted in LocalStorage</span>
          </div>
        </div>

        {/* GRN CSV Block */}
        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple-600" />
              <span className="font-bold text-slate-800 text-xs">Goods Received Notes (GRN) CSV</span>
            </div>
            <span className="text-[11px] font-mono font-bold text-slate-500">
              {grnLineCount > 0 ? `${grnLineCount} GRN record(s)` : "No GRN loaded"}
            </span>
          </div>

          <textarea
            value={grnCsv}
            onChange={(e) => setGrnCsv(e.target.value)}
            placeholder="Paste GRN CSV content here... (e.g., GRN_NUMBER,PO_NUMBER,RECEIVED_QTY,DATE)"
            className="w-full h-32 p-3 text-xs font-mono bg-white rounded-xl border border-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
          />

          <div className="flex items-center justify-between text-xs">
            <label className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg cursor-pointer font-bold flex items-center gap-1.5 shadow-2xs">
              <Upload className="w-3.5 h-3.5 text-purple-600" />
              <span>Upload GRN CSV</span>
              <input type="file" accept=".csv,.txt" onChange={(e) => handleFileUpload(e, "GRN")} className="hidden" />
            </label>
            <span className="text-[10px] text-slate-400">Auto-persisted in LocalStorage</span>
          </div>
        </div>
      </div>
    </div>
  );
};

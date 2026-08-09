import ExcelJS from "exceljs";
import { InvoiceRecord, DashboardSummary } from "../types.js";
import { getApp2EligibleInvoices } from "./invoiceEngine.js";

/**
 * Utility: Convert column number (1-based) to Excel column letter (e.g. 1 -> A, 22 -> V)
 */
function colToLetter(col: number): string {
  let temp: number;
  let letter = "";
  while (col > 0) {
    temp = (col - 1) % 26;
    letter = String.fromCharCode(65 + temp) + letter;
    col = (col - temp - 1) / 26;
  }
  return letter;
}

/**
 * Utility: Apply standard thin cell borders
 */
function applyCellBorder(cell: ExcelJS.Cell, colorHex = "FFCBD5E1") {
  cell.border = {
    top: { style: "thin", color: { argb: colorHex } },
    left: { style: "thin", color: { argb: colorHex } },
    bottom: { style: "thin", color: { argb: colorHex } },
    right: { style: "thin", color: { argb: colorHex } }
  };
}

/**
 * Utility: Create a title banner across top rows
 */
function createTitleBanner(
  sheet: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
  bannerFillHex: string,
  subtitleTextHex: string,
  totalCols: number
) {
  const lastColLetter = colToLetter(totalCols);

  // Row 1: Main Title
  sheet.mergeCells(`A1:${lastColLetter}1`);
  const titleCell = sheet.getCell("A1");
  titleCell.value = title;
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bannerFillHex } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  sheet.getRow(1).height = 32;

  // Row 2: Subtitle
  sheet.mergeCells(`A2:${lastColLetter}2`);
  const subtitleCell = sheet.getCell("A2");
  subtitleCell.value = subtitle;
  subtitleCell.font = { name: "Calibri", size: 11, italic: true, color: { argb: subtitleTextHex } };
  subtitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bannerFillHex } };
  subtitleCell.alignment = { vertical: "middle", horizontal: "center" };
  sheet.getRow(2).height = 22;

  // Row 3: Blank separator
  sheet.getRow(3).height = 8;
}

/**
 * Utility: Create a summary strip below title banner
 */
function createSummaryStrip(
  sheet: ExcelJS.Worksheet,
  rowNum: number,
  text: string,
  stripFillHex: string,
  stripTextHex: string,
  borderHex: string,
  totalCols: number
) {
  const lastColLetter = colToLetter(totalCols);
  sheet.mergeCells(`A${rowNum}:${lastColLetter}${rowNum}`);
  const cell = sheet.getCell(`A${rowNum}`);
  cell.value = text;
  cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: stripTextHex } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: stripFillHex } };
  cell.alignment = { vertical: "middle", horizontal: "left" };
  applyCellBorder(cell, borderHex);
  sheet.getRow(rowNum).height = 26;

  // Row after summary strip: Blank separator
  sheet.getRow(rowNum + 1).height = 8;
}

/**
 * Utility: Auto-fit columns with intelligent width limits
 */
function formatAndFitColumns(sheet: ExcelJS.Worksheet, minWidths: Record<number, number> = {}) {
  sheet.columns.forEach((column, colIdx) => {
    let maxLen = 12;
    if (column.header) {
      maxLen = Math.max(maxLen, column.header.length);
    }
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const val = cell.value ? cell.value.toString() : "";
      if (val.length < 60) {
        maxLen = Math.max(maxLen, val.length);
      }
    });
    const colNumber = colIdx + 1;
    const customMin = minWidths[colNumber] || 14;
    column.width = Math.min(Math.max(maxLen + 4, customMin), 55);
  });
}

/**
 * Generates a professional, polished 4-sheet XLSX workbook using ExcelJS
 */
export async function generateInvoiceWorkbook(
  invoices: InvoiceRecord[],
  summaryParam?: DashboardSummary
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Boon Huat Hardware & Supplies Pte Ltd";
  workbook.created = new Date();

  const activeInvoices = invoices.filter(i => !i.isDeleted);
  const approvedInvoices = getApp2EligibleInvoices(invoices);
  const reviewInvoices = activeInvoices.filter(i => i.app1Status === "REVIEW_REQUIRED" || i.app1Status === "CANNOT_PROCESS");
  const rejectedInvoices = activeInvoices.filter(i => i.app1Status === "REJECTED_BY_HUMAN");

  const missingFieldCount = activeInvoices.filter(i =>
    i.issues?.some(iss => iss.code === "MISSING_FIELD" || (iss.message && iss.message.toLowerCase().includes("missing")))
  ).length;

  const reviewRequiredValue = Math.round(reviewInvoices.reduce((acc, i) => acc + (i.extractedData?.printedTotalAmount || i.calculatedTotal || 0), 0) * 100) / 100;
  const rejectedValue = Math.round(rejectedInvoices.reduce((acc, i) => acc + (i.extractedData?.printedTotalAmount || i.calculatedTotal || 0), 0) * 100) / 100;

  const summary = summaryParam || {
    totalActiveInvoices: activeInvoices.length,
    readyForApp2Count: approvedInvoices.length,
    reviewRequiredCount: reviewInvoices.length,
    rejectedCount: rejectedInvoices.length,
    cannotProcessCount: activeInvoices.filter(i => i.app1Status === "CANNOT_PROCESS").length,
    possibleDuplicateCount: activeInvoices.filter(i => i.duplicateCheckStatus === "POSSIBLE_DUPLICATE" || i.duplicateCheckStatus === "EXACT_DUPLICATE").length,
    amountIssueCount: activeInvoices.filter(i => i.amountCheckStatus === "FAIL").length,
    totalActiveValue: Math.round(activeInvoices.reduce((acc, i) => acc + (i.extractedData?.printedTotalAmount || i.calculatedTotal || 0), 0) * 100) / 100,
    readyForApp2Value: Math.round(approvedInvoices.reduce((acc, i) => acc + (i.extractedData?.printedTotalAmount || i.calculatedTotal || 0), 0) * 100) / 100
  };

  const now = new Date();
  const nowStrDate = now.toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
  const nowStrTime = now.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const nowFullStr = `${nowStrDate} ${nowStrTime}`;

  // ==========================================
  // SHEET 1: Summary (Dashboard Style)
  // ==========================================
  const summarySheet = workbook.addWorksheet("Summary", { views: [{ showGridLines: true }] });

  // Banner Header
  createTitleBanner(
    summarySheet,
    "Boon Huat Hardware & Supplies Pte Ltd",
    "Invoice Intake and Review Summary",
    "FF1E3A8A", // Navy Blue
    "FFDBEAFE", // Light Blue Text
    5
  );

  // Section 1: Intake Metrics
  summarySheet.mergeCells("A4:B4");
  const metricsHeaderCell = summarySheet.getCell("A4");
  metricsHeaderCell.value = "INTAKE METRICS";
  metricsHeaderCell.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FF1E293B" } };
  metricsHeaderCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  applyCellBorder(metricsHeaderCell, "FFCBD5E1");
  summarySheet.getRow(4).height = 24;

  const metricRowsData: Array<{
    label: string;
    value: string | number;
    bgHex: string;
    textHex: string;
    isCurrency?: boolean;
  }> = [
    { label: "Report Generation Date", value: nowStrDate, bgHex: "FFF8FAFC", textHex: "FF334155" },
    { label: "Report Generation Time", value: nowStrTime, bgHex: "FFF8FAFC", textHex: "FF334155" },
    { label: "Total Invoices Processed", value: summary.totalActiveInvoices, bgHex: "FFDBEAFE", textHex: "FF1E40AF" },
    { label: "Ready for App 2", value: summary.readyForApp2Count, bgHex: "FFDCFCE7", textHex: "FF15803D" },
    { label: "Review Required", value: summary.reviewRequiredCount, bgHex: "FFFEF3C7", textHex: "FFB45309" },
    { label: "Rejected Invoices", value: summary.rejectedCount, bgHex: "FFFEE2E2", textHex: "FFB91C1C" },
    { label: "Possible Duplicate Records", value: summary.possibleDuplicateCount, bgHex: "FFF3E8FF", textHex: "FF6B21A8" },
    { label: "Internal Amount Issues", value: summary.amountIssueCount, bgHex: "FFFFEDD5", textHex: "FFC2410C" },
    { label: "Missing-Field Issues", value: missingFieldCount, bgHex: "FFF3F4F6", textHex: "FF374151" },
    { label: "Cannot Process", value: summary.cannotProcessCount, bgHex: "FFFEE2E2", textHex: "FF991B1B" },
    { label: "Rejected by Madam Lim", value: summary.rejectedCount, bgHex: "FFFEE2E2", textHex: "FFB91C1C" },
    { label: "Total Active Value (SGD)", value: summary.totalActiveValue, bgHex: "FFDBEAFE", textHex: "FF1E40AF", isCurrency: true },
    { label: "App 2-Ready Value (SGD)", value: summary.readyForApp2Value, bgHex: "FFDCFCE7", textHex: "FF15803D", isCurrency: true }
  ];

  metricRowsData.forEach((item, idx) => {
    const rowNum = 5 + idx;
    const row = summarySheet.getRow(rowNum);
    row.height = 22;

    const cellLabel = row.getCell(1);
    cellLabel.value = item.label;
    cellLabel.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF334155" } };
    cellLabel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    cellLabel.alignment = { vertical: "middle", horizontal: "left" };
    applyCellBorder(cellLabel, "FFCBD5E1");

    const cellVal = row.getCell(2);
    cellVal.value = item.value;
    cellVal.font = { name: "Calibri", size: 11, bold: true, color: { argb: item.textHex } };
    cellVal.fill = { type: "pattern", pattern: "solid", fgColor: { argb: item.bgHex } };
    cellVal.alignment = { vertical: "middle", horizontal: item.isCurrency ? "right" : "center" };
    if (item.isCurrency) {
      cellVal.numFmt = "$#,##0.00";
    }
    applyCellBorder(cellVal, "FFCBD5E1");
  });

  // Section 2: Status Definitions & Legend
  const defStartRow = 20;
  summarySheet.getRow(defStartRow - 1).height = 10; // separator

  summarySheet.mergeCells(`A${defStartRow}:E${defStartRow}`);
  const defHeaderCell = summarySheet.getCell(`A${defStartRow}`);
  defHeaderCell.value = "STATUS DEFINITIONS & LEGEND";
  defHeaderCell.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FF1E293B" } };
  defHeaderCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  applyCellBorder(defHeaderCell, "FFCBD5E1");
  summarySheet.getRow(defStartRow).height = 24;

  // Subheaders for Definitions
  const defSubHeaderRow = defStartRow + 1;
  const colAHead = summarySheet.getCell(`A${defSubHeaderRow}`);
  colAHead.value = "Status / State";
  colAHead.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  colAHead.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
  colAHead.alignment = { vertical: "middle", horizontal: "center" };
  applyCellBorder(colAHead, "FFCBD5E1");

  summarySheet.mergeCells(`B${defSubHeaderRow}:E${defSubHeaderRow}`);
  const colBHead = summarySheet.getCell(`B${defSubHeaderRow}`);
  colBHead.value = "Definition & Processing Workflow";
  colBHead.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  colBHead.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
  colBHead.alignment = { vertical: "middle", horizontal: "left" };
  applyCellBorder(colBHead, "FFCBD5E1");
  summarySheet.getRow(defSubHeaderRow).height = 22;

  const definitions = [
    {
      status: "Ready for App 2",
      badgeBg: "FFDCFCE7",
      badgeText: "FF15803D",
      desc: "All App 1 checks completed and no blocking issue was found. Ready for automated data integration into App 2."
    },
    {
      status: "Review Required",
      badgeBg: "FFFEF3C7",
      badgeText: "FFB45309",
      desc: "Madam Lim must review one or more issues (e.g. duplicate check, amount mismatch, missing required fields, or low confidence)."
    },
    {
      status: "Rejected",
      badgeBg: "FFFEE2E2",
      badgeText: "FFB91C1C",
      desc: "Madam Lim manually rejected the invoice during review. Record is archived with rejection reason and review notes."
    },
    {
      status: "Cannot Process",
      badgeBg: "FFFEE2E2",
      badgeText: "FF991B1B",
      desc: "The document could not be read or validated reliably (e.g. unreadable OCR, corrupted file, or missing source)."
    }
  ];

  definitions.forEach((d, idx) => {
    const curRow = defSubHeaderRow + 1 + idx;
    summarySheet.getRow(curRow).height = 24;

    const cellStatus = summarySheet.getCell(`A${curRow}`);
    cellStatus.value = d.status;
    cellStatus.font = { name: "Calibri", size: 11, bold: true, color: { argb: d.badgeText } };
    cellStatus.fill = { type: "pattern", pattern: "solid", fgColor: { argb: d.badgeBg } };
    cellStatus.alignment = { vertical: "middle", horizontal: "center" };
    applyCellBorder(cellStatus, "FFCBD5E1");

    summarySheet.mergeCells(`B${curRow}:E${curRow}`);
    const cellDesc = summarySheet.getCell(`B${curRow}`);
    cellDesc.value = d.desc;
    cellDesc.font = { name: "Calibri", size: 10, color: { argb: "FF334155" } };
    cellDesc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
    cellDesc.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    applyCellBorder(cellDesc, "FFCBD5E1");
  });

  // Section 3: Review Symbols Legend
  const legendStartRow = defSubHeaderRow + 1 + definitions.length + 1;
  summarySheet.getRow(legendStartRow - 1).height = 10;

  summarySheet.mergeCells(`A${legendStartRow}:E${legendStartRow}`);
  const legendHeaderCell = summarySheet.getCell(`A${legendStartRow}`);
  legendHeaderCell.value = "REVIEW SYMBOLS LEGEND";
  legendHeaderCell.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FF1E293B" } };
  legendHeaderCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  applyCellBorder(legendHeaderCell, "FFCBD5E1");
  summarySheet.getRow(legendStartRow).height = 24;

  const legendSubHeaderRow = legendStartRow + 1;
  summarySheet.getRow(legendSubHeaderRow).height = 22;

  const legA = summarySheet.getCell(`A${legendSubHeaderRow}`);
  legA.value = "Symbol / Flag";
  legA.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  legA.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF475569" } };
  legA.alignment = { vertical: "middle", horizontal: "center" };
  applyCellBorder(legA, "FFCBD5E1");

  const legB = summarySheet.getCell(`B${legendSubHeaderRow}`);
  legB.value = "Issue Name";
  legB.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  legB.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF475569" } };
  legB.alignment = { vertical: "middle", horizontal: "left" };
  applyCellBorder(legB, "FFCBD5E1");

  summarySheet.mergeCells(`C${legendSubHeaderRow}:E${legendSubHeaderRow}`);
  const legC = summarySheet.getCell(`C${legendSubHeaderRow}`);
  legC.value = "Meaning & Verification Rule";
  legC.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  legC.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF475569" } };
  legC.alignment = { vertical: "middle", horizontal: "left" };
  applyCellBorder(legC, "FFCBD5E1");

  const symbolRules = [
    { symbol: "🔁", name: "Duplicate", rule: "SHA-256 hash match or exact invoice number & supplier match against existing record." },
    { symbol: "⚠️", name: "Amount Issue", rule: "Tax or subtotal mismatch against total printed amount." },
    { symbol: "❓", name: "Missing Field", rule: "Critical header field (e.g. Invoice Number, Date, Total) missing or unextracted." },
    { symbol: "📉", name: "Low Confidence", rule: "OCR/AI extraction confidence score below threshold requirement." },
    { symbol: "🚫", name: "Cannot Process", rule: "Unreadable, corrupt, or missing file." },
    { symbol: "📋", name: "PO Reference Issue", rule: "Purchase Order reference missing or invalid format." },
    { symbol: "📅", name: "Date Issue", rule: "Invoice date in future or overdue beyond payment terms threshold." },
    { symbol: "📄", name: "Wrong Document Type", rule: "Not a standard tax invoice or payment receipt." },
    { symbol: "🏦", name: "Bank Details Changed", rule: "Supplier bank account details changed versus master vendor database." }
  ];

  symbolRules.forEach((s, idx) => {
    const r = legendSubHeaderRow + 1 + idx;
    summarySheet.getRow(r).height = 22;

    const cSym = summarySheet.getCell(`A${r}`);
    cSym.value = s.symbol;
    cSym.font = { name: "Calibri", size: 12 };
    cSym.alignment = { vertical: "middle", horizontal: "center" };
    applyCellBorder(cSym, "FFCBD5E1");

    const cName = summarySheet.getCell(`B${r}`);
    cName.value = s.name;
    cName.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF1E293B" } };
    cName.alignment = { vertical: "middle", horizontal: "left" };
    applyCellBorder(cName, "FFCBD5E1");

    summarySheet.mergeCells(`C${r}:E${r}`);
    const cRule = summarySheet.getCell(`C${r}`);
    cRule.value = s.rule;
    cRule.font = { name: "Calibri", size: 10, color: { argb: "FF475569" } };
    cRule.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    applyCellBorder(cRule, "FFCBD5E1");
  });

  summarySheet.columns = [
    { key: "colA", width: 30 },
    { key: "colB", width: 28 },
    { key: "colC", width: 22 },
    { key: "colD", width: 28 },
    { key: "colE", width: 35 }
  ];


  // ==========================================
  // SHEET 2: Approved Invoice (GREEN Theme)
  // ==========================================
  const approvedSheet = workbook.addWorksheet("Approved Invoice", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 6, showGridLines: true }]
  });

  const appTotalValStr = summary.readyForApp2Value.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Title Banner
  createTitleBanner(
    approvedSheet,
    "Approved Invoice",
    "Invoices successfully validated and ready for App 2",
    "FF14532D", // Dark Forest Green
    "FFDCFCE7", // Light Mint Green Subtitle
    22
  );

  // Summary Strip Row 4
  createSummaryStrip(
    approvedSheet,
    4,
    ` SUMMARY STRIP  |  Total Approved Invoices: ${summary.readyForApp2Count}  |  Total Approved Value: $${appTotalValStr} SGD  |  Export Date: ${nowFullStr}`,
    "FFE6F4EA", // Light Green Fill
    "FF14532D", // Dark Green Text
    "FFA7F3D0",
    22
  );

  // Table Headers Row 6
  const approvedHeaders = [
    "Status",
    "Record ID",
    "Supplier Name",
    "Invoice Number",
    "Invoice Date",
    "Due Date",
    "PO Reference",
    "Currency",
    "Line Number",
    "Item Description",
    "Quantity",
    "Unit of Measure",
    "Unit Price",
    "Line Amount",
    "Calculated Subtotal",
    "Tax Amount",
    "Total Amount",
    "Source File",
    "Document Style",
    "Approved By",
    "Approval Date",
    "Review Notes"
  ];

  const appHeaderRow = approvedSheet.getRow(6);
  appHeaderRow.height = 28;
  approvedHeaders.forEach((h, idx) => {
    const cell = appHeaderRow.getCell(idx + 1);
    cell.value = h;
    cell.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF15803D" } }; // Medium Green
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    applyCellBorder(cell, "FF166534");
  });

  approvedSheet.autoFilter = "A6:V6";

  let appRowIdx = 7;
  for (const inv of approvedInvoices) {
    const ext = inv.extractedData;
    const lines = ext?.lineItems && ext.lineItems.length > 0 ? ext.lineItems : [{
      lineNumber: 1,
      description: "Invoice Total",
      quantity: 1,
      unitOfMeasure: "LOT",
      unitPrice: ext?.printedTotalAmount || 0,
      printedLineAmount: ext?.printedTotalAmount || 0,
      calculatedLineAmount: ext?.printedTotalAmount || 0
    }];

    for (const line of lines) {
      const isEven = appRowIdx % 2 === 0;
      const rowBgHex = isEven ? "FFF0FDF4" : "FFFFFFFF"; // Alternating white / pale mint green
      const row = approvedSheet.getRow(appRowIdx);
      row.height = 22;

      const rowValues = [
        "Ready for App 2",
        inv.id,
        ext?.supplierName || "Unknown",
        ext?.invoiceNumber || "N/A",
        ext?.invoiceDate || "",
        ext?.dueDate || "",
        ext?.poReference || "N/A",
        ext?.currency || "SGD",
        line.lineNumber || 1,
        line.description || "N/A",
        line.quantity != null ? line.quantity : "",
        line.unitOfMeasure || "",
        line.unitPrice != null ? line.unitPrice : "",
        line.printedLineAmount != null ? line.printedLineAmount : (line.calculatedLineAmount || ""),
        inv.calculatedSubtotal != null ? inv.calculatedSubtotal : (ext?.printedSubtotal || ""),
        ext?.printedTaxAmount != null ? ext.printedTaxAmount : "",
        ext?.printedTotalAmount != null ? ext.printedTotalAmount : (inv.calculatedTotal || 0),
        inv.filename,
        ext?.documentType || "INVOICE",
        inv.reviewDecision?.reviewedBy || "System Auto-Check",
        inv.reviewDecision?.reviewedAt ? new Date(inv.reviewDecision.reviewedAt).toLocaleDateString("en-SG") : new Date(inv.uploadedAt).toLocaleDateString("en-SG"),
        inv.reviewDecision?.reviewNotes || "Passed automated validation"
      ];

      rowValues.forEach((val, cIdx) => {
        const colNum = cIdx + 1;
        const cell = row.getCell(colNum);
        cell.value = val;
        cell.font = { name: "Calibri", size: 10, color: { argb: "FF1E293B" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowBgHex } };
        applyCellBorder(cell, "FFA7F3D0");

        // Specific alignment & badge formatting
        if (colNum === 1) { // Status Badge
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF15803D" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
          cell.alignment = { vertical: "middle", horizontal: "center" };
        } else if ([5, 6, 8, 9, 11, 12, 19, 21].includes(colNum)) { // Dates, Currency, Line#, Qty, UOM, Style
          cell.alignment = { vertical: "middle", horizontal: "center" };
        } else if ([13, 14, 15, 16, 17].includes(colNum)) { // Currency amounts
          cell.alignment = { vertical: "middle", horizontal: "right" };
          cell.numFmt = "$#,##0.00";
        } else {
          cell.alignment = { vertical: "middle", horizontal: "left", wrapText: colNum === 10 || colNum === 22 };
        }
      });

      appRowIdx++;
    }
  }

  formatAndFitColumns(approvedSheet, {
    1: 18, // Status
    2: 18, // Record ID
    3: 28, // Supplier
    4: 18, // Invoice Num
    7: 18, // PO Ref
    10: 32, // Item Desc
    18: 24, // Source File
    22: 30  // Review Notes
  });


  // ==========================================
  // SHEET 3: Review Required (AMBER / YELLOW Theme)
  // ==========================================
  const reviewSheet = workbook.addWorksheet("Review Required", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 6, showGridLines: true }]
  });

  const revTotalValStr = reviewRequiredValue.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Title Banner
  createTitleBanner(
    reviewSheet,
    "Review Required",
    "Invoices requiring human review before progressing",
    "FF78350F", // Dark Amber / Golden
    "FFFEF3C7", // Light Amber Subtitle
    14
  );

  // Summary Strip Row 4
  createSummaryStrip(
    reviewSheet,
    4,
    ` SUMMARY STRIP  |  Total Review Required Invoices: ${summary.reviewRequiredCount}  |  Total Review Value: $${revTotalValStr} SGD  |  Export Date: ${nowFullStr}`,
    "FFFEF3C7", // Light Yellow Fill
    "FF78350F", // Dark Amber Text
    "FFFDE68A",
    14
  );

  // Table Headers Row 6
  const reviewHeaders = [
    "Status",
    "Record ID",
    "Supplier Name",
    "Invoice Number",
    "Invoice Date",
    "PO Reference",
    "Total Amount",
    "Currency",
    "Main Issue / Review Reason",
    "Related Invoice / Duplicate Match",
    "AI Recommended Suggestion",
    "Reviewed By",
    "Review Date",
    "Review Notes"
  ];

  const revHeaderRow = reviewSheet.getRow(6);
  revHeaderRow.height = 28;
  reviewHeaders.forEach((h, idx) => {
    const cell = revHeaderRow.getCell(idx + 1);
    cell.value = h;
    cell.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB45309" } }; // Warm Amber
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    applyCellBorder(cell, "FF78350F");
  });

  reviewSheet.autoFilter = "A6:N6";

  let revRowIdx = 7;
  for (const inv of reviewInvoices) {
    const ext = inv.extractedData;
    const isCannotProcess = inv.app1Status === "CANNOT_PROCESS";
    const statusText = isCannotProcess ? "Cannot Process" : "Review Required";

    const mainIssue = inv.issues?.[0]?.message || inv.processingError || "Requires manual verification";
    const recommendedAction = inv.issues?.[0]?.recommendedAction || "Inspect document and verify details";
    const related = inv.possibleDuplicateOf ? inv.possibleDuplicateOf.invoiceNumber : "N/A";

    const isEven = revRowIdx % 2 === 0;
    const rowBgHex = isEven ? "FFFDFAEA" : "FFFFFFFF"; // Alternating white / pale yellow cream
    const row = reviewSheet.getRow(revRowIdx);
    row.height = 24;

    const rowValues = [
      statusText,
      inv.id,
      ext?.supplierName || "Unknown",
      ext?.invoiceNumber || "N/A",
      ext?.invoiceDate || "",
      ext?.poReference || "N/A",
      ext?.printedTotalAmount != null ? ext.printedTotalAmount : 0,
      ext?.currency || "SGD",
      mainIssue,
      related,
      recommendedAction,
      inv.reviewDecision?.reviewedBy || "-",
      inv.reviewDecision?.reviewedAt ? new Date(inv.reviewDecision.reviewedAt).toLocaleDateString("en-SG") : "-",
      inv.reviewDecision?.reviewNotes || "-"
    ];

    rowValues.forEach((val, cIdx) => {
      const colNum = cIdx + 1;
      const cell = row.getCell(colNum);
      cell.value = val;
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF1E293B" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowBgHex } };
      applyCellBorder(cell, "FFFDE68A");

      if (colNum === 1) { // Status Badge
        if (isCannotProcess) {
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF991B1B" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
        } else {
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF92400E" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
        }
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else if (colNum === 7) { // Total Amount
        cell.alignment = { vertical: "middle", horizontal: "right" };
        cell.numFmt = "$#,##0.00";
      } else if ([5, 8, 12, 13].includes(colNum)) { // Dates, Currency, Reviewer
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else if (colNum === 9) { // Main Issue Emphasis
        const lowerMsg = mainIssue.toLowerCase();
        if (lowerMsg.includes("duplicate") || lowerMsg.includes("hash")) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3E8FF" } };
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF6B21A8" } };
        } else if (lowerMsg.includes("amount") || lowerMsg.includes("mismatch") || lowerMsg.includes("subtotal") || lowerMsg.includes("tax")) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEDD5" } };
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFC2410C" } };
        } else if (lowerMsg.includes("missing") || lowerMsg.includes("field")) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF9C3" } };
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF854D0E" } };
        } else if (isCannotProcess) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF991B1B" } };
        }
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      } else if (colNum === 11) { // AI Recommendation
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF08A" } };
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF1E293B" } };
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      } else {
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: colNum === 14 };
      }
    });

    revRowIdx++;
  }

  formatAndFitColumns(reviewSheet, {
    1: 18, // Status
    2: 18, // Record ID
    3: 28, // Supplier
    4: 18, // Invoice Num
    6: 18, // PO Ref
    9: 36, // Main Issue
    10: 20, // Related Inv
    11: 35, // AI Suggestion
    14: 30  // Review Notes
  });


  // ==========================================
  // SHEET 4: Rejected Invoices (RED Theme)
  // ==========================================
  const rejectedSheet = workbook.addWorksheet("Rejected Invoices", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 6, showGridLines: true }]
  });

  const rejTotalValStr = rejectedValue.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Title Banner
  createTitleBanner(
    rejectedSheet,
    "Rejected Invoices",
    "Invoices rejected after review",
    "FF7F1D1D", // Dark Red
    "FFFEE2E2", // Light Pink/Red Subtitle
    12
  );

  // Summary Strip Row 4
  createSummaryStrip(
    rejectedSheet,
    4,
    ` SUMMARY STRIP  |  Total Rejected Invoices: ${summary.rejectedCount}  |  Total Rejected Value: $${rejTotalValStr} SGD  |  Export Date: ${nowFullStr}`,
    "FFFEE2E2", // Light Red Fill
    "FF7F1D1D", // Dark Red Text
    "FFFECACA",
    12
  );

  // Table Headers Row 6
  const rejectedHeaders = [
    "Status",
    "Record ID",
    "Supplier Name",
    "Invoice Number",
    "Invoice Date",
    "Total Amount",
    "Currency",
    "Rejection Reason",
    "Rejected By",
    "Rejection Date",
    "Review Notes",
    "Source File"
  ];

  const rejHeaderRow = rejectedSheet.getRow(6);
  rejHeaderRow.height = 28;
  rejectedHeaders.forEach((h, idx) => {
    const cell = rejHeaderRow.getCell(idx + 1);
    cell.value = h;
    cell.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB91C1C" } }; // Medium Red
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    applyCellBorder(cell, "FF7F1D1D");
  });

  rejectedSheet.autoFilter = "A6:L6";

  let rejRowIdx = 7;
  for (const inv of rejectedInvoices) {
    const ext = inv.extractedData;
    const isEven = rejRowIdx % 2 === 0;
    const rowBgHex = isEven ? "FFFFF5F5" : "FFFFFFFF"; // Alternating white / pale pink red
    const row = rejectedSheet.getRow(rejRowIdx);
    row.height = 24;

    const rowValues = [
      "Rejected",
      inv.id,
      ext?.supplierName || "Unknown",
      ext?.invoiceNumber || "N/A",
      ext?.invoiceDate || "",
      ext?.printedTotalAmount != null ? ext.printedTotalAmount : 0,
      ext?.currency || "SGD",
      inv.reviewDecision?.reviewNotes || "Rejected during manual review",
      inv.reviewDecision?.reviewedBy || "Madam Lim",
      inv.reviewDecision?.reviewedAt ? new Date(inv.reviewDecision.reviewedAt).toLocaleDateString("en-SG") : "-",
      inv.reviewDecision?.reviewNotes || "-",
      inv.filename
    ];

    rowValues.forEach((val, cIdx) => {
      const colNum = cIdx + 1;
      const cell = row.getCell(colNum);
      cell.value = val;
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF1E293B" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowBgHex } };
      applyCellBorder(cell, "FFFECACA");

      if (colNum === 1) { // Status Badge
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF991B1B" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else if (colNum === 6) { // Total Amount
        cell.alignment = { vertical: "middle", horizontal: "right" };
        cell.numFmt = "$#,##0.00";
      } else if ([5, 7, 9, 10].includes(colNum)) { // Dates, Currency, Rejected By
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else if (colNum === 8) { // Rejection Reason
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF991B1B" } };
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      } else {
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: colNum === 11 || colNum === 12 };
      }
    });

    rejRowIdx++;
  }

  formatAndFitColumns(rejectedSheet, {
    1: 18, // Status
    2: 18, // Record ID
    3: 28, // Supplier
    4: 18, // Invoice Num
    8: 35, // Rejection Reason
    11: 30, // Review Notes
    12: 24  // Source File
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

import express from "express";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

import { 
  InvoiceRecord, 
  AuditEvent, 
  ExtractionResult, 
  DashboardSummary,
  App1Status,
  LineItem
} from "./src/types.js";
import { 
  isPlaceholderValue,
  isInvalidInvoiceNumber,
  isPoReferenceMissing,
  calculateInvoiceAmounts, 
  validateInvoiceFields, 
  calculatePossibleDuplicateScore, 
  deriveApp1Status,
  reevaluateAllDuplicatesAndStatuses,
  getApp2EligibleInvoices
} from "./src/server/invoiceEngine.js";
import { generateInvoiceWorkbook } from "./src/server/excelExport.js";

dotenv.config();

const PORT = 3000;
const LOGIN_PASSCODE = process.env.APP1_LOGIN_PASSCODE || "1111";
const ACTION_PASSCODE = process.env.APP1_ACTION_PASSCODE || "1111";
const APP2_URL = process.env.APP2_URL || "https://ai.studio/apps/0e4c15a0-9b82-4e33-95c7-0873b11b06ed";

// In-Memory Database (Append-Only Audit Trail + Invoices + PO/GRN CSV)
let invoicesDb: InvoiceRecord[] = [];
let auditTrailDb: AuditEvent[] = [];
let poCsvDbData = "";
let grnCsvDbData = "";

// Authorised Staff Profiles Data Structure
interface ServerStaffProfile {
  profileId: string;
  displayName: string;
  role: string;
  department: string;
  initials: string;
}

const SERVER_STAFF_PROFILES: ServerStaffProfile[] = [
  {
    profileId: "MADAM_LIM",
    displayName: "Madam Lim",
    role: "ACCOUNTS EXECUTIVE",
    department: "Accounts Department",
    initials: "ML"
  },
  {
    profileId: "PROCUREMENT_OFFICER",
    displayName: "Procurement Officer",
    role: "PROCUREMENT STAFF",
    department: "Procurement Department",
    initials: "PO"
  },
  {
    profileId: "WAREHOUSE_OFFICER",
    displayName: "Warehouse Officer",
    role: "WAREHOUSE STAFF",
    department: "Warehouse & Logistics",
    initials: "WO"
  },
  {
    profileId: "ACCOUNTS_MANAGER",
    displayName: "Accounts Manager",
    role: "ACCOUNTS MANAGER",
    department: "Accounts Department",
    initials: "AM"
  },
  {
    profileId: "SYSTEM_ADMINISTRATOR",
    displayName: "System Administrator",
    role: "SYSTEM ADMIN",
    department: "IT & Systems",
    initials: "SA"
  }
];

const STAFF_PASSCODES: Record<string, string> = {
  MADAM_LIM: process.env.APP1_LOGIN_PASSCODE || "1111",
  PROCUREMENT_OFFICER: process.env.APP1_LOGIN_PASSCODE || "1111",
  WAREHOUSE_OFFICER: process.env.APP1_LOGIN_PASSCODE || "1111",
  ACCOUNTS_MANAGER: process.env.APP1_LOGIN_PASSCODE || "1111",
  SYSTEM_ADMINISTRATOR: process.env.APP1_LOGIN_PASSCODE || "1111"
};

function getProfilePasscode(profileId: string): string {
  return STAFF_PASSCODES[profileId] || process.env.APP1_LOGIN_PASSCODE || "1111";
}

// Session Management (Configurable Inactivity Timeout)
interface SessionInfo {
  token: string;
  profileId: string;
  displayName: string;
  role: string;
  department: string;
  initials: string;
  createdAt: number;
  lastActivityAt: number;
  inactivityTimeoutMinutes: number;
}
let currentSession: SessionInfo | null = null;
let savedInactivityTimeoutMinutes: number = 5; // Default 5 minutes

function getCurrentUserDisplayName(): string {
  return currentSession?.displayName || "System Administrator";
}

function getCurrentUserRole(): string | undefined {
  return currentSession?.role;
}

function getCurrentUserProfileId(): string | undefined {
  return currentSession?.profileId;
}

function addAuditEvent(
  user: string, 
  actionType: string, 
  result: "SUCCESS" | "FAILURE" | "INFO",
  details?: {
    profileId?: string;
    role?: string;
    recordId?: string;
    invoiceNumber?: string;
    supplier?: string;
    previousValue?: string;
    newValue?: string;
    reason?: string;
    deletionReason?: string;
    previousStatus?: App1Status;
    [key: string]: any;
  }
) {
  const profileId = details?.profileId || currentSession?.profileId;
  const role = details?.role || currentSession?.role;
  const eventUser = (user && user !== "Madam Lim") ? user : (currentSession?.displayName || user || "System Administrator");

  const event: AuditEvent = {
    id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    user: eventUser,
    role: role,
    profileId: profileId,
    actionType,
    result,
    recordId: details?.recordId,
    invoiceNumber: details?.invoiceNumber,
    supplier: details?.supplier,
    previousValue: details?.previousValue,
    newValue: details?.newValue,
    reason: details?.reason
  };
  auditTrailDb.unshift(event);
  return event;
}

function calculateDashboardSummary(): DashboardSummary {
  reevaluateAllDuplicatesAndStatuses(invoicesDb);
  const activeInvoices = invoicesDb.filter(i => !i.isDeleted);
  
  let readyCount = 0;
  let reviewCount = 0;
  let rejectedCount = 0;
  let cannotProcessCount = 0;
  let possibleDuplicateCount = 0;
  let amountIssueCount = 0;
  let totalActiveValue = 0;
  let readyForApp2Value = 0;

  for (const inv of activeInvoices) {
    const total = inv.extractedData?.printedTotalAmount != null 
      ? Number(inv.extractedData.printedTotalAmount) 
      : (inv.calculatedTotal || 0);

    totalActiveValue += total;

    if (inv.app1Status === "READY_FOR_APP2") {
      readyCount++;
      readyForApp2Value += total;
    } else if (inv.app1Status === "REVIEW_REQUIRED") {
      reviewCount++;
    } else if (inv.app1Status === "REJECTED_BY_HUMAN") {
      rejectedCount++;
    } else if (inv.app1Status === "CANNOT_PROCESS") {
      cannotProcessCount++;
    }

    if (inv.duplicateCheckStatus === "POSSIBLE_DUPLICATE") {
      possibleDuplicateCount++;
    }

    if (inv.amountCheckStatus === "FAIL") {
      amountIssueCount++;
    }
  }

  return {
    totalActiveInvoices: activeInvoices.length,
    readyForApp2Count: readyCount,
    reviewRequiredCount: reviewCount,
    rejectedCount,
    cannotProcessCount,
    possibleDuplicateCount,
    amountIssueCount,
    totalActiveValue: Math.round(totalActiveValue * 100) / 100,
    readyForApp2Value: Math.round(readyForApp2Value * 100) / 100
  };
}

// Initialize Gemini Client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build"
    }
  }
});

// Model Pool for Round-Robin Extraction Rotation across free-tier Flash quotas
const ROTATING_FLASH_MODELS = [
  "gemini-2.5-flash",
  "gemini-3.5-flash",
  "gemini-3.6-flash"
];

// Fallback pool if rotated model is unavailable or errors
const EXTRA_FALLBACK_MODELS = [
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-flash-latest",
  "gemini-3.1-flash-lite"
];

let roundRobinModelIndex = 0;

// Track request timestamps per model for rolling 60-second window (max 5 req / 60s window per model)
const modelRequestTimestamps: Record<string, number[]> = {};

/**
 * Ensures accurate pacing of no more than 5 requests per rolling 60-second window per model.
 * Calculates exact millisecond wait time when a model reaches its 5 req/min threshold.
 */
async function acquireModelRateLimitSlot(modelName: string): Promise<void> {
  const WINDOW_MS = 60 * 1000;
  const MAX_REQUESTS_PER_WINDOW = 5;

  while (true) {
    const now = Date.now();
    if (!modelRequestTimestamps[modelName]) {
      modelRequestTimestamps[modelName] = [];
    }
    // Prune entries older than 60 seconds
    modelRequestTimestamps[modelName] = modelRequestTimestamps[modelName].filter(
      t => now - t < WINDOW_MS
    );

    if (modelRequestTimestamps[modelName].length < MAX_REQUESTS_PER_WINDOW) {
      modelRequestTimestamps[modelName].push(now);
      return;
    }

    // Window full for this model. Calculate precise wait time until oldest request exits the 60s window.
    const oldest = modelRequestTimestamps[modelName][0];
    const waitTimeMs = Math.max(50, WINDOW_MS - (now - oldest) + 50);
    console.log(`[Rate Limiter] Model ${modelName} reached 5 req/min limit. Pacing: waiting ${waitTimeMs}ms...`);
    await new Promise(r => setTimeout(r, waitTimeMs));
  }
}

/**
 * Single, unified extraction function with Round-Robin Model Rotation, 
 * Rate Limit Pacing, 20-Second Timeout per File, and Per-File Error Handling.
 */
async function extractInvoiceFromFile(buffer: Buffer, mime: string): Promise<{
  success: boolean;
  extractedData?: ExtractionResult;
  error?: string;
}> {
  if (!buffer || buffer.length === 0) {
    return { success: false, error: "Source invoice file is unavailable. Upload the invoice again to process it." };
  }

  const mimeType = mime || "application/pdf";
  const inlinePart = {
    inlineData: {
      mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType,
      data: buffer.toString("base64")
    }
  };

  const prompt = `You are a high-accuracy Accounts Payable Invoice Extractor for Boon Huat Invoice Management.
Analyze the provided invoice document (PDF or image) carefully and extract all printed details accurately.

CRITICAL INSTRUCTIONS:
1. Extract the COMPLETE Invoice Number exactly as printed on the document (e.g., "WSIS-2026-207", "AA-2026-208", "TBMW-2026-201", "NKHS-2026-219"). Do NOT truncate or return only prefixes like "WSIS" or "AA".
2. Extract the actual Supplier Name printed on the document header. Do NOT return generic placeholders like "Supplier (Pending Review)" or "Unknown".
3. Extract the PO Reference (e.g., "PO-2026-101"). If the PO reference is explicitly printed as "N/A", "NA", "None", or is missing, set "poReference" to "N/A" and "poReferenceSourceText" to whatever is printed.
4. Extract all line items with description, quantity, unit of measure, unit price, and printed line amount.
5. Extract printed subtotal, printed tax amount, printed discount, printed additional charges, and printed total amount.
6. Do NOT invent missing values. If a field is not printed or unreadable, set it to null.

Return JSON strictly matching this schema:
{
  "documentType": "INVOICE" | "OTHER" | null,
  "supplierName": string | null,
  "supplierAddress": string | null,
  "billToName": string | null,
  "invoiceNumber": string | null,
  "invoiceDate": "YYYY-MM-DD" | null,
  "dueDate": "YYYY-MM-DD" | null,
  "poReference": string | null,
  "poReferenceSourceText": string | null,
  "currency": string | null,
  "lineItems": [
    {
      "lineNumber": number,
      "description": string | null,
      "quantity": number | null,
      "unitOfMeasure": string | null,
      "unitPrice": number | null,
      "printedLineAmount": number | null
    }
  ],
  "printedSubtotal": number | null,
  "printedTaxAmount": number | null,
  "printedDiscount": number | null,
  "printedAdditionalCharges": number | null,
  "printedTotalAmount": number | null,
  "fieldConfidence": {
    "supplierName": number | null,
    "invoiceNumber": number | null,
    "invoiceDate": number | null,
    "poReference": number | null,
    "totalAmount": number | null
  }
}`;

  // Round-robin model selection to spread load across model quotas
  const primaryModel = ROTATING_FLASH_MODELS[roundRobinModelIndex % ROTATING_FLASH_MODELS.length];
  roundRobinModelIndex++;

  // Build model fallback sequence starting with round-robin picked model
  const modelAttempts = [
    primaryModel,
    ...ROTATING_FLASH_MODELS.filter(m => m !== primaryModel),
    ...EXTRA_FALLBACK_MODELS.filter(m => m !== primaryModel && !ROTATING_FLASH_MODELS.includes(m))
  ];

  let lastError = "";

  for (const modelName of modelAttempts) {
    try {
      console.log(`[Invoice Engine] Waiting for rate-limit slot for model ${modelName}...`);
      await acquireModelRateLimitSlot(modelName);

      console.log(`[Invoice Engine] Attempting extraction with model: ${modelName} (20s timeout)...`);

      // 20-second per-file timeout promise
      const timeoutPromise = new Promise<{ success: false; error: string }>((resolve) => {
        setTimeout(() => {
          resolve({ success: false, error: "Extraction timed out after 20 seconds." });
        }, 20000);
      });

      const generatePromise = (async () => {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: { parts: [inlinePart, { text: prompt }] },
          config: {
            responseMimeType: "application/json"
          }
        });

        const rawText = response.text?.trim() || "";
        if (!rawText) {
          return { success: false as const, error: "Empty response received from extraction model." };
        }

        let parsed: any;
        try {
          parsed = JSON.parse(rawText);
        } catch (jsonErr: any) {
          console.warn(`[Invoice Engine] Malformed non-JSON response from model ${modelName}`);
          return { success: false as const, error: "Malformed non-JSON response from model." };
        }

        // Validate & sanitize extracted object
        const supplierName = isPlaceholderValue(parsed.supplierName) ? null : String(parsed.supplierName).trim();
        const invoiceNumber = isInvalidInvoiceNumber(parsed.invoiceNumber) ? null : String(parsed.invoiceNumber).trim();
        const poReference = isPoReferenceMissing(parsed.poReference) ? "N/A" : String(parsed.poReference).trim();
        const currency = isPlaceholderValue(parsed.currency) ? null : String(parsed.currency).trim().toUpperCase();

        const rawLines = Array.isArray(parsed.lineItems) ? parsed.lineItems : [];
        const lineItems: LineItem[] = rawLines.map((item: any, idx: number) => ({
          lineNumber: item.lineNumber != null ? Number(item.lineNumber) : idx + 1,
          description: isPlaceholderValue(item.description) ? null : String(item.description).trim(),
          quantity: item.quantity != null && !isNaN(Number(item.quantity)) ? Number(item.quantity) : null,
          unitOfMeasure: isPlaceholderValue(item.unitOfMeasure) ? null : String(item.unitOfMeasure).trim(),
          unitPrice: item.unitPrice != null && !isNaN(Number(item.unitPrice)) ? Number(item.unitPrice) : null,
          printedLineAmount: item.printedLineAmount != null && !isNaN(Number(item.printedLineAmount)) ? Number(item.printedLineAmount) : null
        }));

        const cleanData: ExtractionResult = {
          documentType: parsed.documentType === "INVOICE" || parsed.documentType === "OTHER" ? parsed.documentType : "INVOICE",
          supplierName,
          supplierAddress: isPlaceholderValue(parsed.supplierAddress) ? null : String(parsed.supplierAddress).trim(),
          billToName: isPlaceholderValue(parsed.billToName) ? null : String(parsed.billToName).trim(),
          invoiceNumber,
          invoiceDate: parsed.invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.invoiceDate) ? parsed.invoiceDate : null,
          dueDate: parsed.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dueDate) ? parsed.dueDate : null,
          poReference,
          poReferenceSourceText: parsed.poReferenceSourceText ? String(parsed.poReferenceSourceText) : null,
          currency: currency || "SGD",
          lineItems,
          printedSubtotal: parsed.printedSubtotal != null && !isNaN(Number(parsed.printedSubtotal)) ? Number(parsed.printedSubtotal) : null,
          printedTaxAmount: parsed.printedTaxAmount != null && !isNaN(Number(parsed.printedTaxAmount)) ? Number(parsed.printedTaxAmount) : null,
          printedDiscount: parsed.printedDiscount != null && !isNaN(Number(parsed.printedDiscount)) ? Number(parsed.printedDiscount) : null,
          printedAdditionalCharges: parsed.printedAdditionalCharges != null && !isNaN(Number(parsed.printedAdditionalCharges)) ? Number(parsed.printedAdditionalCharges) : null,
          printedTotalAmount: parsed.printedTotalAmount != null && !isNaN(Number(parsed.printedTotalAmount)) ? Number(parsed.printedTotalAmount) : null,
          bankName: parsed.bankName ? String(parsed.bankName) : null,
          bankAccountNumber: parsed.bankAccountNumber ? String(parsed.bankAccountNumber) : null,
          fieldConfidence: parsed.fieldConfidence || undefined
        };

        console.log(`[Invoice Engine] Extraction succeeded with model ${modelName}. Supplier: ${supplierName}, InvNum: ${invoiceNumber}, PO: ${poReference}`);
        return { success: true as const, extractedData: cleanData };
      })();

      const result: any = await Promise.race([generatePromise, timeoutPromise]);

      if (result.success && result.extractedData) {
        return { success: true, extractedData: result.extractedData };
      } else {
        lastError = result.error || "Model extraction returned failure";
        console.warn(`[Invoice Engine] Model ${modelName} returned failure: ${lastError}`);
      }
    } catch (err: any) {
      console.warn(`[Invoice Engine] Model ${modelName} failed/error:`, err?.message || err);
      lastError = err?.message || "Model extraction failed";
    }
  }

  return { success: false, error: lastError || "Invoice could not be extracted. Retry processing." };
}

async function startServer() {
  const app = express();

  // Middleware
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    next();
  });

  // Helper for Session Check
  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!currentSession) {
      return res.status(401).json({
        success: false,
        code: "SESSION_INACTIVITY_TIMEOUT",
        message: "Your session expired due to inactivity."
      });
    }
    const now = Date.now();
    const timeoutMs = currentSession.inactivityTimeoutMinutes * 60 * 1000;
    if (now - currentSession.lastActivityAt > timeoutMs) {
      addAuditEvent(currentSession.displayName, "SESSION_AUTOMATIC_LOGOUT", "INFO", {
        profileId: currentSession.profileId,
        role: currentSession.role,
        reason: "Session expired on server due to inactivity"
      });
      currentSession = null;
      return res.status(401).json({
        success: false,
        code: "SESSION_INACTIVITY_TIMEOUT",
        message: "Your session expired due to inactivity."
      });
    }
    next();
  };

  // ==================================================
  // AUTHENTICATION & SESSION ENDPOINTS
  // ==================================================
  app.post("/api/auth/login", (req, res) => {
    const { profileId, passcode } = req.body;

    if (!profileId || typeof profileId !== "string" || !profileId.trim()) {
      addAuditEvent("Unknown Profile", "LOGIN_FAILURE", "FAILURE", {
        reason: "Missing staff profile selection",
        failureCategory: "MISSING_PROFILE"
      });
      return res.status(400).json({
        success: false,
        message: "Select a valid staff profile."
      });
    }

    const profile = SERVER_STAFF_PROFILES.find((p) => p.profileId === profileId.trim());
    if (!profile) {
      addAuditEvent("Unknown Profile", "LOGIN_FAILURE", "FAILURE", {
        profileId: profileId,
        reason: "Invalid staff profile selected",
        failureCategory: "INVALID_PROFILE"
      });
      return res.status(401).json({
        success: false,
        message: "Select a valid staff profile."
      });
    }

    const expectedPasscode = getProfilePasscode(profile.profileId);
    if (!passcode || passcode.toString().trim() !== expectedPasscode) {
      addAuditEvent(profile.displayName, "LOGIN_FAILURE", "FAILURE", {
        profileId: profile.profileId,
        role: profile.role,
        reason: "Incorrect passcode entered",
        failureCategory: "INCORRECT_PASSCODE"
      });
      return res.status(401).json({
        success: false,
        message: "Incorrect passcode."
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    currentSession = {
      token,
      profileId: profile.profileId,
      displayName: profile.displayName,
      role: profile.role,
      department: profile.department,
      initials: profile.initials,
      createdAt: now,
      lastActivityAt: now,
      inactivityTimeoutMinutes: savedInactivityTimeoutMinutes
    };

    addAuditEvent(profile.displayName, "LOGIN_SUCCESS", "SUCCESS", {
      profileId: profile.profileId,
      role: profile.role
    });

    res.setHeader("Set-Cookie", `session_token=${token}; Path=/; HttpOnly; SameSite=Lax`);
    res.json({
      success: true,
      authenticated: true,
      user: {
        profileId: profile.profileId,
        displayName: profile.displayName,
        role: profile.role,
        department: profile.department,
        initials: profile.initials
      },
      userName: profile.displayName,
      inactivityTimeoutMinutes: currentSession.inactivityTimeoutMinutes,
      lastActivityAt: new Date(now).toISOString(),
      expiresAt: new Date(now + currentSession.inactivityTimeoutMinutes * 60 * 1000).toISOString()
    });
  });

  app.get("/api/auth/session", (req, res) => {
    if (!currentSession) {
      return res.json({
        success: false,
        authenticated: false,
        code: "SESSION_INACTIVITY_TIMEOUT",
        message: "Your session expired due to inactivity."
      });
    }
    const now = Date.now();
    const timeoutMs = currentSession.inactivityTimeoutMinutes * 60 * 1000;
    if (now - currentSession.lastActivityAt > timeoutMs) {
      addAuditEvent(currentSession.displayName, "SESSION_AUTOMATIC_LOGOUT", "INFO", {
        profileId: currentSession.profileId,
        role: currentSession.role,
        reason: "Session expired on server due to inactivity"
      });
      currentSession = null;
      return res.json({
        success: false,
        authenticated: false,
        code: "SESSION_INACTIVITY_TIMEOUT",
        message: "Your session expired due to inactivity."
      });
    }
    res.json({
      success: true,
      authenticated: true,
      user: {
        profileId: currentSession.profileId,
        displayName: currentSession.displayName,
        role: currentSession.role,
        department: currentSession.department,
        initials: currentSession.initials
      },
      userName: currentSession.displayName,
      inactivityTimeoutMinutes: currentSession.inactivityTimeoutMinutes,
      lastActivityAt: new Date(currentSession.lastActivityAt).toISOString(),
      expiresAt: new Date(currentSession.lastActivityAt + timeoutMs).toISOString()
    });
  });

  app.post("/api/auth/activity", (req, res) => {
    if (!currentSession) {
      return res.status(401).json({
        success: false,
        code: "SESSION_INACTIVITY_TIMEOUT",
        message: "Your session expired due to inactivity."
      });
    }
    const now = Date.now();
    const timeoutMs = currentSession.inactivityTimeoutMinutes * 60 * 1000;
    if (now - currentSession.lastActivityAt > timeoutMs) {
      addAuditEvent(currentSession.displayName, "SESSION_AUTOMATIC_LOGOUT", "INFO", {
        profileId: currentSession.profileId,
        role: currentSession.role,
        reason: "Session expired on server due to inactivity"
      });
      currentSession = null;
      return res.status(401).json({
        success: false,
        code: "SESSION_INACTIVITY_TIMEOUT",
        message: "Your session expired due to inactivity."
      });
    }

    currentSession.lastActivityAt = now;
    const expiresAt = new Date(now + timeoutMs).toISOString();

    res.json({
      success: true,
      lastActivityAt: new Date(now).toISOString(),
      expiresAt,
      inactivityTimeoutMinutes: currentSession.inactivityTimeoutMinutes
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    if (currentSession) {
      addAuditEvent(currentSession.displayName, "LOGOUT", "SUCCESS", {
        profileId: currentSession.profileId,
        role: currentSession.role
      });
    }
    currentSession = null;
    res.setHeader("Set-Cookie", "session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    res.json({ success: true });
  });

  // Action Passcode Authorisation Endpoint
  app.post("/api/auth/authorise-action", (req, res) => {
    const { passcode, action } = req.body;
    if (!passcode || passcode.toString().trim() !== ACTION_PASSCODE) {
      return res.status(401).json({
        success: false,
        authorised: false,
        message: "Incorrect action passcode."
      });
    }
    res.json({
      success: true,
      authorised: true
    });
  });

  // Settings Endpoint: Session Timeout
  app.put("/api/settings/session-timeout", requireAuth, (req, res) => {
    const { inactivityTimeoutMinutes } = req.body;
    const allowedValues = [1, 5, 15, 30];
    const numericVal = Number(inactivityTimeoutMinutes);

    if (!allowedValues.includes(numericVal)) {
      return res.status(400).json({
        success: false,
        message: "Invalid inactivityTimeoutMinutes value. Allowed values are 1, 5, 15, or 30 minutes."
      });
    }

    const prevSetting = savedInactivityTimeoutMinutes;
    savedInactivityTimeoutMinutes = numericVal;

    if (currentSession) {
      currentSession.inactivityTimeoutMinutes = numericVal;
      currentSession.lastActivityAt = Date.now();
    }

    addAuditEvent("Madam Lim", "SESSION_TIMEOUT_SETTING_CHANGED", "SUCCESS", {
      previousValue: `${prevSetting} minutes`,
      newValue: `${numericVal} minutes`,
      reason: `Automatic sign-out time updated to ${numericVal} minutes`
    });

    res.json({
      success: true,
      inactivityTimeoutMinutes: numericVal,
      message: `Automatic sign-out time updated to ${numericVal} minutes.`
    });
  });

  // Session Audit Event Endpoint
  app.post("/api/audit/session-event", (req, res) => {
    const { actionType, result, reason, previousValue, newValue } = req.body;
    const allowedActions = [
      "SESSION_TIMEOUT_SETTING_CHANGED",
      "SESSION_TIMEOUT_WARNING_DISPLAYED",
      "SESSION_EXTENDED_BY_USER",
      "SESSION_AUTOMATIC_LOGOUT",
      "SESSION_EXPIRED_SERVER_SIDE"
    ];

    if (allowedActions.includes(actionType)) {
      addAuditEvent("Madam Lim", actionType, result || "INFO", {
        reason: reason || actionType,
        previousValue,
        newValue
      });
    }

    res.json({ success: true });
  });

  // Protected APIs below
  app.use("/api/invoices", requireAuth);
  app.use("/api/audit", requireAuth);
  app.use("/api/data", requireAuth);
  app.use("/api/export", requireAuth);
  app.use("/api/exports", requireAuth);

  // Sync LocalStorage State Endpoint
  app.post("/api/invoices/sync-localstorage", (req, res) => {
    try {
      const { invoices, poCsvData, grnCsvData, auditEvents } = req.body;

      if (Array.isArray(invoices)) {
        for (const localInv of invoices) {
          const idx = invoicesDb.findIndex(i => i.id === localInv.id);
          if (idx >= 0) {
            // Update record while preserving server soft-deleted state if already deleted
            const isAlreadyDeletedOnServer = invoicesDb[idx].isDeleted === true;
            invoicesDb[idx] = {
              ...localInv,
              isDeleted: isAlreadyDeletedOnServer ? true : (localInv.isDeleted || false),
              deletedAt: isAlreadyDeletedOnServer ? invoicesDb[idx].deletedAt : localInv.deletedAt,
              deletedBy: isAlreadyDeletedOnServer ? invoicesDb[idx].deletedBy : localInv.deletedBy,
              deletionReason: isAlreadyDeletedOnServer ? invoicesDb[idx].deletionReason : localInv.deletionReason,
              previousStatus: isAlreadyDeletedOnServer ? invoicesDb[idx].previousStatus : localInv.previousStatus,
              fileDataUrl: invoicesDb[idx].fileDataUrl || localInv.fileDataUrl
            };
          } else {
            invoicesDb.push(localInv);
          }
        }
      }

      if (typeof poCsvData === "string" && poCsvData.trim()) {
        poCsvDbData = poCsvData;
      }
      if (typeof grnCsvData === "string" && grnCsvData.trim()) {
        grnCsvDbData = grnCsvData;
      }

      if (Array.isArray(auditEvents)) {
        for (const ev of auditEvents) {
          if (!auditTrailDb.some(a => a.id === ev.id)) {
            auditTrailDb.push(ev);
          }
        }
      }

      reevaluateAllDuplicatesAndStatuses(invoicesDb);
      const summary = calculateDashboardSummary();

      res.json({
        success: true,
        summary,
        invoices: invoicesDb,
        auditTrail: auditTrailDb,
        poCsvData: poCsvDbData,
        grnCsvData: grnCsvDbData
      });
    } catch (err: any) {
      console.error("Error syncing local storage:", err);
      res.status(500).json({ error: err.message || "Failed to sync local storage." });
    }
  });

  // PO & GRN CSV Data Endpoints
  app.get("/api/data/po-grn-csv", (req, res) => {
    res.json({
      success: true,
      poCsvData: poCsvDbData,
      grnCsvData: grnCsvDbData
    });
  });

  app.post("/api/data/po-grn-csv", (req, res) => {
    const { poCsvData, grnCsvData } = req.body;
    if (typeof poCsvData === "string") poCsvDbData = poCsvData;
    if (typeof grnCsvData === "string") grnCsvDbData = grnCsvData;

    addAuditEvent("Madam Lim", "PO_GRN_CSV_UPDATED", "SUCCESS", {
      reason: "Updated PO / GRN CSV reference data in local storage"
    });

    res.json({
      success: true,
      poCsvData: poCsvDbData,
      grnCsvData: grnCsvDbData
    });
  });

  // ==================================================
  // INVOICES ENDPOINTS
  // ==================================================
  app.get("/api/invoices", (req, res) => {
    const includeDeleted = req.query.includeDeleted === "true";
    const summary = calculateDashboardSummary();
    const filtered = includeDeleted ? invoicesDb : invoicesDb.filter(i => !i.isDeleted);
    res.json({
      invoices: filtered,
      summary
    });
  });

  // Single File Processing Endpoint (Phase 1: Extraction)
  app.post("/api/invoices/process-file", async (req, res) => {
    try {
      const { filename, fileMimeType, fileSize, fileBase64, skipDuplicateEvaluation } = req.body;

      if (!fileBase64 || !filename) {
        return res.status(400).json({ error: "Missing required file payload." });
      }

      // Step 1: Compute SHA-256 Hash
      const buffer = Buffer.from(fileBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
      const hashHex = crypto.createHash("sha256").update(buffer).digest("hex");
      const mime = fileMimeType || "application/pdf";
      const fileDataUrl = fileBase64.startsWith("data:") ? fileBase64 : `data:${mime};base64,${buffer.toString("base64")}`;

      // Step 2: Check Exact Duplicate against active invoices
      const existingExact = invoicesDb.find(i => !i.isDeleted && i.fileHash === hashHex);
      if (existingExact) {
        addAuditEvent("Madam Lim", "DUPLICATE_FLAGGED", "INFO", {
          invoiceNumber: existingExact.extractedData?.invoiceNumber || undefined,
          supplier: existingExact.extractedData?.supplierName || undefined,
          reason: `Exact file duplicate detected for file ${filename}`
        });
        return res.json({
          isExactDuplicate: true,
          message: "This invoice has already been uploaded.",
          existingInvoice: existingExact
        });
      }

      // Step 3: Run Gemini extraction using extractInvoiceFromFile
      const newId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const extractionRes = await extractInvoiceFromFile(buffer, mime);

      let newRecord: InvoiceRecord;

      if (!extractionRes.success || !extractionRes.extractedData) {
        // Strict failure state - NO placeholder records created!
        newRecord = {
          id: newId,
          filename,
          fileHash: hashHex,
          fileMimeType: mime,
          fileSize,
          fileDataUrl,
          uploadedAt: new Date().toISOString(),
          processingStatus: "FAILED",
          app1Status: "CANNOT_PROCESS",
          processingError: extractionRes.error || "Invoice could not be extracted. Retry processing.",
          amountCheckStatus: "NOT_RUN",
          subtotalCheckStatus: "NOT_STATED",
          taxTreatment: "NOT_STATED",
          duplicateCheckStatus: "CLEAN",
          issues: [{
            code: "EXTRACTION_FAILED",
            severity: "BLOCKING",
            message: extractionRes.error || "Invoice could not be extracted. Retry processing.",
            recommendedAction: "Retry processing or re-upload the file."
          }],
          isDeleted: false,
          sourceFileStored: true,
          sourceFileRecordId: newId,
          sourceFileName: filename,
          sourceMimeType: mime,
          sourceFileSize: fileSize,
          sourceFileHash: hashHex,
          previewAvailable: true
        };

        addAuditEvent("Madam Lim", "INVOICE_PROCESSING_FAILED", "FAILURE", {
          recordId: newId,
          reason: extractionRes.error || "Extraction failed"
        });
      } else {
        // Extraction succeeded - process amounts & field validation
        const extractedData = extractionRes.extractedData;
        const amountResults = calculateInvoiceAmounts(extractedData);
        extractedData.lineItems = amountResults.processedLineItems;

        const fieldIssues = validateInvoiceFields(extractedData);

        if (amountResults.amountCheckStatus === "FAIL") {
          fieldIssues.push({
            code: "AMOUNT_MISMATCH",
            severity: "BLOCKING",
            message: `Calculated total (${amountResults.calculatedTotal}) does not match printed total (${extractedData.printedTotalAmount}).`,
            expectedValue: amountResults.calculatedTotal,
            actualValue: extractedData.printedTotalAmount,
            financialEffect: `Discrepancy of SGD ${Math.abs(amountResults.calculatedTotal - (extractedData.printedTotalAmount || 0)).toFixed(2)}`,
            recommendedAction: "Review line items and amounts carefully."
          });
        }

        newRecord = {
          id: newId,
          filename,
          fileHash: hashHex,
          fileMimeType: mime,
          fileSize,
          fileDataUrl,
          uploadedAt: new Date().toISOString(),
          processingStatus: "COMPLETED",
          app1Status: "READY_FOR_APP2", // Dynamic status set below
          extractedData,
          calculatedSubtotal: amountResults.calculatedSubtotal,
          calculatedTotal: amountResults.calculatedTotal,
          amountCheckStatus: amountResults.amountCheckStatus,
          subtotalCheckStatus: amountResults.subtotalCheckStatus,
          taxTreatment: amountResults.taxTreatment,
          duplicateCheckStatus: "CLEAN",
          issues: fieldIssues,
          isDeleted: false,
          sourceFileStored: true,
          sourceFileRecordId: newId,
          sourceFileName: filename,
          sourceMimeType: mime,
          sourceFileSize: fileSize,
          sourceFileHash: hashHex,
          previewAvailable: true
        };

        addAuditEvent("Madam Lim", "INVOICE_UPLOAD_COMPLETED", "SUCCESS", {
          recordId: newId,
          invoiceNumber: extractedData.invoiceNumber || undefined,
          supplier: extractedData.supplierName || undefined
        });
      }

      invoicesDb.unshift(newRecord);

      // Step 4: Run batch duplicate evaluation unless skipped for Phase 1 of batch upload
      if (!skipDuplicateEvaluation) {
        reevaluateAllDuplicatesAndStatuses(invoicesDb);
      }

      res.json({ isExactDuplicate: false, record: newRecord });

    } catch (err: any) {
      console.error("Error processing invoice:", err);
      res.status(500).json({ error: err.message || "Failed to process invoice file." });
    }
  });

  // Source File Retrieval Endpoint for Document Preview
  app.get("/api/invoices/:id/file", (req, res) => {
    try {
      const { id } = req.params;
      const record = invoicesDb.find(i => i.id === id);

      if (!record) {
        return res.status(404).json({ error: "Invoice record not found." });
      }

      if (!record.fileDataUrl) {
        return res.status(404).json({ error: "Source invoice file is unavailable." });
      }

      res.json({
        success: true,
        recordId: record.id,
        fileName: record.filename,
        mimeType: record.fileMimeType || "application/pdf",
        fileSize: record.fileSize || 0,
        fileHash: record.fileHash || "",
        fileDataUrl: record.fileDataUrl
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to retrieve source invoice file." });
    }
  });

  // Source File Attachment/Replacement Endpoint (Without Re-extraction)
  app.post("/api/invoices/:id/source-file", (req, res) => {
    try {
      const { id } = req.params;
      const { filename, fileMimeType, fileSize, fileBase64, fileHash, replacementReason } = req.body;

      const record = invoicesDb.find(i => i.id === id);
      if (!record) {
        return res.status(404).json({ error: "Invoice record not found." });
      }

      if (!fileBase64 || !filename) {
        return res.status(400).json({ error: "Missing required source file payload." });
      }

      const buffer = Buffer.from(fileBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
      const computedHash = fileHash || crypto.createHash("sha256").update(buffer).digest("hex");
      const mime = fileMimeType || "application/pdf";
      const fileDataUrl = fileBase64.startsWith("data:") ? fileBase64 : `data:${mime};base64,${buffer.toString("base64")}`;

      const hashMatched = record.fileHash ? record.fileHash.toLowerCase() === computedHash.toLowerCase() : true;

      // Update record's source document properties without altering app1Status or re-extracting
      const isInitialAttachment = !record.fileDataUrl;
      record.fileDataUrl = fileDataUrl;
      record.filename = filename;
      record.fileMimeType = mime;
      record.fileSize = fileSize || buffer.length;
      record.fileHash = computedHash;
      record.sourceFileStored = true;
      record.sourceFileRecordId = record.id;
      record.sourceFileName = filename;
      record.sourceMimeType = mime;
      record.sourceFileSize = fileSize || buffer.length;
      record.sourceFileHash = computedHash;
      record.previewAvailable = true;

      if (isInitialAttachment || hashMatched) {
        addAuditEvent("Madam Lim", "INVOICE_SOURCE_FILE_ATTACHED", "SUCCESS", {
          recordId: record.id,
          invoiceNumber: record.extractedData?.invoiceNumber || undefined,
          supplier: record.extractedData?.supplierName || undefined,
          reason: `Attached source document ${filename} (Hash verified)`
        });
      } else {
        addAuditEvent("Madam Lim", "INVOICE_SOURCE_FILE_REPLACED", "SUCCESS", {
          recordId: record.id,
          invoiceNumber: record.extractedData?.invoiceNumber || undefined,
          supplier: record.extractedData?.supplierName || undefined,
          reason: replacementReason || `Replaced source document with ${filename}`
        });
      }

      res.json({
        success: true,
        hashMatched,
        record
      });
    } catch (err: any) {
      console.error("Error attaching source file:", err);
      res.status(500).json({ error: err.message || "Failed to attach source file." });
    }
  });

  // Preview Audit Logging Endpoint
  app.post("/api/audit/preview-event", (req, res) => {
    try {
      const { actionType, recordId, invoiceNumber, filename, result, reason } = req.body;
      const allowed = [
        "INVOICE_PREVIEW_OPENED", 
        "INVOICE_PREVIEW_FAILED", 
        "INVOICE_SOURCE_FILE_ATTACHED", 
        "INVOICE_SOURCE_FILE_REPLACED",
        "LEGACY_SOURCE_FILE_BATCH_STARTED",
        "LEGACY_SOURCE_FILE_BATCH_COMPLETED"
      ];

      if (allowed.includes(actionType)) {
        addAuditEvent("Madam Lim", actionType, result || "SUCCESS", {
          recordId,
          invoiceNumber,
          reason: reason || `${actionType} for record ${recordId} (${filename || "file"})`
        });
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to log preview event." });
    }
  });

  // Phase 2: Batch Duplicate & Matching Evaluation Endpoint (Separate local pass)
  app.post("/api/invoices/evaluate-duplicates", (req, res) => {
    try {
      reevaluateAllDuplicatesAndStatuses(invoicesDb);
      const summary = calculateDashboardSummary();
      res.json({
        success: true,
        summary,
        invoices: invoicesDb.filter(i => !i.isDeleted)
      });
    } catch (err: any) {
      console.error("Error evaluating duplicates:", err);
      res.status(500).json({ error: err.message || "Failed to evaluate duplicates." });
    }
  });

  // Reprocess All Active Invoices Endpoint
  app.post("/api/invoices/reprocess-all", async (req, res) => {
    try {
      const activeRecords = invoicesDb.filter(i => !i.isDeleted);
      let reprocessedCount = 0;
      let failedCount = 0;

      for (const record of activeRecords) {
        if (!record.fileDataUrl) {
          failedCount++;
          continue;
        }

        const base64Data = record.fileDataUrl.replace(/^data:[^;]+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        const mime = record.fileMimeType || "application/pdf";

        const extractionRes = await extractInvoiceFromFile(buffer, mime);

        if (extractionRes.success && extractionRes.extractedData) {
          const extractedData = extractionRes.extractedData;
          const amountResults = calculateInvoiceAmounts(extractedData);
          extractedData.lineItems = amountResults.processedLineItems;

          const fieldIssues = validateInvoiceFields(extractedData);
          if (amountResults.amountCheckStatus === "FAIL") {
            fieldIssues.push({
              code: "AMOUNT_MISMATCH",
              severity: "BLOCKING",
              message: `Calculated total (${amountResults.calculatedTotal}) does not match printed total (${extractedData.printedTotalAmount}).`,
              expectedValue: amountResults.calculatedTotal,
              actualValue: extractedData.printedTotalAmount
            });
          }

          record.extractedData = extractedData;
          record.calculatedSubtotal = amountResults.calculatedSubtotal;
          record.calculatedTotal = amountResults.calculatedTotal;
          record.amountCheckStatus = amountResults.amountCheckStatus;
          record.subtotalCheckStatus = amountResults.subtotalCheckStatus;
          record.taxTreatment = amountResults.taxTreatment;
          record.processingStatus = "COMPLETED";
          record.issues = fieldIssues;
          record.processingError = undefined;
          reprocessedCount++;
        } else {
          record.processingStatus = "FAILED";
          record.app1Status = "CANNOT_PROCESS";
          record.processingError = extractionRes.error || "Invoice could not be extracted. Retry processing.";
          record.issues = [{
            code: "EXTRACTION_FAILED",
            severity: "BLOCKING",
            message: extractionRes.error || "Invoice could not be extracted. Retry processing."
          }];
          failedCount++;
        }
      }

      reevaluateAllDuplicatesAndStatuses(invoicesDb);

      addAuditEvent("Madam Lim", "INVOICE_BATCH_REPROCESSED", "SUCCESS", {
        reason: `Reprocessed ${reprocessedCount} invoices successfully (${failedCount} failed).`
      });

      const summary = calculateDashboardSummary();
      res.json({
        success: true,
        reprocessedCount,
        failedCount,
        summary,
        invoices: invoicesDb.filter(i => !i.isDeleted)
      });
    } catch (err: any) {
      console.error("Error reprocessing all invoices:", err);
      res.status(500).json({ error: err.message || "Failed to reprocess invoices." });
    }
  });

  // Single Invoice Reprocess Endpoint
  app.post("/api/invoices/:id/reprocess", async (req, res) => {
    try {
      const { id } = req.params;
      const record = invoicesDb.find(i => i.id === id);

      if (!record) {
        return res.status(404).json({ error: "Invoice record not found." });
      }

      if (!record.fileDataUrl) {
        return res.status(400).json({ error: "Source invoice file is unavailable. Upload the invoice again to process it." });
      }

      const base64Data = record.fileDataUrl.replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const mime = record.fileMimeType || "application/pdf";

      const extractionRes = await extractInvoiceFromFile(buffer, mime);

      if (extractionRes.success && extractionRes.extractedData) {
        const extractedData = extractionRes.extractedData;
        const amountResults = calculateInvoiceAmounts(extractedData);
        extractedData.lineItems = amountResults.processedLineItems;

        const fieldIssues = validateInvoiceFields(extractedData);
        if (amountResults.amountCheckStatus === "FAIL") {
          fieldIssues.push({
            code: "AMOUNT_MISMATCH",
            severity: "BLOCKING",
            message: `Calculated total (${amountResults.calculatedTotal}) does not match printed total (${extractedData.printedTotalAmount}).`,
            expectedValue: amountResults.calculatedTotal,
            actualValue: extractedData.printedTotalAmount
          });
        }

        record.extractedData = extractedData;
        record.calculatedSubtotal = amountResults.calculatedSubtotal;
        record.calculatedTotal = amountResults.calculatedTotal;
        record.amountCheckStatus = amountResults.amountCheckStatus;
        record.subtotalCheckStatus = amountResults.subtotalCheckStatus;
        record.taxTreatment = amountResults.taxTreatment;
        record.processingStatus = "COMPLETED";
        record.issues = fieldIssues;
        record.processingError = undefined;

        reevaluateAllDuplicatesAndStatuses(invoicesDb);

        addAuditEvent("Madam Lim", "INVOICE_REPROCESSED", "SUCCESS", {
          recordId: record.id,
          invoiceNumber: extractedData.invoiceNumber || undefined,
          supplier: extractedData.supplierName || undefined
        });

        res.json({ success: true, record });
      } else {
        record.processingStatus = "FAILED";
        record.app1Status = "CANNOT_PROCESS";
        record.processingError = extractionRes.error || "Invoice could not be extracted. Retry processing.";
        record.issues = [{
          code: "EXTRACTION_FAILED",
          severity: "BLOCKING",
          message: extractionRes.error || "Invoice could not be extracted. Retry processing."
        }];

        reevaluateAllDuplicatesAndStatuses(invoicesDb);

        res.status(400).json({ error: extractionRes.error || "Failed to extract invoice data." });
      }
    } catch (err: any) {
      console.error("Error reprocessing single invoice:", err);
      res.status(500).json({ error: err.message || "Failed to reprocess invoice." });
    }
  });

  // Helper: Eligibility check for retry
  function isRecordEligibleForRetry(record: InvoiceRecord): boolean {
    if (record.isDeleted) return false;
    if (["QUEUED", "EXTRACTING", "VALIDATING"].includes(record.processingStatus)) return false;
    if (record.app1Status === "REJECTED_BY_HUMAN") return false;
    if (record.app1Status === "READY_FOR_APP2") return false;

    if (record.processingStatus === "FAILED" || record.processingStatus === "PAUSED") return true;
    if (record.app1Status === "CANNOT_PROCESS") return true;

    const hasExtractionIssue = record.issues?.some(
      i => i.code === "EXTRACTION_FAILED" || i.code === "EXTRACTION_INCOMPLETE" || (i.message && i.message.toLowerCase().includes("extraction"))
    );
    return Boolean(hasExtractionIssue);
  }

  // Helper: Central Retry Processing Core Function
  async function executeRetryForRecord(
    record: InvoiceRecord,
    payload?: {
      fileBase64?: string;
      filename?: string;
      fileMimeType?: string;
      manualHashOverride?: boolean;
    }
  ): Promise<{
    success: boolean;
    code?: string;
    message?: string;
    error?: string;
    record: InvoiceRecord;
  }> {
    if (record.isDeleted) {
      return { success: false, code: "RECORD_DELETED", message: "Deleted invoices cannot be retried.", record };
    }

    if (["QUEUED", "EXTRACTING", "VALIDATING"].includes(record.processingStatus)) {
      return { success: false, code: "ALREADY_PROCESSING", message: "This invoice is already being processed.", record };
    }

    // Source file handling
    if (payload?.fileBase64) {
      const rawBuffer = Buffer.from(payload.fileBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
      const newHash = crypto.createHash("sha256").update(rawBuffer).digest("hex");
      const mime = payload.fileMimeType || record.fileMimeType || "application/pdf";
      const dataUrl = payload.fileBase64.startsWith("data:")
        ? payload.fileBase64
        : `data:${mime};base64,${rawBuffer.toString("base64")}`;

      if (record.fileHash && record.fileHash !== newHash && !payload.manualHashOverride) {
        return {
          success: false,
          code: "FILE_MISMATCH",
          message: "The selected file does not match the original invoice.",
          record
        };
      }

      if (payload.manualHashOverride) {
        addAuditEvent("Madam Lim", "INVOICE_SOURCE_FILE_OVERRIDE_CONFIRMED", "SUCCESS", {
          recordId: record.id,
          invoiceNumber: record.extractedData?.invoiceNumber || undefined,
          supplier: record.extractedData?.supplierName || undefined,
          reason: "Manual override confirmed for re-selected source invoice file."
        });
      }

      addAuditEvent("Madam Lim", "INVOICE_SOURCE_FILE_RESELECTED", "SUCCESS", {
        recordId: record.id,
        invoiceNumber: record.extractedData?.invoiceNumber || undefined,
        supplier: record.extractedData?.supplierName || undefined,
        reason: `Re-selected source invoice file (${payload.filename || record.filename})`
      });

      record.fileDataUrl = dataUrl;
      record.fileHash = newHash;
      if (payload.filename) record.filename = payload.filename;
      if (payload.fileMimeType) record.fileMimeType = payload.fileMimeType;
    }

    if (!record.fileDataUrl || record.fileDataUrl.trim() === "") {
      return {
        success: false,
        code: "MISSING_SOURCE_FILE",
        message: "The original invoice file is no longer available. Select the invoice file again to retry processing.",
        record
      };
    }

    const attemptNumber = (record.retryHistory?.length || 0) + 1;
    const startedAt = new Date().toISOString();
    const previousProcessingStatus = record.processingStatus;
    const previousApp1Status = record.app1Status;

    addAuditEvent("Madam Lim", "INVOICE_RETRY_REQUESTED", "INFO", {
      recordId: record.id,
      invoiceNumber: record.extractedData?.invoiceNumber || undefined,
      supplier: record.extractedData?.supplierName || undefined,
      previousValue: previousApp1Status,
      reason: `Retry processing attempt #${attemptNumber} requested`
    });

    record.processingStatus = "QUEUED";
    addAuditEvent("Madam Lim", "INVOICE_RETRY_STARTED", "INFO", {
      recordId: record.id,
      invoiceNumber: record.extractedData?.invoiceNumber || undefined,
      supplier: record.extractedData?.supplierName || undefined,
      previousValue: previousProcessingStatus,
      newValue: "QUEUED",
      reason: `Retry processing attempt #${attemptNumber} started`
    });

    record.processingStatus = "EXTRACTING";

    const base64Data = record.fileDataUrl.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const mime = record.fileMimeType || "application/pdf";

    const extractionRes = await extractInvoiceFromFile(buffer, mime);

    record.processingStatus = "VALIDATING";
    const completedAt = new Date().toISOString();

    if (!extractionRes.success || !extractionRes.extractedData) {
      const errorMsg = extractionRes.error || "Invoice processing could not be completed after retry.";
      const isQuota = /quota|rate limit|resource_exhausted|429|temporarily unavailable/i.test(errorMsg);

      if (isQuota) {
        record.processingStatus = "PAUSED";
        record.processingError = "Processing paused because the AI service is temporarily unavailable.";
        record.issues = [{
          code: "QUOTA_PAUSED",
          severity: "BLOCKING",
          message: "Processing paused because the AI service is temporarily unavailable.",
          recommendedAction: "Resume when the AI service is available."
        }];

        addAuditEvent("Madam Lim", "INVOICE_RETRY_PAUSED", "FAILURE", {
          recordId: record.id,
          invoiceNumber: record.extractedData?.invoiceNumber || undefined,
          supplier: record.extractedData?.supplierName || undefined,
          previousValue: previousProcessingStatus,
          newValue: "PAUSED",
          reason: "Processing paused due to AI service rate limit / quota"
        });

        if (!record.retryHistory) record.retryHistory = [];
        record.retryHistory.push({
          retryAttemptId: `retry_${record.id}_${attemptNumber}_${Date.now()}`,
          recordId: record.id,
          attemptNumber,
          startedAt,
          completedAt,
          initiatedBy: "Madam Lim",
          previousProcessingStatus,
          previousApp1Status,
          sourceFileName: record.filename,
          result: "PAUSED",
          failureReason: "Processing paused because the AI service is temporarily unavailable.",
          newProcessingStatus: "PAUSED",
          newApp1Status: record.app1Status
        });

        reevaluateAllDuplicatesAndStatuses(invoicesDb);

        return {
          success: false,
          code: "QUOTA_PAUSED",
          message: "Processing paused because the AI service is temporarily unavailable.",
          record
        };
      } else {
        record.processingStatus = "FAILED";
        record.app1Status = "CANNOT_PROCESS";
        record.processingError = "Invoice processing could not be completed after retry.";
        record.issues = [{
          code: "EXTRACTION_FAILED",
          severity: "BLOCKING",
          message: "Invoice processing could not be completed after retry.",
          recommendedAction: "Select the invoice file again or retry."
        }];

        addAuditEvent("Madam Lim", "INVOICE_RETRY_FAILED", "FAILURE", {
          recordId: record.id,
          invoiceNumber: record.extractedData?.invoiceNumber || undefined,
          supplier: record.extractedData?.supplierName || undefined,
          previousValue: previousProcessingStatus,
          newValue: "FAILED",
          reason: errorMsg
        });

        if (!record.retryHistory) record.retryHistory = [];
        record.retryHistory.push({
          retryAttemptId: `retry_${record.id}_${attemptNumber}_${Date.now()}`,
          recordId: record.id,
          attemptNumber,
          startedAt,
          completedAt,
          initiatedBy: "Madam Lim",
          previousProcessingStatus,
          previousApp1Status,
          sourceFileName: record.filename,
          result: "FAILED",
          failureReason: errorMsg,
          newProcessingStatus: "FAILED",
          newApp1Status: "CANNOT_PROCESS"
        });

        reevaluateAllDuplicatesAndStatuses(invoicesDb);

        return {
          success: false,
          code: "EXTRACTION_FAILED",
          message: "Invoice processing could not be completed after retry.",
          record
        };
      }
    }

    // Success path
    const extractedData = extractionRes.extractedData;
    const amountResults = calculateInvoiceAmounts(extractedData);
    extractedData.lineItems = amountResults.processedLineItems;

    const fieldIssues = validateInvoiceFields(extractedData);
    if (amountResults.amountCheckStatus === "FAIL") {
      fieldIssues.push({
        code: "AMOUNT_MISMATCH",
        severity: "BLOCKING",
        message: `Calculated total (${amountResults.calculatedTotal}) does not match printed total (${extractedData.printedTotalAmount}).`,
        expectedValue: amountResults.calculatedTotal,
        actualValue: extractedData.printedTotalAmount,
        financialEffect: `Discrepancy of SGD ${Math.abs(amountResults.calculatedTotal - (extractedData.printedTotalAmount || 0)).toFixed(2)}`,
        recommendedAction: "Review line items and amounts carefully."
      });
    }

    record.extractedData = extractedData;
    record.calculatedSubtotal = amountResults.calculatedSubtotal;
    record.calculatedTotal = amountResults.calculatedTotal;
    record.amountCheckStatus = amountResults.amountCheckStatus;
    record.subtotalCheckStatus = amountResults.subtotalCheckStatus;
    record.taxTreatment = amountResults.taxTreatment;
    record.processingStatus = "COMPLETED";
    record.issues = fieldIssues;
    record.processingError = undefined;

    reevaluateAllDuplicatesAndStatuses(invoicesDb);

    addAuditEvent("Madam Lim", "INVOICE_RETRY_COMPLETED", "SUCCESS", {
      recordId: record.id,
      invoiceNumber: extractedData.invoiceNumber || undefined,
      supplier: extractedData.supplierName || undefined,
      previousValue: previousApp1Status,
      newValue: record.app1Status,
      reason: `Retry attempt #${attemptNumber} completed successfully. Status: ${record.app1Status}`
    });

    if (!record.retryHistory) record.retryHistory = [];
    record.retryHistory.push({
      retryAttemptId: `retry_${record.id}_${attemptNumber}_${Date.now()}`,
      recordId: record.id,
      attemptNumber,
      startedAt,
      completedAt,
      initiatedBy: "Madam Lim",
      previousProcessingStatus,
      previousApp1Status,
      sourceFileName: record.filename,
      result: "SUCCESS",
      newProcessingStatus: "COMPLETED",
      newApp1Status: record.app1Status
    });

    return {
      success: true,
      record
    };
  }

  // Single Invoice Retry Endpoint
  app.post("/api/invoices/:id/retry", async (req, res) => {
    try {
      const recordId = req.params.id;
      if (!recordId || recordId.trim() === "") {
        return res.status(400).json({ error: "Invalid record ID." });
      }

      const record = invoicesDb.find(i => i.id === recordId);
      if (!record) {
        return res.status(404).json({ error: "Invoice record not found." });
      }

      if (record.isDeleted) {
        return res.status(400).json({ error: "Deleted invoices cannot be retried." });
      }

      if (!isRecordEligibleForRetry(record)) {
        return res.status(400).json({ error: "This invoice is not eligible for retry processing." });
      }

      const outcome = await executeRetryForRecord(record, req.body);

      if (!outcome.success && outcome.code === "MISSING_SOURCE_FILE") {
        return res.status(400).json({
          code: "MISSING_SOURCE_FILE",
          message: "The original invoice file is no longer available. Select the invoice file again to retry processing.",
          error: "The original invoice file is no longer available. Select the invoice file again to retry processing.",
          record: outcome.record
        });
      }

      if (!outcome.success && outcome.code === "FILE_MISMATCH") {
        return res.status(400).json({
          code: "FILE_MISMATCH",
          message: "The selected file does not match the original invoice.",
          error: "The selected file does not match the original invoice.",
          record: outcome.record
        });
      }

      const summary = calculateDashboardSummary();
      res.json({
        success: outcome.success,
        code: outcome.code,
        message: outcome.message,
        record: outcome.record,
        summary,
        invoices: invoicesDb.filter(i => !i.isDeleted)
      });
    } catch (err: any) {
      console.error("Error retrying invoice:", err);
      res.status(500).json({ error: err.message || "Failed to retry invoice processing." });
    }
  });

  // Batch Retry Endpoint
  app.post("/api/invoices/retry-batch", async (req, res) => {
    try {
      const { recordIds } = req.body;
      let eligible: InvoiceRecord[] = [];

      if (Array.isArray(recordIds) && recordIds.length > 0) {
        eligible = invoicesDb.filter(i => !i.isDeleted && recordIds.includes(i.id) && isRecordEligibleForRetry(i));
      } else {
        eligible = invoicesDb.filter(i => !i.isDeleted && isRecordEligibleForRetry(i));
      }

      if (eligible.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No eligible failed invoices were found to retry."
        });
      }

      let successfullyProcessed = 0;
      let stillRequiresReview = 0;
      let failedAgain = 0;
      let paused = 0;

      const BATCH_SIZE = 2;
      for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
        const chunk = eligible.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(chunk.map(rec => executeRetryForRecord(rec)));

        for (const resItem of results) {
          if (resItem.status === "fulfilled") {
            const outcome = resItem.value;
            if (outcome.success) {
              if (outcome.record.app1Status === "READY_FOR_APP2") {
                successfullyProcessed++;
              } else if (outcome.record.app1Status === "REVIEW_REQUIRED") {
                stillRequiresReview++;
              } else {
                failedAgain++;
              }
            } else if (outcome.code === "QUOTA_PAUSED") {
              paused++;
            } else {
              failedAgain++;
            }
          } else {
            failedAgain++;
          }
        }
      }

      reevaluateAllDuplicatesAndStatuses(invoicesDb);
      const summary = calculateDashboardSummary();

      res.json({
        success: true,
        totalCompleted: eligible.length,
        successfullyProcessed,
        stillRequiresReview,
        failedAgain,
        paused,
        summary,
        invoices: invoicesDb.filter(i => !i.isDeleted)
      });
    } catch (err: any) {
      console.error("Error batch retrying invoices:", err);
      res.status(500).json({ error: err.message || "Failed to batch retry invoices." });
    }
  });


  // Human Review Decision Endpoint
  app.post("/api/invoices/:id/review", (req, res) => {
    const { id } = req.params;
    const { decision, reviewNotes, correctedFields } = req.body;

    const record = invoicesDb.find(i => i.id === id);
    if (!record) {
      return res.status(404).json({ error: "Invoice record not found." });
    }

    const prevStatus = record.app1Status;

    if (correctedFields && record.extractedData) {
      record.extractedData = {
        ...record.extractedData,
        ...correctedFields
      };
      // Recompute amounts & field issues
      const amountResults = calculateInvoiceAmounts(record.extractedData);
      record.extractedData.lineItems = amountResults.processedLineItems;
      record.calculatedSubtotal = amountResults.calculatedSubtotal;
      record.calculatedTotal = amountResults.calculatedTotal;
      record.amountCheckStatus = amountResults.amountCheckStatus;
      record.subtotalCheckStatus = amountResults.subtotalCheckStatus;
      record.taxTreatment = amountResults.taxTreatment;
      record.issues = validateInvoiceFields(record.extractedData);
    }

    let newStatus: App1Status = prevStatus;
    if (decision === "APPROVE") {
      newStatus = "READY_FOR_APP2";
    } else if (decision === "REJECT") {
      newStatus = "REJECTED_BY_HUMAN";
    } else if (decision === "HOLD") {
      newStatus = "REVIEW_REQUIRED";
    }

    record.reviewDecision = {
      reviewedBy: getCurrentUserDisplayName(),
      reviewedAt: new Date().toISOString(),
      decision,
      reviewNotes: reviewNotes || "",
      previousStatus: prevStatus,
      newStatus,
      correctedFields
    };

    reevaluateAllDuplicatesAndStatuses(invoicesDb);

    let auditAction = "INVOICE_REVIEWED";
    if (decision === "APPROVE") auditAction = "INVOICE_APPROVED_FOR_APP2";
    if (decision === "REJECT") auditAction = "INVOICE_REJECTED";

    addAuditEvent("Madam Lim", auditAction, "SUCCESS", {
      recordId: record.id,
      invoiceNumber: record.extractedData?.invoiceNumber || undefined,
      supplier: record.extractedData?.supplierName || undefined,
      previousValue: prevStatus,
      newValue: record.app1Status,
      reason: reviewNotes
    });

    res.json({ success: true, record });
  });

  // Helper function for Single Invoice Soft Delete
  const handleSingleInvoiceSoftDelete = (req: express.Request, res: express.Response) => {
    const recordId = req.params.recordId || req.params.id;
    const { passcode, deletionReason, reason, confirmationPhrase, phrase } = req.body;
    const effectiveReason = (deletionReason || reason || "").toString().trim();
    const effectivePhrase = (confirmationPhrase || phrase || "").toString().trim();
    const effectivePasscode = (passcode || req.headers["x-action-passcode"] || "").toString().trim();

    if (effectivePasscode !== ACTION_PASSCODE) {
      return res.status(401).json({
        success: false,
        authorised: false,
        message: "Incorrect action passcode.",
        error: "Incorrect action passcode."
      });
    }

    if (!effectiveReason) {
      return res.status(400).json({
        success: false,
        message: "Enter a reason for deletion.",
        error: "Enter a reason for deletion."
      });
    }

    if (effectivePhrase !== "DELETE") {
      return res.status(400).json({
        success: false,
        message: "Enter the required confirmation phrase exactly.",
        error: "Enter the required confirmation phrase exactly."
      });
    }

    const record = invoicesDb.find(i => i.id === recordId && !i.isDeleted);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Invoice record not found.",
        error: "Invoice record not found."
      });
    }

    const prevStatus = record.app1Status;

    // 1. Snapshot record before deletion
    const preDeletionSnapshot = {
      id: record.id,
      app1Status: record.app1Status,
      supplierName: record.extractedData?.supplierName,
      invoiceNumber: record.extractedData?.invoiceNumber,
      printedTotalAmount: record.extractedData?.printedTotalAmount,
      currency: record.extractedData?.currency,
      poReference: record.extractedData?.poReference,
      filename: record.filename,
      uploadedAt: record.uploadedAt
    };

    // 2. Perform Atomic Audit Creation First
    try {
      addAuditEvent("Madam Lim", "INVOICE_SOFT_DELETED", "SUCCESS", {
        recordId: record.id,
        invoiceNumber: record.extractedData?.invoiceNumber || undefined,
        supplier: record.extractedData?.supplierName || undefined,
        previousStatus: prevStatus,
        previousValue: prevStatus,
        totalAmount: record.extractedData?.printedTotalAmount,
        deletionReason: effectiveReason,
        reason: effectiveReason,
        preDeletionSnapshot
      });
    } catch (auditErr: any) {
      console.error("Audit event write failed:", auditErr);
      return res.status(500).json({
        success: false,
        message: "The deletion was not completed because the audit event could not be recorded.",
        error: "The deletion was not completed because the audit event could not be recorded."
      });
    }

    // 3. Update invoice record as soft deleted
    record.isDeleted = true;
    record.deletedAt = new Date().toISOString();
    record.deletedBy = getCurrentUserDisplayName();
    record.deletionReason = effectiveReason;
    record.previousStatus = prevStatus;

    reevaluateAllDuplicatesAndStatuses(invoicesDb);

    res.json({
      success: true,
      recordId: record.id,
      message: "Invoice moved to Deleted Records.",
      record
    });
  };

  app.post("/api/invoices/:recordId/soft-delete", handleSingleInvoiceSoftDelete);
  app.post("/api/invoices/:id/delete", handleSingleInvoiceSoftDelete);

  // Helper function for Bulk Invoice Soft Delete
  const handleBulkInvoiceSoftDelete = (req: express.Request, res: express.Response) => {
    const { passcode, deletionReason, reason, confirmationPhrase, phrase, recordIds, ids } = req.body;
    const effectiveReason = (deletionReason || reason || "").toString().trim();
    const effectivePhrase = (confirmationPhrase || phrase || "").toString().trim();
    const effectivePasscode = (passcode || req.headers["x-action-passcode"] || "").toString().trim();
    const targetIds: string[] = Array.isArray(recordIds) ? recordIds : Array.isArray(ids) ? ids : [];

    if (effectivePasscode !== ACTION_PASSCODE) {
      return res.status(401).json({
        success: false,
        authorised: false,
        message: "Incorrect action passcode.",
        error: "Incorrect action passcode."
      });
    }

    if (!effectiveReason) {
      return res.status(400).json({
        success: false,
        message: "Enter a reason for deletion.",
        error: "Enter a reason for deletion."
      });
    }

    if (effectivePhrase !== "DELETE SELECTED") {
      return res.status(400).json({
        success: false,
        message: "Enter the required confirmation phrase exactly.",
        error: "Enter the required confirmation phrase exactly."
      });
    }

    if (targetIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No invoice records selected.",
        error: "No invoice records selected."
      });
    }

    const recordsToDelete = invoicesDb.filter(i => targetIds.includes(i.id) && !i.isDeleted);
    if (recordsToDelete.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No active records found for the specified IDs.",
        error: "No active records found for the specified IDs."
      });
    }

    const nowIso = new Date().toISOString();
    const batchAuditId = `audit_batch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 1. Perform Atomic Batch Audit Creation First
    try {
      // Create batch summary audit event
      addAuditEvent("Madam Lim", "BULK_INVOICE_SOFT_DELETED", "SUCCESS", {
        reason: effectiveReason,
        deletionReason: effectiveReason,
        batchAuditId,
        details: {
          affectedCount: recordsToDelete.length,
          affectedRecordIds: recordsToDelete.map(r => r.id),
          affectedInvoiceNumbers: recordsToDelete.map(r => r.extractedData?.invoiceNumber || "N/A"),
          totalValue: recordsToDelete.reduce((sum, r) => sum + (r.extractedData?.printedTotalAmount || 0), 0)
        }
      });

      // Create linked audit entry for each affected invoice
      for (const record of recordsToDelete) {
        addAuditEvent("Madam Lim", "INVOICE_SOFT_DELETED", "SUCCESS", {
          recordId: record.id,
          invoiceNumber: record.extractedData?.invoiceNumber || undefined,
          supplier: record.extractedData?.supplierName || undefined,
          previousStatus: record.app1Status,
          previousValue: record.app1Status,
          totalAmount: record.extractedData?.printedTotalAmount,
          deletionReason: effectiveReason,
          reason: effectiveReason,
          batchAuditId,
          preDeletionSnapshot: {
            id: record.id,
            app1Status: record.app1Status,
            supplierName: record.extractedData?.supplierName,
            invoiceNumber: record.extractedData?.invoiceNumber,
            printedTotalAmount: record.extractedData?.printedTotalAmount,
            currency: record.extractedData?.currency,
            poReference: record.extractedData?.poReference,
            filename: record.filename,
            uploadedAt: record.uploadedAt
          }
        });
      }
    } catch (auditErr: any) {
      console.error("Batch audit write failed:", auditErr);
      return res.status(500).json({
        success: false,
        message: "The deletion was not completed because the audit event could not be recorded.",
        error: "The deletion was not completed because the audit event could not be recorded."
      });
    }

    // 2. Soft-delete all matched records
    for (const record of recordsToDelete) {
      record.isDeleted = true;
      record.deletedAt = nowIso;
      record.deletedBy = getCurrentUserDisplayName();
      record.deletionReason = effectiveReason;
      record.previousStatus = record.app1Status;
    }

    reevaluateAllDuplicatesAndStatuses(invoicesDb);

    res.json({
      success: true,
      deletedCount: recordsToDelete.length,
      message: `${recordsToDelete.length} invoice(s) moved to Deleted Records.`
    });
  };

  app.post("/api/invoices/bulk-soft-delete", handleBulkInvoiceSoftDelete);
  app.post("/api/invoices/delete-selected", handleBulkInvoiceSoftDelete);

  // Helper function for Delete All Active Invoices
  const handleDeleteAllActiveInvoices = (req: express.Request, res: express.Response) => {
    const { passcode, deletionReason, reason, confirmationPhrase, phrase } = req.body;
    const effectiveReason = (deletionReason || reason || "").toString().trim();
    const effectivePhrase = (confirmationPhrase || phrase || "").toString().trim();
    const effectivePasscode = (passcode || req.headers["x-action-passcode"] || "").toString().trim();

    if (effectivePasscode !== ACTION_PASSCODE) {
      return res.status(401).json({
        success: false,
        authorised: false,
        message: "Incorrect action passcode.",
        error: "Incorrect action passcode."
      });
    }

    if (!effectiveReason) {
      return res.status(400).json({
        success: false,
        message: "Enter a reason for deletion.",
        error: "Enter a reason for deletion."
      });
    }

    if (effectivePhrase !== "DELETE ALL INVOICES") {
      return res.status(400).json({
        success: false,
        message: "Enter the required confirmation phrase exactly.",
        error: "Enter the required confirmation phrase exactly."
      });
    }

    const activeInvoices = invoicesDb.filter(i => !i.isDeleted);
    if (activeInvoices.length === 0) {
      return res.status(400).json({
        success: false,
        message: "There are no active invoices to delete.",
        error: "There are no active invoices to delete."
      });
    }

    const nowIso = new Date().toISOString();
    const batchAuditId = `audit_all_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 1. Perform Atomic Audit Creation First
    try {
      addAuditEvent("Madam Lim", "ALL_ACTIVE_INVOICES_SOFT_DELETED", "SUCCESS", {
        reason: effectiveReason,
        deletionReason: effectiveReason,
        batchAuditId,
        details: {
          affectedCount: activeInvoices.length,
          affectedRecordIds: activeInvoices.map(r => r.id),
          affectedInvoiceNumbers: activeInvoices.map(r => r.extractedData?.invoiceNumber || "N/A"),
          totalValue: activeInvoices.reduce((sum, r) => sum + (r.extractedData?.printedTotalAmount || 0), 0)
        }
      });

      for (const record of activeInvoices) {
        addAuditEvent("Madam Lim", "INVOICE_SOFT_DELETED", "SUCCESS", {
          recordId: record.id,
          invoiceNumber: record.extractedData?.invoiceNumber || undefined,
          supplier: record.extractedData?.supplierName || undefined,
          previousStatus: record.app1Status,
          previousValue: record.app1Status,
          totalAmount: record.extractedData?.printedTotalAmount,
          deletionReason: effectiveReason,
          reason: effectiveReason,
          batchAuditId,
          preDeletionSnapshot: {
            id: record.id,
            app1Status: record.app1Status,
            supplierName: record.extractedData?.supplierName,
            invoiceNumber: record.extractedData?.invoiceNumber,
            printedTotalAmount: record.extractedData?.printedTotalAmount,
            currency: record.extractedData?.currency,
            poReference: record.extractedData?.poReference,
            filename: record.filename,
            uploadedAt: record.uploadedAt
          }
        });
      }
    } catch (auditErr: any) {
      console.error("Delete all audit write failed:", auditErr);
      return res.status(500).json({
        success: false,
        message: "The deletion was not completed because the audit event could not be recorded.",
        error: "The deletion was not completed because the audit event could not be recorded."
      });
    }

    // 2. Soft-delete all active records
    for (const record of activeInvoices) {
      record.isDeleted = true;
      record.deletedAt = nowIso;
      record.deletedBy = getCurrentUserDisplayName();
      record.deletionReason = effectiveReason;
      record.previousStatus = record.app1Status;
    }

    reevaluateAllDuplicatesAndStatuses(invoicesDb);

    res.json({
      success: true,
      deletedCount: activeInvoices.length,
      message: "All active invoices were moved to Deleted Records."
    });
  };

  app.post("/api/invoices/soft-delete-all", handleDeleteAllActiveInvoices);
  app.post("/api/invoices/delete-all", handleDeleteAllActiveInvoices);

  // Restore Deleted Invoice
  app.post("/api/invoices/:id/restore", (req, res) => {
    const { id } = req.params;
    const { passcode, reason } = req.body;

    if (!passcode || passcode.toString().trim() !== ACTION_PASSCODE) {
      return res.status(401).json({ error: "Invalid action passcode." });
    }
    if (!reason || reason.trim() === "") {
      return res.status(400).json({ error: "A valid restoration reason is mandatory." });
    }

    const record = invoicesDb.find(i => i.id === id && i.isDeleted);
    if (!record) {
      return res.status(404).json({ error: "Deleted invoice record not found." });
    }

    record.isDeleted = false;
    record.deletedAt = undefined;
    record.deletedBy = undefined;
    record.deletionReason = undefined;

    reevaluateAllDuplicatesAndStatuses(invoicesDb);

    addAuditEvent("Madam Lim", "INVOICE_RESTORED", "SUCCESS", {
      recordId: record.id,
      invoiceNumber: record.extractedData?.invoiceNumber || undefined,
      supplier: record.extractedData?.supplierName || undefined,
      reason
    });

    res.json({ success: true, record });
  });

  // Audit Trail Endpoint
  app.get("/api/audit", (req, res) => {
    res.json({ auditTrail: auditTrailDb });
  });

  app.post("/api/audit/app2-opened", (req, res) => {
    addAuditEvent("Madam Lim", "APP2_LINK_OPENED", "INFO", {
      reason: "User clicked link to open App 2 in a new window"
    });
    res.json({ success: true });
  });

  app.post("/api/audit/transfer-event", (req, res) => {
    const { actionType, result, transferId, approvedInvoiceCount, approvedInvoiceTotal, reason } = req.body;
    
    // Valid action types: APP2_TRANSFER_STARTED, APPROVED_INVOICES_SENT_TO_APP2, APP2_TRANSFER_CONFIRMED, APP2_TRANSFER_FAILED
    const allowedActions = [
      "APP2_TRANSFER_STARTED",
      "APPROVED_INVOICES_SENT_TO_APP2",
      "APP2_TRANSFER_CONFIRMED",
      "APP2_TRANSFER_FAILED"
    ];

    if (allowedActions.includes(actionType)) {
      addAuditEvent("Madam Lim", actionType, result || "INFO", {
        reason: reason || `Transfer ${transferId || "N/A"}: ${approvedInvoiceCount || 0} invoices (SGD $${Number(approvedInvoiceTotal || 0).toFixed(2)})`
      });
    }

    res.json({ success: true });
  });

  // Workbook Export Endpoint
  const handleExportWorkbookRequest = async (req: express.Request, res: express.Response) => {
    try {
      const activeInvoices = invoicesDb.filter(i => !i.isDeleted);

      if (!activeInvoices || activeInvoices.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No active invoices are available for export."
        });
      }

      const buffer = await generateInvoiceWorkbook(activeInvoices);

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const min = String(now.getMinutes()).padStart(2, "0");
      const filename = `Boon_Huat_App1_Invoice_Review_${yyyy}-${mm}-${dd}_${hh}${min}.xlsx`;

      addAuditEvent("Madam Lim", "EXCEL_EXPORT_GENERATED", "SUCCESS", {
        reason: `Generated invoice workbook (${filename}) containing ${activeInvoices.length} active records`
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(buffer);
    } catch (err: any) {
      console.error("Failed to generate XLSX workbook:", err);
      res.status(500).json({
        success: false,
        message: "The invoice workbook could not be generated."
      });
    }
  };

  app.get("/api/exports/app1-workbook", handleExportWorkbookRequest);
  app.get("/api/export/xlsx", handleExportWorkbookRequest);

  // Vite development mode vs production static mode
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

import { Mistral } from "@mistralai/mistralai";
import fs from "fs";
import path from "path";
import { Request, Response } from "express";
import multer from "multer";
import Tesseract from "tesseract.js";
import logger from "../utils/logger";
import { AuthenticatedRequest } from '../middleware/jwtAuth';
import { logVerification } from './verificationRecords';
import { verifyTelebirr } from "./verifyTelebirr";
import { verifyCBE } from "./verifyCBE";
import { verifyDashen } from "./verifyDashen";
import { verifyAbyssinia } from "./verifyAbyssinia";
import { verifyCBEBirr } from "./verifyCBEBirr";
import { verifyMpesa } from "./verifyMpesa";
import { scoreFraudRisk } from "./fraudScoring";
import dotenv from "dotenv";

dotenv.config();

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/bmp",
    "image/tiff"
]);

const upload = multer({
    dest: "uploads/",
    limits: {
        fileSize: 10 * 1024 * 1024,
    },
});

type ReceiptType = "cbe" | "cbe_birr" | "telebirr" | "dashen" | "abyssinia" | "mpesa";

interface ReceiptDetection {
    bank: ReceiptType;
    reference: string;
    referenceLabel: string;
    confidence: "high" | "medium" | "low";
    source: "local-ocr" | "mistral";
    orderId?: string;
    receiptNumber?: string;
    extraParams?: {
        accountSuffix?: string;
        suffix?: string;
        phoneNumber?: string;
    };
    missingParams?: string[];
}

// ─── Local OCR Detection ───────────────────────────────────────────────────────

function detectFromText(rawText: string): ReceiptDetection | null {
    const text = rawText.toUpperCase();
    const originalText = rawText; // Keep original case for some patterns

    // Keyword sets for each bank
    const cbeKeywords = /VAT\s+INVOICE\s*\/?\s*CUSTOMER\s+RECEIPT|REFERENCE\s+NO\.?\s*\(VAT/i.test(text);
    const cbeBirrKeywords = /CBEBIR|CBE\s*BIR|ORDER\s+ID/i.test(text); // More flexible: "CBEBir" (OCR drops last r)
    const telebirrKeywords = /TELEBIR|ETHIO\s*TELECOM|PAYER\s+TELEBIR/i.test(text); // More flexible: "telebir" without trailing r
    const dashenKeywords = /DASHEN\s*BANK|DASHEN\s*SUPERAPP|SUCCESSFULLY\s+PAID|FT\s*REF/i.test(text);
    const abyssiniaKeywords = /BANK\s+OF\s+ABYSSINIA|ABYSETAA|ABYSSINIA/i.test(text);
    const mpesaKeywords = /M[\-\s]*PESA|SAFARICOM|MOBILE\s+FINANCIAL\s+SERVICES/i.test(text);

    // Abyssinia app receipt has a unique layout: "Acknowledgement" + "Source Account" + "Transaction Reference"
    // This is important because Abyssinia receipts often mention "Commercial Bank of Ethiopia" as the RECEIVER bank
    const abyssiniaLayoutPattern = /ACKNOWLEDGEMENT|SOURCE\s+ACCOUNT\s+NAME/i.test(text)
        && /TRANSACTION\s+REFERENCE/i.test(text);

    // ── M-Pesa ──
    if (mpesaKeywords) {
        const txMatch = text.match(/TRANSACTION\s+(?:NUMBER|ID)\s*:?\s*([A-Z0-9]{8,12})/);
        const receiptMatch = text.match(/RECEIPT\s+NO\s*:?\s*([A-Z0-9]{10,14})/);
        const ref = txMatch?.[1] || receiptMatch?.[1];
        if (ref) {
            return {
                bank: "mpesa",
                reference: ref,
                referenceLabel: txMatch ? "Transaction Number" : "Receipt No",
                confidence: "high",
                source: "local-ocr"
            };
        }
    }

    // ── CBE Birr (must check BEFORE CBE since both mention "Commercial Bank of Ethiopia") ──
    if (cbeBirrKeywords) {
        // Order ID pattern: DAH113N6ISR — OCR may garble to DAHITINBSR etc.
        const orderIdMatch = text.match(/ORDER\s+ID\s*:?\s*([A-Z0-9]{8,14})/);
        const receiptMatch = text.match(/RECEIPT\s+NUMBER\s*:?\s*([A-Z0-9]{8,14})/);
        // Also look for DAH-prefix pattern specific to CBE Birr order IDs
        const dahPattern = text.match(/\b(DAH[A-Z0-9]{6,11})\b/);
        const orderId = sanitizeReferenceCandidate(orderIdMatch?.[1]) || sanitizeReferenceCandidate(dahPattern?.[1]);
        const receiptNumber = sanitizeReferenceCandidate(receiptMatch?.[1]);
        const ref = orderId || receiptNumber;
        if (ref) {
            const phoneNumber = extractEthiopianPhone(originalText);
            return {
                bank: "cbe_birr",
                reference: ref,
                referenceLabel: orderId ? "Order ID" : "Receipt Number",
                confidence: "high",
                source: "local-ocr",
                orderId,
                receiptNumber,
                extraParams: phoneNumber ? { phoneNumber } : undefined,
                missingParams: phoneNumber ? undefined : ["phoneNumber"]
            };
        }
    }

    // ── Telebirr ──
    if (telebirrKeywords && !cbeKeywords) {
        // 1. URL-based extraction: Tesseract often reads the URL at the bottom of the receipt
        //    e.g. "https://transactioninfo.ethiotelecom.et/receipt/CIP240YHNO"
        const urlMatch = originalText.match(/(?:transactioninfo\.ethiotelecom\.et\/receipt\/)([A-Za-z0-9]+)/i);
        // 2. Invoice No pattern: CIP240YHNO — try the label
        const invoiceMatch = text.match(/INVOICE\s+NO\.?\s*:?\s*([A-Z0-9]{8,14})/);
        // 3. CE/CIP-prefix pattern for telebirr: must contain both letters and digits
        const cipMatch = text.match(/\b(CIP[A-Z0-9]{5,11})\b/);
        const ceMatch = text.match(/\b(C[A-Z]{2}\d[A-Z0-9]{4,10})\b/) || text.match(/\b(C[A-Z]{1,2}[A-Z0-9]*\d[A-Z0-9]*)\b/);
        const ref = urlMatch?.[1]?.toUpperCase() || invoiceMatch?.[1] || cipMatch?.[1] || ceMatch?.[1];
        if (ref && ref.length >= 8 && /\d/.test(ref)) {
            return {
                bank: "telebirr",
                reference: ref,
                referenceLabel: "Invoice No",
                confidence: urlMatch ? "high" : "high",
                source: "local-ocr"
            };
        }
        // Telebirr identified but reference couldn't be extracted cleanly
        return {
            bank: "telebirr",
            reference: "",
            referenceLabel: "Invoice No",
            confidence: "medium",
            source: "local-ocr",
            missingParams: ["reference"]
        };
    }

    // ── Dashen ──
    if (dashenKeywords) {
        const ftRefMatch = text.match(/FT\s*REF\s*:?\s*([A-Z0-9]{10,20})/);
        if (ftRefMatch?.[1]) {
            return {
                bank: "dashen",
                reference: ftRefMatch[1],
                referenceLabel: "FT Ref",
                confidence: "high",
                source: "local-ocr"
            };
        }
    }

    // ── FT-prefix references: Abyssinia vs CBE ──
    // Both use FT-prefixed 12-char references. Disambiguate using context.
    const ftMatches = [...text.matchAll(/\bFT[A-Z0-9]{8,14}\b/g)].map((m) => m[0]);
    // Also try to find garbled FT references:
    // - OCR may read T as r, 7, I, or 1 (e.g. Fr2s1498R508 instead of FT25149BR505)
    // - Only use original (case-sensitive) text for garbled matching
    const ftGarbled = [...originalText.matchAll(/\bF[rR7tTI1][A-Za-z0-9]{8,14}\b/g)]
        .map((m) => m[0].toUpperCase().replace(/^F[^T]/i, 'FT'));
    const allFtCandidates = [...new Set([...ftMatches, ...ftGarbled])];
    const bestFt = chooseBestReference(ftMatches, 12) || chooseBestReference(allFtCandidates, 12);

    if (bestFt) {
        // Abyssinia layout detection takes priority (Abyssinia receipts often say "Commercial Bank of Ethiopia" as receiver)
        if (abyssiniaLayoutPattern || (abyssiniaKeywords && !cbeBirrKeywords)) {
            return {
                bank: "abyssinia",
                reference: bestFt,
                referenceLabel: "Transaction Reference",
                confidence: abyssiniaLayoutPattern ? "high" : "medium",
                source: "local-ocr",
                missingParams: ["accountNumber"]
            };
        }
        // Only CBE keywords, not Abyssinia
        if (cbeKeywords && !abyssiniaKeywords && !abyssiniaLayoutPattern) {
            return {
                bank: "cbe",
                reference: bestFt,
                referenceLabel: "Reference No",
                confidence: "high",
                source: "local-ocr",
                missingParams: ["accountNumber"]
            };
        }
        // Default: if FT reference found but can't disambiguate, default to CBE
        return {
            bank: "cbe",
            reference: bestFt,
            referenceLabel: "Reference No",
            confidence: "medium",
            source: "local-ocr",
            missingParams: ["accountNumber"]
        };
    }

    // ── Telebirr as last-resort (if telebirr keywords matched but no good ref found above) ──
    if (telebirrKeywords) {
        // Try to find any CE-like reference with digits
        const ceMatches = [...text.matchAll(/\b(C[A-Z]{1,2}[A-Z0-9]*\d[A-Z0-9]*)\b/g)]
            .map((m) => m[1])
            .filter(r => r.length >= 8 && r.length <= 14 && /\d/.test(r));
        const bestCe = chooseBestReference(ceMatches);
        if (bestCe) {
            return {
                bank: "telebirr",
                reference: bestCe,
                referenceLabel: "Invoice No",
                confidence: "medium",
                source: "local-ocr"
            };
        }
    }

    return null;
}

function chooseBestReference(matches: string[], preferredLength?: number): string | null {
    if (!matches.length) return null;
    if (preferredLength) {
        const exact = matches.find((m) => m.length === preferredLength);
        if (exact) return exact;
    }
    return matches.sort((a, b) => b.length - a.length)[0];
}

function sanitizeReferenceCandidate(value?: string | null): string | undefined {
    if (!value) return undefined;
    const cleaned = value.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (!cleaned || !/\d/.test(cleaned)) return undefined;
    return cleaned;
}

// ─── OCR Character Correction ──────────────────────────────────────────────────

function normalizeEthiopianPhone(raw: string): string | null {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return null;

    if (digits.startsWith("251") && digits.length === 12) return digits;
    if (digits.startsWith("09") && digits.length === 10) return `251${digits.slice(1)}`;
    if (digits.startsWith("9") && digits.length === 9) return `251${digits}`;

    return null;
}

function extractEthiopianPhone(text: string): string | null {
    const patterns = [
        /DEBIT\s+ACCOUNT[^\d]*(\+?2519\d{8}|09\d{8}|9\d{8})/i,
        /PHONE\s*(?:NUMBER|NO)?[^\d]*(\+?2519\d{8}|09\d{8}|9\d{8})/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const normalized = normalizeEthiopianPhone(match[1]);
        if (normalized) return normalized;
    }

    const fallback = text.match(/(\+?2519\d{8}|09\d{8}|9\d{8})/);
    return fallback ? normalizeEthiopianPhone(fallback[1]) : null;
}

function generateReferenceCandidates(reference: string): string[] {
    const candidates = new Set<string>([reference]);
    const chars = reference.toUpperCase().split("");

    const substitutions: Record<string, string[]> = {
        "0": ["O"], "O": ["0"],
        "1": ["I", "L"], "I": ["1"], "L": ["1"],
        "5": ["S"], "S": ["5"],
        "8": ["B"], "B": ["8"],
        "2": ["Z"], "Z": ["2"],
        "6": ["G"], "G": ["6"],
    };

    for (let i = 0; i < chars.length; i++) {
        const options = substitutions[chars[i]];
        if (!options) continue;
        for (const option of options) {
            const copy = [...chars];
            copy[i] = option;
            candidates.add(copy.join(""));
        }
    }
    return [...candidates];
}

function generateO0Candidates(reference: string): string[] {
    const candidates = new Set<string>([reference]);
    const chars = reference.toUpperCase().split("");

    for (let i = 0; i < chars.length; i++) {
        if (chars[i] !== "0" && chars[i] !== "O") continue;
        const copy = [...chars];
        copy[i] = chars[i] === "0" ? "O" : "0";
        candidates.add(copy.join(""));
    }

    return [...candidates];
}

const MAX_O0_RETRIES = 6;

function getO0RetryCandidates(reference: string, source: ReceiptDetection["source"]): string[] {
    if (source !== "local-ocr") return [reference];
    const candidates = generateO0Candidates(reference);
    return candidates.length > MAX_O0_RETRIES
        ? candidates.slice(0, MAX_O0_RETRIES)
        : candidates;
}

// ─── Local OCR Runner ──────────────────────────────────────────────────────────

async function detectWithLocalOcr(filePath: string): Promise<ReceiptDetection | null> {
    try {
        const ocrResult = await Tesseract.recognize(filePath, "eng");
        const text = ocrResult.data?.text || "";
        logger.info("Local OCR complete", {
            chars: text.length,
            confidence: ocrResult.data?.confidence
        });
        return detectFromText(text);
    } catch (error) {
        logger.error("Local OCR failed", {
            error: error instanceof Error ? error.message : String(error)
        });
        return null;
    }
}

async function extractPhoneFromImage(filePath: string): Promise<string | null> {
    try {
        const ocrResult = await Tesseract.recognize(filePath, "eng");
        const text = ocrResult.data?.text || "";
        return extractEthiopianPhone(text);
    } catch (error) {
        logger.warn("Phone OCR extraction failed", {
            error: error instanceof Error ? error.message : String(error)
        });
        return null;
    }
}

// ─── Mistral Vision Detection ──────────────────────────────────────────────────

async function detectWithMistral(base64Image: string): Promise<ReceiptDetection | null> {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) return null;

    try {
        const client = new Mistral({ apiKey });

        const prompt = `
You are an Ethiopian payment receipt analyzer. Analyze the uploaded image and identify which bank/payment provider it belongs to, then extract the key reference number used for verification.

## Banks and their visual characteristics:

1. **CBE (Commercial Bank of Ethiopia)** — Two variants:
   - Full receipt: Purple header, "Commercial Bank of Ethiopia", "VAT Invoice / Customer Receipt", table layout
   - QR receipt: Green "Success" banner, message text with "transaction ID: FTxxxx", QR code, "Commercial Bank of Ethiopia" at bottom
   - Reference label: "Reference No. (VAT Invoice No)" or "transaction ID"
   - Reference format: Starts with "FT", 12 characters (e.g. FT25188Y8622)
   - Extra needed: accountSuffix (last 8 digits of sender's account)

2. **CBE Birr** — Purple header like CBE but with "CBEBirr" subtitle and "CBE Birr" logo:
   - Reference label: "Order ID" (e.g. DAH113N6ISR)
   - Also has "Receipt Number" in Transaction Details
   - Extra needed: phoneNumber (sender's phone, NOT visible on receipt)

3. **Telebirr** — Ethio Telecom + Telebirr logos, bilingual Amharic/English:
   - Reference label: "Invoice No." or "የክፍያ ቁጥር"
   - Reference format: alphanumeric like CIP240YHNO
   - No extra params needed

4. **Dashen Bank** — Two variants:
   - Formal receipt: Blue "Dashen Bank Electronic Receipt" header, structured tables
   - App receipt: Green checkmark, "Successfully paid!", Dashen Bank watermark
    - If the receipt is the "Electronic Receipt" style, use "Transaction Reference"
    - If the receipt shows an "FT Ref" label, use "FT Ref"
    - Use "Transaction ID" only if neither Transaction Reference nor FT Ref is visible
   - No extra params needed

5. **Bank of Abyssinia** — Golden/yellow theme, "Bank of Abyssinia" / "አቢሲንያ ባንክ":
   - Reference label: "Transaction Reference"
   - Reference format: Starts with "FT", 12 characters (e.g. FT26112L1FGQ)
   - Extra needed: suffix (last 5 digits of sender's account)

6. **M-Pesa (Safaricom)** — Two variants:
   - App receipt: Green theme, "M-PESA" stamp, simple card
   - Formal receipt: "Safaricom M-PESA Mobile Financial Services" header, QR code
   - Reference label: "Transaction number" or "TRANSACTION ID" or "RECEIPT NO"
   - No extra params needed

## Instructions:
- Identify the bank based on visual appearance, logos, colors, and text
- Extract the primary reference/ID used for verification
- For Dashen, use Transaction Reference for Electronic Receipt style; use FT Ref when that label is present; only use Transaction ID if neither appears
- If you can see partial account numbers (masked like 1****2751), extract visible digits
- Return ONLY valid JSON

## Response format:
{
  "bank": "cbe" | "cbe_birr" | "telebirr" | "dashen" | "abyssinia" | "mpesa",
  "reference": "THE_REFERENCE_NUMBER",
  "referenceLabel": "what the receipt calls this field",
  "confidence": "high" | "medium" | "low",
  "partialAccountDigits": "visible digits if any, e.g. '2751' from '1****2751'"
}
`.trim();

        logger.info("Falling back to Mistral Vision for multi-bank receipt analysis...");

        const chatResponse = await client.chat.complete({
            model: "pixtral-12b",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        {
                            type: "image_url",
                            imageUrl: `data:image/jpeg;base64,${base64Image}`,
                        },
                    ],
                },
            ],
            responseFormat: { type: "json_object" },
        });

        const messageContent = chatResponse.choices?.[0]?.message?.content;
        if (!messageContent || typeof messageContent !== "string") {
            logger.error("Invalid Mistral response", { messageContent });
            return null;
        }

        const result = JSON.parse(messageContent) as {
            bank?: ReceiptType;
            reference?: string | Record<string, string>;
            referenceLabel?: string | Record<string, string>;
            confidence?: "high" | "medium" | "low";
            partialAccountDigits?: string;
        };

        let orderId: string | undefined;
        let receiptNumber: string | undefined;
        let reference: string | undefined;
        let referenceLabel = "Reference";

        if (typeof result.reference === "string") {
            reference = result.reference.trim();
        } else if (result.reference && typeof result.reference === "object") {
            const refObj = result.reference as Record<string, string>;
            orderId = sanitizeReferenceCandidate(refObj.orderID || refObj.orderId || refObj.order_id);
            receiptNumber = sanitizeReferenceCandidate(refObj.receiptNumber || refObj.receipt_number);
            reference = orderId || receiptNumber;
        }

        if (typeof result.referenceLabel === "string") {
            referenceLabel = result.referenceLabel;
        } else if (result.referenceLabel && typeof result.referenceLabel === "object") {
            const labelObj = result.referenceLabel as Record<string, string>;
            if (orderId) referenceLabel = labelObj.orderID || labelObj.orderId || labelObj.order_id || "Order ID";
            if (!orderId && receiptNumber) referenceLabel = labelObj.receiptNumber || labelObj.receipt_number || "Receipt Number";
        }

        if (!result.bank || !reference) {
            return null;
        }

        // Determine missing params based on bank type
        const missingParams: string[] = [];
        if (result.bank === "cbe") missingParams.push("accountNumber");
        if (result.bank === "abyssinia") missingParams.push("accountNumber");
        if (result.bank === "cbe_birr") missingParams.push("phoneNumber");

        return {
            bank: result.bank,
            reference,
            referenceLabel,
            confidence: result.confidence || "medium",
            source: "mistral",
            orderId,
            receiptNumber,
            missingParams: missingParams.length > 0 ? missingParams : undefined
        };
    } catch (error) {
        logger.error("Mistral OCR fallback failed", {
            error: error instanceof Error ? error.message : String(error)
        });
        return null;
    }
}

// ─── Bank-specific parameter requirements ──────────────────────────────────────

const BANK_PARAM_INFO: Record<ReceiptType, { requiredExtra: string[]; paramDescriptions: Record<string, string> }> = {
    cbe: {
        requiredExtra: ["accountNumber"],
        paramDescriptions: { accountNumber: "Sender's bank account number (full number — last 8 digits will be used)" }
    },
    cbe_birr: {
        requiredExtra: ["phoneNumber"],
        paramDescriptions: { phoneNumber: "Sender's phone number in 251XXXXXXXXX format" }
    },
    telebirr: { requiredExtra: [], paramDescriptions: {} },
    dashen: { requiredExtra: [], paramDescriptions: {} },
    abyssinia: {
        requiredExtra: ["accountNumber"],
        paramDescriptions: { accountNumber: "Sender's bank account number (full number — last 5 digits will be used)" }
    },
    mpesa: { requiredExtra: [], paramDescriptions: {} }
};

// ─── Main Handler ──────────────────────────────────────────────────────────────

export const verifyImageHandler = [
    upload.single("file"),

    async (req: Request, res: Response): Promise<void> => {
        let persistedImagePath: string | null = null;
        try {
            const autoVerify = req.query.autoVerify === "true";
            const debugVision = req.query.debugVision === "true" || process.env.IMAGE_VERIFY_DEBUG_MISTRAL === "true";
            // Accept optional extra params from the form data
            // Accept full account number and splice it later per-bank
            const accountNumber = req.body?.accountNumber || req.body?.suffix || req.body?.accountSuffix || null;
            const phoneNumber = req.body?.phoneNumber || null;

            if (!req.file) {
                logger.warn("No file uploaded");
                res.status(400).json({ error: "No file uploaded" });
                return;
            }

            const tempPath = req.file.path;
            const authReq = req as AuthenticatedRequest;

            if (!SUPPORTED_IMAGE_MIME_TYPES.has(req.file.mimetype)) {
                res.status(400).json({
                    error: "Unsupported image format",
                    details: `Received ${req.file.mimetype}. Use JPG, PNG, WEBP, BMP, or TIFF.`
                });
                return;
            }

            const filePath = tempPath;
            const imageBuffer = fs.readFileSync(filePath);
            const base64Image = imageBuffer.toString("base64");

            // Two-stage detection: fast local OCR first, then Mistral Vision fallback
            let result = await detectWithLocalOcr(filePath);
            let visionResult: ReceiptDetection | null = null;
            if (!result) {
                result = await detectWithMistral(base64Image);
            } else if (result.bank === "dashen" || result.bank === "telebirr") {
                visionResult = await detectWithMistral(base64Image);
                if (visionResult && visionResult.bank === result.bank && visionResult.reference) {
                    result = visionResult;
                }
            }

            if (!result) {
                res.status(422).json({
                    error: "Could not identify the receipt or extract a valid reference",
                    hint: "Try a clearer image, better crop, or ensure MISTRAL_API_KEY is set for AI-powered extraction",
                    supportedBanks: ["CBE", "CBE Birr", "Telebirr", "Dashen", "Bank of Abyssinia", "M-Pesa"]
                });
                return;
            }

            if (result.bank === "cbe_birr" && !result.extraParams?.phoneNumber) {
                const phoneFromOcr = await extractPhoneFromImage(filePath);
                if (phoneFromOcr) {
                    result.extraParams = { ...(result.extraParams || {}), phoneNumber: phoneFromOcr };
                    if (result.missingParams) {
                        result.missingParams = result.missingParams.filter(p => p !== "phoneNumber");
                        if (!result.missingParams.length) result.missingParams = undefined;
                    }
                }
            }

            if (debugVision && !visionResult) {
                visionResult = result.source === "mistral" ? result : await detectWithMistral(base64Image);
            }
            if (visionResult && debugVision) {
                logger.info("Mistral debug result", {
                    bank: visionResult.bank,
                    reference: visionResult.reference,
                    confidence: visionResult.confidence,
                    source: visionResult.source,
                });
            }

            logger.info("Receipt detected", {
                bank: result.bank,
                reference: result.reference,
                confidence: result.confidence,
                source: result.source
            });

            // Merge user-supplied params with detection
            const suppliedParams = {
                accountNumber,
                phoneNumber: phoneNumber || result?.extraParams?.phoneNumber || null
            };

            // If not auto-verifying, return extraction results with routing info
            if (!autoVerify) {
                const bankInfo = BANK_PARAM_INFO[result.bank];
                const forwardEndpoint = getForwardEndpoint(result.bank);
                const visionPayload = debugVision && visionResult ? {
                    visionBank: visionResult.bank,
                    visionSource: visionResult.source,
                    visionReference: visionResult.reference,
                    visionReferenceLabel: visionResult.referenceLabel,
                    visionConfidence: visionResult.confidence,
                    visionOrderId: visionResult.orderId,
                    visionReceiptNumber: visionResult.receiptNumber,
                } : {};
                res.json({
                    bank: result.bank,
                    source: result.source,
                    confidence: result.confidence,
                    reference: result.reference || null,
                    referenceLabel: result.referenceLabel,
                    orderId: result.orderId,
                    receiptNumber: result.receiptNumber,
                    extractedPhoneNumber: result.extraParams?.phoneNumber,
                    ...visionPayload,
                    forward_to: forwardEndpoint,
                    requiredParams: bankInfo.requiredExtra.length > 0
                        ? bankInfo.paramDescriptions
                        : undefined,
                    missingParams: result.missingParams,
                    hint: !result.reference
                        ? `Bank identified as ${result.bank}, but the reference number could not be extracted. Please provide it manually via ${forwardEndpoint}.`
                        : undefined
                });
                return;
            }

            // Check if we have a reference before attempting auto-verify
            if (!result.reference) {
                res.status(400).json({
                    bank: result.bank,
                    source: result.source,
                    error: "Bank identified but reference number could not be extracted from the image",
                    forward_to: getForwardEndpoint(result.bank),
                    hint: `Use ${getForwardEndpoint(result.bank)} with the reference number to verify manually.`
                });
                return;
            }

            if (autoVerify && authReq.user?.id) {
                try {
                    persistedImagePath = persistUploadedImage(tempPath, req.file.originalname, req.file.mimetype);
                } catch (persistError) {
                    logger.warn('Failed to persist uploaded receipt image', persistError);
                }
            }

            // ── Auto-verify: route to the correct verifier ──
            await routeToVerifier(result, suppliedParams, req, res, persistedImagePath);

        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`Unexpected error in /verify-image: ${message}`, {
                stack: err instanceof Error ? err.stack : undefined,
            });
            res.status(500).json({
                error: "Something went wrong processing the image.",
                details: message
            });
        } finally {
            if (req.file?.path && !persistedImagePath) {
                try {
                    fs.unlinkSync(req.file.path);
                    logger.debug("Temp file deleted", { path: req.file.path });
                } catch (cleanupErr) {
                    logger.warn("Failed to delete temp file", {
                        path: req.file.path,
                        error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
                    });
                }
            }
        }
    },
];

// ─── Routing Logic ─────────────────────────────────────────────────────────────

function getForwardEndpoint(bank: ReceiptType): string {
    const map: Record<ReceiptType, string> = {
        cbe: "/verify-cbe",
        cbe_birr: "/verify-cbebirr",
        telebirr: "/verify-telebirr",
        dashen: "/verify-dashen",
        abyssinia: "/verify-abyssinia",
        mpesa: "/verify-mpesa"
    };
    return map[bank];
}

function getImageExtension(originalName: string, mimeType: string): string {
    const mimeMap: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/bmp": "bmp",
        "image/tiff": "tiff"
    };

    if (mimeMap[mimeType]) return mimeMap[mimeType];

    const ext = path.extname(originalName || "").replace(".", "").toLowerCase();
    if (ext && ext.length <= 5) return ext;

    return "jpg";
}

function persistUploadedImage(tempPath: string, originalName: string, mimeType: string): string {
    const uploadsDir = path.join(process.cwd(), "uploads", "history");
    fs.mkdirSync(uploadsDir, { recursive: true });

    const ext = getImageExtension(originalName, mimeType);
    const stamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const filename = `receipt-${stamp}-${random}.${ext}`;
    const targetPath = path.join(uploadsDir, filename);

    fs.renameSync(tempPath, targetPath);
    return path.relative(process.cwd(), targetPath).replace(/\\/g, "/");
}

async function maybeLogImageVerification(
    req: Request,
    bank: string,
    reference: string,
    requestPayload: Record<string, unknown>,
    responsePayload: Record<string, unknown>,
    imagePath: string | null,
    verified: boolean,
    error?: string
): Promise<void> {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user?.id) return;

    try {
        await logVerification({
            userId: authReq.user.id,
            bank,
            method: 'IMAGE',
            endpoint: '/verify-image',
            requestPayload,
            responsePayload,
            status: verified ? 'SUCCESS' : 'FAILED',
            reference,
            imagePath,
            error: verified ? null : error || 'Verification failed'
        });
    } catch (logError) {
        logger.warn('Failed to log image verification record', logError);
    }
}

async function routeToVerifier(
    detection: ReceiptDetection,
    suppliedParams: { accountNumber: string | null; phoneNumber: string | null },
    req: Request,
    res: Response,
    imagePath: string | null
): Promise<void> {
    const { bank, reference, source } = detection;

    try {
        switch (bank) {
            // ── Telebirr: no extra params needed ──
            case "telebirr": {
                const referencesToTry = getO0RetryCandidates(reference, source);
                let usedReference = reference;
                let data = await verifyTelebirr(usedReference);

                for (const candidate of referencesToTry) {
                    if (candidate === usedReference) continue;
                    if (data) break;
                    const retry = await verifyTelebirr(candidate);
                    if (retry) {
                        usedReference = candidate;
                        data = retry;
                        break;
                    }
                }
                if (!data) {
                    res.status(404).json({ error: "Telebirr receipt not found or could not be processed." });
                    return;
                }
                // Path B: AI fraud scoring
                const fraudResult = await scoreFraudRisk({
                    bank: "telebirr",
                    reference: usedReference,
                    amount: parseFloat(data.settledAmount?.replace(/[^\d.]/g, '') || '0'),
                    payer_name: data.payerName,
                    payer_account: data.payerTelebirrNo,
                    receiver_name: data.creditedPartyName,
                    receiver_account: data.creditedPartyAccountNo,
                    transaction_date: data.paymentDate,
                    transaction_status: data.transactionStatus,
                });
                res.json({
                    verified: true,
                    bank: "telebirr",
                    source,
                    reference: usedReference,
                    details: data,
                    fraudAnalysis: fraudResult,
                });
                await maybeLogImageVerification(
                    req,
                    'telebirr',
                    usedReference,
                    { source, suppliedParams },
                    { details: data, fraudAnalysis: fraudResult },
                    imagePath,
                    true
                );
                return;
            }

            // ── Dashen: no extra params needed ──
            case "dashen": {
                const referencesToTry = getO0RetryCandidates(reference, source);

                let usedReference = reference;
                let data = await verifyDashen(usedReference);

                for (const candidate of referencesToTry) {
                    if (candidate === usedReference) continue;
                    if (data.success) break;
                    const retry = await verifyDashen(candidate);
                    if (retry.success) {
                        usedReference = candidate;
                        data = retry;
                        break;
                    }
                }
                // Path B: AI fraud scoring
                const fraudResult = data.success ? await scoreFraudRisk({
                    bank: "dashen",
                    reference: usedReference,
                    amount: data.transactionAmount || data.total || 0,
                    payer_name: data.senderName || '',
                    receiver_name: data.receiverName || '',
                    transaction_date: data.transactionDate?.toISOString() || '',
                }) : null;
                const payload = {
                    verified: data.success,
                    bank: "dashen",
                    source,
                    reference: usedReference,
                    details: data,
                    fraudAnalysis: fraudResult,
                    suggestion: data.success ? undefined : "Verification failed. Confirm the reference and try /verify-dashen directly."
                };
                res.json(payload);
                await maybeLogImageVerification(
                    req,
                    'dashen',
                    usedReference,
                    { source, suppliedParams },
                    payload,
                    imagePath,
                    data.success,
                    data.success ? undefined : data.error
                );
                return;
            }

            // ── M-Pesa: no extra params needed ──
            case "mpesa": {
                const referencesToTry = getO0RetryCandidates(reference, source);
                let usedReference = reference;
                let data = await verifyMpesa(usedReference);

                for (const candidate of referencesToTry) {
                    if (candidate === usedReference) continue;
                    if (data.success) break;
                    const retry = await verifyMpesa(candidate);
                    if (retry.success) {
                        usedReference = candidate;
                        data = retry;
                        break;
                    }
                }
                // Path B: AI fraud scoring
                const fraudResult = data.success ? await scoreFraudRisk({
                    bank: "mpesa",
                    reference: usedReference,
                    amount: data.amount || 0,
                    payer_name: data.payerName || '',
                    payer_account: data.payerAccount || '',
                    receiver_name: data.receiverName || '',
                    receiver_account: data.receiverAccount || '',
                    transaction_date: data.paymentDate?.toISOString() || '',
                }) : null;
                const payload = {
                    verified: data.success,
                    bank: "mpesa",
                    source,
                    reference: usedReference,
                    details: data,
                    fraudAnalysis: fraudResult,
                    suggestion: data.success ? undefined : "Verification failed. Confirm the receipt number and try /verify-mpesa directly."
                };
                res.json(payload);
                await maybeLogImageVerification(
                    req,
                    'mpesa',
                    usedReference,
                    { source, suppliedParams },
                    payload,
                    imagePath,
                    data.success,
                    data.success ? undefined : data.error
                );
                return;
            }

            // ── CBE: needs account number (last 8 digits used as suffix) ──
            case "cbe": {
                if (!suppliedParams.accountNumber) {
                    res.status(400).json({
                        bank: "cbe",
                        source,
                        reference,
                        error: "CBE verification requires the sender's account number",
                        missingParams: {
                            accountNumber: "Sender's bank account number. The last 8 digits will be used for verification."
                        },
                        hint: "Re-submit with the 'accountNumber' field in your form data, or call /verify-cbe directly."
                    });
                    return;
                }

                // Splice: take last 8 digits from the full account number
                const cbeAccountSuffix = suppliedParams.accountNumber.replace(/\D/g, '').slice(-8);
                if (cbeAccountSuffix.length < 8) {
                    res.status(400).json({
                        bank: "cbe",
                        error: "Account number must be at least 8 digits",
                    });
                    return;
                }

                const referencesToTry = source === "local-ocr"
                    ? generateReferenceCandidates(reference)
                    : [reference];

                let usedReference = reference;
                let data = await verifyCBE(usedReference, cbeAccountSuffix);

                for (const candidate of referencesToTry) {
                    if (candidate === usedReference) continue;
                    if (data.success) break;
                    const retry = await verifyCBE(candidate, cbeAccountSuffix);
                    if (retry.success) {
                        usedReference = candidate;
                        data = retry;
                        break;
                    }
                }

                // Path B: AI fraud scoring
                const cbeF = data.success ? await scoreFraudRisk({
                    bank: "cbe",
                    reference: usedReference,
                    amount: data.amount || 0,
                    payer_name: data.payer || '',
                    payer_account: data.payerAccount || '',
                    receiver_name: data.receiver || '',
                    receiver_account: data.receiverAccount || '',
                    transaction_date: data.date?.toISOString() || '',
                    suffix: cbeAccountSuffix,
                }) : null;
                const payload = {
                    verified: data.success,
                    bank: "cbe",
                    source,
                    reference: usedReference,
                    details: data,
                    fraudAnalysis: cbeF,
                    suggestion: data.success ? undefined : "Verification failed. Confirm the account number and reference, then try /verify-cbe directly."
                };
                res.json(payload);
                await maybeLogImageVerification(
                    req,
                    'cbe',
                    usedReference,
                    { source, suppliedParams },
                    payload,
                    imagePath,
                    data.success,
                    data.success ? undefined : data.error
                );
                return;
            }

            // ── Abyssinia: needs account number (last 5 digits used as suffix) ──
            case "abyssinia": {
                if (!suppliedParams.accountNumber) {
                    res.status(400).json({
                        bank: "abyssinia",
                        source,
                        reference,
                        error: "Bank of Abyssinia verification requires the sender's account number",
                        missingParams: {
                            accountNumber: "Sender's bank account number. The last 5 digits will be used for verification."
                        },
                        hint: "Re-submit with the 'accountNumber' field in your form data, or call /verify-abyssinia directly."
                    });
                    return;
                }

                // Splice: take last 5 digits from the full account number
                const abySuffix = suppliedParams.accountNumber.replace(/\D/g, '').slice(-5);
                if (abySuffix.length < 5) {
                    res.status(400).json({
                        bank: "abyssinia",
                        error: "Account number must be at least 5 digits",
                    });
                    return;
                }

                const data = await verifyAbyssinia(reference, abySuffix);
                // Path B: AI fraud scoring
                const abyF = data.success ? await scoreFraudRisk({
                    bank: "abyssinia",
                    reference,
                    amount: data.amount || 0,
                    payer_name: data.payer || '',
                    receiver_name: data.receiver || '',
                    transaction_date: data.date?.toISOString() || '',
                    suffix: abySuffix,
                }) : null;
                const payload = {
                    verified: data.success,
                    bank: "abyssinia",
                    source,
                    reference,
                    details: data,
                    fraudAnalysis: abyF,
                    suggestion: data.success ? undefined : "Verification failed. Confirm the account number and reference, then try /verify-abyssinia directly."
                };
                res.json(payload);
                await maybeLogImageVerification(
                    req,
                    'abyssinia',
                    reference,
                    { source, suppliedParams },
                    payload,
                    imagePath,
                    data.success,
                    data.success ? undefined : data.error
                );
                return;
            }

            // ── CBE Birr: needs phoneNumber ──
            case "cbe_birr": {
                if (!suppliedParams.phoneNumber) {
                    res.status(400).json({
                        bank: "cbe_birr",
                        source,
                        reference,
                        error: "CBE Birr verification requires the sender's phone number",
                        missingParams: {
                            phoneNumber: "Sender's phone number in 251XXXXXXXXX format (10-12 digits starting with 251). Pass as 'phoneNumber' in the form data."
                        },
                        hint: "Re-submit with the 'phoneNumber' field in your form data, or call /verify-cbebirr directly."
                    });
                    return;
                }

                const referencesToTry = getO0RetryCandidates(reference, source);
                let usedReference = reference;
                let data = await verifyCBEBirr(usedReference, suppliedParams.phoneNumber);
                let cbeBirrVerified = !("success" in data && data.success === false);

                for (const candidate of referencesToTry) {
                    if (candidate === usedReference) continue;
                    if (cbeBirrVerified) break;
                    const retry = await verifyCBEBirr(candidate, suppliedParams.phoneNumber);
                    const retryVerified = !("success" in retry && retry.success === false);
                    if (retryVerified) {
                        usedReference = candidate;
                        data = retry;
                        cbeBirrVerified = retryVerified;
                        break;
                    }
                }
                // Path B: AI fraud scoring
                const cbeBirrF = cbeBirrVerified ? await scoreFraudRisk({
                    bank: "cbe_birr",
                    reference: usedReference,
                    amount: (data as any)?.amount || 0,
                    payer_name: (data as any)?.payerName || '',
                    phone_number: suppliedParams.phoneNumber,
                }) : null;
                const payload = {
                    verified: cbeBirrVerified,
                    bank: "cbe_birr",
                    source,
                    reference: usedReference,
                    details: data,
                    fraudAnalysis: cbeBirrF,
                };
                res.json(payload);
                await maybeLogImageVerification(
                    req,
                    'cbe_birr',
                    usedReference,
                    { source, suppliedParams },
                    payload,
                    imagePath,
                    cbeBirrVerified,
                    cbeBirrVerified ? undefined : (data as { error?: string }).error
                );
                return;
            }

            default: {
                res.status(422).json({ error: "Unknown or unsupported receipt type detected" });
                return;
            }
        }
    } catch (verifyErr: any) {
        logger.error(`${bank} verification failed`, { verifyErr });

        if (verifyErr.name === "TelebirrVerificationError") {
            res.status(502).json({ error: verifyErr.message, details: verifyErr.details });
            return;
        }

        res.status(500).json({
            error: `Verification failed for ${bank}`,
            details: verifyErr instanceof Error ? verifyErr.message : String(verifyErr)
        });
    }
}

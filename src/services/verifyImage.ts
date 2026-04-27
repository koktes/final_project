import { Mistral } from "@mistralai/mistralai";
import fs from "fs";
import { Request, Response } from "express";
import multer from "multer";
import Tesseract from "tesseract.js";
import logger from "../utils/logger";
import { verifyTelebirr } from "./verifyTelebirr";
import { verifyCBE } from "./verifyCBE";
import { verifyDashen } from "./verifyDashen";
import { verifyAbyssinia } from "./verifyAbyssinia";
import { verifyCBEBirr } from "./verifyCBEBirr";
import { verifyMpesa } from "./verifyMpesa";
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
    const cbeKeywords = /COMMERCIAL\s+BANK\s+OF\s+ETHIOPIA|VAT\s+INVOICE\s*\/?\s*CUSTOMER\s+RECEIPT|REFERENCE\s+NO\.?\s*\(VAT/i.test(text);
    const cbeBirrKeywords = /CBEBIR|CBE\s*BIR|ORDER\s+ID/i.test(text); // More flexible: "CBEBir" (OCR drops last r)
    const telebirrKeywords = /TELEBIR|ETHIO\s*TELECOM|PAYER\s+TELEBIR/i.test(text); // More flexible: "telebir" without trailing r
    const dashenKeywords = /DASHEN\s*BANK|DASHEN\s*SUPERAPP|SUCCESSFULLY\s+PAID/i.test(text);
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
        const ref = orderIdMatch?.[1] || receiptMatch?.[1] || dahPattern?.[1];
        if (ref) {
            return {
                bank: "cbe_birr",
                reference: ref,
                referenceLabel: orderIdMatch ? "Order ID" : (receiptMatch ? "Receipt Number" : "Order ID"),
                confidence: "high",
                source: "local-ocr",
                missingParams: ["phoneNumber"]
            };
        }
    }

    // ── Telebirr ──
    if (telebirrKeywords && !cbeKeywords) {
        // Invoice No pattern: CIP240YHNO — must contain at least one digit to avoid matching plain words
        const invoiceMatch = text.match(/INVOICE\s+NO\.?\s*:?\s*([A-Z0-9]{8,14})/);
        // CE-prefix pattern for telebirr: must contain both letters and digits (not plain English words)
        const ceMatch = text.match(/\b(C[A-Z]{2}\d[A-Z0-9]{4,10})\b/) || text.match(/\b(C[A-Z]{1,2}[A-Z0-9]*\d[A-Z0-9]*)\b/);
        // Also try to find payer telebirr number as verification input (e.g. 251904440704)
        const payerPhoneMatch = originalText.match(/(251\d{9})/);
        const ref = invoiceMatch?.[1] || ceMatch?.[1];
        if (ref && ref.length >= 8 && /\d/.test(ref)) {
            return {
                bank: "telebirr",
                reference: ref,
                referenceLabel: "Invoice No",
                confidence: "high",
                source: "local-ocr"
            };
        }
        // Telebirr identified but reference couldn't be extracted cleanly
        // Return the bank identification so the user knows which verifier to use
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
        const txIdMatch = text.match(/TRANSACTION\s+ID\s*:?\s*(\d{14,18})/);
        const ftRefMatch = text.match(/FT\s*REF\s*:?\s*([A-Z0-9]{12,20})/);
        const txRefMatch = text.match(/TRANSACTION\s+REFERENCE\s*:?\s*([A-Z0-9]{14,20})/);
        const ref = txIdMatch?.[1] || ftRefMatch?.[1] || txRefMatch?.[1];
        if (ref) {
            return {
                bank: "dashen",
                reference: ref,
                referenceLabel: txIdMatch ? "Transaction ID" : (ftRefMatch ? "FT Ref" : "Transaction Reference"),
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
                missingParams: ["suffix"]
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
                missingParams: ["accountSuffix"]
            };
        }
        // Default: if FT reference found but can't disambiguate, default to CBE
        return {
            bank: "cbe",
            reference: bestFt,
            referenceLabel: "Reference No",
            confidence: "medium",
            source: "local-ocr",
            missingParams: ["accountSuffix"]
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

// ─── OCR Character Correction ──────────────────────────────────────────────────

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
   - Reference label: "Transaction ID" (16-digit numeric) or "FT Ref" or "Transaction reference"
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
            reference?: string;
            referenceLabel?: string;
            confidence?: "high" | "medium" | "low";
            partialAccountDigits?: string;
        };

        if (!result.bank || !result.reference) {
            return null;
        }

        // Determine missing params based on bank type
        const missingParams: string[] = [];
        if (result.bank === "cbe") missingParams.push("accountSuffix");
        if (result.bank === "abyssinia") missingParams.push("suffix");
        if (result.bank === "cbe_birr") missingParams.push("phoneNumber");

        return {
            bank: result.bank,
            reference: result.reference,
            referenceLabel: result.referenceLabel || "Reference",
            confidence: result.confidence || "medium",
            source: "mistral",
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
        requiredExtra: ["accountSuffix"],
        paramDescriptions: { accountSuffix: "Last 8 digits of the sender's bank account number" }
    },
    cbe_birr: {
        requiredExtra: ["phoneNumber"],
        paramDescriptions: { phoneNumber: "Sender's phone number in 251XXXXXXXXX format" }
    },
    telebirr: { requiredExtra: [], paramDescriptions: {} },
    dashen: { requiredExtra: [], paramDescriptions: {} },
    abyssinia: {
        requiredExtra: ["suffix"],
        paramDescriptions: { suffix: "Last 5 digits of the sender's bank account number" }
    },
    mpesa: { requiredExtra: [], paramDescriptions: {} }
};

// ─── Main Handler ──────────────────────────────────────────────────────────────

export const verifyImageHandler = [
    upload.single("file"),

    async (req: Request, res: Response): Promise<void> => {
        try {
            const autoVerify = req.query.autoVerify === "true";
            // Accept optional extra params from the form data
            const accountSuffix = req.body?.suffix || req.body?.accountSuffix || null;
            const phoneNumber = req.body?.phoneNumber || null;

            if (!req.file) {
                logger.warn("No file uploaded");
                res.status(400).json({ error: "No file uploaded" });
                return;
            }

            if (!SUPPORTED_IMAGE_MIME_TYPES.has(req.file.mimetype)) {
                res.status(400).json({
                    error: "Unsupported image format",
                    details: `Received ${req.file.mimetype}. Use JPG, PNG, WEBP, BMP, or TIFF.`
                });
                return;
            }

            const filePath = req.file.path;
            const imageBuffer = fs.readFileSync(filePath);
            const base64Image = imageBuffer.toString("base64");

            // Two-stage detection: fast local OCR first, then Mistral Vision fallback
            let result = await detectWithLocalOcr(filePath);
            if (!result) {
                result = await detectWithMistral(base64Image);
            }

            if (!result) {
                res.status(422).json({
                    error: "Could not identify the receipt or extract a valid reference",
                    hint: "Try a clearer image, better crop, or ensure MISTRAL_API_KEY is set for AI-powered extraction",
                    supportedBanks: ["CBE", "CBE Birr", "Telebirr", "Dashen", "Bank of Abyssinia", "M-Pesa"]
                });
                return;
            }

            logger.info("Receipt detected", {
                bank: result.bank,
                reference: result.reference,
                confidence: result.confidence,
                source: result.source
            });

            // Merge user-supplied params with detection
            const suppliedParams = { accountSuffix, suffix: accountSuffix, phoneNumber };

            // If not auto-verifying, return extraction results with routing info
            if (!autoVerify) {
                const bankInfo = BANK_PARAM_INFO[result.bank];
                const forwardEndpoint = getForwardEndpoint(result.bank);
                res.json({
                    bank: result.bank,
                    source: result.source,
                    confidence: result.confidence,
                    reference: result.reference || null,
                    referenceLabel: result.referenceLabel,
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

            // ── Auto-verify: route to the correct verifier ──
            await routeToVerifier(result, suppliedParams, req, res);

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
            if (req.file?.path) {
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

async function routeToVerifier(
    detection: ReceiptDetection,
    suppliedParams: { accountSuffix: string | null; suffix: string | null; phoneNumber: string | null },
    req: Request,
    res: Response
): Promise<void> {
    const { bank, reference, source } = detection;

    try {
        switch (bank) {
            // ── Telebirr: no extra params needed ──
            case "telebirr": {
                const data = await verifyTelebirr(reference);
                if (!data) {
                    res.status(404).json({ error: "Telebirr receipt not found or could not be processed." });
                    return;
                }
                res.json({
                    verified: true,
                    bank: "telebirr",
                    source,
                    reference,
                    details: data
                });
                return;
            }

            // ── Dashen: no extra params needed ──
            case "dashen": {
                const data = await verifyDashen(reference);
                res.json({
                    verified: data.success,
                    bank: "dashen",
                    source,
                    reference,
                    details: data,
                    suggestion: data.success ? undefined : "Verification failed. Confirm the reference and try /verify-dashen directly."
                });
                return;
            }

            // ── M-Pesa: no extra params needed ──
            case "mpesa": {
                const data = await verifyMpesa(reference);
                res.json({
                    verified: data.success,
                    bank: "mpesa",
                    source,
                    reference,
                    details: data,
                    suggestion: data.success ? undefined : "Verification failed. Confirm the receipt number and try /verify-mpesa directly."
                });
                return;
            }

            // ── CBE: needs accountSuffix (8 digits) ──
            case "cbe": {
                if (!suppliedParams.accountSuffix) {
                    res.status(400).json({
                        bank: "cbe",
                        source,
                        reference,
                        error: "CBE verification requires the sender's account suffix",
                        missingParams: {
                            accountSuffix: "Last 8 digits of the sender's bank account number. Pass as 'suffix' or 'accountSuffix' in the form data."
                        },
                        hint: "Re-submit with the 'suffix' field in your form data, or call /verify-cbe directly."
                    });
                    return;
                }

                const referencesToTry = source === "local-ocr"
                    ? generateReferenceCandidates(reference)
                    : [reference];

                let usedReference = reference;
                let data = await verifyCBE(usedReference, suppliedParams.accountSuffix);

                for (const candidate of referencesToTry) {
                    if (candidate === usedReference) continue;
                    if (data.success) break;
                    const retry = await verifyCBE(candidate, suppliedParams.accountSuffix);
                    if (retry.success) {
                        usedReference = candidate;
                        data = retry;
                        break;
                    }
                }

                res.json({
                    verified: data.success,
                    bank: "cbe",
                    source,
                    reference: usedReference,
                    details: data,
                    suggestion: data.success ? undefined : "Verification failed. Confirm the account suffix and reference, then try /verify-cbe directly."
                });
                return;
            }

            // ── Abyssinia: needs suffix (5 digits) ──
            case "abyssinia": {
                if (!suppliedParams.suffix) {
                    res.status(400).json({
                        bank: "abyssinia",
                        source,
                        reference,
                        error: "Bank of Abyssinia verification requires the sender's account suffix",
                        missingParams: {
                            suffix: "Last 5 digits of the sender's bank account number. Pass as 'suffix' in the form data."
                        },
                        hint: "Re-submit with the 'suffix' field in your form data, or call /verify-abyssinia directly."
                    });
                    return;
                }

                const data = await verifyAbyssinia(reference, suppliedParams.suffix);
                res.json({
                    verified: data.success,
                    bank: "abyssinia",
                    source,
                    reference,
                    details: data,
                    suggestion: data.success ? undefined : "Verification failed. Confirm the suffix and reference, then try /verify-abyssinia directly."
                });
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

                const data = await verifyCBEBirr(reference, suppliedParams.phoneNumber);
                res.json({
                    verified: !("success" in data && data.success === false),
                    bank: "cbe_birr",
                    source,
                    reference,
                    details: data
                });
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

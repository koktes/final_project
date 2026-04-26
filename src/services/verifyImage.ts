import { Mistral } from "@mistralai/mistralai";
import fs from "fs";
import { Request, Response } from "express";
import multer from "multer";
import Tesseract from "tesseract.js";
import logger from "../utils/logger";
import { verifyTelebirr } from "./verifyTelebirr";
import { verifyCBE } from "./verifyCBE";
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

type ReceiptType = "telebirr" | "cbe";

interface ReceiptDetection {
    type: ReceiptType;
    transaction_id?: string;
    transaction_number?: string;
    source: "local-ocr" | "mistral";
}

function chooseBestReference(matches: string[], preferredLength?: number): string | null {
    if (!matches.length) return null;

    if (preferredLength) {
        const exact = matches.find((m) => m.length === preferredLength);
        if (exact) return exact;
    }

    return matches.sort((a, b) => b.length - a.length)[0];
}

function detectFromText(rawText: string): ReceiptDetection | null {
    const text = rawText.toUpperCase();

    const ftMatches = [...text.matchAll(/\bFT[A-Z0-9]{8,14}\b/g)].map((m) => m[0]);
    const ceMatches = [...text.matchAll(/\bCE[A-Z0-9]{6,14}\b/g)].map((m) => m[0]);

    const cbeKeywords = /COMMERCIAL\s+BANK\s+OF\s+ETHIOPIA|\bCBE\b|REFERENCE\s+NO|PAYER\s+ACCOUNT/.test(text);
    const telebirrKeywords = /\bTELEBIRR\b|RECEIPT\s+NO|PAYER\s+TELEBIRR|TRANSACTION\s+STATUS/.test(text);

    const bestFt = chooseBestReference(ftMatches, 12);
    const bestCe = chooseBestReference(ceMatches);

    if (bestFt && (cbeKeywords || !bestCe)) {
        return {
            type: "cbe",
            transaction_id: bestFt,
            source: "local-ocr"
        };
    }

    if (bestCe && (telebirrKeywords || !bestFt)) {
        return {
            type: "telebirr",
            transaction_number: bestCe,
            source: "local-ocr"
        };
    }

    if (bestFt) {
        return {
            type: "cbe",
            transaction_id: bestFt,
            source: "local-ocr"
        };
    }

    if (bestCe) {
        return {
            type: "telebirr",
            transaction_number: bestCe,
            source: "local-ocr"
        };
    }

    return null;
}

function generateReferenceCandidates(reference: string): string[] {
    const candidates = new Set<string>([reference]);
    const chars = reference.toUpperCase().split("");

    const substitutions: Record<string, string[]> = {
        "0": ["O"],
        "O": ["0"],
        "1": ["I", "L"],
        "I": ["1"],
        "L": ["1"],
        "5": ["S"],
        "S": ["5"],
        "8": ["B"],
        "B": ["8"],
        "2": ["Z"],
        "Z": ["2"],
        "6": ["G"],
        "G": ["6"],
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

async function detectWithMistral(base64Image: string): Promise<ReceiptDetection | null> {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) return null;

    try {
        const client = new Mistral({ apiKey });

        const prompt = `
You are a payment receipt analyzer. Based on the uploaded image, determine:
- If the receipt was issued by Telebirr or the Commercial Bank of Ethiopia (CBE).
- If it's a CBE receipt, extract the transaction ID (usually starts with 'FT').
- If it's a Telebirr receipt, extract the transaction number (usually starts with 'CE').

Rules:
- CBE receipts usually include a purple header with the title "Commercial Bank of Ethiopia" and a structured table.
- Telebirr receipts are typically green with a large minus sign before the amount.
- CBE receipts may mention Telebirr (as the receiver) but are still CBE receipts.

Return this JSON format exactly:
{
  "type": "telebirr" | "cbe",
  "transaction_id"?: "FTxxxx" (if CBE),
  "transaction_number"?: "CExxxx" (if Telebirr)
}
    `.trim();

        logger.info("Falling back to Mistral Vision OCR...");

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
            type?: ReceiptType;
            transaction_id?: string;
            transaction_number?: string;
        };

        if (!result.type) {
            return null;
        }

        return {
            type: result.type,
            transaction_id: result.transaction_id,
            transaction_number: result.transaction_number,
            source: "mistral"
        };
    } catch (error) {
        logger.error("Mistral OCR fallback failed", {
            error: error instanceof Error ? error.message : String(error)
        });
        return null;
    }
}

export const verifyImageHandler = [
    upload.single("file"),

    async (req: Request, res: Response): Promise<void> => {
        try {
            const autoVerify = req.query.autoVerify === "true";
            const accountSuffix = req.body?.suffix || null;

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

            let result = await detectWithLocalOcr(filePath);
            if (!result) {
                result = await detectWithMistral(base64Image);
            }

            if (!result) {
                res.status(422).json({
                    error: "Could not extract a valid reference from image",
                    hint: "Try a clearer image, better crop, or set MISTRAL_API_KEY for fallback OCR"
                });
                return;
            }

            logger.info("OCR Result", result);

            if (result.type === "telebirr" && result.transaction_number) {
                if (autoVerify) {
                    try {
                        const data = await verifyTelebirr(result.transaction_number);
                        res.json({
                            verified: true,
                            type: "telebirr",
                            source: result.source,
                            reference: result.transaction_number,
                            details: data,
                        });
                    } catch (verifyErr: any) {
                        logger.error("Telebirr verification failed", { verifyErr });
                        if (verifyErr.name === 'TelebirrVerificationError') {
                            res.status(502).json({ error: verifyErr.message, details: verifyErr.details });
                        } else {
                            res.status(500).json({ error: "Verification failed for Telebirr" });
                        }
                    }
                } else {
                    res.json({
                        type: "telebirr",
                        source: result.source,
                        reference: result.transaction_number,
                        forward_to: "/verify-telebirr",
                    });
                }
                return;
            }

            if (result.type === "cbe" && result.transaction_id) {
                if (!autoVerify) {
                    res.json({
                        type: "cbe",
                        source: result.source,
                        reference: result.transaction_id,
                        forward_to: "/verify-cbe",
                        accountSuffix: "required_from_user",
                    });
                    return;
                }

                if (!accountSuffix) {
                    res.status(400).json({
                        error: "Account suffix is required for CBE verification in autoVerify mode",
                    });
                    return;
                }

                try {
                    const referencesToTry = result.source === "local-ocr"
                        ? generateReferenceCandidates(result.transaction_id)
                        : [result.transaction_id];

                    let usedReference = result.transaction_id;
                    let data = await verifyCBE(usedReference, accountSuffix);

                    for (const candidate of referencesToTry) {
                        if (candidate === usedReference) continue;
                        if (data.success) break;

                        const retry = await verifyCBE(candidate, accountSuffix);
                        if (retry.success) {
                            usedReference = candidate;
                            data = retry;
                            break;
                        }
                    }

                    res.json({
                        verified: data.success,
                        type: "cbe",
                        source: result.source,
                        reference: usedReference,
                        details: data,
                        suggestion: data.success
                            ? undefined
                            : "Verification failed. Confirm account suffix and reference from receipt, then call /verify-cbe directly."
                    });
                } catch (verifyErr) {
                    logger.error("CBE verification failed", { verifyErr });
                    res.status(500).json({ error: "Verification failed for CBE" });
                }
                return;
            }

            res.status(422).json({ error: "Unknown or unrecognized receipt type" });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`Unexpected error in /verify-image: ${err instanceof Error ? err.message : String(err)}`, {
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

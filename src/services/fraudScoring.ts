import axios from 'axios';
import logger from '../utils/logger';

/**
 * AI Fraud Detection Integration
 * 
 * Calls the Python FastAPI fraud detection microservice (Path B)
 * to score transactions for fraud risk after bank API verification (Path A).
 * This implements the hybrid dual-path architecture described in the thesis.
 */

const FRAUD_API_URL = process.env.FRAUD_DETECTION_URL || 'http://localhost:8000';
const FRAUD_API_TIMEOUT = 5000; // 5 second timeout — don't block verification if AI is down

export interface FraudScoreResult {
    risk_score: number;       // 0-100
    status: string;           // Verified | Low_Risk | Suspicious | Invalid
    is_anomaly: boolean;
    confidence: number;       // 0-1
    anomaly_score_raw: number;
    contributing_features: Array<{
        feature: string;
        value: number;
        deviation: number;
    }>;
}

export interface FraudScoreInput {
    bank: string;
    reference: string;
    amount?: number;
    payer_name?: string;
    payer_account?: string;
    receiver_name?: string;
    receiver_account?: string;
    transaction_date?: string;
    transaction_status?: string;
    reason?: string;
    suffix?: string;
    phone_number?: string;
}

/**
 * Score a transaction through the AI fraud detection engine.
 * 
 * This is a non-blocking call — if the AI service is unavailable,
 * the verification result is still returned without the AI score.
 * The AI score is an additive layer, not a gatekeeper.
 */
export async function scoreFraudRisk(input: FraudScoreInput): Promise<FraudScoreResult | null> {
    try {
        const response = await axios.post(`${FRAUD_API_URL}/predict`, {
            bank: input.bank,
            reference: input.reference,
            amount: input.amount || 0,
            payer_name: input.payer_name || '',
            payer_account: input.payer_account || '',
            receiver_name: input.receiver_name || '',
            receiver_account: input.receiver_account || '',
            transaction_date: input.transaction_date || new Date().toISOString(),
            transaction_status: input.transaction_status || 'Completed',
            reason: input.reason || '',
            suffix: input.suffix || '',
            phone_number: input.phone_number || '',
        }, {
            timeout: FRAUD_API_TIMEOUT,
            headers: { 'Content-Type': 'application/json' },
        });

        const result = response.data as FraudScoreResult;

        logger.info('AI fraud scoring complete', {
            bank: input.bank,
            reference: input.reference,
            risk_score: result.risk_score,
            status: result.status,
            is_anomaly: result.is_anomaly,
        });

        return result;
    } catch (error: any) {
        // Non-fatal: AI scoring is an enhancement, not a requirement
        if (error.code === 'ECONNREFUSED' || error.code === 'ECONNABORTED') {
            logger.warn('AI fraud detection service unavailable — skipping risk scoring', {
                url: FRAUD_API_URL,
                error: error.code,
            });
        } else {
            logger.warn('AI fraud scoring failed', {
                error: error.message || String(error),
            });
        }
        return null;
    }
}

/**
 * Check if the AI fraud detection service is available.
 */
export async function isFraudServiceAvailable(): Promise<boolean> {
    try {
        const response = await axios.get(`${FRAUD_API_URL}/health`, {
            timeout: 2000,
        });
        return response.data?.model_loaded === true;
    } catch {
        return false;
    }
}

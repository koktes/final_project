import { Router, Request, Response } from 'express';
import { verifyCBE } from '../services/verifyCBE';
import { logVerification } from '../services/verificationRecords';
import { AuthenticatedRequest } from '../middleware/jwtAuth';
import logger from '../utils/logger';

const router = Router();

interface VerifyRequestBody {
    reference: string;
    accountSuffix: string;
}

router.post('/', async function (
    req: Request<{}, {}, VerifyRequestBody>,
    res: Response
): Promise<void> {
    const { reference, accountSuffix } = req.body;

    if (!reference || !accountSuffix) {
        res.status(400).json({ success: false, error: 'Missing reference or accountSuffix.' });
        return;
    }

    try {
        const result = await verifyCBE(reference, accountSuffix);

        const authReq = req as AuthenticatedRequest;
        if (authReq.user?.id) {
            await logVerification({
                userId: authReq.user.id,
                bank: 'cbe',
                method: 'MANUAL',
                endpoint: '/verify-cbe',
                requestPayload: req.body,
                responsePayload: result,
                status: result.success ? 'SUCCESS' : 'FAILED',
                reference,
                error: result.success ? null : result.error || 'Verification failed'
            });
        }

        res.json(result);
    } catch (err) {
        logger.error("💥 Payment verification failed:", err);
        res.status(500).json({ success: false, error: 'Server error verifying payment.' });
    }
});

router.get('/', async function(
    req: Request<{}, {}, {}, { reference?: string; accountSuffix?: string }>,
    res: Response
): Promise<void> {
    const { reference, accountSuffix } = req.query;

    if (typeof reference !== 'string' || typeof accountSuffix !== 'string') {
        res.status(400).json({ success: false, error: 'Missing or invalid query parameters.' });
        return;
    }

    try {
        const result = await verifyCBE(reference, accountSuffix);

        const authReq = req as AuthenticatedRequest;
        if (authReq.user?.id) {
            await logVerification({
                userId: authReq.user.id,
                bank: 'cbe',
                method: 'MANUAL',
                endpoint: '/verify-cbe',
                requestPayload: req.query as Record<string, string>,
                responsePayload: result,
                status: result.success ? 'SUCCESS' : 'FAILED',
                reference,
                error: result.success ? null : result.error || 'Verification failed'
            });
        }

        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ success: false, error: 'Server error verifying payment.' });
    }
});

export default router;

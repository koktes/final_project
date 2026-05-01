import { Router, Request, Response } from 'express';
import { verifyTelebirr } from '../services/verifyTelebirr';
import { logVerification } from '../services/verificationRecords';
import { AuthenticatedRequest } from '../middleware/jwtAuth';
import logger from '../utils/logger';

const router = Router();

interface VerifyTelebirrRequestBody {
    reference: string;
}

router.post<{}, {}, VerifyTelebirrRequestBody>(
    '/',
    async (req: Request<{}, {}, VerifyTelebirrRequestBody>, res: Response): Promise<void> => {
        const { reference } = req.body;

        if (!reference) {
            res.status(400).json({ success: false, error: 'Missing reference.' });
            return;
        }

        try {
            const result = await verifyTelebirr(reference);
            if (!result) {
                const authReq = req as AuthenticatedRequest;
                if (authReq.user?.id) {
                    await logVerification({
                        userId: authReq.user.id,
                        bank: 'telebirr',
                        method: 'MANUAL',
                        endpoint: '/verify-telebirr',
                        requestPayload: req.body,
                        responsePayload: null,
                        status: 'FAILED',
                        reference,
                        error: 'Receipt not found or could not be processed.'
                    });
                }

                res.status(404).json({ success: false, error: 'Receipt not found or could not be processed.' });
                return;
            }

            const authReq = req as AuthenticatedRequest;
            if (authReq.user?.id) {
                await logVerification({
                    userId: authReq.user.id,
                    bank: 'telebirr',
                    method: 'MANUAL',
                    endpoint: '/verify-telebirr',
                    requestPayload: req.body,
                    responsePayload: result,
                    status: 'SUCCESS',
                    reference
                });
            }

            res.json({ success: true, data: result });
        } catch (err: any) {
            logger.error('Telebirr verification error:', err);

            if (err.name === 'TelebirrVerificationError') {
                res.status(502).json({
                    success: false,
                    error: err.message,
                    details: err.details
                });
                return;
            }

            res.status(500).json({ 
                success: false, 
                error: 'Server error verifying Telebirr receipt.',
                message: err instanceof Error ? err.message : 'Unknown error'
            });
        }
    }
);

export default router;

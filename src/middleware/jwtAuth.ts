import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';

export interface AuthUser {
  id: string;
  email?: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const TOKEN_TTL = '7d';

export function signJwt(user: AuthUser): string {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function authenticateJwt(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.path === '/' || req.path === '/health' || req.path.startsWith('/auth')) {
    return next();
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authorization token is required' });
  }

  const token = header.replace('Bearer ', '').trim();
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; email?: string };
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch (error) {
    logger.warn('Invalid or expired JWT token');
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

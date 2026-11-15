import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { AuthContext, UserRole } from './types.ts';

const AUTH_SECRET = process.env.CBT_SESSION_SECRET || crypto.createHash('sha256').update(process.cwd() + ':sinarcbt-key-2026').digest('hex');
export const COOKIE_NAME = 'sinarcbt_session';

export interface SessionTokenPayload extends AuthContext {
  iat: number;
  exp: number;
}

export function signToken(payload: AuthContext, ttlSeconds = 60 * 60 * 12): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: SessionTokenPayload = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyToken(token: string | undefined): SessionTokenPayload | null {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionTokenPayload;
    if (parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function extractTokenFromRequest(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }
  if (typeof req.query?.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return undefined;
}

declare global {
  namespace Express {
    interface Request {
      auth?: SessionTokenPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractTokenFromRequest(req);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Sesi autentikasi tidak valid atau telah berakhir. Silakan login kembali.' });
    return;
  }
  req.auth = payload;
  next();
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ error: 'Autentikasi diperlukan.' });
      return;
    }
    if (!allowedRoles.includes(req.auth.role)) {
      res.status(403).json({ error: 'Akses ditolak: peran Anda tidak memiliki izin untuk operasi ini.' });
      return;
    }
    next();
  };
}

export function canAccessClassOrExam(auth: AuthContext, classId?: string | null, examId?: string | null): boolean {
  if (auth.role === 'admin') return true;
  if (auth.role === 'pengawas') {
    const classes = auth.assignedClassIds || [];
    const exams = auth.assignedExamIds || [];
    if (classes.length === 0 && exams.length === 0) return false;
    if (classId && classes.length > 0 && classes.includes(classId)) return true;
    if (examId && exams.length > 0 && exams.includes(examId)) return true;
    if (!classId && !examId) return true;
    return false;
  }
  return false;
}

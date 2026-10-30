import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AuthService, AuthUser } from '../services/AuthService';
import { AppError } from '../domain/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: AuthUser; }
  }
}

/** Fábrica de middleware: recibe el servicio por inyección en vez de importar el pool directamente. */
export function requireAuth(auth: AuthService): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return next(new AppError(401, 'No autorizado'));
    auth.autenticar(token).then(user => { req.user = user; next(); }, next);
  };
}

export function requireRole(...roles: string[]): RequestHandler {
  return (req, _res, next) => {
    const tiene = roles.some(r => (req.user?.rol || []).includes(r));
    next(tiene ? undefined : new AppError(403, 'No tienes permiso'));
  };
}

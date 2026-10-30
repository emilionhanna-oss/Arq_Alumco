import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { AppError } from '../domain/errors';

/** Evita try/catch repetido en cada controlador; `mensajeError` es el texto 500 histórico de cada endpoint. */
export const wrap = (fn: (req: Request, res: Response) => Promise<unknown>, mensajeError?: string): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(err => {
      if (err && typeof err === 'object') (err as any).mensajeFallback = mensajeError;
      next(err);
    });
  };

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ mensaje: 'Ruta no encontrada' });
}

export function errorHandler(err: any, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(err);
  if (err instanceof AppError) { res.status(err.status).json({ mensaje: err.message, ...err.extra }); return; }
  if (err?.type === 'entity.parse.failed') { res.status(400).json({ mensaje: 'JSON inválido' }); return; }
  if (err?.type === 'entity.too.large') { res.status(413).json({ mensaje: 'Solicitud demasiado grande' }); return; }
  // Errores de integridad de PostgreSQL: son culpa de la entrada, no del servidor.
  if (err?.code === '23503') { res.status(400).json({ mensaje: 'Referencia inválida' }); return; }
  if (err?.code === '23505') { res.status(409).json({ mensaje: 'El registro ya existe' }); return; }
  if (err?.code === '22P02') { res.status(400).json({ mensaje: 'Dato con formato inválido' }); return; }
  console.error('Error no controlado:', err);
  res.status(500).json({ mensaje: err?.mensajeFallback || 'Error interno' });
}

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db/pool';

const SECRET = process.env.JWT_SECRET || 'dev_insecure_change_me';

export interface AuthUser { id: string; rol: string[]; }

declare global {
  namespace Express {
    interface Request { user?: AuthUser; }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) { res.status(401).json({ mensaje: 'No autorizado' }); return; }

  try {
    const decoded = jwt.verify(token, SECRET) as { id: string };
    const { rows } = await pool.query(
      `SELECT u.id, u.estado, u.fecha_expiracion,
              array_agg(r.rol) FILTER (WHERE r.rol IS NOT NULL) AS roles
       FROM usuarios u
       LEFT JOIN usuario_roles r ON r.usuario_id = u.id
       WHERE u.id = $1 GROUP BY u.id`,
      [decoded.id]
    );

    if (rows.length === 0) { res.status(401).json({ mensaje: 'Usuario no encontrado' }); return; }

    const user = rows[0];
    if (user.fecha_expiracion && new Date(user.fecha_expiracion).getTime() <= Date.now() && user.estado !== 'vencido') {
      await pool.query('UPDATE usuarios SET estado = $1 WHERE id = $2', ['vencido', user.id]);
      user.estado = 'vencido';
    }
    if (user.estado === 'pendiente') { res.status(403).json({ mensaje: 'Cuenta pendiente de aprobación' }); return; }
    if (user.estado === 'vencido')   { res.status(403).json({ mensaje: 'Cuenta vencida' }); return; }

    req.user = { id: String(user.id), rol: user.roles || [] };
    next();
  } catch {
    res.status(401).json({ mensaje: 'Token inválido o expirado' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const hasRole = roles.some(r => (req.user?.rol || []).includes(r));
    if (!hasRole) { res.status(403).json({ mensaje: 'No tienes permiso' }); return; }
    next();
  };
}

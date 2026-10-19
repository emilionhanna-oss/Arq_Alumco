import { Request, Response } from 'express';
import pool from '../db/pool';

export async function perfilGamificacion(req: Request, res: Response): Promise<void> {
  try {
    const usuarioId = req.user!.id;
    const { rows: puntos }   = await pool.query('SELECT * FROM gamificacion_puntos WHERE usuario_id = $1', [usuarioId]);
    const { rows: insignias } = await pool.query('SELECT tipo, obtenida_en FROM insignias WHERE usuario_id = $1 ORDER BY obtenida_en DESC', [usuarioId]);
    const { rows: modulos }   = await pool.query('SELECT COUNT(*) AS total FROM progreso_modulos WHERE usuario_id = $1 AND completado = TRUE', [usuarioId]);
    const datos = puntos[0] || { puntos: 0, nivel: 'Aprendiz', racha_dias: 0 };
    res.status(200).json({ puntos: datos.puntos, nivel: datos.nivel, rachaDias: datos.racha_dias, ultimoAcceso: datos.ultimo_acceso, insignias: insignias.map(i => i.tipo), modulosCompletados: Number(modulos[0]?.total || 0) });
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al obtener perfil de gamificación' });
  }
}

export async function registrarAcceso(req: Request, res: Response): Promise<void> {
  try {
    const usuarioId = req.user!.id;
    const { rows } = await pool.query('SELECT * FROM gamificacion_puntos WHERE usuario_id = $1', [usuarioId]);
    if (rows.length === 0) {
      await pool.query('INSERT INTO gamificacion_puntos (usuario_id, racha_dias, ultimo_acceso) VALUES ($1,1,NOW())', [usuarioId]);
      res.status(200).json({ rachaDias: 1 }); return;
    }
    const datos = rows[0];
    const ultimoAcceso = datos.ultimo_acceso ? new Date(datos.ultimo_acceso) : null;
    const hoy  = new Date();
    const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);
    let nuevaRacha = datos.racha_dias;
    if (ultimoAcceso) {
      if (ultimoAcceso.toDateString() === hoy.toDateString()) { res.status(200).json({ rachaDias: nuevaRacha }); return; }
      nuevaRacha = ultimoAcceso.toDateString() === ayer.toDateString() ? nuevaRacha + 1 : 1;
    }
    await pool.query('UPDATE gamificacion_puntos SET racha_dias=$1, ultimo_acceso=NOW() WHERE usuario_id=$2', [nuevaRacha, usuarioId]);
    if (nuevaRacha >= 7) await pool.query('INSERT INTO insignias (usuario_id, tipo) VALUES ($1,$2) ON CONFLICT DO NOTHING', [usuarioId, 'racha_7_dias']);
    res.status(200).json({ rachaDias: nuevaRacha });
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al registrar acceso' });
  }
}

export async function ranking(req: Request, res: Response): Promise<void> {
  try {
    const { sede } = req.query;
    let query = `SELECT u.id, u.nombre_completo, u.nombre, s.nombre AS sede, gp.puntos, gp.nivel, gp.racha_dias,
      COUNT(ins.id) AS insignias_count,
      (SELECT COUNT(*) FROM progreso_modulos pm WHERE pm.usuario_id = u.id AND pm.completado = TRUE) AS modulos_completados
      FROM usuarios u INNER JOIN gamificacion_puntos gp ON gp.usuario_id = u.id
      LEFT JOIN sedes s ON s.id = u.sede_id LEFT JOIN insignias ins ON ins.usuario_id = u.id
      WHERE u.estado = 'activo'`;
    const params: unknown[] = [];
    if (sede) { params.push(sede); query += ` AND s.nombre = $${params.length}`; }
    query += ` GROUP BY u.id, u.nombre_completo, u.nombre, s.nombre, gp.puntos, gp.nivel, gp.racha_dias ORDER BY gp.puntos DESC LIMIT 50`;
    const { rows } = await pool.query(query, params);
    res.status(200).json(rows.map((r, i) => ({ posicion: i + 1, id: String(r.id), nombre: r.nombre_completo || r.nombre, sede: r.sede, puntos: r.puntos, nivel: r.nivel, rachaDias: r.racha_dias, insigniasCount: Number(r.insignias_count), modulosCompletados: Number(r.modulos_completados) })));
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al obtener ranking' });
  }
}

export async function insignias(req: Request, res: Response): Promise<void> {
  try {
    const { rows } = await pool.query('SELECT tipo, obtenida_en FROM insignias WHERE usuario_id = $1 ORDER BY obtenida_en DESC', [req.user!.id]);
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al obtener insignias' });
  }
}

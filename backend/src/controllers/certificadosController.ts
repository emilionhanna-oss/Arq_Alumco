import { Request, Response } from 'express';
import { createHash } from 'crypto';
import pool from '../db/pool';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

export async function generarCertificado(req: Request, res: Response): Promise<void> {
  try {
    const { cursoId } = req.params;
    const usuarioId   = req.user!.id;

    const { rows: cursos } = await pool.query('SELECT * FROM cursos WHERE id = $1', [cursoId]);
    if (cursos.length === 0) { res.status(404).json({ mensaje: 'Curso no encontrado' }); return; }

    const { rows: modulos } = await pool.query('SELECT id FROM modulos WHERE curso_id = $1', [cursoId]);
    if (modulos.length === 0) { res.status(400).json({ mensaje: 'El curso no tiene módulos' }); return; }

    const { rows: completados } = await pool.query(
      `SELECT pm.modulo_id FROM progreso_modulos pm WHERE pm.usuario_id = $1 AND pm.modulo_id = ANY($2) AND pm.completado = TRUE`,
      [usuarioId, modulos.map(m => m.id)]
    );
    if (completados.length < modulos.length) {
      res.status(400).json({ mensaje: 'Debes completar todos los módulos primero' }); return;
    }

    const { rows: existente } = await pool.query(
      'SELECT * FROM certificados_emitidos WHERE usuario_id=$1 AND curso_id=$2', [usuarioId, cursoId]
    );
    if (existente.length > 0) {
      res.status(200).json({ mensaje: 'Ya tienes un certificado', certificado: existente[0], urlVerificacion: `${FRONTEND_URL}/certificado/${existente[0].hash}` }); return;
    }

    const hash = createHash('sha256').update(`${usuarioId}-${cursoId}-${Date.now()}`).digest('hex').slice(0, 64);
    const { rows } = await pool.query('INSERT INTO certificados_emitidos (hash, usuario_id, curso_id) VALUES ($1,$2,$3) RETURNING *', [hash, usuarioId, cursoId]);

    await pool.query('INSERT INTO insignias (usuario_id, tipo) VALUES ($1,$2) ON CONFLICT DO NOTHING', [usuarioId, `certificado_${cursoId}`]);
    await pool.query(
      `INSERT INTO gamificacion_puntos (usuario_id, puntos) VALUES ($1,200)
       ON CONFLICT (usuario_id) DO UPDATE SET puntos = gamificacion_puntos.puntos + 200`, [usuarioId]
    );

    res.status(201).json({ mensaje: 'Certificado generado', certificado: rows[0], urlVerificacion: `${FRONTEND_URL}/certificado/${hash}` });
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al generar certificado' });
  }
}

export async function verificarCertificado(req: Request, res: Response): Promise<void> {
  try {
    const { hash } = req.params;
    const { rows } = await pool.query(
      `SELECT ce.*, u.nombre_completo, u.rut, c.titulo AS curso_titulo FROM certificados_emitidos ce
       INNER JOIN usuarios u ON u.id = ce.usuario_id INNER JOIN cursos c ON c.id = ce.curso_id WHERE ce.hash = $1`, [hash]
    );
    if (rows.length === 0) { res.status(404).json({ valido: false, mensaje: 'Certificado no encontrado' }); return; }
    const cert = rows[0];
    res.status(200).json({ valido: true, nombreCompleto: cert.nombre_completo, rut: cert.rut, cursoTitulo: cert.curso_titulo, emitidoEn: cert.emitido_en, hash: cert.hash });
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al verificar certificado' });
  }
}

export async function misCertificados(req: Request, res: Response): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT ce.*, c.titulo AS curso_titulo, c.imagen_url FROM certificados_emitidos ce
       INNER JOIN cursos c ON c.id = ce.curso_id WHERE ce.usuario_id = $1 ORDER BY ce.emitido_en DESC`, [req.user!.id]
    );
    res.status(200).json(rows.map(r => ({ id: r.id, hash: r.hash, cursoId: String(r.curso_id), cursoTitulo: r.curso_titulo, cursoImagen: r.imagen_url, emitidoEn: r.emitido_en, urlVerificacion: `${FRONTEND_URL}/certificado/${r.hash}` })));
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al obtener certificados' });
  }
}

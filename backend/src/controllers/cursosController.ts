import { Request, Response } from 'express';
import pool from '../db/pool';

async function getModulos(cursoId: number) {
  const { rows } = await pool.query('SELECT * FROM modulos WHERE curso_id = $1 ORDER BY orden ASC', [cursoId]);
  return rows.map(m => ({ id: m.id, tituloModulo: m.titulo, tipo: m.tipo, contenido: m.contenido, materialUrl: m.material_url, orden: m.orden }));
}

async function getAlumnos(cursoId: number) {
  const { rows } = await pool.query('SELECT usuario_id FROM inscripciones WHERE curso_id = $1', [cursoId]);
  return rows.map(r => String(r.usuario_id));
}

function buildCurso(row: Record<string, unknown>, modulos: unknown[], alumnos: string[]) {
  return { id: String(row.id), titulo: row.titulo, descripcion: row.descripcion, imagenUrl: row.imagen_url || '/course-images/default.svg', publicado: row.publicado, instructorId: row.instructor_id ? String(row.instructor_id) : null, creadoEn: row.creado_en, modulos, alumnosInscritos: alumnos };
}

export async function listarCursos(req: Request, res: Response): Promise<void> {
  try {
    const roles = req.user?.rol || [];
    const isAdmin = roles.includes('admin');
    const wantAll = req.query.all === '1';
    let rows;
    if (isAdmin && wantAll) {
      ({ rows } = await pool.query('SELECT * FROM cursos ORDER BY creado_en DESC'));
    } else {
      ({ rows } = await pool.query(
        `SELECT c.* FROM cursos c INNER JOIN inscripciones i ON i.curso_id = c.id
         WHERE i.usuario_id = $1 AND c.publicado = TRUE ORDER BY c.creado_en DESC`,
        [req.user!.id]
      ));
    }
    const cursos = await Promise.all(rows.map(async c => buildCurso(c, await getModulos(c.id), await getAlumnos(c.id))));
    res.status(200).json(cursos);
  } catch (err) {
    res.status(500).json({ mensaje: 'No se pudieron obtener los cursos' });
  }
}

export async function obtenerCurso(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const roles = req.user?.rol || [];
    const isAdmin = roles.includes('admin') || roles.includes('profesor');
    const { rows } = await pool.query('SELECT * FROM cursos WHERE id = $1', [id]);
    if (rows.length === 0) { res.status(404).json({ mensaje: 'Curso no encontrado' }); return; }
    if (!isAdmin) {
      const insc = await pool.query('SELECT id FROM inscripciones WHERE curso_id = $1 AND usuario_id = $2', [id, req.user!.id]);
      if (insc.rows.length === 0) { res.status(403).json({ mensaje: 'No estás inscrito' }); return; }
    }
    res.status(200).json(buildCurso(rows[0], await getModulos(Number(id)), await getAlumnos(Number(id))));
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al obtener curso' });
  }
}

export async function crearCurso(req: Request, res: Response): Promise<void> {
  try {
    const { titulo, descripcion, imagenUrl, modulos } = req.body || {};
    if (!titulo) { res.status(400).json({ mensaje: 'El título es obligatorio' }); return; }
    const { rows } = await pool.query(
      `INSERT INTO cursos (titulo, descripcion, imagen_url, instructor_id, publicado)
       VALUES ($1,$2,$3,$4,false) RETURNING *`,
      [titulo, descripcion || '', imagenUrl || '/course-images/default.svg', req.user!.id]
    );
    const curso = rows[0];
    if (Array.isArray(modulos)) {
      for (let i = 0; i < modulos.length; i++) {
        const m = modulos[i];
        await pool.query('INSERT INTO modulos (curso_id, titulo, tipo, contenido, orden) VALUES ($1,$2,$3,$4,$5)', [curso.id, m.tituloModulo || m.titulo, m.tipo, JSON.stringify(m.contenido), i]);
      }
    }
    res.status(201).json({ success: true, curso: buildCurso(curso, await getModulos(curso.id), []) });
  } catch (err) {
    res.status(500).json({ mensaje: 'No se pudo crear el curso' });
  }
}

export async function actualizarCurso(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { titulo, descripcion, imagenUrl, publicado, modulos } = req.body || {};
    const existing = await pool.query('SELECT id FROM cursos WHERE id = $1', [id]);
    if (existing.rows.length === 0) { res.status(404).json({ mensaje: 'Curso no encontrado' }); return; }
    await pool.query(
      `UPDATE cursos SET titulo = COALESCE($1,titulo), descripcion = COALESCE($2,descripcion),
       imagen_url = COALESCE($3,imagen_url), publicado = COALESCE($4,publicado), actualizado_en = NOW() WHERE id = $5`,
      [titulo || null, descripcion || null, imagenUrl || null, publicado ?? null, id]
    );
    if (Array.isArray(modulos)) {
      await pool.query('DELETE FROM modulos WHERE curso_id = $1', [id]);
      for (let i = 0; i < modulos.length; i++) {
        const m = modulos[i];
        await pool.query('INSERT INTO modulos (curso_id, titulo, tipo, contenido, orden) VALUES ($1,$2,$3,$4,$5)', [id, m.tituloModulo || m.titulo, m.tipo, JSON.stringify(m.contenido), i]);
      }
    }
    const { rows } = await pool.query('SELECT * FROM cursos WHERE id = $1', [id]);
    res.status(200).json({ success: true, curso: buildCurso(rows[0], await getModulos(Number(id)), await getAlumnos(Number(id))) });
  } catch (err) {
    res.status(500).json({ mensaje: 'No se pudo actualizar el curso' });
  }
}

export async function eliminarCurso(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT id FROM cursos WHERE id = $1', [id]);
    if (existing.rows.length === 0) { res.status(404).json({ mensaje: 'Curso no encontrado' }); return; }
    await pool.query('DELETE FROM cursos WHERE id = $1', [id]);
    res.status(200).json({ success: true, id });
  } catch (err) {
    res.status(500).json({ mensaje: 'No se pudo eliminar el curso' });
  }
}

export async function asignarAlumnos(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { alumnosInscritos } = req.body || {};
    if (!Array.isArray(alumnosInscritos)) { res.status(400).json({ mensaje: 'alumnosInscritos debe ser un array' }); return; }
    await pool.query('DELETE FROM inscripciones WHERE curso_id = $1', [id]);
    for (const uid of alumnosInscritos) {
      await pool.query('INSERT INTO inscripciones (usuario_id, curso_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [uid, id]);
    }
    const { rows } = await pool.query('SELECT * FROM cursos WHERE id = $1', [id]);
    res.status(200).json({ success: true, curso: buildCurso(rows[0], await getModulos(Number(id)), await getAlumnos(Number(id))) });
  } catch (err) {
    res.status(500).json({ mensaje: 'No se pudo asignar alumnos' });
  }
}

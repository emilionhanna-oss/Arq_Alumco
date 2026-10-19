import { Request, Response } from 'express';
import pool from '../db/pool';

async function getRoles(userId: number): Promise<string[]> {
  const { rows } = await pool.query('SELECT rol FROM usuario_roles WHERE usuario_id = $1', [userId]);
  return rows.map(r => r.rol);
}

function buildUsuario(u: Record<string, unknown>, roles: string[], sede: string | null) {
  return {
    id: String(u.id), email: u.email, nombre: u.nombre, nombreCompleto: u.nombre_completo,
    genero: u.genero, rut: u.rut, sede, cargo: u.cargo, estado: u.estado, rol: roles,
    fechaRegistro:   u.fecha_registro   ? new Date(u.fecha_registro as string).toISOString()   : null,
    fechaExpiracion: u.fecha_expiracion ? new Date(u.fecha_expiracion as string).toISOString() : null,
  };
}

export async function listarUsuarios(req: Request, res: Response): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT u.*, s.nombre AS sede_nombre FROM usuarios u
       LEFT JOIN sedes s ON s.id = u.sede_id ORDER BY u.fecha_registro DESC`
    );
    const ahora = Date.now();
    await Promise.all(rows.filter(u => u.fecha_expiracion && new Date(u.fecha_expiracion).getTime() <= ahora && u.estado !== 'vencido')
      .map(u => pool.query('UPDATE usuarios SET estado=$1 WHERE id=$2', ['vencido', u.id])));
    const result = await Promise.all(rows.map(async u => {
      const roles  = await getRoles(u.id);
      const estado = u.fecha_expiracion && new Date(u.fecha_expiracion).getTime() <= ahora ? 'vencido' : u.estado;
      return buildUsuario({ ...u, estado }, roles, u.sede_nombre);
    }));
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al listar usuarios' });
  }
}

export async function obtenerUsuario(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT u.*, s.nombre AS sede_nombre FROM usuarios u LEFT JOIN sedes s ON s.id = u.sede_id WHERE u.id = $1`, [id]
    );
    if (rows.length === 0) { res.status(404).json({ mensaje: 'Usuario no encontrado' }); return; }
    res.status(200).json(buildUsuario(rows[0], await getRoles(Number(id)), rows[0].sede_nombre));
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al obtener usuario' });
  }
}

export async function actualizarUsuario(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { nombre, nombreCompleto, email, rut, cargo, sede, estado, rol, fechaExpiracion } = req.body || {};
    const existing = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
    if (existing.rows.length === 0) { res.status(404).json({ mensaje: 'Usuario no encontrado' }); return; }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (nombre         !== undefined) { fields.push(`nombre=$${idx++}`);          values.push(nombre); }
    if (nombreCompleto !== undefined) { fields.push(`nombre_completo=$${idx++}`); values.push(nombreCompleto); }
    if (email          !== undefined) { fields.push(`email=$${idx++}`);           values.push(String(email).toLowerCase()); }
    if (rut            !== undefined) { fields.push(`rut=$${idx++}`);             values.push(rut); }
    if (cargo          !== undefined) { fields.push(`cargo=$${idx++}`);           values.push(cargo); }
    if (fechaExpiracion !== undefined) { fields.push(`fecha_expiracion=$${idx++}`); values.push(fechaExpiracion); }

    const nuevoEstado = estado || (existing.rows[0].estado === 'pendiente' ? 'activo' : existing.rows[0].estado);
    fields.push(`estado=$${idx++}`); values.push(nuevoEstado);

    if (sede !== undefined) {
      const sedeResult = await pool.query('SELECT id FROM sedes WHERE nombre = $1', [sede]);
      if (sedeResult.rows.length > 0) { fields.push(`sede_id=$${idx++}`); values.push(sedeResult.rows[0].id); }
    }

    if (fields.length > 0) { values.push(id); await pool.query(`UPDATE usuarios SET ${fields.join(',')} WHERE id=$${idx}`, values); }

    if (Array.isArray(rol) && rol.length > 0) {
      await pool.query('DELETE FROM usuario_roles WHERE usuario_id=$1', [id]);
      await Promise.all(rol.map(r => pool.query('INSERT INTO usuario_roles (usuario_id, rol) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, r])));
    }

    const { rows } = await pool.query(`SELECT u.*, s.nombre AS sede_nombre FROM usuarios u LEFT JOIN sedes s ON s.id = u.sede_id WHERE u.id = $1`, [id]);
    res.status(200).json({ success: true, usuario: buildUsuario(rows[0], await getRoles(Number(id)), rows[0].sede_nombre) });
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al actualizar usuario' });
  }
}

export async function miPerfil(req: Request, res: Response): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT u.*, s.nombre AS sede_nombre FROM usuarios u LEFT JOIN sedes s ON s.id = u.sede_id WHERE u.id = $1`,
      [req.user!.id]
    );
    if (rows.length === 0) { res.status(404).json({ mensaje: 'No encontrado' }); return; }
    res.status(200).json(buildUsuario(rows[0], await getRoles(Number(req.user!.id)), rows[0].sede_nombre));
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al obtener perfil' });
  }
}

export async function actualizarPerfil(req: Request, res: Response): Promise<void> {
  try {
    const usuarioId = req.user!.id;
    const { nombre, nombreCompleto, genero, firmaTexto, firmaImagenDataUrl } = req.body || {};
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (nombre             !== undefined) { fields.push(`nombre=$${idx++}`);                  values.push(nombre); }
    if (nombreCompleto     !== undefined) { fields.push(`nombre_completo=$${idx++}`);          values.push(nombreCompleto); }
    if (genero             !== undefined) { fields.push(`genero=$${idx++}`);                   values.push(genero); }
    if (firmaTexto         !== undefined) { fields.push(`firma_texto=$${idx++}`);              values.push(firmaTexto); }
    if (firmaImagenDataUrl !== undefined) { fields.push(`firma_imagen_data_url=$${idx++}`);    values.push(firmaImagenDataUrl); }
    if (fields.length > 0) { values.push(usuarioId); await pool.query(`UPDATE usuarios SET ${fields.join(',')} WHERE id=$${idx}`, values); }
    const { rows } = await pool.query(`SELECT u.*, s.nombre AS sede_nombre FROM usuarios u LEFT JOIN sedes s ON s.id = u.sede_id WHERE u.id = $1`, [usuarioId]);
    res.status(200).json(buildUsuario(rows[0], await getRoles(Number(usuarioId)), rows[0].sede_nombre));
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al actualizar perfil' });
  }
}

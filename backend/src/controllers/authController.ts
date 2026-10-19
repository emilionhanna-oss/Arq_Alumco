import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db/pool';

const SECRET = process.env.JWT_SECRET || 'dev_insecure_change_me';

async function getRoles(userId: number): Promise<string[]> {
  const { rows } = await pool.query('SELECT rol FROM usuario_roles WHERE usuario_id = $1', [userId]);
  return rows.map(r => r.rol);
}

function buildUser(user: Record<string, unknown>, roles: string[], sede: string | null) {
  return {
    id: String(user.id), email: user.email, nombre: user.nombre,
    nombreCompleto: user.nombre_completo, genero: user.genero, rut: user.rut,
    sede, cargo: user.cargo, estado: user.estado, rol: roles,
    fechaRegistro:   user.fecha_registro   ? new Date(user.fecha_registro as string).toISOString()   : null,
    fechaExpiracion: user.fecha_expiracion ? new Date(user.fecha_expiracion as string).toISOString() : null,
  };
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body || {};
  if (!email || !password) { res.status(400).json({ mensaje: 'Email y contraseña requeridos' }); return; }

  try {
    const { rows } = await pool.query(
      `SELECT u.*, s.nombre AS sede_nombre FROM usuarios u
       LEFT JOIN sedes s ON s.id = u.sede_id WHERE u.email = $1`,
      [String(email).trim().toLowerCase()]
    );
    if (rows.length === 0) { res.status(401).json({ mensaje: 'Credenciales incorrectas' }); return; }

    const user  = rows[0];
    const valid = await bcrypt.compare(String(password), user.password_hash);
    if (!valid) { res.status(401).json({ mensaje: 'Credenciales incorrectas' }); return; }

    if (user.fecha_expiracion && new Date(user.fecha_expiracion).getTime() <= Date.now() && user.estado !== 'vencido') {
      await pool.query('UPDATE usuarios SET estado = $1 WHERE id = $2', ['vencido', user.id]);
      user.estado = 'vencido';
    }
    if (user.estado === 'pendiente') { res.status(403).json({ mensaje: 'Cuenta pendiente de aprobación' }); return; }
    if (user.estado === 'vencido')   { res.status(403).json({ mensaje: 'Cuenta vencida' }); return; }

    const roles = await getRoles(user.id);
    const token = jwt.sign({ id: user.id, rol: roles }, SECRET, { expiresIn: '8h' });
    res.status(200).json({ mensaje: 'Login exitoso', token, usuario: buildUser(user, roles, user.sede_nombre) });
  } catch (err) {
    console.error('Error login:', err);
    res.status(500).json({ mensaje: 'Error interno' });
  }
}

export async function register(req: Request, res: Response): Promise<void> {
  const { nombreCompleto, email, password, confirmPassword, genero, sede, rut, cargo } = req.body || {};
  if (!nombreCompleto || !email || !password || !genero || !sede || !rut) {
    res.status(400).json({ mensaje: 'Todos los campos son obligatorios' }); return;
  }
  if (password !== confirmPassword) { res.status(400).json({ mensaje: 'Las contraseñas no coinciden' }); return; }
  if (String(password).length < 6)  { res.status(400).json({ mensaje: 'Mínimo 6 caracteres' }); return; }

  try {
    const emailNorm = String(email).trim().toLowerCase();
    const emailCheck = await pool.query('SELECT id FROM usuarios WHERE email = $1', [emailNorm]);
    if (emailCheck.rows.length > 0) { res.status(400).json({ mensaje: 'Correo ya registrado' }); return; }

    const rutCheck = await pool.query('SELECT id FROM usuarios WHERE rut = $1', [rut]);
    if (rutCheck.rows.length > 0) { res.status(400).json({ mensaje: 'RUT ya registrado' }); return; }

    const sedeResult = await pool.query('SELECT id FROM sedes WHERE nombre = $1', [sede]);
    if (sedeResult.rows.length === 0) { res.status(400).json({ mensaje: 'Sede no válida' }); return; }

    const hash   = await bcrypt.hash(String(password), 12);
    const nombre = String(nombreCompleto).trim().split(' ')[0];

    const { rows } = await pool.query(
      `INSERT INTO usuarios (email, password_hash, nombre_completo, nombre, rut, genero, sede_id, cargo, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pendiente') RETURNING id`,
      [emailNorm, hash, nombreCompleto, nombre, rut, genero, sedeResult.rows[0].id, cargo || 'Pendiente de asignación']
    );
    const newId = rows[0].id;
    await pool.query('INSERT INTO usuario_roles (usuario_id, rol) VALUES ($1,$2)', [newId, 'colaborador']);
    await pool.query('INSERT INTO gamificacion_puntos (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING', [newId]);

    res.status(201).json({ mensaje: 'Registro exitoso. Pendiente de aprobación.' });
  } catch (err) {
    console.error('Error register:', err);
    res.status(500).json({ mensaje: 'Error interno' });
  }
}

export async function listarSedes(req: Request, res: Response): Promise<void> {
  try {
    const { rows } = await pool.query('SELECT id, nombre, region FROM sedes ORDER BY nombre');
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al obtener sedes' });
  }
}

export async function me(req: Request, res: Response): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT u.*, s.nombre AS sede_nombre FROM usuarios u
       LEFT JOIN sedes s ON s.id = u.sede_id WHERE u.id = $1`,
      [req.user!.id]
    );
    if (rows.length === 0) { res.status(404).json({ mensaje: 'No encontrado' }); return; }
    const roles = await getRoles(rows[0].id);
    res.status(200).json(buildUser(rows[0], roles, rows[0].sede_nombre));
  } catch (err) {
    res.status(500).json({ mensaje: 'Error interno' });
  }
}

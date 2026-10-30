import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';

export interface UsuarioDemo { email: string; nombreCompleto: string; rut: string; rol: 'admin' | 'profesor' | 'colaborador'; cargo: string }

export const USUARIOS_DEMO: UsuarioDemo[] = [
  { email: 'admin@alumco.cl', nombreCompleto: 'Admin Alumco', rut: '11111111-1', rol: 'admin', cargo: 'Administrador' },
  { email: 'profesor@alumco.cl', nombreCompleto: 'Paula Profesora', rut: '22222222-2', rol: 'profesor', cargo: 'Instructora' },
  { email: 'alumno@alumco.cl', nombreCompleto: 'Alan Alumno', rut: '33333333-3', rol: 'colaborador', cargo: 'TENS' },
];

/** Crea los usuarios de demostración (idempotente). Todos con la misma contraseña (DEMO_PASSWORD). */
export async function runSeed(pool: Pick<Pool, 'query'>, password: string): Promise<string[]> {
  const hash = await bcrypt.hash(password, 10);
  const creados: string[] = [];
  for (const u of USUARIOS_DEMO) {
    const { rows } = await pool.query(
      `INSERT INTO usuarios (email, password_hash, nombre_completo, nombre, rut, genero, sede_id, cargo, estado)
       VALUES ($1,$2,$3,$4,$5,'otro',(SELECT id FROM sedes ORDER BY id LIMIT 1),$6,'activo')
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [u.email, hash, u.nombreCompleto, u.nombreCompleto.split(' ')[0], u.rut, u.cargo],
    );
    if (rows.length === 0) continue;
    await pool.query('INSERT INTO usuario_roles (usuario_id, rol) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, u.rol]);
    await pool.query('INSERT INTO gamificacion_puntos (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING', [rows[0].id]);
    creados.push(u.email);
  }
  return creados;
}

if (require.main === module) {
  (async () => {
    const { loadEnv } = await import('../config/env');
    const { createPool } = await import('./pool');
    const env = loadEnv();
    if (env.isProd && process.env.ALLOW_SEED !== 'true') {
      console.error('Seed bloqueado en producción (usuarios de demo con contraseña conocida). Define ALLOW_SEED=true solo para una demo.');
      process.exit(1);
    }
    const password = process.env.DEMO_PASSWORD || 'Demo1234!';
    const pool = createPool(env);
    try {
      const creados = await runSeed(pool, password);
      console.log(creados.length ? `✅ Usuarios de demo creados: ${creados.join(', ')}` : '✅ Los usuarios de demo ya existían');
      console.log(`   Contraseña de demo: ${password}`);
    } finally { await pool.end(); }
  })().catch(err => { console.error(err); process.exit(1); });
}

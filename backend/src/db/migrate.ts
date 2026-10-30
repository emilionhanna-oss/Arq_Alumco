import type { Pool } from 'pg';
import { MIGRATIONS, type Migration } from './migrations';

const LOCK_ID = 727274; // evita que stable y canary migren a la vez

export async function runMigrations(pool: Pick<Pool, 'connect'>, migrations: Migration[] = MIGRATIONS): Promise<string[]> {
  const client = await pool.connect();
  const aplicadas: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const { rows } = await client.query('SELECT id FROM schema_migrations');
    const hechas = new Set(rows.map(r => r.id));

    for (const m of migrations) {
      if (hechas.has(m.id)) continue;
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
        await client.query('COMMIT');
        aplicadas.push(m.id);
        console.log(`✅ Migración aplicada: ${m.id}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Falló la migración ${m.id}:`, err);
        throw err;
      }
    }
    if (aplicadas.length === 0) console.log('✅ Esquema al día (sin migraciones pendientes)');
    return aplicadas;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

if (require.main === module) {
  (async () => {
    const { loadEnv } = await import('../config/env');
    const { createPool } = await import('./pool');
    const pool = createPool(loadEnv());
    try {
      await runMigrations(pool);
    } finally {
      await pool.end();
    }
  })().catch(() => process.exit(1));
}

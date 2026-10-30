import { Pool } from 'pg';
import type { Env } from '../config/env';

export function createPool(env: Pick<Env, 'databaseUrl' | 'dbSsl'>): Pool {
  const pool = new Pool({
    connectionString: env.databaseUrl,
    ssl: env.dbSsl ? { rejectUnauthorized: false } : false,
    max: 10,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', err => console.error('❌ Error PostgreSQL:', err.message));
  return pool;
}

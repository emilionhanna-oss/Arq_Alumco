import type { Pool } from 'pg';
import CircuitBreaker from 'opossum';
import { ServiceUnavailableError } from '../domain/errors';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
}

export interface Queryable {
  query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

/** Puerto de acceso a datos. Los repositorios dependen de esta interfaz, no de `pg`. */
export interface Database extends Queryable {
  /** Ejecuta `fn` dentro de una transacción (COMMIT si resuelve, ROLLBACK si lanza). */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  health(): Promise<boolean>;
  breakerState(): 'closed' | 'half-open' | 'open';
  close(): Promise<void>;
}

export interface BreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  volumeThreshold?: number;
}

const CODIGOS_INFRA = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'EAI_AGAIN']);

/**
 * Solo los fallos de infraestructura (red, BD caída, apagado del servidor) cuentan para abrir el circuito.
 * Un error de SQL de la aplicación (unique_violation, FK, etc.) NO debe tumbar el servicio.
 */
export function isInfrastructureError(err: any): boolean {
  const code: string = err?.code ?? '';
  if (CODIGOS_INFRA.has(code)) return true;
  return code.startsWith('08') || code.startsWith('53') || code.startsWith('57P'); // conexión, recursos, apagado
}

/**
 * Implementación PostgreSQL con Circuit Breaker (opossum).
 * Se crea UNA sola vez en el composition root (Singleton por construcción, no por caché de módulos).
 */
export class PgDatabase implements Database {
  private readonly breaker: CircuitBreaker<[text: string, params?: unknown[]], QueryResult>;

  constructor(
    private readonly pool: Pick<Pool, 'query' | 'connect' | 'end'>,
    opts: BreakerOptions = {},
  ) {
    this.breaker = new CircuitBreaker(
      (text: string, params?: unknown[]) => this.pool.query(text, params as any) as Promise<QueryResult>,
      {
        name: 'postgres',
        timeout: opts.timeout ?? 8000,
        errorThresholdPercentage: opts.errorThresholdPercentage ?? 50,
        resetTimeout: opts.resetTimeout ?? 10000,
        volumeThreshold: opts.volumeThreshold ?? 5,
        // true => el error NO cuenta como fallo del circuito
        errorFilter: (err: unknown) => !isInfrastructureError(err),
      },
    );
    this.breaker.on('open', () => console.error('⚡ Circuit breaker PostgreSQL: ABIERTO'));
    this.breaker.on('halfOpen', () => console.warn('⚡ Circuit breaker PostgreSQL: SEMI-ABIERTO'));
    this.breaker.on('close', () => console.log('⚡ Circuit breaker PostgreSQL: CERRADO'));
  }

  async query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    try {
      return (await this.breaker.fire(text, params)) as QueryResult<T>;
    } catch (err: any) {
      if (err?.code === 'EOPENBREAKER' || err?.code === 'ETIMEDOUT') throw new ServiceUnavailableError();
      throw err;
    }
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({ query: (text, params) => client.query(text, params as any) as any });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async health(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  breakerState(): 'closed' | 'half-open' | 'open' {
    if (this.breaker.opened) return 'open';
    if (this.breaker.halfOpen) return 'half-open';
    return 'closed';
  }

  async close(): Promise<void> {
    this.breaker.shutdown();
    await this.pool.end();
  }
}

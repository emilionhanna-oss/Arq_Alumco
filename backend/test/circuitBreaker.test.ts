import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgDatabase, isInfrastructureError } from '../src/db/Database';
import { ServiceUnavailableError } from '../src/domain/errors';

function fakePool(comportamiento: { error?: any }) {
  const estado = { llamadas: 0 };
  return {
    estado,
    pool: {
      query: async () => { estado.llamadas++; if (comportamiento.error) throw comportamiento.error; return { rows: [{ ok: 1 }], rowCount: 1 }; },
      connect: async () => { throw new Error('no usado'); },
      end: async () => {},
    } as any,
  };
}
const err = (code: string) => Object.assign(new Error(code), { code });
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

test('Circuit Breaker: se abre con fallos de infraestructura, falla rápido y se recupera', async () => {
  const comp: { error?: any } = { error: err('ECONNREFUSED') };
  const { pool, estado } = fakePool(comp);
  const db = new PgDatabase(pool, { volumeThreshold: 3, errorThresholdPercentage: 50, resetTimeout: 150 });
  const log = console.error; console.error = () => {};
  try {
    for (let i = 0; i < 3; i++) await assert.rejects(db.query('SELECT 1'), /ECONNREFUSED/);
    await esperar(20);
    assert.equal(db.breakerState(), 'open');

    const antes = estado.llamadas;
    await assert.rejects(db.query('SELECT 1'), (e: any) => e instanceof ServiceUnavailableError && e.status === 503);
    assert.equal(estado.llamadas, antes, 'con el circuito abierto no se toca la BD');
    assert.equal(await db.health(), false);

    comp.error = undefined;       // la BD vuelve
    await esperar(200);           // pasa resetTimeout -> half-open
    assert.deepEqual((await db.query('SELECT 1')).rows, [{ ok: 1 }]);
    assert.equal(db.breakerState(), 'closed');
    assert.equal(await db.health(), true);
  } finally { console.error = log; db.close().catch(() => {}); }
});

test('Circuit Breaker: errores de SQL de la aplicación NO abren el circuito', async () => {
  const { pool } = fakePool({ error: err('23505') });
  const db = new PgDatabase(pool, { volumeThreshold: 3, errorThresholdPercentage: 50 });
  for (let i = 0; i < 10; i++) await assert.rejects(db.query('INSERT ...'), /23505/);
  assert.equal(db.breakerState(), 'closed');
  await db.close();
});

test('isInfrastructureError', () => {
  assert.equal(isInfrastructureError(err('ECONNREFUSED')), true);
  assert.equal(isInfrastructureError(err('08006')), true);
  assert.equal(isInfrastructureError(err('57P01')), true);
  assert.equal(isInfrastructureError(err('23505')), false);
  assert.equal(isInfrastructureError(new Error('x')), false);
});

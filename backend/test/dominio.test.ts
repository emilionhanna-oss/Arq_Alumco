import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UmbralNivelStrategy } from '../src/domain/nivel';
import { calificar, ocultarRespuestas, PUNTAJE_MINIMO } from '../src/domain/calificacion';
import { calcularRacha } from '../src/domain/racha';
import { enmascararRut } from '../src/domain/privacidad';
import { EventBus } from '../src/domain/events';
import { parseFeatureFlags } from '../src/config/env';
import { FeatureFlags, bucket } from '../src/canary/featureFlags';
import { loadEnv } from '../src/config/env';

test('Strategy de nivel: umbrales equivalentes a la lógica original', () => {
  const s = new UmbralNivelStrategy();
  const casos: Array<[number, string]> = [[0, 'Aprendiz'], [49, 'Aprendiz'], [50, 'Principiante'], [199, 'Principiante'], [200, 'Colaborador'], [499, 'Colaborador'], [500, 'Experto'], [999, 'Experto'], [1000, 'Maestro'], [5000, 'Maestro']];
  for (const [pts, nivel] of casos) assert.equal(s.calcular(pts), nivel, `${pts} pts`);
});

test('Strategy de nivel: es intercambiable', () => {
  const s = new UmbralNivelStrategy([{ min: 0, nivel: 'A' }, { min: 10, nivel: 'B' }]);
  assert.equal(s.calcular(9), 'A');
  assert.equal(s.calcular(10), 'B');
});

const quiz = [
  { opciones: [{ correcta: false }, { correcta: true }] },
  { opciones: [{ correcta: true }, { correcta: false }, { correcta: false }] },
  { opciones: [{ correcta: false }, { correcta: false }, { correcta: true }] },
];

test('calificar: puntaje, aprobación y respuestas faltantes', () => {
  assert.deepEqual(calificar(quiz, [1, 0, 2]), { correctas: 3, total: 3, puntaje: 100, aprobado: true });
  const r = calificar(quiz, [1, 0, 0]);
  assert.equal(r.puntaje, 67); assert.equal(r.aprobado, true);
  assert.equal(calificar(quiz, [1]).aprobado, false);       // 33%
  assert.equal(calificar(quiz, undefined).puntaje, 0);       // sin respuestas
  assert.equal(calificar([], [1]).puntaje, 0);
  assert.equal(PUNTAJE_MINIMO, 60);
});

test('ocultarRespuestas: el alumno no recibe "correcta"', () => {
  const out = JSON.stringify(ocultarRespuestas([{ pregunta: 'x', opciones: [{ texto: 'a', correcta: true }] }]));
  assert.ok(!out.includes('correcta'));
  assert.ok(out.includes('"texto":"a"'));
  assert.equal(ocultarRespuestas({ texto: 'lectura' }) !== undefined, true);
});

test('racha: primer acceso, mismo día, día consecutivo y racha rota', () => {
  const hoy = new Date('2026-10-30T15:00:00');
  assert.deepEqual(calcularRacha(null, 0, hoy), { rachaDias: 1, cambio: true });                       // bug original: quedaba en 0
  assert.deepEqual(calcularRacha(new Date('2026-10-30T08:00:00'), 4, hoy), { rachaDias: 4, cambio: false });
  assert.deepEqual(calcularRacha(new Date('2026-10-29T23:00:00'), 4, hoy), { rachaDias: 5, cambio: true });
  assert.deepEqual(calcularRacha(new Date('2026-10-27T10:00:00'), 4, hoy), { rachaDias: 1, cambio: true });
});

test('enmascararRut', () => {
  assert.equal(enmascararRut('12345678-5'), '*****678-5');
  assert.equal(enmascararRut('12.345.678-5'), '*****678-5');
  assert.equal(enmascararRut(''), '');
});

test('EventBus (Observer): notifica a todos y aísla fallos de un observador', async () => {
  const bus = new EventBus();
  const vistos: string[] = [];
  bus.on('quiz.aprobado', () => { throw new Error('boom'); });
  bus.on('quiz.aprobado', async p => { vistos.push(p.usuarioId); });
  const log = console.error; console.error = () => {};
  try { await bus.emit('quiz.aprobado', { usuarioId: 'u1', moduloId: '1', puntaje: 100 }); } finally { console.error = log; }
  assert.deepEqual(vistos, ['u1']);
});

test('feature flags: parseo de FEATURE_FLAGS', () => {
  assert.deepEqual(parseFeatureFlags('ranking_v2:10, otra:100,rota:abc,tope:150,neg:-5,sinvalor'), { ranking_v2: 10, otra: 100, tope: 100, neg: 0, sinvalor: 100 });
  assert.deepEqual(parseFeatureFlags(''), {});
});

test('canary por usuario: determinista, ~porcentaje configurado y monótono', () => {
  const flags10 = new FeatureFlags({ f: 10 });
  const ids = Array.from({ length: 20000 }, (_, i) => String(i + 1));
  const activos = ids.filter(id => flags10.isEnabled('f', id));
  const pct = (activos.length / ids.length) * 100;
  assert.ok(pct > 8.5 && pct < 11.5, `esperado ~10%, obtenido ${pct.toFixed(2)}%`);
  assert.equal(flags10.isEnabled('f', '123'), flags10.isEnabled('f', '123')); // sticky
  // subir de 10% a 30% no reasigna: todos los del 10% siguen dentro
  const flags30 = new FeatureFlags({ f: 30 });
  assert.ok(activos.every(id => flags30.isEnabled('f', id)));
  assert.equal(new FeatureFlags({ f: 0 }).isEnabled('f', '1'), false);
  assert.equal(new FeatureFlags({ f: 100 }).isEnabled('f', '1'), true);
  assert.equal(new FeatureFlags({}).isEnabled('inexistente', '1'), false);
  assert.ok(bucket('f', '1') >= 0 && bucket('f', '1') < 100);
});

test('config: JWT_SECRET obligatorio en producción', () => {
  assert.throws(() => loadEnv({ NODE_ENV: 'production' } as any), /JWT_SECRET/);
  assert.throws(() => loadEnv({ NODE_ENV: 'production', JWT_SECRET: 'dev_insecure_change_me' } as any), /JWT_SECRET/);
  assert.equal(loadEnv({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32), APP_TRACK: 'canary', APP_VERSION: '2.0.0' } as any).appTrack, 'canary');
  assert.equal(loadEnv({} as any).appTrack, 'stable');
});

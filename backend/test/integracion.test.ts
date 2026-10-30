/**
 * Integración extremo a extremo contra PostgreSQL real (HTTP -> controlador -> servicio -> repositorio -> BD).
 * Se omite si no hay TEST_DATABASE_URL.   Ej: TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/alumco_test npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { Pool } from 'pg';
import { loadEnv } from '../src/config/env';
import { createPool } from '../src/db/pool';
import { PgDatabase } from '../src/db/Database';
import { runMigrations } from '../src/db/migrate';
import { runSeed } from '../src/db/seed';
import { buildContainer } from '../src/container';
import { createApp } from '../src/app';

const URL = process.env.TEST_DATABASE_URL;
const opts = { skip: URL ? false : 'define TEST_DATABASE_URL para correr la integración' };

let seed: Pool; let server: Server; let server2: Server; let base = ''; let base2 = '';
let dbs: PgDatabase[] = [];
const S: Record<string, any> = {};

async function api(method: string, path: string, body?: unknown, token?: string, root = base) {
  const res = await fetch(root + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* texto plano */ }
  return { status: res.status, body: json, text, headers: res.headers };
}

function levantar(extra: Record<string, string>) {
  const env = loadEnv({ JWT_SECRET: 'secreto-de-prueba', DATABASE_URL: URL, FRONTEND_URL: 'https://front.test', ...extra } as any);
  const db = new PgDatabase(createPool(env));
  dbs.push(db);
  const app = createApp(buildContainer(db, env), env);
  return new Promise<{ server: Server; base: string }>(ok => {
    const srv = app.listen(0, '127.0.0.1', () => ok({ server: srv, base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` }));
  });
}

before(async () => {
  if (!URL) return;
  seed = new Pool({ connectionString: URL });
  await seed.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await runMigrations(seed);
  S.sembrados = await runSeed(seed, 'admin123');   // usuarios de demo: admin, profesor, alumno
  ({ server, base } = await levantar({ APP_VERSION: '9.9.9', APP_TRACK: 'canary', FEATURE_FLAGS: 'ranking_v2:100' }));
  ({ server: server2, base: base2 } = await levantar({ APP_VERSION: '1.0.0', APP_TRACK: 'stable', FEATURE_FLAGS: 'ranking_v2:0' }));
});

after(async () => {
  if (!URL) return;
  server.close(); server2.close();
  await Promise.all(dbs.map(d => d.close().catch(() => {})));
  await seed.end();
});

async function registrarYActivar(email: string, rut: string, nombre: string) {
  const r = await api('POST', '/api/auth/register', { nombreCompleto: nombre, email, password: 'secreto1', confirmPassword: 'secreto1', genero: 'femenino', sede: 'Hualpen (Region del Biobio)', rut, cargo: 'TENS' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const pend = await api('POST', '/api/auth/login', { email, password: 'secreto1' });
  assert.equal(pend.status, 403); assert.equal(pend.body.mensaje, 'Cuenta pendiente de aprobación');
  const { rows } = await seed.query('SELECT id FROM usuarios WHERE email = $1', [email]);
  const act = await api('PUT', `/api/usuarios/${rows[0].id}`, {}, S.adminToken);   // sin estado: pendiente -> activo
  assert.equal(act.status, 200); assert.equal(act.body.usuario.estado, 'activo');
  const login = await api('POST', '/api/auth/login', { email, password: 'secreto1' });
  assert.equal(login.status, 200);
  return { id: String(rows[0].id), token: login.body.token as string };
}

test('salud, versión y métricas', opts, async () => {
  const h = await api('GET', '/health');
  assert.equal(h.status, 200);
  assert.deepEqual([h.body.status, h.body.db, h.body.version, h.body.track, h.body.circuitBreaker], ['ok', 'up', '9.9.9', 'canary', 'closed']);
  assert.equal(h.headers.get('x-app-version'), '9.9.9');
  assert.equal(h.headers.get('x-app-track'), 'canary');
  assert.equal((await api('GET', '/health/live')).status, 200);
  assert.equal((await api('GET', '/health/ready')).status, 200);
  assert.equal((await api('GET', '/')).body.status, 'ok');
});

test('errores: JSON inválido, id inválido, sin token, ruta inexistente', opts, async () => {
  assert.equal((await api('POST', '/api/auth/login', '{malo')).status, 400);
  assert.equal((await api('GET', '/api/cursos/abc')).status, 401);
  assert.equal((await api('GET', '/api/ruta-que-no-existe')).status, 404);
  assert.equal((await api('POST', '/api/auth/login', { email: 'x@y.cl', password: 'z' })).status, 401);
});

test('registro, aprobación por admin y login', opts, async () => {
  S.adminToken = (await api('POST', '/api/auth/login', { email: 'admin@alumco.cl', password: 'admin123' })).body.token;
  assert.ok(S.adminToken);
  const sedes = await api('GET', '/api/auth/sedes');
  assert.equal(sedes.body.length, 2);
  S.ana = await registrarYActivar('ana@alumco.cl', '12345678-5', 'Ana Pérez');
  S.bea = await registrarYActivar('bea@alumco.cl', '87654321-K', 'Bea Soto');
  const dup = await api('POST', '/api/auth/register', { nombreCompleto: 'X', email: 'ana@alumco.cl', password: 'secreto1', confirmPassword: 'secreto1', genero: 'f', sede: 'Hualpen (Region del Biobio)', rut: '1-9' });
  assert.equal(dup.status, 400); assert.equal(dup.body.mensaje, 'Correo ya registrado');
  assert.equal((await api('GET', '/api/auth/me', undefined, S.ana.token)).body.rol[0], 'colaborador');
  assert.equal((await api('GET', '/api/usuarios', undefined, S.ana.token)).status, 403);   // solo admin
  const lista = await api('GET', '/api/usuarios', undefined, S.adminToken);
  assert.equal(lista.body.length, 5);   // 3 de seed + ana + bea
  assert.equal((await api('PUT', `/api/usuarios/${S.ana.id}`, { estado: 'inventado' }, S.adminToken)).status, 400);
});

test('curso: el alumno NO recibe las respuestas correctas del quiz; el admin sí', opts, async () => {
  const quiz = [{ pregunta: '2+2', opciones: [{ texto: '3', correcta: false }, { texto: '4', correcta: true }] }, { pregunta: 'Capital de Chile', opciones: [{ texto: 'Santiago', correcta: true }, { texto: 'Lima', correcta: false }] }];
  const c = await api('POST', '/api/cursos', { titulo: 'Seguridad', descripcion: 'EPP', modulos: [{ tituloModulo: 'Lectura', tipo: 'lectura', contenido: { texto: 'hola' } }, { tituloModulo: 'Evaluación', tipo: 'quiz', contenido: quiz }] }, S.adminToken);
  assert.equal(c.status, 201, JSON.stringify(c.body));
  S.curso = c.body.curso; S.modLectura = S.curso.modulos[0].id; S.modQuiz = S.curso.modulos[1].id;
  assert.equal((await api('POST', '/api/cursos', { descripcion: 'sin título' }, S.adminToken)).status, 400);
  assert.equal((await api('POST', '/api/cursos', { titulo: 'x' }, S.ana.token)).status, 403);

  assert.equal((await api('PUT', `/api/cursos/${S.curso.id}`, { publicado: true }, S.adminToken)).status, 200);
  assert.equal((await api('PUT', `/api/cursos/${S.curso.id}/alumnos`, { alumnosInscritos: [S.ana.id, S.bea.id] }, S.adminToken)).status, 200);
  assert.equal((await api('PUT', `/api/cursos/${S.curso.id}/alumnos`, { alumnosInscritos: [999999] }, S.adminToken)).status, 400);  // FK -> 400, no 500

  const alumno = await api('GET', `/api/cursos/${S.curso.id}`, undefined, S.ana.token);
  assert.equal(alumno.status, 200);
  assert.ok(!alumno.text.includes('correcta'), 'el alumno no debe ver "correcta"');
  assert.ok(alumno.text.includes('"texto":"4"'));
  const admin = await api('GET', `/api/cursos/${S.curso.id}`, undefined, S.adminToken);
  assert.ok(admin.text.includes('"correcta":true'));
  const lista = await api('GET', '/api/cursos', undefined, S.ana.token);
  assert.equal(lista.body.length, 1); assert.ok(!lista.text.includes('correcta'));
});

test('gamificación: el primer acceso inicia la racha en 1 (antes quedaba en 0)', opts, async () => {
  assert.equal((await api('POST', '/api/gamificacion/acceso', {}, S.ana.token)).body.rachaDias, 1);
  assert.equal((await api('POST', '/api/gamificacion/acceso', {}, S.ana.token)).body.rachaDias, 1);   // mismo día
});

test('quiz: IDOR bloqueado, reprobar, aprobar, puntos/nivel/insignia y reenvío', opts, async () => {
  const bad = { intentoId: 0, respuestas: [0, 1], tiempoSegundos: 10 };
  const i1 = await api('POST', `/api/quiz/${S.modQuiz}/iniciar`, {}, S.ana.token);
  assert.equal(i1.status, 201); assert.equal(i1.body.intentoNumero, 1);

  // Bea intenta cerrar el intento de Ana
  const robo = await api('POST', `/api/quiz/${S.modQuiz}/submit`, { intentoId: i1.body.intentoId, respuestas: [1, 0] }, S.bea.token);
  assert.equal(robo.status, 404);

  const fallo = await api('POST', `/api/quiz/${S.modQuiz}/submit`, { ...bad, intentoId: i1.body.intentoId }, S.ana.token);
  assert.equal(fallo.status, 200); assert.equal(fallo.body.aprobado, false); assert.equal(fallo.body.puntaje, 0); assert.ok(fallo.body.desbloqueoEn);
  assert.equal((await api('POST', `/api/quiz/${S.modQuiz}/submit`, { ...bad, intentoId: i1.body.intentoId }, S.ana.token)).status, 409);

  const i2 = await api('POST', `/api/quiz/${S.modQuiz}/iniciar`, {}, S.ana.token);
  assert.equal(i2.body.intentoNumero, 2);
  const ok = await api('POST', `/api/quiz/${S.modQuiz}/submit`, { intentoId: i2.body.intentoId, respuestas: [1, 0], tiempoSegundos: 42 }, S.ana.token);
  assert.deepEqual([ok.body.puntaje, ok.body.aprobado, ok.body.correctas, ok.body.total], [100, true, 2, 2]);
  // la tabla respuestas_quiz ahora existe y se guarda (antes: 500 después de dar los puntos)
  const { rows } = await seed.query('SELECT count(*)::int AS n FROM respuestas_quiz WHERE usuario_id = $1', [S.ana.id]);
  assert.equal(rows[0].n, 2);

  const est = await api('GET', `/api/quiz/${S.modQuiz}/estado`, undefined, S.ana.token);
  assert.deepEqual([est.body.intentosRealizados, est.body.intentosRestantes, est.body.mejorPuntaje, est.body.aprobado], [2, 0, 100, true]);

  const perfil = await api('GET', '/api/gamificacion/perfil', undefined, S.ana.token);
  assert.equal(perfil.body.puntos, 100); assert.equal(perfil.body.nivel, 'Principiante');
  assert.ok(perfil.body.insignias.includes(`quiz_aprobado_${S.modQuiz}`));
  assert.equal(perfil.body.modulosCompletados, 1);
});

test('certificado: exige módulos completos, es idempotente, sube puntos Y nivel, y el RUT público va enmascarado', opts, async () => {
  const antes = await api('POST', `/api/certificados/generar/${S.curso.id}`, {}, S.ana.token);
  assert.equal(antes.status, 400);   // falta el módulo de lectura
  // No existe endpoint para completar módulos no-quiz (CU-03 del informe): se simula por SQL.
  await seed.query('INSERT INTO progreso_modulos (usuario_id, modulo_id, completado, completado_en) VALUES ($1,$2,TRUE,NOW())', [S.ana.id, S.modLectura]);

  const g = await api('POST', `/api/certificados/generar/${S.curso.id}`, {}, S.ana.token);
  assert.equal(g.status, 201);
  const hash = g.body.certificado.hash;
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(g.body.urlVerificacion, `https://front.test/certificado/${hash}`);
  assert.equal((await api('POST', `/api/certificados/generar/${S.curso.id}`, {}, S.ana.token)).status, 200);

  const perfil = await api('GET', '/api/gamificacion/perfil', undefined, S.ana.token);
  assert.equal(perfil.body.puntos, 300);
  assert.equal(perfil.body.nivel, 'Colaborador');   // bug original: se quedaba en Principiante
  assert.ok(perfil.body.insignias.includes(`certificado_${S.curso.id}`));

  const pub = await api('GET', `/api/certificados/verificar/${hash}`);   // sin token
  assert.equal(pub.status, 200); assert.equal(pub.body.valido, true);
  assert.equal(pub.body.rut, '*****678-5'); assert.equal(pub.body.nombreCompleto, 'Ana Pérez');
  const noExiste = await api('GET', '/api/certificados/verificar/abc');
  assert.deepEqual([noExiste.status, noExiste.body.valido], [404, false]);
  assert.equal((await api('GET', '/api/certificados/mis-certificados', undefined, S.ana.token)).body.length, 1);
});

test('editar un curso NO borra el progreso de los alumnos (por id y por posición)', opts, async () => {
  const conteo = async () => (await seed.query('SELECT count(*)::int n FROM progreso_modulos WHERE completado')).rows[0].n;
  const antes = await conteo(); assert.equal(antes, 2);

  // 1) cliente que reenvía los ids de los módulos
  const mods = (await api('GET', `/api/cursos/${S.curso.id}`, undefined, S.adminToken)).body.modulos;
  mods[0].tituloModulo = 'Lectura (editada)';
  const r1 = await api('PUT', `/api/cursos/${S.curso.id}`, { titulo: 'Seguridad v2', modulos: mods }, S.adminToken);
  assert.equal(r1.status, 200); assert.equal(r1.body.curso.titulo, 'Seguridad v2');
  assert.deepEqual(r1.body.curso.modulos.map((m: any) => m.id), [S.modLectura, S.modQuiz]);
  assert.equal(await conteo(), 2);

  // 2) cliente que NO envía ids (como el original): se reutiliza por posición
  const sinIds = mods.map((m: any) => ({ tituloModulo: m.tituloModulo + '!', tipo: m.tipo, contenido: m.contenido }));
  const r2 = await api('PUT', `/api/cursos/${S.curso.id}`, { modulos: sinIds }, S.adminToken);
  assert.deepEqual(r2.body.curso.modulos.map((m: any) => m.id), [S.modLectura, S.modQuiz]);
  assert.equal(await conteo(), 2);

  // 3) quitar un módulo sí lo elimina (y solo su progreso); agregar uno nuevo conserva los demás
  const r3 = await api('PUT', `/api/cursos/${S.curso.id}`, { modulos: [...sinIds, { tituloModulo: 'Extra', tipo: 'lectura', contenido: {} }] }, S.adminToken);
  assert.equal(r3.body.curso.modulos.length, 3);
  assert.equal(await conteo(), 2);
  const r4 = await api('PUT', `/api/cursos/${S.curso.id}`, { modulos: [{ id: S.modQuiz, tituloModulo: 'Solo quiz', tipo: 'quiz', contenido: [] }] }, S.adminToken);
  assert.deepEqual(r4.body.curso.modulos.map((m: any) => m.id), [S.modQuiz]);
  assert.equal(await conteo(), 1);   // se fue solo el progreso del módulo eliminado

  assert.equal((await api('PUT', `/api/cursos/${S.curso.id}`, { modulos: [{ tipo: 'quiz' }] }, S.adminToken)).status, 400);
});

test('canary por funcionalidad: ranking v2 en la instancia con flag 100%, v1 con 0%', opts, async () => {
  const v2 = await api('GET', '/api/gamificacion/ranking', undefined, S.ana.token);
  assert.equal(v2.status, 200); assert.equal(v2.headers.get('x-ranking-version'), 'v2');
  const token1 = (await api('POST', '/api/auth/login', { email: 'ana@alumco.cl', password: 'secreto1' }, undefined, base2)).body.token;
  const v1 = await api('GET', '/api/gamificacion/ranking', undefined, token1, base2);
  assert.equal(v1.headers.get('x-ranking-version'), 'v1');
  assert.equal(v1.headers.get('x-app-track'), 'stable');
  // mismo contrato JSON y mismos datos en ambas versiones (v1 no ordena los empates; v2 sí)
  const norm = (b: any[]) => b.map(r => [r.id, r.puntos, r.nivel, r.insigniasCount]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  assert.deepEqual(norm(v1.body), norm(v2.body));
  const empatados = v2.body.filter((r: any) => r.puntos === 0).map((r: any) => r.nombre);
  assert.deepEqual(empatados, [...empatados].sort(), 'v2: desempate determinista por nombre');
  assert.equal(v2.body[0].nombre, 'Ana Pérez'); assert.equal(v2.body[0].posicion, 1);
  assert.equal((await api('GET', '/api/gamificacion/ranking?sede=Coyhaique%20(Region%20de%20Aysen)', undefined, S.ana.token)).body.length, 0);
});

test('métricas: cuentan solo tráfico de negocio y llevan versión/track', opts, async () => {
  const m = await api('GET', '/metrics');
  assert.equal(m.status, 200);
  assert.match(m.text, /alumco_build_info\{version="9.9.9",track="canary"\} 1/);
  assert.match(m.text, /alumco_http_requests_total\{version="9.9.9",track="canary",status="2xx"\} \d+/);
  assert.match(m.text, /alumco_http_requests_total\{version="9.9.9",track="canary",status="4xx"\} \d+/);
  assert.match(m.text, /alumco_http_request_duration_seconds_count\{version="9.9.9",track="canary"\} \d+/);
  assert.match(m.text, /alumco_db_circuit_breaker_state\{version="9.9.9",track="canary"\} 0/);
});

test('eliminar curso: solo admin', opts, async () => {
  assert.equal((await api('DELETE', `/api/cursos/${S.curso.id}`, undefined, S.ana.token)).status, 403);
  assert.equal((await api('DELETE', `/api/cursos/${S.curso.id}`, undefined, S.adminToken)).status, 200);
  assert.equal((await api('GET', `/api/cursos/${S.curso.id}`, undefined, S.adminToken)).status, 404);
});

test('apagado ordenado: al recibir SIGTERM /health/ready pasa a 503 y /health/live sigue en 200', opts, async () => {
  const env = loadEnv({ JWT_SECRET: 's', DATABASE_URL: URL } as any);
  const db = new PgDatabase(createPool(env)); dbs.push(db);
  const lifecycle = { shuttingDown: false };
  const srv = createApp(buildContainer(db, env), env, lifecycle).listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    assert.equal((await api('GET', '/health/ready', undefined, undefined, b)).status, 200);
    lifecycle.shuttingDown = true;
    const r = await api('GET', '/health/ready', undefined, undefined, b);
    assert.equal(r.status, 503); assert.equal(r.body.status, 'shutting_down');
    assert.equal((await api('GET', '/health/live', undefined, undefined, b)).status, 200);
  } finally { srv.close(); }
});

test('seed: crea admin/profesor/alumno de demo, es idempotente y permite iniciar sesión', opts, async () => {
  assert.deepEqual(S.sembrados, ['admin@alumco.cl', 'profesor@alumco.cl', 'alumno@alumco.cl']);
  assert.deepEqual(await runSeed(seed, 'otra'), []);   // segunda corrida: no duplica ni cambia contraseñas
  for (const [email, rol] of [['admin@alumco.cl', 'admin'], ['profesor@alumco.cl', 'profesor'], ['alumno@alumco.cl', 'colaborador']]) {
    const r = await api('POST', '/api/auth/login', { email, password: 'admin123' });
    assert.equal(r.status, 200, email); assert.deepEqual(r.body.usuario.rol, [rol]);
  }
});

test('GET /api lista los endpoints y todos existen realmente en el router', opts, async () => {
  const r = await api('GET', '/api');
  assert.equal(r.status, 200);
  assert.equal(r.body.totalEndpointsNegocio, 25);
  assert.equal(r.body.endpoints.length, 25);
  const por = (m: string, ruta: string) => r.body.endpoints.find((e: any) => e.metodo === m && e.ruta === ruta);
  assert.equal(por('POST', '/api/auth/login').acceso, 'pública');
  assert.equal(por('GET', '/api/auth/me').acceso, 'JWT');
  assert.equal(por('DELETE', '/api/cursos/:id').acceso, 'JWT + rol admin');
  assert.equal(por('POST', '/api/cursos').acceso, 'JWT + rol admin o profesor');
  assert.equal(r.body.sistema.length, 5);
  // Cada endpoint publicado responde (401/403/400/200...), nunca el 404 genérico de "ruta no encontrada".
  for (const e of r.body.endpoints) {
    const url = e.ruta.replace(/:\w+/g, '1');
    const res = await api(e.metodo, url, e.metodo === 'GET' || e.metodo === 'DELETE' ? undefined : {});
    assert.notEqual(res.body?.mensaje, 'Ruta no encontrada', `${e.metodo} ${e.ruta}`);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/domain/events';
import { UmbralNivelStrategy } from '../src/domain/nivel';
import { QuizService } from '../src/services/QuizService';
import { CertificadoService } from '../src/services/CertificadoService';
import { GamificacionService } from '../src/services/GamificacionService';
import { registrarSubscribersGamificacion } from '../src/subscribers/gamificacionSubscriber';
import { AppError } from '../src/domain/errors';
import type { QuizRepository, GamificacionRepository, CertificadoRepository, Row } from '../src/repositories/contracts';

/** Repositorios en memoria: demuestran que los servicios dependen de interfaces (inyección de dependencias). */
class QuizMem implements QuizRepository {
  intentos: Row[] = []; progreso = new Set<string>(); respuestas = 0;
  constructor(private preguntas: unknown) {}
  async intentosDe(u: string, m: number) { return this.intentos.filter(i => i.usuario_id === u && i.modulo_id === m).sort((a, b) => b.intento_numero - a.intento_numero); }
  async crearIntento(u: string, m: number, n: number) { const id = this.intentos.length + 1; this.intentos.push({ id, usuario_id: u, modulo_id: m, intento_numero: n, estado: 'en_progreso', puntaje: 0 }); return id; }
  async buscarIntento(id: number) { return this.intentos.find(i => i.id === id) ?? null; }
  async preguntasDe() { return this.preguntas; }
  async guardarResultado(d: any) {
    const i = this.intentos.find(x => x.id === d.intentoId && x.usuario_id === d.usuarioId && x.estado !== 'completado');
    if (!i) return false;
    Object.assign(i, { estado: 'completado', puntaje: d.puntaje, fecha_desbloqueo_temporal: d.desbloqueoEn });
    if (d.aprobado) this.progreso.add(`${d.usuarioId}:${d.moduloId}`);
    this.respuestas++; return true;
  }
}
class GamMem implements GamificacionRepository {
  puntos = new Map<string, number>(); niveles = new Map<string, string>(); insig = new Map<string, Set<string>>();
  async perfil(u: string) { return this.puntos.has(u) ? { puntos: this.puntos.get(u), nivel: this.niveles.get(u) ?? 'Aprendiz', racha_dias: 0 } : null; }
  async sumarPuntos(u: string, p: number) { const t = (this.puntos.get(u) ?? 0) + p; this.puntos.set(u, t); return t; }
  async fijarNivel(u: string, n: string) { this.niveles.set(u, n); }
  async otorgarInsignia(u: string, t: string) { this.insig.set(u, (this.insig.get(u) ?? new Set()).add(t)); }
  async insignias(u: string) { return [...(this.insig.get(u) ?? [])].map(tipo => ({ tipo })); }
  async modulosCompletados() { return 0; }
  async guardarRacha() {}
  async ranking() { return []; }
}

const preguntas = [{ opciones: [{ correcta: false }, { correcta: true }] }, { opciones: [{ correcta: true }, { correcta: false }] }];

function armar() {
  const bus = new EventBus();
  const gamRepo = new GamMem();
  const gam = new GamificacionService(gamRepo, new UmbralNivelStrategy(), bus);
  registrarSubscribersGamificacion(bus, gam);
  const quizRepo = new QuizMem(preguntas);
  let ahora = new Date('2026-10-30T12:00:00Z');
  const quiz = new QuizService(quizRepo, bus, () => ahora);
  return { bus, gamRepo, gam, quizRepo, quiz, avanzar: (h: number) => { ahora = new Date(ahora.getTime() + h * 3600_000); } };
}
const falla = async (p: Promise<unknown>, status: number) =>
  assert.rejects(p, (e: any) => e instanceof AppError && e.status === status);

test('Quiz: aprobar suma 100 puntos, otorga insignia y marca progreso (vía eventos)', async () => {
  const { quiz, gamRepo, quizRepo } = armar();
  const { intentoId, intentoNumero } = await quiz.iniciar('7', 1);
  assert.equal(intentoNumero, 1);
  const r = await quiz.enviar('7', 1, { intentoId, respuestas: [1, 0], tiempoSegundos: 30 });
  assert.deepEqual([r.puntaje, r.aprobado, r.desbloqueoEn], [100, true, null]);
  assert.equal(gamRepo.puntos.get('7'), 100);
  assert.equal(gamRepo.niveles.get('7'), 'Principiante');
  assert.ok(gamRepo.insig.get('7')!.has('quiz_aprobado_1'));
  assert.ok(quizRepo.progreso.has('7:1'));
});

test('Quiz: reprobar bloquea 24 h tras agotar intentos y no da puntos', async () => {
  const { quiz, gamRepo, avanzar } = armar();
  for (let n = 1; n <= 2; n++) {
    const { intentoId } = await quiz.iniciar('7', 1);
    const r = await quiz.enviar('7', 1, { intentoId, respuestas: [0, 1] });
    assert.equal(r.aprobado, false);
    assert.ok(r.desbloqueoEn);
  }
  assert.equal(gamRepo.puntos.size, 0);
  await assert.rejects(quiz.iniciar('7', 1), (e: any) => e.status === 403 && !!e.extra.desbloqueoEn);
  avanzar(25);
  assert.equal((await quiz.iniciar('7', 1)).intentoNumero, 3);
});

test('Quiz (IDOR): un usuario no puede enviar el intento de otro', async () => {
  const { quiz } = armar();
  const { intentoId } = await quiz.iniciar('7', 1);
  await falla(quiz.enviar('8', 1, { intentoId, respuestas: [1, 0] }), 404);
  const r = await quiz.enviar('7', 1, { intentoId, respuestas: [1, 0] });   // el dueño sí puede
  assert.equal(r.aprobado, true);
});

test('Quiz: validaciones (intento inválido, módulo distinto, reenvío)', async () => {
  const { quiz } = armar();
  await falla(quiz.enviar('7', 1, { intentoId: 'abc' }), 400);
  await falla(quiz.enviar('7', 1, { intentoId: 999 }), 404);
  const { intentoId } = await quiz.iniciar('7', 1);
  await falla(quiz.enviar('7', 2, { intentoId, respuestas: [] }), 400);
  await quiz.enviar('7', 1, { intentoId, respuestas: [1, 0] });
  await falla(quiz.enviar('7', 1, { intentoId, respuestas: [1, 0] }), 409);   // no se puede reenviar para sumar puntos otra vez
});

test('Certificado: exige todos los módulos, es idempotente, mejora puntos Y nivel (bug original)', async () => {
  const bus = new EventBus();
  const gamRepo = new GamMem();
  const gam = new GamificacionService(gamRepo, new UmbralNivelStrategy(), bus);
  registrarSubscribersGamificacion(bus, gam);
  gamRepo.puntos.set('7', 100); gamRepo.niveles.set('7', 'Principiante');

  let completados = 1; const guardados: Row[] = [];
  const certRepo: CertificadoRepository = {
    async buscar(u, c) { return guardados.find(x => x.usuario_id === u && x.curso_id === c) ?? null; },
    async crear(hash, u, c) { const f = { hash, usuario_id: u, curso_id: c }; guardados.push(f); return f; },
    async verificar(hash) { const f = guardados.find(x => x.hash === hash); return f ? { ...f, nombre_completo: 'Ana', rut: '12345678-5', curso_titulo: 'EPP', emitido_en: 'x' } : null; },
    async listarDe() { return []; },
    async contarModulosCompletados() { return completados; },
  };
  const cursos = { async buscar(id: number) { return id === 5 ? { id } : null; }, async moduloIdsDe() { return [1, 2] as number[]; } };
  const svc = new CertificadoService(certRepo, cursos, bus, 'https://front');

  await falla(svc.generar('7', 99), 404);
  await falla(svc.generar('7', 5), 400);                       // falta 1 módulo
  completados = 2;
  const r1 = await svc.generar('7', 5);
  assert.equal(r1.status, 201);
  assert.match((r1.cuerpo as any).certificado.hash, /^[0-9a-f]{64}$/);
  assert.equal(gamRepo.puntos.get('7'), 300);
  assert.equal(gamRepo.niveles.get('7'), 'Colaborador');       // antes quedaba en 'Principiante'
  assert.ok(gamRepo.insig.get('7')!.has('certificado_5'));
  const r2 = await svc.generar('7', 5);
  assert.equal(r2.status, 200);                                // idempotente
  assert.equal(gamRepo.puntos.get('7'), 300);                  // no suma dos veces
  const v = await svc.verificar((r1.cuerpo as any).certificado.hash);
  assert.equal(v.rut, '*****678-5');
  await falla(svc.verificar('x'), 404);
});

test('Gamificación: racha por eventos (insignia a los 7 días)', async () => {
  const { gam, gamRepo } = armar();
  gamRepo.puntos.set('7', 0);
  (gamRepo as any).perfil = async () => ({ racha_dias: 6, ultimo_acceso: new Date('2026-10-29T10:00:00') });
  const r = await gam.registrarAcceso('7', new Date('2026-10-30T10:00:00'));
  assert.equal(r.rachaDias, 7);
  assert.ok(gamRepo.insig.get('7')!.has('racha_7_dias'));
});

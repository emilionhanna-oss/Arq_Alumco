import type { QuizRepository } from '../repositories/contracts';
import type { EventBus } from '../domain/events';
import { AppError } from '../domain/errors';
import { BLOQUEO_HORAS, MAX_INTENTOS, PUNTAJE_MINIMO, calificar, type Pregunta } from '../domain/calificacion';

export class QuizService {
  constructor(
    private readonly repo: QuizRepository,
    private readonly bus: EventBus,
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  async iniciar(usuarioId: string, moduloId: number) {
    const intentos = await this.repo.intentosDe(usuarioId, moduloId);
    const completados = intentos.filter(i => i.estado === 'completado').length;
    if (completados >= MAX_INTENTOS) {
      const ultimo = intentos[0];
      if (ultimo?.fecha_desbloqueo_temporal && new Date(ultimo.fecha_desbloqueo_temporal) > this.ahora()) {
        throw new AppError(403, 'Máximo de intentos alcanzado', { desbloqueoEn: ultimo.fecha_desbloqueo_temporal });
      }
    }
    const intentoId = await this.repo.crearIntento(usuarioId, moduloId, completados + 1);
    return { intentoId, intentoNumero: completados + 1 };
  }

  async enviar(usuarioId: string, moduloId: number, body: { intentoId?: unknown; respuestas?: unknown; tiempoSegundos?: unknown }) {
    const intentoId = Number(body.intentoId);
    if (!Number.isInteger(intentoId) || intentoId <= 0) throw new AppError(400, 'intentoId inválido');

    // Antes el UPDATE solo filtraba por id: cualquier usuario podía cerrar/manipular intentos ajenos.
    const intento = await this.repo.buscarIntento(intentoId);
    if (!intento || String(intento.usuario_id) !== usuarioId) throw new AppError(404, 'Intento no encontrado');
    if (Number(intento.modulo_id) !== moduloId) throw new AppError(400, 'El intento no corresponde a este módulo');
    if (intento.estado === 'completado') throw new AppError(409, 'El intento ya fue enviado');

    const preguntas = await this.repo.preguntasDe(moduloId);
    if (preguntas === null) throw new AppError(404, 'Módulo quiz no encontrado');
    if (!Array.isArray(preguntas) || preguntas.length === 0) throw new AppError(400, 'Sin preguntas configuradas');

    const resultado = calificar(preguntas as Pregunta[], body.respuestas);
    const desbloqueoEn = resultado.aprobado ? null : new Date(this.ahora().getTime() + BLOQUEO_HORAS * 3600_000).toISOString();

    const guardado = await this.repo.guardarResultado({
      intentoId, usuarioId, moduloId, puntaje: resultado.puntaje,
      tiempoSegundos: Number(body.tiempoSegundos) || 0, desbloqueoEn,
      aprobado: resultado.aprobado, respuestas: body.respuestas,
    });
    if (!guardado) throw new AppError(409, 'El intento ya fue enviado');

    if (resultado.aprobado) {
      await this.bus.emit('quiz.aprobado', { usuarioId, moduloId: String(moduloId), puntaje: resultado.puntaje });
    }
    return { puntaje: resultado.puntaje, aprobado: resultado.aprobado, correctas: resultado.correctas, total: resultado.total, desbloqueoEn };
  }

  async estado(usuarioId: string, moduloId: number) {
    const rows = await this.repo.intentosDe(usuarioId, moduloId);
    const completados = rows.filter(i => i.estado === 'completado').length;
    const mejor = rows.reduce((max: (typeof rows)[number] | null, i) => (i.puntaje > (max?.puntaje || 0) ? i : max), null);
    return {
      intentosRealizados: completados,
      intentosRestantes: Math.max(0, MAX_INTENTOS - completados),
      mejorPuntaje: mejor?.puntaje || 0,
      aprobado: (mejor?.puntaje || 0) >= PUNTAJE_MINIMO,
      desbloqueoEn: rows[0]?.fecha_desbloqueo_temporal || null,
      historial: rows,
    };
  }
}

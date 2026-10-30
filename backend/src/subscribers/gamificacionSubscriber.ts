import type { EventBus } from '../domain/events';
import type { GamificacionService } from '../services/GamificacionService';

export const PUNTOS_QUIZ_APROBADO = 100;
export const PUNTOS_CERTIFICADO = 200;
export const DIAS_INSIGNIA_RACHA = 7;

/** Observadores: reaccionan a hechos del dominio, así quiz y certificados no conocen las reglas de puntos. */
export function registrarSubscribersGamificacion(bus: EventBus, gamificacion: GamificacionService): void {
  bus.on('quiz.aprobado', async ({ usuarioId, moduloId }) => {
    await gamificacion.sumarPuntos(usuarioId, PUNTOS_QUIZ_APROBADO);
    await gamificacion.otorgarInsignia(usuarioId, `quiz_aprobado_${moduloId}`);
  });

  bus.on('certificado.emitido', async ({ usuarioId, cursoId }) => {
    await gamificacion.otorgarInsignia(usuarioId, `certificado_${cursoId}`);
    await gamificacion.sumarPuntos(usuarioId, PUNTOS_CERTIFICADO);
  });

  bus.on('acceso.registrado', async ({ usuarioId, rachaDias }) => {
    if (rachaDias >= DIAS_INSIGNIA_RACHA) await gamificacion.otorgarInsignia(usuarioId, 'racha_7_dias');
  });
}

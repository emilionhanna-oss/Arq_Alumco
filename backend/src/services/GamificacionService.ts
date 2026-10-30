import type { GamificacionRepository } from '../repositories/contracts';
import type { NivelStrategy } from '../domain/nivel';
import type { EventBus } from '../domain/events';
import { calcularRacha } from '../domain/racha';

export class GamificacionService {
  constructor(
    private readonly repo: GamificacionRepository,
    private readonly nivel: NivelStrategy,
    private readonly bus: EventBus,
  ) {}

  /** Único punto donde se suman puntos: siempre recalcula el nivel (antes los certificados no lo hacían). */
  async sumarPuntos(usuarioId: string, puntos: number): Promise<{ puntos: number; nivel: string }> {
    const total = await this.repo.sumarPuntos(usuarioId, puntos);
    const nivel = this.nivel.calcular(total);
    await this.repo.fijarNivel(usuarioId, nivel);
    return { puntos: total, nivel };
  }

  otorgarInsignia(usuarioId: string, tipo: string) {
    return this.repo.otorgarInsignia(usuarioId, tipo);
  }

  async perfil(usuarioId: string) {
    const [fila, insignias, modulos] = await Promise.all([
      this.repo.perfil(usuarioId), this.repo.insignias(usuarioId), this.repo.modulosCompletados(usuarioId),
    ]);
    const datos = fila ?? { puntos: 0, nivel: 'Aprendiz', racha_dias: 0, ultimo_acceso: undefined };
    return {
      puntos: datos.puntos, nivel: datos.nivel, rachaDias: datos.racha_dias, ultimoAcceso: datos.ultimo_acceso,
      insignias: insignias.map(i => i.tipo), modulosCompletados: modulos,
    };
  }

  async registrarAcceso(usuarioId: string, hoy: Date = new Date()): Promise<{ rachaDias: number }> {
    const fila = await this.repo.perfil(usuarioId);
    const ultimo = fila?.ultimo_acceso ? new Date(fila.ultimo_acceso) : null;
    const { rachaDias, cambio } = calcularRacha(ultimo, fila?.racha_dias ?? 0, hoy);
    if (cambio) {
      await this.repo.guardarRacha(usuarioId, rachaDias);
      await this.bus.emit('acceso.registrado', { usuarioId, rachaDias });
    }
    return { rachaDias };
  }

  async ranking(sede: string | undefined, version: 'v1' | 'v2') {
    const rows = await this.repo.ranking(sede, version);
    return rows.map((r, i) => ({
      posicion: i + 1, id: String(r.id), nombre: r.nombre_completo || r.nombre, sede: r.sede,
      puntos: r.puntos, nivel: r.nivel, rachaDias: r.racha_dias,
      insigniasCount: Number(r.insignias_count), modulosCompletados: Number(r.modulos_completados),
    }));
  }

  async insignias(usuarioId: string) {
    return this.repo.insignias(usuarioId);
  }
}

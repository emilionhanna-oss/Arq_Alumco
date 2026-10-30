/** Patrón Observer: los casos de uso publican hechos de dominio; la gamificación los observa. */
export interface DomainEvents {
  'quiz.aprobado': { usuarioId: string; moduloId: string; puntaje: number };
  'certificado.emitido': { usuarioId: string; cursoId: string };
  'acceso.registrado': { usuarioId: string; rachaDias: number };
}

type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => Promise<void> | void;

export class EventBus {
  private readonly handlers = new Map<keyof DomainEvents, Array<Handler<any>>>();

  on<K extends keyof DomainEvents>(evento: K, handler: Handler<K>): void {
    this.handlers.set(evento, [...(this.handlers.get(evento) ?? []), handler]);
  }

  /** Espera a todos los observadores; un observador que falla no rompe al emisor ni a los demás. */
  async emit<K extends keyof DomainEvents>(evento: K, payload: DomainEvents[K]): Promise<void> {
    for (const h of (this.handlers.get(evento) ?? []) as Handler<K>[]) {
      try {
        await h(payload);
      } catch (err) {
        console.error(`Observador de "${evento}" falló:`, err);
      }
    }
  }
}

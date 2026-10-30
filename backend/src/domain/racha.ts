export interface RachaResultado {
  rachaDias: number;
  /** false si ya se había registrado un acceso hoy (no hay nada que persistir). */
  cambio: boolean;
}

const mismoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/**
 * Racha diaria. Corrige el caso del primer acceso: un usuario registrado tiene fila de gamificación
 * con racha 0 y `ultimo_acceso` nulo; antes su racha se quedaba en 0 para siempre.
 */
export function calcularRacha(ultimoAcceso: Date | null, rachaActual: number, hoy: Date = new Date()): RachaResultado {
  if (!ultimoAcceso) return { rachaDias: 1, cambio: true };
  if (mismoDia(ultimoAcceso, hoy)) return { rachaDias: rachaActual, cambio: false };
  const ayer = new Date(hoy);
  ayer.setDate(ayer.getDate() - 1);
  return { rachaDias: mismoDia(ultimoAcceso, ayer) ? rachaActual + 1 : 1, cambio: true };
}

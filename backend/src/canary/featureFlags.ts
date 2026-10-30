import { createHash } from 'crypto';

/**
 * Canary a nivel de funcionalidad (feature toggle con porcentaje).
 * El bucket depende de (flag, usuario) de forma determinista: un usuario siempre ve la misma versión
 * y subir el porcentaje solo suma usuarios, nunca los reasigna.
 */
export function bucket(flag: string, usuarioId: string): number {
  const digest = createHash('sha256').update(`${flag}:${usuarioId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export class FeatureFlags {
  constructor(private readonly porcentajes: Readonly<Record<string, number>>) {}

  porcentaje(flag: string): number {
    return this.porcentajes[flag] ?? 0;
  }

  isEnabled(flag: string, usuarioId: string): boolean {
    const pct = this.porcentaje(flag);
    if (pct >= 100) return true;
    if (pct <= 0) return false;
    return bucket(flag, usuarioId) < pct;
  }

  snapshot(): Record<string, number> {
    return { ...this.porcentajes };
  }
}

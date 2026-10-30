/** Patrón Strategy: cómo se traduce un puntaje en un rango. Se puede cambiar sin tocar los servicios. */
export interface NivelStrategy {
  calcular(puntos: number): string;
}

export interface Umbral {
  min: number;
  nivel: string;
}

export const UMBRALES_POR_DEFECTO: ReadonlyArray<Umbral> = [
  { min: 1000, nivel: 'Maestro' },
  { min: 500, nivel: 'Experto' },
  { min: 200, nivel: 'Colaborador' },
  { min: 50, nivel: 'Principiante' },
  { min: 0, nivel: 'Aprendiz' },
];

export class UmbralNivelStrategy implements NivelStrategy {
  private readonly umbrales: ReadonlyArray<Umbral>;

  constructor(umbrales: ReadonlyArray<Umbral> = UMBRALES_POR_DEFECTO) {
    this.umbrales = [...umbrales].sort((a, b) => b.min - a.min);
  }

  calcular(puntos: number): string {
    return this.umbrales.find(u => puntos >= u.min)?.nivel ?? 'Aprendiz';
  }
}

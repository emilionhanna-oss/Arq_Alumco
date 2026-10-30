export const MAX_INTENTOS = 2;
export const PUNTAJE_MINIMO = 60;
export const BLOQUEO_HORAS = 24;

export interface Pregunta {
  opciones?: Array<{ correcta?: boolean }>;
  [clave: string]: unknown;
}

export interface Resultado {
  correctas: number;
  total: number;
  puntaje: number;
  aprobado: boolean;
}

/** Función pura: califica un quiz. Las respuestas son índices de opción por pregunta. */
export function calificar(preguntas: Pregunta[], respuestas: unknown): Resultado {
  const total = preguntas.length;
  let correctas = 0;
  preguntas.forEach((pregunta, i) => {
    const idxCorrecta = pregunta.opciones?.findIndex(o => o.correcta) ?? -1;
    const dada = Array.isArray(respuestas) ? respuestas[i] : (respuestas as any)?.[i];
    if (idxCorrecta >= 0 && dada !== undefined && dada !== null && Number(dada) === idxCorrecta) correctas++;
  });
  const puntaje = total === 0 ? 0 : Math.round((correctas / total) * 100);
  return { correctas, total, puntaje, aprobado: puntaje >= PUNTAJE_MINIMO };
}

/** Quita `correcta` de las opciones: el alumno no debe recibir las respuestas junto con las preguntas. */
export function ocultarRespuestas(contenido: unknown): unknown {
  if (!Array.isArray(contenido)) return contenido;
  return contenido.map((p: any) =>
    p && Array.isArray(p.opciones)
      ? { ...p, opciones: p.opciones.map((o: any) => { const { correcta, ...resto } = o ?? {}; return resto; }) }
      : p,
  );
}

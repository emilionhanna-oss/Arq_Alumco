/** Error de negocio con código HTTP. El middleware de errores lo traduce a { mensaje, ...extra }. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** La base de datos no está disponible (circuito abierto o timeout). */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Servicio temporalmente no disponible') {
    super(503, message);
    this.name = 'ServiceUnavailableError';
  }
}

export function parseId(valor: unknown, nombre = 'id'): number {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(400, `${nombre} inválido`);
  return n;
}

/**
 * Contratos del patrón Repository. Los servicios dependen de estas interfaces (no de `pg`),
 * lo que permite probarlos con repositorios en memoria y cambiar el motor de persistencia.
 */
export type Row = Record<string, any>;

export type CampoUsuario =
  | 'nombre' | 'nombreCompleto' | 'email' | 'rut' | 'cargo' | 'fechaExpiracion'
  | 'estado' | 'sedeId' | 'genero' | 'firmaTexto' | 'firmaImagenDataUrl';

export interface NuevoColaborador {
  email: string;
  passwordHash: string;
  nombreCompleto: string;
  nombre: string;
  rut: string;
  genero: string;
  sedeId: number;
  cargo: string;
}

export interface UsuarioRepository {
  buscarPorEmail(email: string): Promise<Row | null>;
  buscarPorId(id: number | string): Promise<Row | null>;
  estadoAuth(id: number | string): Promise<{ id: number; estado: string; fecha_expiracion: Date | null; roles: string[] } | null>;
  existeEmail(email: string): Promise<boolean>;
  existeRut(rut: string): Promise<boolean>;
  /** Crea usuario + rol "colaborador" + fila de gamificación en una sola transacción. */
  crearColaborador(datos: NuevoColaborador): Promise<number>;
  roles(id: number | string): Promise<string[]>;
  rolesDe(ids: number[]): Promise<Map<number, string[]>>;
  listar(): Promise<Row[]>;
  marcarVencidos(ids: number[]): Promise<void>;
  actualizar(id: number | string, cambios: Partial<Record<CampoUsuario, unknown>>): Promise<void>;
  reemplazarRoles(id: number | string, roles: string[]): Promise<void>;
}

export interface SedeRepository {
  listar(): Promise<Row[]>;
  idPorNombre(nombre: string): Promise<number | null>;
}

export interface ModuloEntrada {
  id?: number | string;
  titulo: string;
  tipo: string;
  contenido?: unknown;
}

export interface CursoRepository {
  listarTodos(): Promise<Row[]>;
  listarPublicadosDe(usuarioId: number | string): Promise<Row[]>;
  buscar(id: number): Promise<Row | null>;
  inscrito(cursoId: number, usuarioId: number | string): Promise<boolean>;
  modulosDe(cursoIds: number[]): Promise<Map<number, Row[]>>;
  alumnosDe(cursoIds: number[]): Promise<Map<number, string[]>>;
  moduloIdsDe(cursoId: number): Promise<number[]>;
  crear(d: { titulo: string; descripcion: string; imagenUrl: string; instructorId: number | string; modulos?: ModuloEntrada[] }): Promise<Row>;
  actualizar(id: number, d: { titulo?: string; descripcion?: string; imagenUrl?: string; publicado?: boolean; modulos?: ModuloEntrada[] }): Promise<void>;
  eliminar(id: number): Promise<void>;
  asignarAlumnos(id: number, usuarioIds: Array<number | string>): Promise<void>;
}

export interface GuardarResultado {
  intentoId: number;
  usuarioId: string;
  moduloId: number;
  puntaje: number;
  tiempoSegundos: number;
  desbloqueoEn: string | null;
  aprobado: boolean;
  respuestas: unknown;
}

export interface QuizRepository {
  intentosDe(usuarioId: string, moduloId: number): Promise<Row[]>;
  crearIntento(usuarioId: string, moduloId: number, numero: number): Promise<number>;
  buscarIntento(intentoId: number): Promise<Row | null>;
  preguntasDe(moduloId: number): Promise<unknown | null>;
  /** Atómico: cierra el intento, marca progreso si aprobó y guarda las respuestas. false si ya estaba cerrado. */
  guardarResultado(d: GuardarResultado): Promise<boolean>;
}

export interface GamificacionRepository {
  perfil(usuarioId: string): Promise<Row | null>;
  sumarPuntos(usuarioId: string, puntos: number): Promise<number>;
  fijarNivel(usuarioId: string, nivel: string): Promise<void>;
  otorgarInsignia(usuarioId: string, tipo: string): Promise<void>;
  insignias(usuarioId: string): Promise<Row[]>;
  modulosCompletados(usuarioId: string): Promise<number>;
  guardarRacha(usuarioId: string, rachaDias: number): Promise<void>;
  ranking(sede: string | undefined, version: 'v1' | 'v2'): Promise<Row[]>;
}

export interface CertificadoRepository {
  buscar(usuarioId: string, cursoId: number): Promise<Row | null>;
  /** Idempotente: si ya existe devuelve el existente. */
  crear(hash: string, usuarioId: string, cursoId: number): Promise<Row>;
  verificar(hash: string): Promise<Row | null>;
  listarDe(usuarioId: string): Promise<Row[]>;
  contarModulosCompletados(usuarioId: string, moduloIds: number[]): Promise<number>;
}

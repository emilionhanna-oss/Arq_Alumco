import type { CursoRepository, ModuloEntrada, Row } from '../repositories/contracts';
import { AppError } from '../domain/errors';
import { toCursoDto } from '../mappers';
import type { AuthUser } from './AuthService';

const esStaff = (u: AuthUser) => u.rol.includes('admin') || u.rol.includes('profesor');

function normalizarModulos(raw: unknown): ModuloEntrada[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new AppError(400, 'modulos debe ser un arreglo');
  return raw.map((m: any, i: number) => {
    const titulo = m?.tituloModulo || m?.titulo;
    if (!titulo || !m?.tipo) throw new AppError(400, `El módulo ${i + 1} requiere título y tipo`);
    return { id: m.id, titulo, tipo: m.tipo, contenido: m.contenido };
  });
}

export class CursoService {
  constructor(private readonly repo: CursoRepository) {}

  private async armar(cursos: Row[], verRespuestas: boolean) {
    const ids = cursos.map(c => c.id);
    const [modulos, alumnos] = await Promise.all([this.repo.modulosDe(ids), this.repo.alumnosDe(ids)]);
    return cursos.map(c => toCursoDto(c, modulos.get(c.id) ?? [], alumnos.get(c.id) ?? [], verRespuestas));
  }

  async listar(user: AuthUser, todos: boolean) {
    const admin = user.rol.includes('admin');
    const cursos = admin && todos ? await this.repo.listarTodos() : await this.repo.listarPublicadosDe(user.id);
    return this.armar(cursos, esStaff(user));
  }

  async obtener(user: AuthUser, id: number) {
    const curso = await this.repo.buscar(id);
    if (!curso) throw new AppError(404, 'Curso no encontrado');
    if (!esStaff(user) && !(await this.repo.inscrito(id, user.id))) throw new AppError(403, 'No estás inscrito');
    return (await this.armar([curso], esStaff(user)))[0];
  }

  async crear(user: AuthUser, body: Record<string, any>) {
    if (!body.titulo) throw new AppError(400, 'El título es obligatorio');
    const curso = await this.repo.crear({
      titulo: body.titulo, descripcion: body.descripcion || '', imagenUrl: body.imagenUrl || '/course-images/default.svg',
      instructorId: user.id, modulos: normalizarModulos(body.modulos),
    });
    return { success: true, curso: (await this.armar([curso], true))[0] };
  }

  async actualizar(id: number, body: Record<string, any>) {
    if (!(await this.repo.buscar(id))) throw new AppError(404, 'Curso no encontrado');
    await this.repo.actualizar(id, {
      titulo: body.titulo, descripcion: body.descripcion, imagenUrl: body.imagenUrl,
      publicado: body.publicado, modulos: normalizarModulos(body.modulos),
    });
    return { success: true, curso: (await this.armar([(await this.repo.buscar(id))!], true))[0] };
  }

  async eliminar(id: number) {
    if (!(await this.repo.buscar(id))) throw new AppError(404, 'Curso no encontrado');
    await this.repo.eliminar(id);
    return { success: true, id: String(id) };
  }

  async asignarAlumnos(id: number, alumnosInscritos: unknown) {
    if (!Array.isArray(alumnosInscritos)) throw new AppError(400, 'alumnosInscritos debe ser un array');
    const curso = await this.repo.buscar(id);
    if (!curso) throw new AppError(404, 'Curso no encontrado');
    await this.repo.asignarAlumnos(id, alumnosInscritos);
    return { success: true, curso: (await this.armar([curso], true))[0] };
  }
}

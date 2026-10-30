import type { Row } from './repositories/contracts';
import { ocultarRespuestas } from './domain/calificacion';

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Mapper único (antes buildUser y buildUsuario estaban duplicados). El contrato JSON no cambia. */
export function toUsuarioDto(u: Row, roles: string[], sede: string | null) {
  return {
    id: String(u.id), email: u.email, nombre: u.nombre, nombreCompleto: u.nombre_completo,
    genero: u.genero, rut: u.rut, sede, cargo: u.cargo, estado: u.estado, rol: roles,
    fechaRegistro: iso(u.fecha_registro), fechaExpiracion: iso(u.fecha_expiracion),
  };
}

export function toCursoDto(row: Row, modulos: Row[], alumnos: string[], verRespuestas: boolean) {
  return {
    id: String(row.id), titulo: row.titulo, descripcion: row.descripcion,
    imagenUrl: row.imagen_url || '/course-images/default.svg',
    publicado: row.publicado, instructorId: row.instructor_id ? String(row.instructor_id) : null,
    creadoEn: row.creado_en,
    modulos: modulos.map(m => ({
      id: m.id, tituloModulo: m.titulo, tipo: m.tipo,
      contenido: verRespuestas || m.tipo !== 'quiz' ? m.contenido : ocultarRespuestas(m.contenido),
      materialUrl: m.material_url, orden: m.orden,
    })),
    alumnosInscritos: alumnos,
  };
}

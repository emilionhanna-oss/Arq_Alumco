import type { SedeRepository, UsuarioRepository } from '../repositories/contracts';
import { AppError } from '../domain/errors';
import { toUsuarioDto } from '../mappers';

const ESTADOS = ['pendiente', 'activo', 'vencido'];
const ROLES = ['admin', 'profesor', 'colaborador'];

export class UsuarioService {
  constructor(private readonly usuarios: UsuarioRepository, private readonly sedes: SedeRepository) {}

  async listar() {
    const rows = await this.usuarios.listar();
    const ahora = Date.now();
    const vencidos = rows.filter(u => u.fecha_expiracion && new Date(u.fecha_expiracion).getTime() <= ahora);
    await this.usuarios.marcarVencidos(vencidos.filter(u => u.estado !== 'vencido').map(u => u.id));
    const roles = await this.usuarios.rolesDe(rows.map(u => u.id)); // 1 consulta (antes: 1 por usuario)
    return rows.map(u => {
      const estado = u.fecha_expiracion && new Date(u.fecha_expiracion).getTime() <= ahora ? 'vencido' : u.estado;
      return toUsuarioDto({ ...u, estado }, roles.get(u.id) ?? [], u.sede_nombre);
    });
  }

  async obtener(id: number) {
    const u = await this.usuarios.buscarPorId(id);
    if (!u) throw new AppError(404, 'Usuario no encontrado');
    return toUsuarioDto(u, await this.usuarios.roles(id), u.sede_nombre);
  }

  async actualizar(id: number, body: Record<string, any>) {
    const existente = await this.usuarios.buscarPorId(id);
    if (!existente) throw new AppError(404, 'Usuario no encontrado');
    const { nombre, nombreCompleto, email, rut, cargo, sede, estado, rol, fechaExpiracion } = body;

    if (estado !== undefined && !ESTADOS.includes(estado)) throw new AppError(400, 'Estado inválido');
    if (rol !== undefined && (!Array.isArray(rol) || rol.some(r => !ROLES.includes(r)))) throw new AppError(400, 'Rol inválido');

    let sedeId: number | undefined;
    if (sede !== undefined) sedeId = (await this.sedes.idPorNombre(sede)) ?? undefined;

    await this.usuarios.actualizar(id, {
      nombre, nombreCompleto, rut, cargo, fechaExpiracion, sedeId,
      email: email !== undefined ? String(email).toLowerCase() : undefined,
      estado: estado || (existente.estado === 'pendiente' ? 'activo' : existente.estado),
    });
    if (Array.isArray(rol) && rol.length > 0) await this.usuarios.reemplazarRoles(id, rol);
    return { success: true, usuario: await this.obtener(id) };
  }

  async miPerfil(id: string) {
    const u = await this.usuarios.buscarPorId(id);
    if (!u) throw new AppError(404, 'No encontrado');
    return toUsuarioDto(u, await this.usuarios.roles(id), u.sede_nombre);
  }

  async actualizarPerfil(id: string, body: Record<string, any>) {
    const { nombre, nombreCompleto, genero, firmaTexto, firmaImagenDataUrl } = body;
    await this.usuarios.actualizar(id, { nombre, nombreCompleto, genero, firmaTexto, firmaImagenDataUrl });
    return this.miPerfil(id);
  }
}

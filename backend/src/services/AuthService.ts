import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { SedeRepository, UsuarioRepository, Row } from '../repositories/contracts';
import { AppError } from '../domain/errors';
import { toUsuarioDto } from '../mappers';

export interface AuthUser {
  id: string;
  rol: string[];
}

const venceYa = (u: { fecha_expiracion: unknown; estado: string }) =>
  !!u.fecha_expiracion && new Date(u.fecha_expiracion as string).getTime() <= Date.now();

export class AuthService {
  constructor(
    private readonly usuarios: UsuarioRepository,
    private readonly sedes: SedeRepository,
    private readonly jwtSecret: string,
  ) {}

  /** Aplica la expiración y rechaza cuentas pendientes/vencidas (misma regla en login y en cada request). */
  private async exigirCuentaActiva(user: { id: number; fecha_expiracion: unknown; estado: string }) {
    let estado = user.estado;
    if (venceYa(user) && estado !== 'vencido') {
      await this.usuarios.marcarVencidos([user.id]);
      estado = 'vencido';
    }
    if (estado === 'pendiente') throw new AppError(403, 'Cuenta pendiente de aprobación');
    if (estado === 'vencido') throw new AppError(403, 'Cuenta vencida');
  }

  async login(emailRaw: unknown, password: unknown) {
    if (!emailRaw || !password) throw new AppError(400, 'Email y contraseña requeridos');
    const user = await this.usuarios.buscarPorEmail(String(emailRaw).trim().toLowerCase());
    if (!user || !(await bcrypt.compare(String(password), user.password_hash))) throw new AppError(401, 'Credenciales incorrectas');

    await this.exigirCuentaActiva(user as any);
    const roles = await this.usuarios.roles(user.id);
    const token = jwt.sign({ id: user.id, rol: roles }, this.jwtSecret, { expiresIn: '8h' });
    return { mensaje: 'Login exitoso', token, usuario: toUsuarioDto(user, roles, user.sede_nombre) };
  }

  async registrar(body: Record<string, any>) {
    const { nombreCompleto, email, password, confirmPassword, genero, sede, rut, cargo } = body;
    if (!nombreCompleto || !email || !password || !genero || !sede || !rut) throw new AppError(400, 'Todos los campos son obligatorios');
    if (password !== confirmPassword) throw new AppError(400, 'Las contraseñas no coinciden');
    if (String(password).length < 6) throw new AppError(400, 'Mínimo 6 caracteres');

    const emailNorm = String(email).trim().toLowerCase();
    if (await this.usuarios.existeEmail(emailNorm)) throw new AppError(400, 'Correo ya registrado');
    if (await this.usuarios.existeRut(rut)) throw new AppError(400, 'RUT ya registrado');
    const sedeId = await this.sedes.idPorNombre(sede);
    if (sedeId === null) throw new AppError(400, 'Sede no válida');

    await this.usuarios.crearColaborador({
      email: emailNorm, passwordHash: await bcrypt.hash(String(password), 12), nombreCompleto,
      nombre: String(nombreCompleto).trim().split(' ')[0], rut, genero, sedeId, cargo: cargo || 'Pendiente de asignación',
    });
    return { mensaje: 'Registro exitoso. Pendiente de aprobación.' };
  }

  listarSedes() {
    return this.sedes.listar();
  }

  /** Usado por el middleware: valida el JWT y relee estado/roles desde la BD en cada request. */
  async autenticar(token: string): Promise<AuthUser> {
    let decoded: { id: string };
    try {
      decoded = jwt.verify(token, this.jwtSecret) as { id: string };
    } catch {
      throw new AppError(401, 'Token inválido o expirado');
    }
    const user = await this.usuarios.estadoAuth(decoded.id);
    if (!user) throw new AppError(401, 'Usuario no encontrado');
    await this.exigirCuentaActiva(user);
    return { id: String(user.id), rol: user.roles || [] };
  }

  async me(id: string) {
    const user: Row | null = await this.usuarios.buscarPorId(id);
    if (!user) throw new AppError(404, 'No encontrado');
    return toUsuarioDto(user, await this.usuarios.roles(user.id), user.sede_nombre);
  }
}

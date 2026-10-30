import type { Database } from '../../db/Database';
import type { CampoUsuario, NuevoColaborador, Row, UsuarioRepository } from '../contracts';

/** Lista blanca: solo estas claves del DTO llegan al UPDATE, y siempre con nombre de columna fijo. */
const COLUMNAS: Record<CampoUsuario, string> = {
  nombre: 'nombre', nombreCompleto: 'nombre_completo', email: 'email', rut: 'rut', cargo: 'cargo',
  fechaExpiracion: 'fecha_expiracion', estado: 'estado', sedeId: 'sede_id', genero: 'genero',
  firmaTexto: 'firma_texto', firmaImagenDataUrl: 'firma_imagen_data_url',
};

const SELECT_CON_SEDE = `SELECT u.*, s.nombre AS sede_nombre FROM usuarios u LEFT JOIN sedes s ON s.id = u.sede_id`;

export class PgUsuarioRepository implements UsuarioRepository {
  constructor(private readonly db: Database) {}

  async buscarPorEmail(email: string): Promise<Row | null> {
    const { rows } = await this.db.query(`${SELECT_CON_SEDE} WHERE u.email = $1`, [email]);
    return rows[0] ?? null;
  }

  async buscarPorId(id: number | string): Promise<Row | null> {
    const { rows } = await this.db.query(`${SELECT_CON_SEDE} WHERE u.id = $1`, [id]);
    return rows[0] ?? null;
  }

  async estadoAuth(id: number | string) {
    const { rows } = await this.db.query(
      `SELECT u.id, u.estado, u.fecha_expiracion,
              COALESCE(array_agg(r.rol) FILTER (WHERE r.rol IS NOT NULL), '{}') AS roles
       FROM usuarios u LEFT JOIN usuario_roles r ON r.usuario_id = u.id
       WHERE u.id = $1 GROUP BY u.id`,
      [id],
    );
    return rows[0] ?? null;
  }

  async existeEmail(email: string): Promise<boolean> {
    const { rows } = await this.db.query('SELECT 1 FROM usuarios WHERE email = $1', [email]);
    return rows.length > 0;
  }

  async existeRut(rut: string): Promise<boolean> {
    const { rows } = await this.db.query('SELECT 1 FROM usuarios WHERE rut = $1', [rut]);
    return rows.length > 0;
  }

  async crearColaborador(d: NuevoColaborador): Promise<number> {
    return this.db.transaction(async tx => {
      const { rows } = await tx.query(
        `INSERT INTO usuarios (email, password_hash, nombre_completo, nombre, rut, genero, sede_id, cargo, estado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pendiente') RETURNING id`,
        [d.email, d.passwordHash, d.nombreCompleto, d.nombre, d.rut, d.genero, d.sedeId, d.cargo],
      );
      const id = rows[0].id as number;
      await tx.query('INSERT INTO usuario_roles (usuario_id, rol) VALUES ($1,$2)', [id, 'colaborador']);
      await tx.query('INSERT INTO gamificacion_puntos (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
      return id;
    });
  }

  async roles(id: number | string): Promise<string[]> {
    const { rows } = await this.db.query('SELECT rol FROM usuario_roles WHERE usuario_id = $1', [id]);
    return rows.map(r => r.rol);
  }

  async rolesDe(ids: number[]): Promise<Map<number, string[]>> {
    const mapa = new Map<number, string[]>();
    if (ids.length === 0) return mapa;
    const { rows } = await this.db.query('SELECT usuario_id, rol FROM usuario_roles WHERE usuario_id = ANY($1)', [ids]);
    for (const r of rows) mapa.set(r.usuario_id, [...(mapa.get(r.usuario_id) ?? []), r.rol]);
    return mapa;
  }

  async listar(): Promise<Row[]> {
    const { rows } = await this.db.query(`${SELECT_CON_SEDE} ORDER BY u.fecha_registro DESC`);
    return rows;
  }

  async marcarVencidos(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.query(`UPDATE usuarios SET estado = 'vencido' WHERE id = ANY($1)`, [ids]);
  }

  async actualizar(id: number | string, cambios: Partial<Record<CampoUsuario, unknown>>): Promise<void> {
    const sets: string[] = [];
    const valores: unknown[] = [];
    for (const [clave, valor] of Object.entries(cambios) as Array<[CampoUsuario, unknown]>) {
      if (valor === undefined || !(clave in COLUMNAS)) continue;
      valores.push(valor);
      sets.push(`${COLUMNAS[clave]} = $${valores.length}`);
    }
    if (sets.length === 0) return;
    valores.push(id);
    await this.db.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = $${valores.length}`, valores);
  }

  async reemplazarRoles(id: number | string, roles: string[]): Promise<void> {
    await this.db.transaction(async tx => {
      await tx.query('DELETE FROM usuario_roles WHERE usuario_id = $1', [id]);
      for (const rol of roles) {
        await tx.query('INSERT INTO usuario_roles (usuario_id, rol) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, rol]);
      }
    });
  }
}

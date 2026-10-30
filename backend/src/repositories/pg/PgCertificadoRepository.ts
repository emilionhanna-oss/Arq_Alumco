import type { Database } from '../../db/Database';
import type { CertificadoRepository, Row } from '../contracts';

export class PgCertificadoRepository implements CertificadoRepository {
  constructor(private readonly db: Database) {}

  async buscar(usuarioId: string, cursoId: number): Promise<Row | null> {
    return (await this.db.query('SELECT * FROM certificados_emitidos WHERE usuario_id=$1 AND curso_id=$2', [usuarioId, cursoId])).rows[0] ?? null;
  }

  async crear(hash: string, usuarioId: string, cursoId: number): Promise<Row> {
    const { rows } = await this.db.query(
      'INSERT INTO certificados_emitidos (hash, usuario_id, curso_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *',
      [hash, usuarioId, cursoId],
    );
    return rows[0] ?? (await this.buscar(usuarioId, cursoId))!;
  }

  async verificar(hash: string): Promise<Row | null> {
    const { rows } = await this.db.query(
      `SELECT ce.*, u.nombre_completo, u.rut, c.titulo AS curso_titulo FROM certificados_emitidos ce
       INNER JOIN usuarios u ON u.id = ce.usuario_id INNER JOIN cursos c ON c.id = ce.curso_id WHERE ce.hash = $1`,
      [hash],
    );
    return rows[0] ?? null;
  }

  async listarDe(usuarioId: string): Promise<Row[]> {
    const { rows } = await this.db.query(
      `SELECT ce.*, c.titulo AS curso_titulo, c.imagen_url FROM certificados_emitidos ce
       INNER JOIN cursos c ON c.id = ce.curso_id WHERE ce.usuario_id = $1 ORDER BY ce.emitido_en DESC`,
      [usuarioId],
    );
    return rows;
  }

  async contarModulosCompletados(usuarioId: string, moduloIds: number[]): Promise<number> {
    if (moduloIds.length === 0) return 0;
    const { rows } = await this.db.query(
      'SELECT COUNT(*) AS total FROM progreso_modulos WHERE usuario_id = $1 AND modulo_id = ANY($2) AND completado = TRUE',
      [usuarioId, moduloIds],
    );
    return Number(rows[0].total);
  }
}

import type { Database, Queryable } from '../../db/Database';
import type { CursoRepository, ModuloEntrada, Row } from '../contracts';

const INSERT_MODULO = 'INSERT INTO modulos (curso_id, titulo, tipo, contenido, orden) VALUES ($1,$2,$3,$4,$5)';

export class PgCursoRepository implements CursoRepository {
  constructor(private readonly db: Database) {}

  async listarTodos(): Promise<Row[]> {
    return (await this.db.query('SELECT * FROM cursos ORDER BY creado_en DESC')).rows;
  }

  async listarPublicadosDe(usuarioId: number | string): Promise<Row[]> {
    const { rows } = await this.db.query(
      `SELECT c.* FROM cursos c INNER JOIN inscripciones i ON i.curso_id = c.id
       WHERE i.usuario_id = $1 AND c.publicado = TRUE ORDER BY c.creado_en DESC`,
      [usuarioId],
    );
    return rows;
  }

  async buscar(id: number): Promise<Row | null> {
    return (await this.db.query('SELECT * FROM cursos WHERE id = $1', [id])).rows[0] ?? null;
  }

  async inscrito(cursoId: number, usuarioId: number | string): Promise<boolean> {
    const { rows } = await this.db.query('SELECT 1 FROM inscripciones WHERE curso_id = $1 AND usuario_id = $2', [cursoId, usuarioId]);
    return rows.length > 0;
  }

  /** Una consulta para todos los cursos (antes: 2 consultas por curso, el clásico N+1). */
  async modulosDe(cursoIds: number[]): Promise<Map<number, Row[]>> {
    const mapa = new Map<number, Row[]>();
    if (cursoIds.length === 0) return mapa;
    const { rows } = await this.db.query('SELECT * FROM modulos WHERE curso_id = ANY($1) ORDER BY curso_id, orden ASC', [cursoIds]);
    for (const m of rows) mapa.set(m.curso_id, [...(mapa.get(m.curso_id) ?? []), m]);
    return mapa;
  }

  async alumnosDe(cursoIds: number[]): Promise<Map<number, string[]>> {
    const mapa = new Map<number, string[]>();
    if (cursoIds.length === 0) return mapa;
    const { rows } = await this.db.query('SELECT curso_id, usuario_id FROM inscripciones WHERE curso_id = ANY($1)', [cursoIds]);
    for (const r of rows) mapa.set(r.curso_id, [...(mapa.get(r.curso_id) ?? []), String(r.usuario_id)]);
    return mapa;
  }

  async moduloIdsDe(cursoId: number): Promise<number[]> {
    const { rows } = await this.db.query('SELECT id FROM modulos WHERE curso_id = $1', [cursoId]);
    return rows.map(r => r.id);
  }

  async crear(d: Parameters<CursoRepository['crear']>[0]): Promise<Row> {
    return this.db.transaction(async tx => {
      const { rows } = await tx.query(
        `INSERT INTO cursos (titulo, descripcion, imagen_url, instructor_id, publicado) VALUES ($1,$2,$3,$4,false) RETURNING *`,
        [d.titulo, d.descripcion, d.imagenUrl, d.instructorId],
      );
      const curso = rows[0];
      for (let i = 0; i < (d.modulos ?? []).length; i++) {
        const m = d.modulos![i];
        await tx.query(INSERT_MODULO, [curso.id, m.titulo, m.tipo, JSON.stringify(m.contenido), i]);
      }
      return curso;
    });
  }

  async actualizar(id: number, d: Parameters<CursoRepository['actualizar']>[1]): Promise<void> {
    await this.db.transaction(async tx => {
      await tx.query(
        `UPDATE cursos SET titulo = COALESCE($1,titulo), descripcion = COALESCE($2,descripcion),
         imagen_url = COALESCE($3,imagen_url), publicado = COALESCE($4,publicado), actualizado_en = NOW() WHERE id = $5`,
        [d.titulo || null, d.descripcion || null, d.imagenUrl || null, d.publicado ?? null, id],
      );
      if (Array.isArray(d.modulos)) await this.sincronizarModulos(tx, id, d.modulos);
    });
  }

  /**
   * Antes: DELETE de todos los módulos + INSERT nuevos. Con ON DELETE CASCADE eso borraba el progreso y los
   * intentos de quiz de TODOS los alumnos en cada edición del curso. Ahora los módulos se actualizan en el lugar
   * (por `id` si el cliente lo envía; si no, por posición) y solo se borran los que realmente se eliminaron.
   */
  private async sincronizarModulos(tx: Queryable, cursoId: number, modulos: ModuloEntrada[]): Promise<void> {
    const { rows: existentes } = await tx.query('SELECT id FROM modulos WHERE curso_id = $1 ORDER BY orden, id', [cursoId]);
    const idsExistentes = new Set<number>(existentes.map(r => r.id));
    const clienteEnviaIds = modulos.some(m => m.id !== undefined && idsExistentes.has(Number(m.id)));
    const conservados = new Set<number>();

    for (let i = 0; i < modulos.length; i++) {
      const m = modulos[i];
      let destino: number | null = null;
      if (clienteEnviaIds) {
        const candidato = Number(m.id);
        if (idsExistentes.has(candidato) && !conservados.has(candidato)) destino = candidato;
      } else if (existentes[i]) {
        destino = existentes[i].id;
      }

      if (destino !== null) {
        await tx.query(
          'UPDATE modulos SET titulo = $1, tipo = $2, contenido = $3, orden = $4 WHERE id = $5 AND curso_id = $6',
          [m.titulo, m.tipo, JSON.stringify(m.contenido), i, destino, cursoId],
        );
        conservados.add(destino);
      } else {
        await tx.query(INSERT_MODULO, [cursoId, m.titulo, m.tipo, JSON.stringify(m.contenido), i]);
      }
    }

    const aBorrar = [...idsExistentes].filter(x => !conservados.has(x));
    if (aBorrar.length > 0) await tx.query('DELETE FROM modulos WHERE curso_id = $1 AND id = ANY($2)', [cursoId, aBorrar]);
  }

  async eliminar(id: number): Promise<void> {
    await this.db.query('DELETE FROM cursos WHERE id = $1', [id]);
  }

  async asignarAlumnos(id: number, usuarioIds: Array<number | string>): Promise<void> {
    await this.db.transaction(async tx => {
      await tx.query('DELETE FROM inscripciones WHERE curso_id = $1', [id]);
      for (const uid of usuarioIds) {
        await tx.query('INSERT INTO inscripciones (usuario_id, curso_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [uid, id]);
      }
    });
  }
}

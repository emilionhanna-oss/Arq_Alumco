import type { Database } from '../../db/Database';
import type { Row, SedeRepository } from '../contracts';

export class PgSedeRepository implements SedeRepository {
  constructor(private readonly db: Database) {}

  async listar(): Promise<Row[]> {
    const { rows } = await this.db.query('SELECT id, nombre, region FROM sedes ORDER BY nombre');
    return rows;
  }

  async idPorNombre(nombre: string): Promise<number | null> {
    const { rows } = await this.db.query('SELECT id FROM sedes WHERE nombre = $1', [nombre]);
    return rows[0]?.id ?? null;
  }
}

import type { Database } from '../../db/Database';
import type { GuardarResultado, QuizRepository, Row } from '../contracts';

export class PgQuizRepository implements QuizRepository {
  constructor(private readonly db: Database) {}

  async intentosDe(usuarioId: string, moduloId: number): Promise<Row[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM intentos_quiz WHERE usuario_id = $1 AND modulo_id = $2 ORDER BY intento_numero DESC',
      [usuarioId, moduloId],
    );
    return rows;
  }

  async crearIntento(usuarioId: string, moduloId: number, numero: number): Promise<number> {
    const { rows } = await this.db.query(
      `INSERT INTO intentos_quiz (usuario_id, modulo_id, intento_numero, estado) VALUES ($1,$2,$3,'en_progreso') RETURNING id`,
      [usuarioId, moduloId, numero],
    );
    return rows[0].id;
  }

  async buscarIntento(intentoId: number): Promise<Row | null> {
    return (await this.db.query('SELECT * FROM intentos_quiz WHERE id = $1', [intentoId])).rows[0] ?? null;
  }

  async preguntasDe(moduloId: number): Promise<unknown | null> {
    const { rows } = await this.db.query(`SELECT contenido FROM modulos WHERE id = $1 AND tipo = 'quiz'`, [moduloId]);
    return rows.length === 0 ? null : rows[0].contenido;
  }

  async guardarResultado(d: GuardarResultado): Promise<boolean> {
    return this.db.transaction(async tx => {
      const upd = await tx.query(
        `UPDATE intentos_quiz SET estado='completado', puntaje=$1, completado_en=NOW(),
                tiempo_utilizado_segundos=$2, fecha_desbloqueo_temporal=$3
         WHERE id=$4 AND usuario_id=$5 AND estado <> 'completado'`,
        [d.puntaje, d.tiempoSegundos, d.desbloqueoEn, d.intentoId, d.usuarioId],
      );
      if (!upd.rowCount) return false;
      if (d.aprobado) {
        await tx.query(
          `INSERT INTO progreso_modulos (usuario_id, modulo_id, completado, completado_en) VALUES ($1,$2,TRUE,NOW())
           ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET completado=TRUE, completado_en=NOW()`,
          [d.usuarioId, d.moduloId],
        );
      }
      await tx.query('INSERT INTO respuestas_quiz (usuario_id, modulo_id, respuesta) VALUES ($1,$2,$3)', [
        d.usuarioId, d.moduloId, JSON.stringify(d.respuestas ?? null),
      ]);
      return true;
    });
  }
}

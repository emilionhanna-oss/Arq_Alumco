import type { Database } from '../../db/Database';
import type { GamificacionRepository, Row } from '../contracts';

export class PgGamificacionRepository implements GamificacionRepository {
  constructor(private readonly db: Database) {}

  async perfil(usuarioId: string): Promise<Row | null> {
    return (await this.db.query('SELECT * FROM gamificacion_puntos WHERE usuario_id = $1', [usuarioId])).rows[0] ?? null;
  }

  async sumarPuntos(usuarioId: string, puntos: number): Promise<number> {
    const { rows } = await this.db.query(
      `INSERT INTO gamificacion_puntos (usuario_id, puntos) VALUES ($1,$2)
       ON CONFLICT (usuario_id) DO UPDATE SET puntos = gamificacion_puntos.puntos + EXCLUDED.puntos
       RETURNING puntos`,
      [usuarioId, puntos],
    );
    return rows[0].puntos;
  }

  async fijarNivel(usuarioId: string, nivel: string): Promise<void> {
    await this.db.query('UPDATE gamificacion_puntos SET nivel = $1 WHERE usuario_id = $2', [nivel, usuarioId]);
  }

  async otorgarInsignia(usuarioId: string, tipo: string): Promise<void> {
    await this.db.query('INSERT INTO insignias (usuario_id, tipo) VALUES ($1,$2) ON CONFLICT DO NOTHING', [usuarioId, tipo]);
  }

  async insignias(usuarioId: string): Promise<Row[]> {
    return (await this.db.query('SELECT tipo, obtenida_en FROM insignias WHERE usuario_id = $1 ORDER BY obtenida_en DESC', [usuarioId])).rows;
  }

  async modulosCompletados(usuarioId: string): Promise<number> {
    const { rows } = await this.db.query('SELECT COUNT(*) AS total FROM progreso_modulos WHERE usuario_id = $1 AND completado = TRUE', [usuarioId]);
    return Number(rows[0]?.total || 0);
  }

  async guardarRacha(usuarioId: string, rachaDias: number): Promise<void> {
    await this.db.query(
      `INSERT INTO gamificacion_puntos (usuario_id, racha_dias, ultimo_acceso) VALUES ($1,$2,NOW())
       ON CONFLICT (usuario_id) DO UPDATE SET racha_dias = EXCLUDED.racha_dias, ultimo_acceso = NOW()`,
      [usuarioId, rachaDias],
    );
  }

  async ranking(sede: string | undefined, version: 'v1' | 'v2'): Promise<Row[]> {
    const params: unknown[] = [];
    let filtroSede = '';
    if (sede) { params.push(sede); filtroSede = ` AND s.nombre = $${params.length}`; }

    const sql = version === 'v2'
      // v2 (canary): sin GROUP BY ni JOIN multiplicador; desempate determinista (puntos, módulos, nombre).
      ? `SELECT u.id, u.nombre_completo, u.nombre, s.nombre AS sede, gp.puntos, gp.nivel, gp.racha_dias,
                (SELECT COUNT(*) FROM insignias ins WHERE ins.usuario_id = u.id) AS insignias_count,
                (SELECT COUNT(*) FROM progreso_modulos pm WHERE pm.usuario_id = u.id AND pm.completado = TRUE) AS modulos_completados
         FROM usuarios u
         INNER JOIN gamificacion_puntos gp ON gp.usuario_id = u.id
         LEFT JOIN sedes s ON s.id = u.sede_id
         WHERE u.estado = 'activo'${filtroSede}
         ORDER BY gp.puntos DESC, modulos_completados DESC, u.nombre_completo ASC LIMIT 50`
      : `SELECT u.id, u.nombre_completo, u.nombre, s.nombre AS sede, gp.puntos, gp.nivel, gp.racha_dias,
                COUNT(ins.id) AS insignias_count,
                (SELECT COUNT(*) FROM progreso_modulos pm WHERE pm.usuario_id = u.id AND pm.completado = TRUE) AS modulos_completados
         FROM usuarios u INNER JOIN gamificacion_puntos gp ON gp.usuario_id = u.id
         LEFT JOIN sedes s ON s.id = u.sede_id LEFT JOIN insignias ins ON ins.usuario_id = u.id
         WHERE u.estado = 'activo'${filtroSede}
         GROUP BY u.id, u.nombre_completo, u.nombre, s.nombre, gp.puntos, gp.nivel, gp.racha_dias
         ORDER BY gp.puntos DESC LIMIT 50`;
    return (await this.db.query(sql, params)).rows;
  }
}

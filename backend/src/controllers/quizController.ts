import { Request, Response } from 'express';
import pool from '../db/pool';

const MAX_INTENTOS   = 2;
const PUNTAJE_MINIMO = 60;

async function actualizarPuntos(usuarioId: string, puntos: number) {
  await pool.query(
    `INSERT INTO gamificacion_puntos (usuario_id, puntos) VALUES ($1,$2)
     ON CONFLICT (usuario_id) DO UPDATE SET puntos = gamificacion_puntos.puntos + EXCLUDED.puntos`,
    [usuarioId, puntos]
  );
  const { rows } = await pool.query('SELECT puntos FROM gamificacion_puntos WHERE usuario_id = $1', [usuarioId]);
  const p = rows[0]?.puntos || 0;
  const nivel = p >= 1000 ? 'Maestro' : p >= 500 ? 'Experto' : p >= 200 ? 'Colaborador' : p >= 50 ? 'Principiante' : 'Aprendiz';
  await pool.query('UPDATE gamificacion_puntos SET nivel = $1 WHERE usuario_id = $2', [nivel, usuarioId]);
}

export async function iniciarIntento(req: Request, res: Response): Promise<void> {
  try {
    const { moduloId } = req.params;
    const usuarioId    = req.user!.id;
    const { rows: intentos } = await pool.query(
      `SELECT * FROM intentos_quiz WHERE usuario_id = $1 AND modulo_id = $2 ORDER BY intento_numero DESC`,
      [usuarioId, moduloId]
    );
    const completados = intentos.filter(i => i.estado === 'completado').length;
    if (completados >= MAX_INTENTOS) {
      const ultimo = intentos[0];
      if (ultimo?.fecha_desbloqueo_temporal && new Date(ultimo.fecha_desbloqueo_temporal) > new Date()) {
        res.status(403).json({ mensaje: 'Máximo de intentos alcanzado', desbloqueoEn: ultimo.fecha_desbloqueo_temporal });
        return;
      }
    }
    const { rows } = await pool.query(
      `INSERT INTO intentos_quiz (usuario_id, modulo_id, intento_numero, estado)
       VALUES ($1,$2,$3,'en_progreso') RETURNING id`,
      [usuarioId, moduloId, completados + 1]
    );
    res.status(201).json({ intentoId: rows[0].id, intentoNumero: completados + 1 });
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al iniciar intento' });
  }
}

export async function submitQuiz(req: Request, res: Response): Promise<void> {
  try {
    const { moduloId } = req.params;
    const { intentoId, respuestas, tiempoSegundos } = req.body || {};
    const usuarioId = req.user!.id;
    const { rows: modulos } = await pool.query('SELECT contenido FROM modulos WHERE id = $1 AND tipo = $2', [moduloId, 'quiz']);
    if (modulos.length === 0) { res.status(404).json({ mensaje: 'Módulo quiz no encontrado' }); return; }
    const preguntas = modulos[0].contenido as Array<{ opciones: Array<{ correcta: boolean }>; tipo: string }>;
    if (!Array.isArray(preguntas) || preguntas.length === 0) { res.status(400).json({ mensaje: 'Sin preguntas configuradas' }); return; }
    let correctas = 0;
    preguntas.forEach((pregunta, i) => {
      const correctaIdx = pregunta.opciones?.findIndex(o => o.correcta);
      if (Number(respuestas?.[i]) === correctaIdx) correctas++;
    });
    const puntaje  = Math.round((correctas / preguntas.length) * 100);
    const aprobado = puntaje >= PUNTAJE_MINIMO;
    const desbloqueo = !aprobado ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null;
    await pool.query(
      `UPDATE intentos_quiz SET estado='completado', puntaje=$1, completado_en=NOW(),
       tiempo_utilizado_segundos=$2, fecha_desbloqueo_temporal=$3 WHERE id=$4`,
      [puntaje, tiempoSegundos || 0, desbloqueo, intentoId]
    );
    if (aprobado) {
      await pool.query(
        `INSERT INTO progreso_modulos (usuario_id, modulo_id, completado, completado_en)
         VALUES ($1,$2,TRUE,NOW()) ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET completado=TRUE, completado_en=NOW()`,
        [usuarioId, moduloId]
      );
      await actualizarPuntos(usuarioId, 100);
      await pool.query('INSERT INTO insignias (usuario_id, tipo) VALUES ($1,$2) ON CONFLICT DO NOTHING', [usuarioId, `quiz_aprobado_${moduloId}`]);
    }
    await pool.query('INSERT INTO respuestas_quiz (usuario_id, modulo_id, respuesta) VALUES ($1,$2,$3)', [usuarioId, moduloId, JSON.stringify(respuestas)]);
    res.status(200).json({ puntaje, aprobado, correctas, total: preguntas.length, desbloqueoEn: desbloqueo });
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al procesar quiz' });
  }
}

export async function estadoQuiz(req: Request, res: Response): Promise<void> {
  try {
    const { moduloId } = req.params;
    const usuarioId    = req.user!.id;
    const { rows } = await pool.query(
      'SELECT * FROM intentos_quiz WHERE usuario_id=$1 AND modulo_id=$2 ORDER BY intento_numero DESC',
      [usuarioId, moduloId]
    );
    const completados = rows.filter(i => i.estado === 'completado').length;
    const mejor = rows.reduce((max: typeof rows[0] | null, i) => i.puntaje > (max?.puntaje || 0) ? i : max, null);
    res.status(200).json({
      intentosRealizados:  completados,
      intentosRestantes:   Math.max(0, MAX_INTENTOS - completados),
      mejorPuntaje:        mejor?.puntaje || 0,
      aprobado:            (mejor?.puntaje || 0) >= PUNTAJE_MINIMO,
      desbloqueoEn:        rows[0]?.fecha_desbloqueo_temporal || null,
      historial:           rows,
    });
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al obtener estado quiz' });
  }
}

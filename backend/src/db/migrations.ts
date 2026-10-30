/**
 * Migraciones versionadas. Reglas para poder hacer canary:
 *  - Solo cambios EXPAND (agregar tablas/columnas nullable/índices). La versión estable y la canary
 *    corren contra la MISMA base, así que ambas deben funcionar con el esquema resultante.
 *  - Los cambios destructivos (DROP/RENAME) van en una migración posterior, cuando la versión vieja ya no existe.
 *  - 001 es idempotente (IF NOT EXISTS): en una base ya existente solo queda registrada.
 */
export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '001_esquema_inicial',
    sql: `
      CREATE TABLE IF NOT EXISTS sedes (id SERIAL PRIMARY KEY, nombre VARCHAR(100) NOT NULL UNIQUE, region VARCHAR(100));
      INSERT INTO sedes (nombre, region) VALUES ('Hualpen (Region del Biobio)', 'Region del Biobio'), ('Coyhaique (Region de Aysen)', 'Region de Aysen') ON CONFLICT (nombre) DO NOTHING;
      CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, password_hash VARCHAR(128) NOT NULL, nombre_completo VARCHAR(150) NOT NULL, nombre VARCHAR(60), rut VARCHAR(12) NOT NULL UNIQUE, genero VARCHAR(20) NOT NULL, sede_id INT REFERENCES sedes(id) ON DELETE SET NULL, cargo VARCHAR(120), estado VARCHAR(20) NOT NULL DEFAULT 'pendiente', fecha_registro TIMESTAMP NOT NULL DEFAULT NOW(), fecha_expiracion TIMESTAMP, firma_texto TEXT, firma_imagen_data_url TEXT);
      CREATE TABLE IF NOT EXISTS usuario_roles (id SERIAL PRIMARY KEY, usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, rol VARCHAR(20) NOT NULL, UNIQUE (usuario_id, rol));
      CREATE TABLE IF NOT EXISTS cursos (id SERIAL PRIMARY KEY, titulo VARCHAR(200) NOT NULL, descripcion TEXT, imagen_url VARCHAR(500), instructor_id INT REFERENCES usuarios(id) ON DELETE SET NULL, publicado BOOLEAN NOT NULL DEFAULT FALSE, creado_en TIMESTAMP NOT NULL DEFAULT NOW(), actualizado_en TIMESTAMP NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS modulos (id SERIAL PRIMARY KEY, curso_id INT NOT NULL REFERENCES cursos(id) ON DELETE CASCADE, titulo VARCHAR(200) NOT NULL, tipo VARCHAR(30) NOT NULL, contenido JSONB, material_url VARCHAR(500), orden SMALLINT NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS inscripciones (id SERIAL PRIMARY KEY, usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, curso_id INT NOT NULL REFERENCES cursos(id) ON DELETE CASCADE, inscrito_en TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE (usuario_id, curso_id));
      CREATE TABLE IF NOT EXISTS progreso_modulos (id SERIAL PRIMARY KEY, usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, modulo_id INT NOT NULL REFERENCES modulos(id) ON DELETE CASCADE, completado BOOLEAN NOT NULL DEFAULT FALSE, completado_en TIMESTAMP, UNIQUE (usuario_id, modulo_id));
      CREATE TABLE IF NOT EXISTS intentos_quiz (id SERIAL PRIMARY KEY, usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, modulo_id INT NOT NULL REFERENCES modulos(id) ON DELETE CASCADE, intento_numero INT NOT NULL DEFAULT 1, estado VARCHAR(20) NOT NULL DEFAULT 'pendiente', puntaje INT NOT NULL DEFAULT 0, completado_en TIMESTAMP, tiempo_utilizado_segundos INT, fecha_desbloqueo_temporal TIMESTAMP);
      CREATE TABLE IF NOT EXISTS certificados_emitidos (id SERIAL PRIMARY KEY, hash VARCHAR(64) UNIQUE NOT NULL, usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE, curso_id INT REFERENCES cursos(id) ON DELETE CASCADE, emitido_en TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS gamificacion_puntos (id SERIAL PRIMARY KEY, usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, puntos INT NOT NULL DEFAULT 0, nivel VARCHAR(30) NOT NULL DEFAULT 'Aprendiz', racha_dias INT NOT NULL DEFAULT 0, ultimo_acceso TIMESTAMP, UNIQUE (usuario_id));
      CREATE TABLE IF NOT EXISTS insignias (id SERIAL PRIMARY KEY, usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, tipo VARCHAR(50) NOT NULL, obtenida_en TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE (usuario_id, tipo));
      CREATE INDEX IF NOT EXISTS idx_usuarios_email    ON usuarios(email);
      CREATE INDEX IF NOT EXISTS idx_usuario_roles_uid ON usuario_roles(usuario_id);
      CREATE INDEX IF NOT EXISTS idx_modulos_curso_id  ON modulos(curso_id);
      CREATE INDEX IF NOT EXISTS idx_inscripciones_uid ON inscripciones(usuario_id);
      CREATE INDEX IF NOT EXISTS idx_progreso_uid      ON progreso_modulos(usuario_id);
    `,
  },
  {
    // submitQuiz ya insertaba en esta tabla, pero el migrate original nunca la creaba (fallaba con 500).
    id: '002_respuestas_quiz',
    sql: `
      CREATE TABLE IF NOT EXISTS respuestas_quiz (
        id SERIAL PRIMARY KEY,
        usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        modulo_id  INT NOT NULL REFERENCES modulos(id)  ON DELETE CASCADE,
        respuesta  JSONB,
        creado_en  TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_respuestas_quiz_uid_mod ON respuestas_quiz(usuario_id, modulo_id);
    `,
  },
  {
    id: '003_indices_consulta',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_intentos_uid_mod   ON intentos_quiz(usuario_id, modulo_id);
      CREATE INDEX IF NOT EXISTS idx_certificados_uid   ON certificados_emitidos(usuario_id);
      CREATE INDEX IF NOT EXISTS idx_gamificacion_pts   ON gamificacion_puntos(puntos DESC);
    `,
  },
  {
    // Evita certificados duplicados por carrera, pero solo si los datos actuales no tienen duplicados
    // (para que la migración nunca bloquee un despliegue sobre una base con datos reales).
    id: '004_certificado_unico_por_curso',
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM certificados_emitidos GROUP BY usuario_id, curso_id HAVING COUNT(*) > 1) THEN
          CREATE UNIQUE INDEX IF NOT EXISTS uq_certificado_usuario_curso ON certificados_emitidos(usuario_id, curso_id);
        END IF;
      END $$;
    `,
  },
];

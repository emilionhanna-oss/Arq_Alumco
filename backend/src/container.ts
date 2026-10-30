import type { Env } from './config/env';
import type { Database } from './db/Database';
import { EventBus } from './domain/events';
import { UmbralNivelStrategy } from './domain/nivel';
import { FeatureFlags } from './canary/featureFlags';
import { Metrics } from './observability/metrics';
import { PgUsuarioRepository } from './repositories/pg/PgUsuarioRepository';
import { PgSedeRepository } from './repositories/pg/PgSedeRepository';
import { PgCursoRepository } from './repositories/pg/PgCursoRepository';
import { PgQuizRepository } from './repositories/pg/PgQuizRepository';
import { PgGamificacionRepository } from './repositories/pg/PgGamificacionRepository';
import { PgCertificadoRepository } from './repositories/pg/PgCertificadoRepository';
import { AuthService } from './services/AuthService';
import { UsuarioService } from './services/UsuarioService';
import { CursoService } from './services/CursoService';
import { QuizService } from './services/QuizService';
import { GamificacionService } from './services/GamificacionService';
import { CertificadoService } from './services/CertificadoService';
import { registrarSubscribersGamificacion } from './subscribers/gamificacionSubscriber';

/**
 * Composition root: el ÚNICO lugar que conoce las clases concretas y las conecta (inyección de dependencias
 * por constructor). Todo lo demás depende de interfaces.
 */
export function buildContainer(db: Database, env: Env) {
  const bus = new EventBus();
  const flags = new FeatureFlags(env.featureFlags);
  const metrics = new Metrics({ version: env.appVersion, track: env.appTrack });

  const usuarios = new PgUsuarioRepository(db);
  const sedes = new PgSedeRepository(db);
  const cursos = new PgCursoRepository(db);

  const gamificacion = new GamificacionService(new PgGamificacionRepository(db), new UmbralNivelStrategy(), bus);
  registrarSubscribersGamificacion(bus, gamificacion);

  return {
    db, bus, flags, metrics,
    services: {
      auth: new AuthService(usuarios, sedes, env.jwtSecret),
      usuarios: new UsuarioService(usuarios, sedes),
      cursos: new CursoService(cursos),
      quiz: new QuizService(new PgQuizRepository(db), bus),
      gamificacion,
      certificados: new CertificadoService(new PgCertificadoRepository(db), cursos, bus, env.frontendUrl),
    },
  };
}

export type Container = ReturnType<typeof buildContainer>;

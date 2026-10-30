import express from 'express';
import cors from 'cors';
import type { Env } from './config/env';
import type { Container } from './container';
import { buildRouter } from './routes';
import { errorHandler, notFound } from './middleware/errors';
import { requestMetrics, versionHeaders } from './middleware/observability';

export interface Lifecycle {
  /** Se pone en true al recibir SIGTERM: /health/ready pasa a 503 para que el balanceador saque la instancia. */
  shuttingDown: boolean;
}

export function createApp(container: Container, env: Env, lifecycle: Lifecycle = { shuttingDown: false }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true); // detrás de nginx/Render/ALB

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed = env.corsOrigins.length === 0 || env.corsOrigins.includes(origin) || origin.endsWith('.vercel.app');
      callback(null, allowed ? origin : false);
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(versionHeaders(env.appVersion, env.appTrack));
  app.use(requestMetrics(container.metrics));

  app.get('/', (_req, res) => { res.json({ status: 'ok', mensaje: 'CapacitaciónPro API funcionando ✅' }); });

  // Liveness: el proceso responde. Readiness: además puede atender (BD ok y no está apagándose).
  app.get('/health/live', (_req, res) => { res.json({ status: 'ok' }); });
  const ready = async (_req: express.Request, res: express.Response) => {
    const dbUp = lifecycle.shuttingDown ? false : await container.db.health();
    const ok = dbUp && !lifecycle.shuttingDown;
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : lifecycle.shuttingDown ? 'shutting_down' : 'degraded',
      timestamp: new Date().toISOString(),
      version: env.appVersion, track: env.appTrack,
      db: dbUp ? 'up' : 'down', circuitBreaker: container.db.breakerState(),
    });
  };
  app.get('/health', ready);
  app.get('/health/ready', ready);

  app.get('/metrics', (req, res) => {
    if (env.metricsToken && req.headers.authorization !== `Bearer ${env.metricsToken}`) {
      res.status(401).json({ mensaje: 'No autorizado' });
      return;
    }
    res.type('text/plain; version=0.0.4').send(container.metrics.render(container.db.breakerState()));
  });

  app.use('/api', buildRouter(container, { version: env.appVersion, track: env.appTrack }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

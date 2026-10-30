import { loadEnv } from './config/env';
import { createPool } from './db/pool';
import { PgDatabase } from './db/Database';
import { buildContainer } from './container';
import { createApp, type Lifecycle } from './app';

const env = loadEnv();
const db = new PgDatabase(createPool(env));
const container = buildContainer(db, env);
const lifecycle: Lifecycle = { shuttingDown: false };
const app = createApp(container, env, lifecycle);

const server = app.listen(env.port, '0.0.0.0', () => {
  console.log(`🚀 CapacitaciónPro API v${env.appVersion} [${env.appTrack}] en http://localhost:${env.port}`);
});
// Más que el idle timeout típico de nginx/ALB (60s) para evitar 502 en conexiones reutilizadas.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

/** Apagado ordenado: deja de ser "ready", termina las peticiones en curso, cierra el pool y sale. */
function apagar(signal: string) {
  if (lifecycle.shuttingDown) return;
  lifecycle.shuttingDown = true;
  console.log(`${signal} recibido: apagando ordenadamente…`);
  const forzar = setTimeout(() => { console.error('Apagado forzado por timeout'); process.exit(1); }, 10_000);
  forzar.unref();
  server.close(async () => {
    await db.close().catch(() => undefined);
    process.exit(0);
  });
  server.closeIdleConnections?.();
}
process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));

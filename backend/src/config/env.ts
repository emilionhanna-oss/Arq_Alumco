import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import path from 'path';

dotenv.config();

const DEV_SECRET = 'dev_insecure_change_me';

function leerVersionPaquete(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    return String(pkg.version || 'dev');
  } catch {
    return 'dev';
  }
}

/** "ranking_v2:10,otra:100" -> { ranking_v2: 10, otra: 100 } (porcentajes 0-100) */
export function parseFeatureFlags(raw: string): Record<string, number> {
  const flags: Record<string, number> = {};
  for (const par of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    const [nombre, valor] = par.split(':').map(s => s.trim());
    const pct = valor === undefined || valor === '' ? 100 : Number(valor);
    if (nombre && Number.isFinite(pct)) flags[nombre] = Math.min(100, Math.max(0, pct));
  }
  return flags;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env) {
  const isProd = source.NODE_ENV === 'production';
  const jwtSecret = source.JWT_SECRET || DEV_SECRET;
  if (isProd && (!source.JWT_SECRET || source.JWT_SECRET === DEV_SECRET)) {
    // Antes caía silenciosamente a un secreto público; en producción ahora se exige uno propio.
    throw new Error('JWT_SECRET es obligatorio en producción');
  }
  return {
    nodeEnv: source.NODE_ENV || 'development',
    isProd,
    port: Number(source.PORT) || 3000,
    corsOrigins: (source.CORS_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean),
    jwtSecret,
    databaseUrl: source.DATABASE_URL,
    dbSsl: source.DB_SSL === 'true',
    frontendUrl: source.FRONTEND_URL || 'http://localhost:5173',
    /** Identifica el artefacto desplegado (se expone en /health, /metrics y header X-App-Version). */
    appVersion: source.APP_VERSION || leerVersionPaquete(),
    /** 'stable' | 'canary': qué rol cumple esta instancia en un despliegue canario. */
    appTrack: source.APP_TRACK === 'canary' ? ('canary' as const) : ('stable' as const),
    /** Feature toggles con porcentaje de usuarios (canary a nivel de funcionalidad). */
    featureFlags: parseFeatureFlags(source.FEATURE_FLAGS || ''),
    metricsToken: source.METRICS_TOKEN || '',
  };
}

export type Env = ReturnType<typeof loadEnv>;

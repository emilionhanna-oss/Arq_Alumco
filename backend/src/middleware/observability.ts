import type { RequestHandler } from 'express';
import type { Metrics } from '../observability/metrics';

/** Todas las respuestas indican qué versión las sirvió: así se ve a qué lado del canary cayó cada request. */
export function versionHeaders(version: string, track: string): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-App-Version', version);
    res.setHeader('X-App-Track', track);
    next();
  };
}

export function requestMetrics(metrics: Metrics): RequestHandler {
  return (req, res, next) => {
    if (req.path.startsWith('/health') || req.path === '/metrics') return next();
    const inicio = process.hrtime.bigint();
    res.on('finish', () => metrics.observar(res.statusCode, Number(process.hrtime.bigint() - inicio) / 1e9));
    next();
  };
}

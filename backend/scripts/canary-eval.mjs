#!/usr/bin/env node
/**
 * Decide si el canary se PROMUEVE, se REVIERTE o hay que ESPERAR más tráfico, comparando sus métricas
 * contra las de la versión estable (lee /metrics de cada instancia).
 *
 *   node scripts/canary-eval.mjs --stable http://localhost:3001 --canary http://localhost:3002 \
 *        [--window 30] [--token $METRICS_TOKEN] [--min-requests 50] \
 *        [--max-error-rate 0.01] [--error-ratio 2] [--latency-ratio 1.5] [--latency-slack-ms 50]
 *
 * Códigos de salida: 0 = PROMOTE, 1 = ROLLBACK, 2 = WAIT   (útil como paso de un pipeline de CI/CD)
 */
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const cfg = {
  stable: arg('stable', 'http://localhost:3001'), canary: arg('canary', 'http://localhost:3002'),
  windowSec: Number(arg('window', 0)), token: arg('token', process.env.METRICS_TOKEN || ''),
  minRequests: Number(arg('min-requests', 50)), maxErrorRate: Number(arg('max-error-rate', 0.01)),
  errorRatio: Number(arg('error-ratio', 2)), latencyRatio: Number(arg('latency-ratio', 1.5)),
  latencySlackMs: Number(arg('latency-slack-ms', 50)),
};

async function leer(base) {
  const r = await fetch(`${base}/metrics`, { headers: cfg.token ? { authorization: `Bearer ${cfg.token}` } : {} });
  if (!r.ok) throw new Error(`${base}/metrics respondió ${r.status}`);
  const txt = await r.text();
  const m = { total: 0, errores: 0, suma: 0, cuenta: 0, breaker: 0, version: '?', track: '?' };
  for (const linea of txt.split('\n')) {
    let x;
    if ((x = linea.match(/^alumco_http_requests_total\{.*status="(\d)xx"\} (\S+)/))) { m.total += +x[2]; if (x[1] === '5') m.errores += +x[2]; }
    else if ((x = linea.match(/^alumco_http_request_duration_seconds_sum\{.*\} (\S+)/))) m.suma = +x[1];
    else if ((x = linea.match(/^alumco_http_request_duration_seconds_count\{.*\} (\S+)/))) m.cuenta = +x[1];
    else if ((x = linea.match(/^alumco_db_circuit_breaker_state\{.*\} (\S+)/))) m.breaker = +x[1];
    else if ((x = linea.match(/^alumco_build_info\{version="([^"]*)",track="([^"]*)"\}/))) { m.version = x[1]; m.track = x[2]; }
  }
  return m;
}
const diff = (a, b) => ({ ...b, total: b.total - a.total, errores: b.errores - a.errores, suma: b.suma - a.suma, cuenta: b.cuenta - a.cuenta });

let [s, c] = [await leer(cfg.stable), await leer(cfg.canary)];
if (cfg.windowSec > 0) {
  console.log(`Midiendo ventana de ${cfg.windowSec}s…`);
  await new Promise(r => setTimeout(r, cfg.windowSec * 1000));
  const [s2, c2] = [await leer(cfg.stable), await leer(cfg.canary)];
  [s, c] = [diff(s, s2), diff(c, c2)];
}
const tasa = m => (m.total ? m.errores / m.total : 0);
const lat = m => (m.cuenta ? (m.suma / m.cuenta) * 1000 : 0);

console.log('\n            versión          peticiones  5xx   tasa error   latencia media   breaker BD');
for (const [nombre, m] of [['stable', s], ['canary', c]]) {
  console.log(`${nombre.padEnd(8)} ${m.version.padEnd(16)} ${String(m.total).padStart(9)} ${String(m.errores).padStart(5)}   ${(tasa(m) * 100).toFixed(2).padStart(6)}%   ${lat(m).toFixed(1).padStart(10)} ms   ${['cerrado', 'semi', 'ABIERTO'][c === m ? m.breaker : m.breaker] ?? m.breaker}`);
}

const motivos = [];
if (c.breaker === 2) motivos.push('el circuit breaker de la BD del canary está ABIERTO');
const maxErr = Math.max(cfg.maxErrorRate, tasa(s) * cfg.errorRatio);
if (c.total >= cfg.minRequests && tasa(c) > maxErr) motivos.push(`tasa de error del canary ${(tasa(c) * 100).toFixed(2)}% > umbral ${(maxErr * 100).toFixed(2)}%`);
const maxLat = lat(s) * cfg.latencyRatio + cfg.latencySlackMs;
if (c.total >= cfg.minRequests && lat(c) > maxLat) motivos.push(`latencia media del canary ${lat(c).toFixed(1)} ms > umbral ${maxLat.toFixed(1)} ms`);

if (motivos.length) { console.log('\n⛔ ROLLBACK:\n  - ' + motivos.join('\n  - ')); process.exit(1); }
if (c.total < cfg.minRequests) { console.log(`\n⏳ WAIT: el canary solo tiene ${c.total} peticiones (mínimo ${cfg.minRequests}).`); process.exit(2); }
console.log('\n✅ PROMOTE: el canary está dentro de los umbrales respecto a stable.');

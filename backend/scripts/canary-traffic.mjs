#!/usr/bin/env node
// Genera tráfico a través del gateway simulando N clientes distintos y muestra cómo se repartió.
//   node scripts/canary-traffic.mjs --url http://localhost:8080 --n 1000 [--path /api/auth/sedes]
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:8080'), n = Number(arg('n', 1000)), path = arg('path', '/api/auth/sedes');

const conteo = {};
let fallos = 0;
for (let i = 0; i < n; i++) {
  const ip = `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;   // cliente distinto por request
  try {
    const r = await fetch(url + path, { headers: { 'x-forwarded-for': ip, 'user-agent': `sim-${i}` } });
    await r.arrayBuffer();
    if (r.status >= 500) fallos++;
    const k = `${r.headers.get('x-app-track') ?? '?'} (${r.headers.get('x-app-version') ?? '?'}) via ${r.headers.get('x-served-by') ?? '?'}`;
    conteo[k] = (conteo[k] ?? 0) + 1;
  } catch { fallos++; }
}
console.log(`Peticiones: ${n}   respuestas 5xx/errores visibles al cliente: ${fallos}`);
for (const [k, v] of Object.entries(conteo).sort()) console.log(`  ${String(v).padStart(6)}  ${(v / n * 100).toFixed(1).padStart(5)}%  ${k}`);

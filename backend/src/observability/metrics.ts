/**
 * Métricas mínimas en formato Prometheus, etiquetadas con versión y track (stable/canary).
 * Son la base para decidir si el canary se promueve o se revierte (ver scripts/canary-eval.mjs).
 */
const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

export class Metrics {
  private readonly porEstado = new Map<string, number>();
  private readonly cubetas = new Array(BUCKETS.length + 1).fill(0);
  private suma = 0;
  private total = 0;

  constructor(private readonly etiquetas: { version: string; track: string }) {}

  observar(status: number, segundos: number): void {
    const clase = `${Math.floor(status / 100)}xx`;
    this.porEstado.set(clase, (this.porEstado.get(clase) ?? 0) + 1);
    const idx = BUCKETS.findIndex(b => segundos <= b);
    this.cubetas[idx === -1 ? BUCKETS.length : idx]++;
    this.suma += segundos;
    this.total++;
  }

  render(breaker: 'closed' | 'half-open' | 'open'): string {
    const base = `version="${this.etiquetas.version}",track="${this.etiquetas.track}"`;
    const l: string[] = [];
    l.push('# TYPE alumco_build_info gauge', `alumco_build_info{${base}} 1`);
    l.push('# TYPE alumco_http_requests_total counter');
    for (const [estado, n] of [...this.porEstado].sort()) l.push(`alumco_http_requests_total{${base},status="${estado}"} ${n}`);
    l.push('# TYPE alumco_http_request_duration_seconds histogram');
    let acumulado = 0;
    BUCKETS.forEach((b, i) => {
      acumulado += this.cubetas[i];
      l.push(`alumco_http_request_duration_seconds_bucket{${base},le="${b}"} ${acumulado}`);
    });
    l.push(`alumco_http_request_duration_seconds_bucket{${base},le="+Inf"} ${this.total}`);
    l.push(`alumco_http_request_duration_seconds_sum{${base}} ${this.suma.toFixed(6)}`);
    l.push(`alumco_http_request_duration_seconds_count{${base}} ${this.total}`);
    l.push('# TYPE alumco_db_circuit_breaker_state gauge');
    l.push(`alumco_db_circuit_breaker_state{${base}} ${breaker === 'closed' ? 0 : breaker === 'half-open' ? 1 : 2}`);
    return l.join('\n') + '\n';
  }
}

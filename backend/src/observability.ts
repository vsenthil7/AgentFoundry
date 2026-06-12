// S18 — Platform observability & metrics.
// Metrics for the PLATFORM itself (not the agents): counters, gauges, and
// histograms with percentile aggregation. Deterministic and dependency-free so
// it runs offline and in CI; exports a Prometheus-style text format.

export interface MetricLabels {
  [key: string]: string;
}

function labelKey(name: string, labels: MetricLabels): string {
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k]}"`)
    .join(",");
  return parts ? `${name}{${parts}}` : name;
}

export interface HistogramStats {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p90: number;
  p99: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  // Nearest-rank method, deterministic.
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[idx];
}

export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();

  increment(name: string, labels: MetricLabels = {}, by = 1): void {
    const k = labelKey(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + by);
  }

  counter(name: string, labels: MetricLabels = {}): number {
    return this.counters.get(labelKey(name, labels)) ?? 0;
  }

  setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    this.gauges.set(labelKey(name, labels), value);
  }

  gauge(name: string, labels: MetricLabels = {}): number {
    return this.gauges.get(labelKey(name, labels)) ?? 0;
  }

  observe(name: string, value: number, labels: MetricLabels = {}): void {
    const k = labelKey(name, labels);
    const arr = this.histograms.get(k) ?? [];
    arr.push(value);
    this.histograms.set(k, arr);
  }

  histogram(name: string, labels: MetricLabels = {}): HistogramStats {
    return this.histogramFromKey(labelKey(name, labels));
  }

  // Convenience: time a synchronous operation, recording latency + error count.
  time<T>(name: string, fn: () => T, labels: MetricLabels = {}): T {
    const start = Date.now();
    try {
      const result = fn();
      this.observe(`${name}_duration_ms`, Date.now() - start, labels);
      this.increment(`${name}_total`, { ...labels, status: "ok" });
      return result;
    } catch (err) {
      this.observe(`${name}_duration_ms`, Date.now() - start, labels);
      this.increment(`${name}_total`, { ...labels, status: "error" });
      throw err;
    }
  }

  // Prometheus-style text exposition, deterministic (sorted).
  export(): string {
    const lines: string[] = [];
    for (const [k, v] of [...this.counters.entries()].sort()) {
      lines.push(`${k} ${v}`);
    }
    for (const [k, v] of [...this.gauges.entries()].sort()) {
      lines.push(`${k} ${v}`);
    }
    for (const [k] of [...this.histograms.entries()].sort()) {
      // k is "name{labels}" or "name"; insert stat suffix before any "{".
      const stats = this.histogramFromKey(k);
      const brace = k.indexOf("{");
      const base = brace === -1 ? k : k.slice(0, brace);
      const lbl = brace === -1 ? "" : k.slice(brace);
      lines.push(`${base}_count${lbl} ${stats.count}`);
      lines.push(`${base}_sum${lbl} ${stats.sum}`);
      lines.push(`${base}_p99${lbl} ${stats.p99}`);
    }
    return lines.join("\n");
  }

  private histogramFromKey(k: string): HistogramStats {
    const arr = [...(this.histograms.get(k) ?? [])].sort((a, b) => a - b);
    const count = arr.length;
    const sum = arr.reduce((s, v) => s + v, 0);
    return {
      count,
      sum,
      min: count ? arr[0] : 0,
      max: count ? arr[count - 1] : 0,
      avg: count ? sum / count : 0,
      p50: percentile(arr, 50),
      p90: percentile(arr, 90),
      p99: percentile(arr, 99),
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

# Platform Observability & Metrics (S18)

Metrics for the platform itself, not just the agents it governs.

## Instrument types
- **Counter** — monotonic (requests, promotions, errors); label-separated.
- **Gauge** — point-in-time value (queue depth, deployed agents).
- **Histogram** — distributions with count/sum/min/max/avg and nearest-rank
  percentiles (p50/p90/p99).

## Timing
`time(name, fn, labels)` runs a synchronous operation, records its duration into a
`<name>_duration_ms` histogram, and increments `<name>_total{status=ok|error}` —
rethrowing on error so behaviour is unchanged.

## Export
`export()` emits a deterministic, sorted, Prometheus-style text exposition (counters,
gauges, and histogram `_count`/`_sum`/`_p99` lines) suitable for scraping. The in-memory
registry can be swapped for an OTel/Prometheus client behind the same surface.

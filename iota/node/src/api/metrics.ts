type MetricType = 'counter' | 'gauge' | 'histogram';

interface MetricDefinition {
  help: string;
  name: string;
  type: MetricType;
}

type Labels = Record<string, string>;

function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return '';
  }

  const rendered = entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',');

  return `{${rendered}}`;
}

function labelKey(labels: Labels): string {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
}

export class CounterMetric {
  private readonly values = new Map<string, { labels: Labels; value: number }>();

  constructor(private readonly definition: MetricDefinition) {}

  inc(labels: Labels = {}, delta = 1): void {
    const key = labelKey(labels);
    const current = this.values.get(key);
    if (current) {
      current.value += delta;
      return;
    }

    this.values.set(key, {
      labels: { ...labels },
      value: delta,
    });
  }

  render(): string[] {
    const lines = [
      `# HELP ${this.definition.name} ${this.definition.help}`,
      `# TYPE ${this.definition.name} ${this.definition.type}`,
    ];

    const entries = [...this.values.values()];
    if (entries.length === 0) {
      lines.push(`${this.definition.name} 0`);
      return lines;
    }

    for (const entry of entries) {
      lines.push(`${this.definition.name}${formatLabels(entry.labels)} ${entry.value}`);
    }

    return lines;
  }
}

export class GaugeMetric {
  private readonly values = new Map<string, { labels: Labels; value: number }>();

  constructor(private readonly definition: MetricDefinition) {}

  set(labels: Labels = {}, value: number): void {
    this.values.set(labelKey(labels), {
      labels: { ...labels },
      value,
    });
  }

  render(): string[] {
    const lines = [
      `# HELP ${this.definition.name} ${this.definition.help}`,
      `# TYPE ${this.definition.name} ${this.definition.type}`,
    ];

    const entries = [...this.values.values()];
    if (entries.length === 0) {
      lines.push(`${this.definition.name} 0`);
      return lines;
    }

    for (const entry of entries) {
      lines.push(`${this.definition.name}${formatLabels(entry.labels)} ${entry.value}`);
    }

    return lines;
  }
}

interface HistogramEntry {
  bucketCounts: number[];
  count: number;
  labels: Labels;
  sum: number;
}

export class HistogramMetric {
  private readonly values = new Map<string, HistogramEntry>();

  constructor(
    private readonly definition: MetricDefinition,
    private readonly buckets: number[],
  ) {}

  observe(labels: Labels = {}, value: number): void {
    const key = labelKey(labels);
    let entry = this.values.get(key);
    if (!entry) {
      entry = {
        labels: { ...labels },
        bucketCounts: this.buckets.map(() => 0),
        count: 0,
        sum: 0,
      };
      this.values.set(key, entry);
    }

    entry.count += 1;
    entry.sum += value;

    for (let index = 0; index < this.buckets.length; index += 1) {
      if (value <= this.buckets[index]!) {
        entry.bucketCounts[index] += 1;
      }
    }
  }

  render(): string[] {
    const lines = [
      `# HELP ${this.definition.name} ${this.definition.help}`,
      `# TYPE ${this.definition.name} ${this.definition.type}`,
    ];

    const entries = [...this.values.values()];
    if (entries.length === 0) {
      for (const bucket of this.buckets) {
        lines.push(`${this.definition.name}_bucket{le="${bucket}"} 0`);
      }
      lines.push(`${this.definition.name}_bucket{le="+Inf"} 0`);
      lines.push(`${this.definition.name}_sum 0`);
      lines.push(`${this.definition.name}_count 0`);
      return lines;
    }

    for (const entry of entries) {
      for (let index = 0; index < this.buckets.length; index += 1) {
        const bucket = this.buckets[index]!;
        lines.push(
          `${this.definition.name}_bucket${formatLabels({
            ...entry.labels,
            le: String(bucket),
          })} ${entry.bucketCounts[index]}`,
        );
      }
      lines.push(
        `${this.definition.name}_bucket${formatLabels({
          ...entry.labels,
          le: '+Inf',
        })} ${entry.count}`,
      );
      lines.push(`${this.definition.name}_sum${formatLabels(entry.labels)} ${entry.sum}`);
      lines.push(`${this.definition.name}_count${formatLabels(entry.labels)} ${entry.count}`);
    }

    return lines;
  }
}

export class PrometheusRegistry {
  private readonly metrics: Array<CounterMetric | GaugeMetric | HistogramMetric> = [];

  counter(name: string, help: string): CounterMetric {
    const metric = new CounterMetric({ name, help, type: 'counter' });
    this.metrics.push(metric);
    return metric;
  }

  gauge(name: string, help: string): GaugeMetric {
    const metric = new GaugeMetric({ name, help, type: 'gauge' });
    this.metrics.push(metric);
    return metric;
  }

  histogram(name: string, help: string, buckets: number[]): HistogramMetric {
    const metric = new HistogramMetric({ name, help, type: 'histogram' }, buckets);
    this.metrics.push(metric);
    return metric;
  }

  render(): string {
    return `${this.metrics
      .flatMap((metric) => metric.render())
      .join('\n')}\n`;
  }
}

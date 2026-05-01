"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrometheusRegistry = exports.HistogramMetric = exports.GaugeMetric = exports.CounterMetric = void 0;
function formatLabels(labels) {
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
function labelKey(labels) {
    return Object.entries(labels)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join(',');
}
class CounterMetric {
    constructor(definition) {
        this.definition = definition;
        this.values = new Map();
    }
    inc(labels = {}, delta = 1) {
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
    render() {
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
exports.CounterMetric = CounterMetric;
class GaugeMetric {
    constructor(definition) {
        this.definition = definition;
        this.values = new Map();
    }
    set(labels = {}, value) {
        this.values.set(labelKey(labels), {
            labels: { ...labels },
            value,
        });
    }
    render() {
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
exports.GaugeMetric = GaugeMetric;
class HistogramMetric {
    constructor(definition, buckets) {
        this.definition = definition;
        this.buckets = buckets;
        this.values = new Map();
    }
    observe(labels = {}, value) {
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
            if (value <= this.buckets[index]) {
                entry.bucketCounts[index] += 1;
            }
        }
    }
    render() {
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
                const bucket = this.buckets[index];
                lines.push(`${this.definition.name}_bucket${formatLabels({
                    ...entry.labels,
                    le: String(bucket),
                })} ${entry.bucketCounts[index]}`);
            }
            lines.push(`${this.definition.name}_bucket${formatLabels({
                ...entry.labels,
                le: '+Inf',
            })} ${entry.count}`);
            lines.push(`${this.definition.name}_sum${formatLabels(entry.labels)} ${entry.sum}`);
            lines.push(`${this.definition.name}_count${formatLabels(entry.labels)} ${entry.count}`);
        }
        return lines;
    }
}
exports.HistogramMetric = HistogramMetric;
class PrometheusRegistry {
    constructor() {
        this.metrics = [];
    }
    counter(name, help) {
        const metric = new CounterMetric({ name, help, type: 'counter' });
        this.metrics.push(metric);
        return metric;
    }
    gauge(name, help) {
        const metric = new GaugeMetric({ name, help, type: 'gauge' });
        this.metrics.push(metric);
        return metric;
    }
    histogram(name, help, buckets) {
        const metric = new HistogramMetric({ name, help, type: 'histogram' }, buckets);
        this.metrics.push(metric);
        return metric;
    }
    render() {
        return `${this.metrics
            .flatMap((metric) => metric.render())
            .join('\n')}\n`;
    }
}
exports.PrometheusRegistry = PrometheusRegistry;

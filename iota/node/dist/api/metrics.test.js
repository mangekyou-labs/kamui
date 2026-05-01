"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const metrics_1 = require("./metrics");
(0, node_test_1.default)('PrometheusRegistry renders counters, gauges, and histograms', () => {
    const registry = new metrics_1.PrometheusRegistry();
    const counter = registry.counter('test_counter_total', 'A test counter.');
    const gauge = registry.gauge('test_gauge', 'A test gauge.');
    const histogram = registry.histogram('test_duration_seconds', 'A test histogram.', [0.1, 1]);
    counter.inc({ result: 'success' }, 2);
    gauge.set({}, 7);
    histogram.observe({}, 0.5);
    const output = registry.render();
    strict_1.default.match(output, /# HELP test_counter_total A test counter\./);
    strict_1.default.match(output, /test_counter_total\{result="success"\} 2/);
    strict_1.default.match(output, /test_gauge 7/);
    strict_1.default.match(output, /test_duration_seconds_bucket\{le="0.1"\} 0/);
    strict_1.default.match(output, /test_duration_seconds_bucket\{le="1"\} 1/);
    strict_1.default.match(output, /test_duration_seconds_bucket\{le="\+Inf"\} 1/);
    strict_1.default.match(output, /test_duration_seconds_sum 0.5/);
    strict_1.default.match(output, /test_duration_seconds_count 1/);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { PrometheusRegistry } from './metrics';

test('PrometheusRegistry renders counters, gauges, and histograms', () => {
  const registry = new PrometheusRegistry();
  const counter = registry.counter('test_counter_total', 'A test counter.');
  const gauge = registry.gauge('test_gauge', 'A test gauge.');
  const histogram = registry.histogram('test_duration_seconds', 'A test histogram.', [0.1, 1]);

  counter.inc({ result: 'success' }, 2);
  gauge.set({}, 7);
  histogram.observe({}, 0.5);

  const output = registry.render();

  assert.match(output, /# HELP test_counter_total A test counter\./);
  assert.match(output, /test_counter_total\{result="success"\} 2/);
  assert.match(output, /test_gauge 7/);
  assert.match(output, /test_duration_seconds_bucket\{le="0.1"\} 0/);
  assert.match(output, /test_duration_seconds_bucket\{le="1"\} 1/);
  assert.match(output, /test_duration_seconds_bucket\{le="\+Inf"\} 1/);
  assert.match(output, /test_duration_seconds_sum 0.5/);
  assert.match(output, /test_duration_seconds_count 1/);
});

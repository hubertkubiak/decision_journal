import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  brierScore,
  calibrationBuckets,
  calibrationSummary,
  confidenceSentence,
} from '../src/services/calibration.js';

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to be close to ${expected}`);

const repeat = (count, confidence, outcome) => Array.from({ length: count }, () => ({ confidence, outcome }));

const bucket = (rows, name) => calibrationBuckets(rows).find((b) => b.name === name);

test('there are always five buckets, and empty ones have no rate', () => {
  const buckets = calibrationBuckets([]);
  assert.deepEqual(buckets.map((b) => b.name), ['50s', '60s', '70s', '80s', '90s']);
  for (const b of buckets) {
    assert.equal(b.n, 0);
    assert.equal(b.hitRate, null);
    assert.equal(b.gap, null);
    assert.equal(b.label, 'Not enough data yet');
  }
  assert.equal(buckets[3].expected, 0.85);
});

test('bucket boundaries: 59/60 and 89/90 and 99 land in the right place', () => {
  const rows = [
    { confidence: 50, outcome: 'right' },
    { confidence: 59, outcome: 'right' },
    { confidence: 60, outcome: 'right' },
    { confidence: 89, outcome: 'right' },
    { confidence: 90, outcome: 'right' },
    { confidence: 99, outcome: 'right' },
  ];
  assert.deepEqual(calibrationBuckets(rows).map((b) => b.n), [2, 1, 0, 1, 2]);
});

test('hits, hit rate, expected and gap are computed per bucket', () => {
  const b = bucket([...repeat(3, 80, 'right'), ...repeat(1, 84, 'wrong')], '80s');
  assert.equal(b.n, 4);
  assert.equal(b.hits, 3);
  assert.equal(b.hitRate, 0.75);
  close(b.expected, 0.81); // the mean of the confidences, not the midpoint
  close(b.gap, -0.06);
});

test('labels: well calibrated, overconfident, underconfident', () => {
  const eight = (confidence, hits) => [
    ...repeat(hits, confidence, 'right'),
    ...repeat(8 - hits, confidence, 'wrong'),
  ];
  assert.equal(bucket(eight(75, 6), '70s').label, 'Well calibrated');
  assert.equal(bucket(eight(90, 6), '90s').label, 'Overconfident');
  assert.equal(bucket(eight(55, 7), '50s').label, 'Underconfident');
});

test('a gap of exactly 5 points is well calibrated, despite floating point', () => {
  const rows = (confidence, hits, total) => [
    ...repeat(hits, confidence, 'right'),
    ...repeat(total - hits, confidence, 'wrong'),
  ];
  // 3/5 - 0.65 is -0.05000000000000004 without rounding.
  assert.equal(bucket(rows(65, 3, 5), '60s').verdict, 'well');
  // 4/5 - 0.75 is 0.050000000000000044 without rounding.
  assert.equal(bucket(rows(75, 4, 5), '70s').verdict, 'well');
  // One point further is not.
  assert.equal(bucket(rows(66, 3, 5), '60s').verdict, 'over');
  assert.equal(bucket(rows(74, 4, 5), '70s').verdict, 'under');
});

test('fewer than 5 in a bucket is not enough data, whatever the gap', () => {
  const b = bucket(repeat(4, 95, 'wrong'), '90s');
  assert.equal(b.verdict, 'muted');
  assert.equal(b.label, 'Not enough data yet');
  assert.equal(b.hitRate, 0); // the bar is still shown
  assert.equal(bucket(repeat(5, 95, 'wrong'), '90s').label, 'Overconfident');
});

test('unclear outcomes are excluded everywhere', () => {
  const rows = [...repeat(5, 80, 'right'), ...repeat(10, 80, 'unclear')];
  assert.equal(bucket(rows, '80s').n, 5);
  assert.equal(calibrationSummary(rows).n, 5);
  assert.equal(calibrationSummary(rows).accuracy, 1);
  close(brierScore(rows), 0.04);
});

test('Brier score: known values, and null with nothing to score', () => {
  assert.equal(brierScore([]), null);
  assert.equal(brierScore(repeat(3, 50, 'unclear')), null);
  close(brierScore(repeat(2, 50, 'right')), 0.25);
  close(brierScore(repeat(2, 50, 'wrong')), 0.25);
  close(brierScore([{ confidence: 90, outcome: 'right' }, { confidence: 80, outcome: 'wrong' }]), (0.01 + 0.64) / 2);
});

test('summary has accuracy and average confidence, and survives no data', () => {
  const summary = calibrationSummary([...repeat(1, 90, 'right'), ...repeat(1, 70, 'wrong')]);
  assert.equal(summary.n, 2);
  assert.equal(summary.hits, 1);
  assert.equal(summary.accuracy, 0.5);
  close(summary.averageConfidence, 0.8);

  assert.deepEqual(calibrationSummary([]), { n: 0, hits: 0, accuracy: null, averageConfidence: null, brier: null });
});

test('the summary sentence reads as the spec shows', () => {
  assert.equal(
    confidenceSentence({ averageConfidence: 0.82, accuracy: 0.71 }),
    "You're on average 82% sure and right 71% of the time.",
  );
});

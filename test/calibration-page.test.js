import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { startApp } from './helpers.js';

const { addDays, today } = await import('../src/lib/dates.js');
const { calibrationBuckets, brierScore } = await import('../src/services/calibration.js');

let app;
before(async () => { app = await startApp(); });
after(() => app.close());
beforeEach(() => app.repo.deleteEverything());

function addResolved(count, confidence, outcome) {
  for (let i = 0; i < count; i += 1) {
    const id = app.repo.createDecision({
      title: 'Resolved one',
      prediction: 'Something',
      confidence,
      review_on: addDays(today(), 1),
    });
    app.repo.resolveDecision(id, { outcome });
  }
}

test('under 5 scored decisions shows an empty state, not charts; unclears do not count', async () => {
  addResolved(4, 80, 'right');
  addResolved(3, 80, 'unclear');
  const { html, status } = await app.get('/calibration');
  assert.equal(status, 200);
  assert.match(html, /You need 1 more/);
  assert.doesNotMatch(html, /class="chart"/);

  const dashboard = await app.get('/');
  assert.match(dashboard.html, /Resolve 1 more decision with a clear outcome/);
});

test('the page has stats, CSS-variable bars, an accessible table and the explanation', async () => {
  addResolved(4, 80, 'right');
  addResolved(1, 80, 'wrong');
  addResolved(2, 80, 'unclear');
  const { html } = await app.get('/calibration');

  assert.match(html, /You&#39;re on average 80% sure and right 80% of the time\.|You're on average 80% sure and right 80% of the time\./);
  assert.match(html, /<span class="stat__value">7<\/span>/);
  assert.match(html, /2 unclear, not scored/);
  assert.match(html, /<span class="stat__value">80%<\/span>/);
  assert.match(html, /0 is perfect, 0\.25 is a coin flip\./);
  assert.match(html, /style="--value: 0\.800; --expected: 0\.800"/);
  assert.match(html, /chart__column--well/);
  assert.match(html, /<table/);
  assert.match(html, /scope="col"/);
  assert.match(html, /What calibration means/);
  assert.match(html, /class="main main--wide"/);
  assert.match(html, /<meta name="description"/); // from `block append head`
});

test('the dashboard glance links to the full report', async () => {
  addResolved(5, 80, 'right');
  const { html } = await app.get('/');
  assert.match(html, /Your calibration at a glance/);
  assert.match(html, /sure and right 100% of the time\./);
  assert.match(html, /href="\/calibration">See the full report/);
});

test('seed data: buckets and Brier score match values worked out by hand', async () => {
  await import('../src/db/seed.js');
  const rows = app.repo.calibrationRows();

  assert.equal(rows.length, 20);
  const buckets = calibrationBuckets(rows);
  assert.deepEqual(buckets.map((b) => [b.name, b.hits, b.n]), [
    ['50s', 1, 2],
    ['60s', 2, 3],
    ['70s', 4, 5],
    ['80s', 3, 5],
    ['90s', 3, 5],
  ]);
  assert.deepEqual(buckets.map((b) => b.label), [
    'Not enough data yet',
    'Not enough data yet',
    'Well calibrated',
    'Overconfident',
    'Overconfident',
  ]);
  // Sum of (p - o)² over the 20 seeded decisions, computed separately: 5.3239.
  assert.ok(Math.abs(brierScore(rows) - 5.3239 / 20) < 1e-9);

  const { html } = await app.get('/calibration');
  assert.match(html, /<span class="stat__value">65%<\/span>/);
  assert.match(html, /<span class="stat__value">0\.27<\/span>/);
});

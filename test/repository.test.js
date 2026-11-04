import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

process.env.DB_PATH = ':memory:';

const repo = await import('../src/repositories/decisions.js');
const { addDays, today } = await import('../src/lib/dates.js');

const decision = (overrides = {}) => ({
  title: 'A decision',
  context: '',
  prediction: 'Something will happen',
  confidence: 70,
  review_on: addDays(today(), 7),
  ...overrides,
});

beforeEach(() => repo.deleteEverything());

test('createDecision stores values and tags; an empty context becomes NULL', () => {
  const id = repo.createDecision(decision(), ['tech', 'money']);
  const found = repo.getDecision(id);
  assert.equal(found.title, 'A decision');
  assert.equal(found.context, null);
  assert.equal(found.status, 'open');
  assert.deepEqual(found.tags, ['money', 'tech']);
});

test('getDecision returns undefined for an unknown id', () => {
  assert.equal(repo.getDecision(999), undefined);
});

test('updateDecision replaces tags and removes the orphans', () => {
  const id = repo.createDecision(decision(), ['old', 'kept']);
  assert.equal(repo.updateDecision(id, decision({ title: 'Renamed' }), ['kept', 'new']), true);
  assert.equal(repo.getDecision(id).title, 'Renamed');
  assert.deepEqual(repo.listTags(), [
    { name: 'kept', count: 1 },
    { name: 'new', count: 1 },
  ]);
});

test('deleteDecision removes orphaned tags but keeps shared ones', () => {
  const a = repo.createDecision(decision(), ['shared', 'only-a']);
  repo.createDecision(decision(), ['shared']);
  assert.equal(repo.deleteDecision(a), true);
  assert.deepEqual(repo.listTags(), [{ name: 'shared', count: 1 }]);
  assert.equal(repo.deleteDecision(a), false);
});

test('a failed write rolls back the tags with the decision', () => {
  const tooLong = 'x'.repeat(31);
  assert.throws(() => repo.createDecision(decision(), [tooLong]), /CHECK constraint/);
  assert.equal(repo.counts().open, 0);
});

test('resolving works once; a resolved decision cannot be updated or re-resolved', () => {
  const id = repo.createDecision(decision());
  assert.equal(repo.resolveDecision(id, { outcome: 'right', reflection: 'Nice' }), true);
  assert.equal(repo.resolveDecision(id, { outcome: 'wrong' }), false);
  assert.equal(repo.updateDecision(id, decision({ title: 'Rewritten' }), []), false);

  const found = repo.getDecision(id);
  assert.equal(found.outcome, 'right');
  assert.equal(found.title, 'A decision');
  assert.ok(found.resolved_at);
});

test('reopen keeps the reflection; the one-click resolve leaves it, an empty form clears it', () => {
  const id = repo.createDecision(decision());
  repo.resolveDecision(id, { outcome: 'wrong', reflection: 'Written with care' });

  assert.equal(repo.reopenDecision(id), true);
  assert.equal(repo.reopenDecision(id), false);
  let found = repo.getDecision(id);
  assert.equal(found.outcome, null);
  assert.equal(found.resolved_at, null);
  assert.equal(found.reflection, 'Written with care');

  repo.resolveDecision(id, { outcome: 'right' });
  assert.equal(repo.getDecision(id).reflection, 'Written with care');

  repo.reopenDecision(id);
  repo.resolveDecision(id, { outcome: 'right', reflection: '' });
  found = repo.getDecision(id);
  assert.equal(found.reflection, null);
});

test('due covers today and the past, overdue only past 7 days, upcoming the next N days', () => {
  const t = today();
  const dueToday = repo.createDecision(decision({ review_on: t }));
  const sevenDays = repo.createDecision(decision({ review_on: addDays(t, -7) }));
  const eightDays = repo.createDecision(decision({ review_on: addDays(t, -8) }));
  const tomorrow = repo.createDecision(decision({ review_on: addDays(t, 1) }));
  const inFourteen = repo.createDecision(decision({ review_on: addDays(t, 14) }));
  repo.createDecision(decision({ review_on: addDays(t, 15) }));

  assert.deepEqual(repo.listDue().map((d) => d.id), [eightDays, sevenDays, dueToday]);
  assert.equal(repo.getDecision(dueToday).isDue, true);
  assert.equal(repo.getDecision(dueToday).isOverdue, false);
  assert.equal(repo.getDecision(sevenDays).isOverdue, false);
  assert.equal(repo.getDecision(eightDays).isOverdue, true);
  assert.equal(repo.getDecision(tomorrow).isDue, false);
  assert.deepEqual(repo.listUpcoming().map((d) => d.id), [tomorrow, inFourteen]);
});

test('counts and calibrationRows treat unclear outcomes correctly', () => {
  const a = repo.createDecision(decision({ confidence: 60 }));
  const b = repo.createDecision(decision({ confidence: 80 }));
  repo.createDecision(decision());
  repo.createDecision(decision({ review_on: today() }));
  repo.resolveDecision(a, { outcome: 'right' });
  repo.resolveDecision(b, { outcome: 'unclear' });

  assert.deepEqual(repo.counts(), { open: 2, due: 1, resolved: 2, unclear: 1 });
  assert.deepEqual(repo.calibrationRows(), [{ confidence: 60, outcome: 'right' }]);
});

test('counts is all zeros for an empty journal', () => {
  assert.deepEqual(repo.counts(), { open: 0, due: 0, resolved: 0, unclear: 0 });
});

test('listDecisions filters by status, tag and text', () => {
  const a = repo.createDecision(decision({ title: 'Buy a house', review_on: today() }), ['money']);
  const b = repo.createDecision(decision({ prediction: 'The house will sell' }), ['money', 'tech']);
  const c = repo.createDecision(decision({ title: 'Other' }), ['tech']);
  repo.resolveDecision(c, { outcome: 'right' });

  const ids = (filters) => repo.listDecisions(filters).rows.map((d) => d.id).sort();
  assert.deepEqual(ids({ status: 'open' }), [a, b]);
  assert.deepEqual(ids({ status: 'due' }), [a]);
  assert.deepEqual(ids({ status: 'resolved' }), [c]);
  assert.deepEqual(ids({ tag: 'tech' }), [b, c]);
  assert.deepEqual(ids({ tag: 'TECH' }), [b, c]);
  assert.deepEqual(ids({ q: 'HOUSE' }), [a, b]);
  assert.deepEqual(ids({ q: 'house', tag: 'tech' }), [b]);
});

test('LIKE wildcards in a search match literally', () => {
  const pct = repo.createDecision(decision({ title: 'Save 20% more' }));
  repo.createDecision(decision({ title: 'Save 200 more' }));
  const under = repo.createDecision(decision({ title: 'rename snake_case' }));
  repo.createDecision(decision({ title: 'rename snakeXcase' }));

  assert.deepEqual(repo.listDecisions({ q: '20%' }).rows.map((d) => d.id), [pct]);
  assert.deepEqual(repo.listDecisions({ q: 'e_c' }).rows.map((d) => d.id), [under]);
});

test('listDecisions sorts and pages, and total ignores the page', () => {
  const ids = [85, 55, 70].map((confidence, i) =>
    repo.createDecision(decision({ confidence, review_on: addDays(today(), 3 - i) })),
  );
  const byConfidence = repo.listDecisions({ sort: 'confidence' }).rows.map((d) => d.confidence);
  assert.deepEqual(byConfidence, [85, 70, 55]);
  const bySoonest = repo.listDecisions({ sort: 'review' }).rows.map((d) => d.id);
  assert.deepEqual(bySoonest, [ids[2], ids[1], ids[0]]);
  const byNewest = repo.listDecisions({ sort: 'newest' }).rows.map((d) => d.id);
  assert.deepEqual(byNewest, [ids[2], ids[1], ids[0]]);

  const page = repo.listDecisions({ limit: 2, offset: 2, sort: 'confidence' });
  assert.equal(page.total, 3);
  assert.deepEqual(page.rows.map((d) => d.confidence), [55]);
});

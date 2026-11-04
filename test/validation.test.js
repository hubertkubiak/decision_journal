import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addMonths, isValidDate, relativeDate, toLocalDate } from '../src/lib/dates.js';
import {
  constraintErrors,
  parseTags,
  validateDecision,
  validateResolution,
} from '../src/validation/decision.js';

const NOW = new Date(2026, 0, 31, 12); // 31 Jan 2026, local time

const valid = (overrides = {}) => ({
  title: 'Take the job',
  prediction: 'I will enjoy it',
  confidence: '70',
  review_on: '2026-03-01',
  ...overrides,
});
const errorsFor = (body, options = { isNew: true, now: NOW }) =>
  validateDecision(body, options).errors;

test('a valid decision has no errors and trimmed values', () => {
  const { values, errors } = validateDecision(valid({ title: '  Take the job ' }), { isNew: true, now: NOW });
  assert.deepEqual(errors, {});
  assert.equal(values.title, 'Take the job');
  assert.equal(values.confidence, 70);
});

test('title and prediction lengths are enforced after trimming', () => {
  assert.ok(errorsFor(valid({ title: '  a  ' })).title);
  assert.ok(errorsFor(valid({ title: 'x'.repeat(121) })).title);
  assert.equal(errorsFor(valid({ title: 'x'.repeat(120) })).title, undefined);
  assert.ok(errorsFor(valid({ prediction: '' })).prediction);
  assert.ok(errorsFor(valid({ prediction: 'x'.repeat(501) })).prediction);
});

test('lengths count characters like SQLite does, not UTF-16 units', () => {
  // Two emoji are 4 UTF-16 units but 2 characters, which SQLite's CHECK would reject.
  assert.ok(errorsFor(valid({ title: '😀😀' })).title);
  assert.equal(errorsFor(valid({ title: '😀'.repeat(120) })).title, undefined);
});

test('a CRLF line break counts as one character', () => {
  assert.equal(errorsFor(valid({ context: 'x\r\n'.repeat(666) + 'xx' })).context, undefined);
  assert.ok(errorsFor(valid({ context: 'x'.repeat(2001) })).context);
});

test('confidence must be a whole number from 50 to 99', () => {
  for (const bad of ['49', '100', '70.5', 'abc', '', '-60', '7e1']) {
    assert.ok(errorsFor(valid({ confidence: bad })).confidence, `expected "${bad}" to fail`);
  }
  for (const good of ['50', '99']) {
    assert.equal(errorsFor(valid({ confidence: good })).confidence, undefined);
  }
});

test('review date must exist, and must not be in the past when creating', () => {
  assert.ok(errorsFor(valid({ review_on: '2026-02-30' })).review_on);
  assert.ok(errorsFor(valid({ review_on: 'soon' })).review_on);
  assert.ok(errorsFor(valid({ review_on: '2026-01-30' })).review_on);
  assert.equal(errorsFor(valid({ review_on: '2026-01-31' })).review_on, undefined);
});

test('a past review date is allowed when editing', () => {
  const errors = errorsFor(valid({ review_on: '2020-01-01' }), { isNew: false, now: NOW });
  assert.equal(errors.review_on, undefined);
});

test('a chosen preset overrides the date field; with none, the date field counts', () => {
  const withPreset = validateDecision(valid({ preset: '1m', review_on: 'garbage' }), { isNew: true, now: NOW });
  assert.deepEqual(withPreset.errors, {});
  assert.equal(withPreset.values.review_on, '2026-02-28'); // clamped from 31 Jan

  const week = validateDecision(valid({ preset: '1w' }), { isNew: true, now: NOW });
  assert.equal(week.values.review_on, '2026-02-07');

  for (const preset of ['', 'bogus', undefined]) {
    const { values } = validateDecision(valid({ preset }), { isNew: true, now: NOW });
    assert.equal(values.review_on, '2026-03-01');
  }
});

test('presets are ignored when editing', () => {
  const { values } = validateDecision(valid({ preset: '1w' }), { isNew: false, now: NOW });
  assert.equal(values.review_on, '2026-03-01');
});

test('tags are lower-cased, deduped, and limited', () => {
  assert.deepEqual(parseTags(' Tech, money ,TECH,, '), ['tech', 'money']);
  assert.equal(errorsFor(valid({ tags: 'a,b,c,d,e' })).tags, undefined);
  assert.equal(errorsFor(valid({ tags: 'a,a,b,c,d,e' })).tags, undefined);
  assert.ok(errorsFor(valid({ tags: 'a,b,c,d,e,f' })).tags);
  assert.ok(errorsFor(valid({ tags: 'x'.repeat(31) })).tags);
});

test('repeated form fields arriving as arrays fail validation without crashing', () => {
  const errors = errorsFor(valid({ title: ['a', 'b'], tags: ['x', 'y'], review_on: ['2026-03-01'] }));
  assert.ok(errors.title);
  assert.ok(errors.review_on);
});

test('validateResolution checks the outcome and the reflection length', () => {
  assert.deepEqual(validateResolution({ outcome: 'right' }).errors, {});
  assert.ok(validateResolution({}).errors.outcome);
  assert.ok(validateResolution({ outcome: 'maybe' }).errors.outcome);
  assert.ok(validateResolution({ outcome: 'wrong', reflection: 'x'.repeat(2001) }).errors.reflection);
});

test('validateResolution tells an absent reflection from an empty one', () => {
  assert.equal(validateResolution({ outcome: 'right' }).values.reflection, undefined);
  assert.equal(validateResolution({ outcome: 'right', reflection: ' ' }).values.reflection, '');
});

test('constraintErrors maps CHECK failures to fields and ignores other errors', () => {
  const failure = (message) => Object.assign(new Error(message), { code: 'SQLITE_CONSTRAINT_CHECK' });
  assert.ok(constraintErrors(failure('CHECK constraint failed: length(title) BETWEEN 3 AND 120')).title);
  assert.ok(constraintErrors(failure('CHECK constraint failed: length(name) BETWEEN 1 AND 30')).tags);
  assert.equal(constraintErrors(new Error('disk full')), null);
});

test('date helpers: real dates only, month-end clamping, relative wording', () => {
  assert.equal(isValidDate('2024-02-29'), true);
  assert.equal(isValidDate('2026-02-29'), false);
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(relativeDate('2026-01-31', NOW), 'today');
  assert.equal(relativeDate('2026-02-01', NOW), 'tomorrow');
  assert.equal(relativeDate('2026-02-03', NOW), 'in 3 days');
  assert.equal(relativeDate('2026-01-17', NOW), '2 weeks ago');
});

test('SQLite timestamps are read as UTC', () => {
  const expected = new Date(Date.UTC(2026, 5, 1, 23, 30));
  const pad = (n) => String(n).padStart(2, '0');
  assert.equal(
    toLocalDate('2026-06-01 23:30:00'),
    `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}`,
  );
});

import { addDays, addMonths, isValidDate, today } from '../lib/dates.js';

const MESSAGES = {
  title: 'Give it a short title (3–120 characters).',
  context: 'Keep context under 2000 characters.',
  prediction: 'What do you expect to happen?',
  confidence: 'Pick a confidence between 50% and 99%.',
  review_on: 'Choose a review date in the future.',
  tags: 'Up to 5 tags, 30 characters each.',
  outcome: 'Did it turn out as you predicted?',
  reflection: 'Keep your reflection under 2000 characters.',
};

/** The radio group always needs a "no preset" choice: a radio can't be unticked without JS. */
export const REVIEW_PRESETS = [
  { value: '', label: 'Use the date above' },
  { value: '1w', label: '1 week', compute: (from) => addDays(from, 7) },
  { value: '1m', label: '1 month', compute: (from) => addMonths(from, 1) },
  { value: '3m', label: '3 months', compute: (from) => addMonths(from, 3) },
  { value: '6m', label: '6 months', compute: (from) => addMonths(from, 6) },
];

const OUTCOMES = ['right', 'wrong', 'unclear'];

// Repeated form keys arrive as arrays; anything but a string counts as blank.
// Browsers send textarea line breaks as CRLF, which would count twice.
const cleanText = (value) =>
  typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';

// Counts code points, as SQLite's length() does, so the two limits agree on emoji.
const charCount = (text) => [...text].length;

export function parseTags(raw) {
  const names = cleanText(raw)
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(names)];
}

/** @param {{isNew?: boolean, now?: Date}} options `isNew` enables presets and the future-date rule. */
export function validateDecision(body, { isNew = false, now = new Date() } = {}) {
  const errors = {};

  const title = cleanText(body.title);
  if (charCount(title) < 3 || charCount(title) > 120) errors.title = MESSAGES.title;

  const context = cleanText(body.context);
  if (charCount(context) > 2000) errors.context = MESSAGES.context;

  const prediction = cleanText(body.prediction);
  if (charCount(prediction) < 3 || charCount(prediction) > 500) errors.prediction = MESSAGES.prediction;

  const rawConfidence = cleanText(body.confidence);
  const confidence = /^\d{2}$/.test(rawConfidence) ? Number(rawConfidence) : rawConfidence;
  if (!Number.isInteger(confidence) || confidence < 50 || confidence > 99) {
    errors.confidence = MESSAGES.confidence;
  }

  const preset = isNew
    ? REVIEW_PRESETS.find((option) => option.compute && option.value === body.preset)
    : undefined;
  const review_on = preset ? preset.compute(today(now)) : cleanText(body.review_on);
  if (!isValidDate(review_on) || (isNew && review_on < today(now))) {
    errors.review_on = MESSAGES.review_on;
  }

  const tagNames = parseTags(body.tags);
  if (tagNames.length > 5 || tagNames.some((name) => charCount(name) > 30)) {
    errors.tags = MESSAGES.tags;
  }

  return {
    values: {
      title,
      context,
      prediction,
      confidence,
      review_on,
      preset: preset ? preset.value : '',
      tags: cleanText(body.tags),
      tagNames,
    },
    errors,
  };
}

export function validateResolution(body) {
  const errors = {};
  const outcome = OUTCOMES.includes(body.outcome) ? body.outcome : '';
  if (!outcome) errors.outcome = MESSAGES.outcome;

  // No field at all (the dashboard buttons) is different from a field left empty.
  const reflection = body.reflection === undefined ? undefined : cleanText(body.reflection);
  if (reflection !== undefined && charCount(reflection) > 2000) {
    errors.reflection = MESSAGES.reflection;
  }
  return { values: { outcome, reflection }, errors };
}

/** Maps a SQLite constraint failure to form errors, or null if it isn't one we can explain. */
export function constraintErrors(err) {
  if (!String(err?.code).startsWith('SQLITE_CONSTRAINT')) return null;
  const message = String(err.message);
  const field = [
    ['title', 'title'],
    ['prediction', 'prediction'],
    ['confidence', 'confidence'],
    ['name', 'tags'],
    ['outcome', 'outcome'],
  ].find(([column]) => message.includes(column));
  return field ? { [field[1]]: MESSAGES[field[1]] } : null;
}

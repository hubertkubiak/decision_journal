// Calendar dates are plain 'YYYY-MM-DD' strings in the user's local time.
// Timestamps from SQLite's datetime('now') are 'YYYY-MM-DD HH:MM:SS' in UTC.
// `new Date('YYYY-MM-DD')` would parse as UTC midnight, so dates are always
// split by hand and day arithmetic is done on UTC values, which avoids DST.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const pad = (n) => String(n).padStart(2, '0');

function parseParts(iso) {
  const match = DATE_RE.exec(iso);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  const isReal =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
  return isReal ? { year, month, day } : null;
}

const toUtc = ({ year, month, day }) => Date.UTC(year, month - 1, day);

function fromUtc(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function isValidDate(value) {
  return typeof value === 'string' && parseParts(value) !== null;
}

/** Today's date in local time, as 'YYYY-MM-DD'. */
export function today(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso, days) {
  return fromUtc(toUtc(parseParts(iso)) + days * MS_PER_DAY);
}

/** Adds calendar months, clamping to month end: 31 Jan + 1 month = 28 Feb. */
export function addMonths(iso, months) {
  const { year, month, day } = parseParts(iso);
  const zeroBased = month - 1 + months;
  const targetYear = year + Math.floor(zeroBased / 12);
  const targetMonth = ((zeroBased % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
}

export function daysBetween(fromIso, toIso) {
  return Math.round((toUtc(parseParts(toIso)) - toUtc(parseParts(fromIso))) / MS_PER_DAY);
}

/** Accepts a 'YYYY-MM-DD' date or a UTC SQLite timestamp; returns the local date. */
export function toLocalDate(value) {
  if (isValidDate(value)) return value;
  return today(new Date(`${String(value).replace(' ', 'T')}Z`));
}

export function formatDate(value) {
  if (!value) return '';
  return dateFormatter.format(toUtc(parseParts(toLocalDate(value))));
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function relativeDate(value, now = new Date()) {
  if (!value) return '';
  const days = daysBetween(today(now), toLocalDate(value));
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';

  const abs = Math.abs(days);
  // Pick the unit from the rounded value, so 350 days reads "1 year", not "12 months".
  const months = Math.round(abs / 30);
  let span;
  if (abs < 14) span = pluralize(abs, 'day');
  else if (abs < 60) span = pluralize(Math.round(abs / 7), 'week');
  else if (months < 12) span = pluralize(months, 'month');
  else span = pluralize(Math.round(abs / 365), 'year');
  return days > 0 ? `in ${span}` : `${span} ago`;
}

export function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning.';
  if (hour >= 12 && hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

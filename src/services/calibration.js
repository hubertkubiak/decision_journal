// Pure calibration maths: rows of { confidence, outcome } in, numbers out. No DB.

export const MIN_BUCKET_SIZE = 5;
export const MIN_RESOLVED = 5;

export const BUCKETS = [
  { name: '50s', min: 50, max: 59, midpoint: 0.55 },
  { name: '60s', min: 60, max: 69, midpoint: 0.65 },
  { name: '70s', min: 70, max: 79, midpoint: 0.75 },
  { name: '80s', min: 80, max: 89, midpoint: 0.85 },
  { name: '90s', min: 90, max: 99, midpoint: 0.95 },
];

const WELL_CALIBRATED_GAP = 0.05;

const VERDICTS = {
  muted: { label: 'Not enough data yet', short: 'Few' },
  well: { label: 'Well calibrated', short: 'On target' },
  over: { label: 'Overconfident', short: 'Over' },
  under: { label: 'Underconfident', short: 'Under' },
};

const scorable = (rows) => rows.filter(({ outcome }) => outcome === 'right' || outcome === 'wrong');
const mean = (numbers) => numbers.reduce((sum, n) => sum + n, 0) / numbers.length;

// 0.6 - 0.65 is -0.05000000000000004 in floating point, which would turn an exact
// 5-point gap into "Overconfident". Differences are rounded before being compared.
const roundOff = (n) => Math.round(n * 1e9) / 1e9;

export function verdictFor(gap, n) {
  if (n < MIN_BUCKET_SIZE) return 'muted';
  if (gap < -WELL_CALIBRATED_GAP) return 'over';
  if (gap > WELL_CALIBRATED_GAP) return 'under';
  return 'well';
}

/**
 * One entry per bucket, always all five. An empty bucket has a null hitRate and
 * gap, and uses its midpoint as the expected rate so the chart can still mark it.
 */
export function calibrationBuckets(rows) {
  const scored = scorable(rows);
  return BUCKETS.map(({ name, min, max, midpoint }) => {
    const inBucket = scored.filter(({ confidence }) => confidence >= min && confidence <= max);
    const n = inBucket.length;
    const hits = inBucket.filter(({ outcome }) => outcome === 'right').length;
    const hitRate = n ? hits / n : null;
    const expected = n ? mean(inBucket.map(({ confidence }) => confidence)) / 100 : midpoint;
    const gap = n ? roundOff(hitRate - expected) : null;
    const verdict = verdictFor(gap, n);
    return { name, min, max, n, hits, hitRate, expected, gap, verdict, ...VERDICTS[verdict] };
  });
}

/** mean((p - o)²): 0 is perfect, 0.25 is a coin flip. Null with nothing to score. */
export function brierScore(rows) {
  const scored = scorable(rows);
  if (scored.length === 0) return null;
  return mean(
    scored.map(({ confidence, outcome }) => (confidence / 100 - (outcome === 'right' ? 1 : 0)) ** 2),
  );
}

export function calibrationSummary(rows) {
  const scored = scorable(rows);
  const n = scored.length;
  if (n === 0) return { n, hits: 0, accuracy: null, averageConfidence: null, brier: null };
  const hits = scored.filter(({ outcome }) => outcome === 'right').length;
  return {
    n,
    hits,
    accuracy: hits / n,
    averageConfidence: mean(scored.map(({ confidence }) => confidence)) / 100,
    brier: brierScore(scored),
  };
}

export const percent = (fraction) => `${Math.round(fraction * 100)}%`;

export function confidenceSentence({ averageConfidence, accuracy }) {
  return `You're on average ${percent(averageConfidence)} sure and right ${percent(accuracy)} of the time.`;
}

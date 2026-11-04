import { Router } from 'express';
import { greeting } from '../lib/dates.js';
import * as repo from '../repositories/decisions.js';
import { calibrationSummary, confidenceSentence, MIN_RESOLVED } from '../services/calibration.js';

const router = Router();

function reviewSummary(due) {
  if (due === 0) return 'Nothing is waiting for you today.';
  if (due === 1) return '1 decision is ready for review.';
  return `${due} decisions are ready for review.`;
}

router.get('/', (req, res) => {
  const counts = repo.counts();
  const calibration = calibrationSummary(repo.calibrationRows());
  res.render('dashboard', {
    greeting: greeting(),
    isEmpty: counts.open + counts.resolved === 0,
    summary: reviewSummary(counts.due),
    due: repo.listDue(),
    upcoming: repo.listUpcoming(14),
    recent: repo.listRecentlyResolved(5),
    calibrationSentence: calibration.n >= MIN_RESOLVED ? confidenceSentence(calibration) : null,
    calibrationRemaining: MIN_RESOLVED - calibration.n,
  });
});

export default router;

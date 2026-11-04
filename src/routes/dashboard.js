import { Router } from 'express';
import { greeting } from '../lib/dates.js';
import * as repo from '../repositories/decisions.js';

const router = Router();

function reviewSummary(due) {
  if (due === 0) return 'Nothing is waiting for you today.';
  if (due === 1) return '1 decision is ready for review.';
  return `${due} decisions are ready for review.`;
}

router.get('/', (req, res) => {
  const counts = repo.counts();
  res.render('dashboard', {
    greeting: greeting(),
    isEmpty: counts.open + counts.resolved === 0,
    summary: reviewSummary(counts.due),
    due: repo.listDue(),
    upcoming: repo.listUpcoming(14),
    recent: repo.listRecentlyResolved(5),
  });
});

export default router;

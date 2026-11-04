import { Router } from 'express';
import * as repo from '../repositories/decisions.js';
import {
  calibrationBuckets,
  calibrationSummary,
  confidenceSentence,
  MIN_RESOLVED,
  percent,
} from '../services/calibration.js';

const router = Router();

router.get('/calibration', (req, res) => {
  const rows = repo.calibrationRows();
  const summary = calibrationSummary(rows);
  const hasEnoughData = summary.n >= MIN_RESOLVED;
  res.render('calibration', {
    wide: true,
    hasEnoughData,
    remaining: MIN_RESOLVED - summary.n,
    counts: repo.counts(),
    summary,
    buckets: calibrationBuckets(rows),
    sentence: hasEnoughData ? confidenceSentence(summary) : null,
    percent,
  });
});

export default router;

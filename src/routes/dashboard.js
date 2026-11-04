import { Router } from 'express';
import { greeting } from '../lib/dates.js';

const router = Router();

router.get('/', (req, res) => {
  res.render('dashboard', { greeting: greeting() });
});

export default router;

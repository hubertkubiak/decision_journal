import { Router } from 'express';
import { addMonths, today } from '../lib/dates.js';
import { setFlash } from '../lib/flash.js';
import * as repo from '../repositories/decisions.js';
import { constraintErrors, REVIEW_PRESETS, validateDecision } from '../validation/decision.js';

const router = Router();

const SEE_OTHER = 303;

function renderNotFound(res) {
  res.status(404).render('errors/404');
}

function loadDecision(req, res, next) {
  const id = /^[1-9]\d*$/.test(req.params.id) ? Number(req.params.id) : NaN;
  const decision = Number.isSafeInteger(id) ? repo.getDecision(id) : undefined;
  if (!decision) return renderNotFound(res);
  req.decision = decision;
  next();
}

function redirectToReopen(req, res) {
  setFlash(req, 'error', 'Reopen this decision to edit it.');
  res.redirect(SEE_OTHER, `/decisions/${req.decision.id}`);
}

const renderNew = (res, values, errors = {}) =>
  res.status(Object.keys(errors).length ? 422 : 200).render('decisions/new', {
    values,
    errors,
    presets: REVIEW_PRESETS,
  });

const renderEdit = (res, decision, values, errors = {}) =>
  res.status(Object.keys(errors).length ? 422 : 200).render('decisions/edit', {
    decision,
    values,
    errors,
  });

router.get('/decisions', (req, res) => {
  const { rows } = repo.listDecisions();
  res.render('decisions/index', { decisions: rows });
});

// Must come before /decisions/:id.
router.get('/decisions/new', (req, res) => {
  renderNew(res, { confidence: 70, review_on: addMonths(today(), 1), preset: '' });
});

router.post('/decisions', (req, res) => {
  const { values, errors } = validateDecision(req.body, { isNew: true });
  if (Object.keys(errors).length) return renderNew(res, values, errors);

  try {
    const id = repo.createDecision(values, values.tagNames);
    setFlash(req, 'success', 'Decision logged. Future you will check back.');
    res.redirect(SEE_OTHER, `/decisions/${id}`);
  } catch (err) {
    const mapped = constraintErrors(err);
    if (!mapped) throw err;
    renderNew(res, values, mapped);
  }
});

router.get('/decisions/:id', loadDecision, (req, res) => {
  res.render('decisions/show', { decision: req.decision });
});

router.get('/decisions/:id/edit', loadDecision, (req, res) => {
  const { decision } = req;
  if (decision.status !== 'open') return redirectToReopen(req, res);
  renderEdit(res, decision, { ...decision, tags: decision.tags.join(', ') });
});

router.patch('/decisions/:id', loadDecision, (req, res) => {
  const { decision } = req;
  if (decision.status !== 'open') return redirectToReopen(req, res);

  const { values, errors } = validateDecision(req.body);
  if (Object.keys(errors).length) return renderEdit(res, decision, values, errors);

  try {
    if (!repo.updateDecision(decision.id, values, values.tagNames)) {
      return redirectToReopen(req, res);
    }
    setFlash(req, 'success', 'Changes saved.');
    res.redirect(SEE_OTHER, `/decisions/${decision.id}`);
  } catch (err) {
    const mapped = constraintErrors(err);
    if (!mapped) throw err;
    renderEdit(res, decision, values, mapped);
  }
});

router.delete('/decisions/:id', loadDecision, (req, res) => {
  repo.deleteDecision(req.decision.id);
  setFlash(req, 'success', 'Decision deleted.');
  res.redirect(SEE_OTHER, '/decisions');
});

export default router;

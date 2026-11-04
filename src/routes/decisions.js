import { Router } from 'express';
import { addMonths, today } from '../lib/dates.js';
import { setFlash } from '../lib/flash.js';
import * as repo from '../repositories/decisions.js';
import {
  constraintErrors,
  REVIEW_PRESETS,
  validateDecision,
  validateResolution,
} from '../validation/decision.js';

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

const PAGE_SIZE = 20;
const STATUSES = ['all', 'open', 'due', 'resolved'];
const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'review', label: 'Review date' },
  { value: 'confidence', label: 'Confidence' },
];

/** Query values can be arrays or objects (?q=a&q=b, ?q[x]=1); those count as absent. */
const queryText = (value) => (typeof value === 'string' ? value.trim() : '');

function parseFilters(query) {
  const status = STATUSES.includes(query.status) ? query.status : 'all';
  const sort = SORTS.some((option) => option.value === query.sort) ? query.sort : 'newest';
  const page = /^[1-9]\d*$/.test(query.page) ? Number(query.page) : 1;
  return {
    status,
    sort,
    tag: queryText(query.tag),
    q: queryText(query.q),
    page: Number.isSafeInteger(page) ? page : 1,
  };
}

function pageHref({ status, sort, tag, q }, page) {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (tag) params.set('tag', tag);
  if (q) params.set('q', q);
  if (sort !== 'newest') params.set('sort', sort);
  if (page > 1) params.set('page', page);
  const search = params.toString();
  return search ? `/decisions?${search}` : '/decisions';
}

router.get('/decisions', (req, res) => {
  const filters = parseFilters(req.query);
  const fetchPage = (page) =>
    repo.listDecisions({ ...filters, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });

  let { rows, total } = fetchPage(filters.page);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page, lastPage);
  if (page !== filters.page) ({ rows, total } = fetchPage(page));

  const tags = repo.listTags().map((tag) => tag.name);
  // A tag from an old bookmark stays visible in the select rather than silently filtering.
  if (filters.tag && !tags.includes(filters.tag.toLowerCase())) tags.push(filters.tag);

  res.render('decisions/index', {
    decisions: rows,
    total,
    filters,
    statuses: STATUSES,
    sorts: SORTS,
    tags,
    isFiltered: Boolean(filters.tag || filters.q || filters.status !== 'all'),
    newerHref: page > 1 ? pageHref(filters, page - 1) : null,
    olderHref: page < lastPage ? pageHref(filters, page + 1) : null,
  });
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

function redirectAlreadyResolved(req, res) {
  setFlash(req, 'error', 'This decision was already resolved.');
  res.redirect(SEE_OTHER, `/decisions/${req.decision.id}`);
}

router.post('/decisions/:id/resolve', loadDecision, (req, res) => {
  const { decision } = req;
  if (decision.status !== 'open') return redirectAlreadyResolved(req, res);

  const { values, errors } = validateResolution(req.body);
  if (Object.keys(errors).length) {
    return res.status(422).render('decisions/show', {
      decision,
      resolution: values,
      errors,
    });
  }

  if (!repo.resolveDecision(decision.id, values)) return redirectAlreadyResolved(req, res);
  setFlash(req, 'success', 'Resolved. Noted for your calibration.');
  res.redirect(SEE_OTHER, `/decisions/${decision.id}`);
});

router.post('/decisions/:id/reopen', loadDecision, (req, res) => {
  const reopened = repo.reopenDecision(req.decision.id);
  setFlash(
    req,
    reopened ? 'success' : 'error',
    reopened ? 'Reopened. You can edit it again.' : 'This decision is already open.',
  );
  res.redirect(SEE_OTHER, `/decisions/${req.decision.id}`);
});

router.delete('/decisions/:id', loadDecision, (req, res) => {
  repo.deleteDecision(req.decision.id);
  setFlash(req, 'success', 'Decision deleted.');
  res.redirect(SEE_OTHER, '/decisions');
});

export default router;

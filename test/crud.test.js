import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { startApp, unescape } from './helpers.js';

const { addDays, today } = await import('../src/lib/dates.js');

let app;
before(async () => { app = await startApp(); });
after(() => app.close());
beforeEach(() => app.repo.deleteEverything());

const form = (overrides = {}) => ({
  title: 'Take the job',
  prediction: 'I will enjoy it',
  confidence: '75',
  review_on: addDays(today(), 10),
  tags: 'Career, money',
  ...overrides,
});

async function createOne(overrides) {
  const res = await app.post('/decisions', form(overrides));
  assert.equal(res.status, 303);
  return res.location;
}

test('create redirects to the detail page, which shows the flash once', async () => {
  const location = await createOne();
  assert.match(location, /^\/decisions\/\d+$/);

  const page = await app.get(location);
  assert.equal(page.status, 200);
  assert.match(page.html, /Decision logged/);
  assert.match(page.html, /Take the job/);
  assert.match(page.html, /career/);

  const again = await app.get(location);
  assert.doesNotMatch(again.html, /Decision logged/);
});

test('invalid create re-renders with 422, values, inline errors and a linked summary', async () => {
  const res = await app.post('/decisions', form({ title: 'x', prediction: 'kept text', confidence: '10' }));
  assert.equal(res.status, 422);
  const html = unescape(res.html);
  assert.match(html, /role="alert"/);
  assert.match(html, /href="#field-title"/);
  assert.match(html, /href="#field-confidence"/);
  assert.match(html, /id="error-title"/);
  assert.match(html, /aria-describedby="error-title"/);
  assert.match(html, /Give it a short title \(3–120 characters\)\./);
  assert.match(html, />kept text<\/textarea>/);
  assert.match(html, /value="career, money"|value="Career, money"/);
  assert.equal(app.repo.counts().open, 0);
});

test('the preset wins on the server and stays selected on a failed submit', async () => {
  const res = await app.post('/decisions', form({ title: 'x', preset: '1w', review_on: '' }));
  assert.equal(res.status, 422);
  assert.match(res.html, /value="1w" checked/);
  assert.doesNotMatch(unescape(res.html), /Choose a review date/);

  const location = await createOne({ preset: '1w', review_on: '' });
  const id = Number(location.split('/').pop());
  assert.equal(app.repo.getDecision(id).review_on, addDays(today(), 7));
});

test('user content is escaped', async () => {
  const location = await createOne({ title: '<script>alert(1)</script>' });
  const page = await app.get(location);
  assert.doesNotMatch(page.html, /<script>alert/);
});

test('edit works while open, including a review date already in the past', async () => {
  const location = await createOne();
  const id = Number(location.split('/').pop());

  const editPage = await app.get(`${location}/edit`);
  assert.equal(editPage.status, 200);
  assert.match(editPage.html, /value="career, money"/);

  const pastDate = addDays(today(), -30);
  const res = await app.post(`${location}?_method=PATCH`, form({ title: 'New title', review_on: pastDate, tags: 'tech' }));
  assert.equal(res.status, 303);
  assert.equal(res.location, location);

  const found = app.repo.getDecision(id);
  assert.equal(found.title, 'New title');
  assert.equal(found.review_on, pastDate);
  assert.deepEqual(found.tags, ['tech']);
  assert.match((await app.get(location)).html, /Changes saved/);
});

test('invalid edit re-renders the edit form with 422', async () => {
  const location = await createOne();
  const res = await app.post(`${location}?_method=PATCH`, form({ prediction: '' }));
  assert.equal(res.status, 422);
  assert.match(res.html, /Edit decision/);
  assert.match(res.html, /_method=PATCH/);
});

test('a resolved decision cannot be edited, through the page or by posting directly', async () => {
  const location = await createOne();
  const id = Number(location.split('/').pop());
  app.repo.resolveDecision(id, { outcome: 'right' });

  const page = await app.get(`${location}/edit`);
  assert.equal(page.status, 303);
  assert.equal(page.location, location);
  assert.match((await app.get(location)).html, /Reopen this decision to edit it\./);

  const patch = await app.post(`${location}?_method=PATCH`, form({ prediction: 'Rewritten history' }));
  assert.equal(patch.status, 303);
  assert.equal(app.repo.getDecision(id).prediction, 'I will enjoy it');
});

test('delete removes the decision and redirects to the list', async () => {
  const location = await createOne();
  const res = await app.post(`${location}?_method=DELETE`);
  assert.equal(res.status, 303);
  assert.equal(res.location, '/decisions');
  assert.match((await app.get('/decisions')).html, /Decision deleted/);
  assert.equal((await app.get(location)).status, 404);
});

test('delete confirmation is a details disclosure, with no JS', async () => {
  const page = await app.get(await createOne());
  assert.match(page.html, /<details[^>]*>\s*<summary>Delete/);
  assert.doesNotMatch(page.html, /confirm\(/);
});

test('non-numeric, unknown and absurd ids are 404', async () => {
  for (const path of ['/decisions/abc', '/decisions/999', '/decisions/1abc', '/decisions/0',
    '/decisions/99999999999999999999', '/decisions/abc/edit', '/decisions/999/edit']) {
    assert.equal((await app.get(path)).status, 404, path);
  }
  assert.equal((await app.post('/decisions/999?_method=PATCH', form())).status, 404);
  assert.equal((await app.post('/decisions/abc?_method=DELETE')).status, 404);
});

test('/decisions/new is not swallowed by the :id route', async () => {
  const page = await app.get('/decisions/new');
  assert.equal(page.status, 200);
  assert.match(page.html, /New decision/);
});

test('page titles and the active nav item are set', async () => {
  const page = await app.get('/decisions/new');
  assert.match(page.html, /<title>New decision · Decision Journal<\/title>/);
  assert.match(page.html, /href="\/decisions" aria-current="page"/);
});

test('every input has a label', async () => {
  const { html } = await app.get('/decisions/new');
  for (const [, id] of html.matchAll(/<(?:input|textarea)[^>]*\bid="([^"]+)"/g)) {
    assert.match(html, new RegExp(`<label[^>]*for="${id}"`), `no label for ${id}`);
  }
});

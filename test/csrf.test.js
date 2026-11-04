import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { startApp } from './helpers.js';

const { addDays, today } = await import('../src/lib/dates.js');

let app;
let id;

before(async () => { app = await startApp(); });
after(() => app.close());

const fields = {
  title: 'Changed title',
  prediction: 'Changed prediction',
  confidence: '60',
  review_on: addDays(today(), 5),
  outcome: 'right',
};

beforeEach(() => {
  app.repo.deleteEverything();
  id = app.repo.createDecision({
    title: 'Original title',
    prediction: 'Original prediction',
    confidence: 70,
    review_on: today(),
  });
});

const mutatingRoutes = () => [
  '/decisions',
  `/decisions/${id}?_method=PATCH`,
  `/decisions/${id}?_method=DELETE`,
  `/decisions/${id}/resolve`,
  `/decisions/${id}/reopen`,
];

function assertUnchanged() {
  const found = app.repo.getDecision(id);
  assert.equal(found.title, 'Original title');
  assert.equal(found.status, 'open');
  assert.equal(app.repo.counts().open, 1);
}

test('without a token, every route that changes data is refused and changes nothing', async () => {
  await app.get('/'); // a real session exists, as it would for a victim of the attack
  for (const path of mutatingRoutes()) {
    const res = await app.postRaw(path, fields);
    assert.equal(res.status, 403, path);
    assert.match(res.html, /This form has expired/);
    assertUnchanged();
  }
});

test('reopen is refused without a token too', async () => {
  app.repo.resolveDecision(id, { outcome: 'right' });
  assert.equal((await app.postRaw(`/decisions/${id}/reopen`)).status, 403);
  assert.equal(app.repo.getDecision(id).status, 'resolved');
});

test('wrong, empty and repeated tokens are refused', async () => {
  const token = await app.getToken();
  const path = `/decisions/${id}?_method=DELETE`;
  for (const bad of [
    { _csrf: 'wrong' },
    { _csrf: '' },
    { _csrf: 'x'.repeat(token.length) },
    { _csrf: token.slice(0, -1) },
    [['_csrf', token], ['_csrf', token]],
  ]) {
    assert.equal((await app.postRaw(path, bad)).status, 403);
    assertUnchanged();
  }
});

test("another session's token is refused", async () => {
  const stranger = app.createClient();
  const strangerToken = await stranger.getToken();
  assert.notEqual(strangerToken, await app.getToken());

  const res = await app.postRaw(`/decisions/${id}?_method=DELETE`, { _csrf: strangerToken });
  assert.equal(res.status, 403);
  assertUnchanged();
});

test('a valid token without its session cookie is refused', async () => {
  const noCookie = app.createClient();
  const res = await noCookie.postRaw(`/decisions/${id}?_method=DELETE`, { _csrf: await app.getToken() });
  assert.equal(res.status, 403);
  assertUnchanged();
});

test('method override cannot be used to skip the check', async () => {
  await app.get('/');
  assert.equal((await app.postRaw(`/decisions/${id}?_method=GET`, fields)).status, 403);
  assert.equal((await app.postRaw(`/decisions/${id}?_method=get`, fields)).status, 403);
});

test('a valid token is accepted on every route', async () => {
  assert.equal((await app.post(`/decisions/${id}?_method=PATCH`, fields)).status, 303);
  assert.equal((await app.post(`/decisions/${id}/resolve`, fields)).status, 303);
  assert.equal((await app.post(`/decisions/${id}/reopen`)).status, 303);
  assert.equal((await app.post('/decisions', fields)).status, 303);
  assert.equal((await app.post(`/decisions/${id}?_method=DELETE`)).status, 303);
});

test('resolving an already resolved decision is a 303 with a valid token', async () => {
  await app.post(`/decisions/${id}/resolve`, { outcome: 'right' });
  const res = await app.post(`/decisions/${id}/resolve`, { outcome: 'wrong' });
  assert.equal(res.status, 303);
  assert.equal(res.location, `/decisions/${id}`);
  assert.equal(app.repo.getDecision(id).outcome, 'right');
});

test('a refused request does not use up a pending flash message', async () => {
  await app.post(`/decisions/${id}?_method=PATCH`, fields);
  await app.postRaw(`/decisions/${id}?_method=PATCH`, fields);
  assert.match((await app.get(`/decisions/${id}`)).html, /Changes saved/);
});

test('every POST form carries the token, and the GET filter form never does', async () => {
  const token = await app.getToken();
  const resolvedId = app.repo.createDecision({
    title: 'Resolved one',
    prediction: 'Some prediction',
    confidence: 70,
    review_on: today(),
  });
  app.repo.resolveDecision(resolvedId, { outcome: 'wrong' });

  const pages = ['/', '/decisions', '/decisions/new', `/decisions/${id}`, `/decisions/${id}/edit`, `/decisions/${resolvedId}`];
  let postForms = 0;
  for (const path of pages) {
    const { html } = await app.get(path);
    for (const [form] of html.matchAll(/<form\b.*?<\/form>/gs)) {
      if (/method="post"/.test(form)) {
        postForms += 1;
        assert.ok(form.includes(`name="_csrf" value="${token}"`), `no token in a form on ${path}`);
      } else {
        assert.doesNotMatch(form, /_csrf/, `token in a GET form on ${path}`);
      }
    }
  }
  assert.ok(postForms >= 7, `expected at least 7 POST forms, saw ${postForms}`);
});

test('a failed validation re-render still has a working token', async () => {
  const res = await app.post('/decisions', { title: 'x' });
  assert.equal(res.status, 422);
  assert.match(res.html, /name="_csrf" value="[0-9a-f]{64}"/);
});

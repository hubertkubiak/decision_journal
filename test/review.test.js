import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { startApp } from './helpers.js';

const { addDays, today } = await import('../src/lib/dates.js');

let app;
before(async () => { app = await startApp(); });
after(() => app.close());
beforeEach(() => app.repo.deleteEverything());

const add = (overrides = {}, tags = []) =>
  app.repo.createDecision(
    {
      title: 'A decision',
      prediction: 'It will happen',
      confidence: 70,
      review_on: addDays(today(), 30),
      ...overrides,
    },
    tags,
  );

/** The ordered title links in the list, ignoring the rest of the page. */
const listedTitles = (html) =>
  [...html.matchAll(/decision-row__title"><a href="[^"]+">([^<]+)</g)].map((match) => match[1]);

test('an empty journal shows the first-run explanation', async () => {
  const { html, status } = await app.get('/');
  assert.equal(status, 200);
  assert.match(html, /class="steps"/);
  assert.match(html, /Log your first decision/);
  assert.doesNotMatch(html, /Ready for review/);
});

test('a decision reaches the dashboard exactly on its review date', async () => {
  add({ title: 'Due today', review_on: today() });
  add({ title: 'Due tomorrow', review_on: addDays(today(), 1) });
  const { html } = await app.get('/');

  assert.match(html, /1 decision is ready for review\./);
  const dueSection = html.split('Coming up')[0];
  assert.match(dueSection, /Due today/);
  assert.doesNotMatch(dueSection, /Due tomorrow/);
  assert.match(html.split('Coming up')[1], /Due tomorrow.*tomorrow/);
});

test('with nothing due the dashboard shows the empty state and plural summary is right', async () => {
  add();
  assert.match((await app.get('/')).html, /Nothing to review\. Future you is busy\./);

  add({ review_on: today() });
  add({ review_on: today() });
  assert.match((await app.get('/')).html, /2 decisions are ready for review\./);
});

test('the dashboard offers inline Right / Wrong / Unclear, which resolve in one click', async () => {
  const id = add({ review_on: today() });
  const { html } = await app.get('/');
  assert.match(html, new RegExp(`action="/decisions/${id}/resolve"`));
  for (const outcome of ['right', 'wrong', 'unclear']) {
    assert.match(html, new RegExp(`name="outcome" value="${outcome}"`));
  }

  const res = await app.post(`/decisions/${id}/resolve`, { outcome: 'wrong' });
  assert.equal(res.status, 303);
  assert.equal(res.location, `/decisions/${id}`);
  assert.equal(app.repo.getDecision(id).outcome, 'wrong');

  const after = await app.get('/');
  assert.match(after.html.split('Recently resolved')[1], /pill--wrong/);
  assert.match(after.html, /Nothing to review/);
});

test('the detail page shows the resolve form open when due, collapsed when not', async () => {
  const dueId = add({ review_on: today() });
  const due = await app.get(`/decisions/${dueId}`);
  assert.match(due.html, /Time to review/);
  assert.doesNotMatch(due.html, /Resolve early/);

  const laterId = add();
  const later = await app.get(`/decisions/${laterId}`);
  assert.match(later.html, /<details class="disclosure detail-section"><summary>Resolve early/);
});

test('resolving without an outcome re-renders with 422, reflection kept, form open', async () => {
  const id = add();
  const res = await app.post(`/decisions/${id}/resolve`, { reflection: 'My thoughts' });
  assert.equal(res.status, 422);
  assert.match(res.html, /Did it turn out as you predicted\?/);
  assert.match(res.html, /href="#field-outcome"/);
  assert.match(res.html, /id="field-outcome"/);
  assert.match(res.html, />My thoughts<\/textarea>/);
  assert.match(res.html, /<details class="disclosure detail-section" open/);
  assert.equal(app.repo.getDecision(id).status, 'open');
});

test('resolving twice keeps the first outcome and redirects with a flash', async () => {
  const id = add();
  await app.post(`/decisions/${id}/resolve`, { outcome: 'right', reflection: 'First' });
  await app.get(`/decisions/${id}`);

  const res = await app.post(`/decisions/${id}/resolve`, { outcome: 'wrong' });
  assert.equal(res.status, 303);
  assert.equal(res.location, `/decisions/${id}`);
  assert.match((await app.get(`/decisions/${id}`)).html, /already resolved/);
  assert.equal(app.repo.getDecision(id).outcome, 'right');
});

test('the resolved view has the banner, reflection and reopen, and no edit link', async () => {
  const id = add();
  await app.post(`/decisions/${id}/resolve`, { outcome: 'right', reflection: 'Saw it coming' });
  const { html } = await app.get(`/decisions/${id}`);
  assert.match(html, /You were right\./);
  assert.match(html, /Saw it coming/);
  assert.match(html, new RegExp(`action="/decisions/${id}/reopen"`));
  assert.doesNotMatch(html, new RegExp(`href="/decisions/${id}/edit"`));
});

test('reopen restores an open decision and prefills the earlier reflection', async () => {
  const id = add();
  await app.post(`/decisions/${id}/resolve`, { outcome: 'right', reflection: 'Keep this' });

  const res = await app.post(`/decisions/${id}/reopen`);
  assert.equal(res.status, 303);
  const { html } = await app.get(`/decisions/${id}`);
  assert.match(html, /Reopened/);
  assert.match(html, />Keep this<\/textarea>/);
  assert.match(html, new RegExp(`href="/decisions/${id}/edit"`));
  assert.equal(app.repo.getDecision(id).status, 'open');
});

test('resolve and reopen on an unknown id are 404', async () => {
  assert.equal((await app.post('/decisions/999/resolve', { outcome: 'right' })).status, 404);
  assert.equal((await app.post('/decisions/999/reopen')).status, 404);
});

test('the list filters by status, tag and text, combined', async () => {
  add({ title: 'Buy house', review_on: today() }, ['money']);
  add({ title: 'Learn Rust', prediction: 'House rules apply' }, ['tech']);
  const done = add({ title: 'Other thing' }, ['money']);
  app.repo.resolveDecision(done, { outcome: 'right' });

  const titles = async (query) => listedTitles((await app.get(`/decisions?${query}`)).html).sort();
  assert.deepEqual(await titles('status=all'), ['Buy house', 'Learn Rust', 'Other thing']);
  assert.deepEqual(await titles('status=open'), ['Buy house', 'Learn Rust']);
  assert.deepEqual(await titles('status=due'), ['Buy house']);
  assert.deepEqual(await titles('status=resolved'), ['Other thing']);
  assert.deepEqual(await titles('tag=money'), ['Buy house', 'Other thing']);
  assert.deepEqual(await titles('q=house'), ['Buy house', 'Learn Rust']);
  assert.deepEqual(await titles('q=house&tag=tech&status=open'), ['Learn Rust']);
});

test('the filter form reflects the URL, so state survives a reload', async () => {
  add({ title: 'Tagged' }, ['money']);
  const { html } = await app.get('/decisions?status=open&tag=money&q=Tag&sort=review');
  assert.match(html, /value="open" checked/);
  assert.match(html, /<option value="money" selected/);
  assert.match(html, /name="q" value="Tag"/);
  assert.match(html, /<option value="review" selected/);
});

test('sort orders the list', async () => {
  add({ title: 'Low', confidence: 55, review_on: addDays(today(), 20) });
  add({ title: 'High', confidence: 95, review_on: addDays(today(), 30) });
  add({ title: 'Soon', confidence: 75, review_on: addDays(today(), 10) });

  const titles = async (sort) => listedTitles((await app.get(`/decisions?sort=${sort}`)).html);
  assert.deepEqual(await titles('newest'), ['Soon', 'High', 'Low']);
  assert.deepEqual(await titles('review'), ['Soon', 'Low', 'High']);
  assert.deepEqual(await titles('confidence'), ['High', 'Soon', 'Low']);
});

test('pagination is 20 per page, and its links keep the filters', async () => {
  for (let i = 1; i <= 45; i += 1) add({ title: `Decision ${i}` }, ['money']);

  const first = await app.get('/decisions?tag=money');
  assert.equal(listedTitles(first.html).length, 20);
  assert.match(first.html, /45 decisions/);
  assert.match(first.html, /href="\/decisions\?tag=money&amp;page=2"[^>]*>Older/);
  assert.doesNotMatch(first.html, />Newer</);

  const second = await app.get('/decisions?tag=money&page=2');
  assert.equal(listedTitles(second.html)[0], 'Decision 25');
  assert.match(second.html, />Newer</);
  assert.match(second.html, />Older</);

  const third = await app.get('/decisions?tag=money&page=3');
  assert.equal(listedTitles(third.html).length, 5);
  assert.doesNotMatch(third.html, />Older</);
});

test('hostile or nonsense list parameters fall back instead of crashing', async () => {
  add({ title: 'Survivor' });
  for (const query of ['page=abc', 'page=0', 'page=-1', 'page=1e9', 'page=99999999999999999999',
    'status=bogus', 'sort=id;DROP TABLE decisions', 'status=a&status=b', 'q=a&q=b', 'q[x]=1',
    'tag[x]=1', 'page[]=2', 'sort[]=review']) {
    const res = await app.get(`/decisions?${query}`);
    assert.equal(res.status, 200, query);
    assert.deepEqual(listedTitles(res.html), ['Survivor'], query);
  }
});

test('a page past the end shows the last page', async () => {
  add({ title: 'Only one' });
  assert.deepEqual(listedTitles((await app.get('/decisions?page=50')).html), ['Only one']);
});

test('a filter matching nothing gets an empty state with a way out', async () => {
  add();
  const { html } = await app.get('/decisions?q=zzz');
  assert.match(html, /No decisions match these filters/);
  assert.match(html, /Clear filters/);
});

test('a tag no longer in use stays visible in the select', async () => {
  add({}, ['money']);
  const { html } = await app.get('/decisions?tag=gone');
  assert.match(html, /<option value="gone" selected/);
});

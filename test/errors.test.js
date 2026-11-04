import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

test('unknown and malformed URLs get the 404 page', async () => {
  for (const path of ['/nope', '/decisions/%E0%A4%A']) {
    const { status, html } = await app.get(path);
    assert.equal(status, 404, path);
    assert.match(html, /Maybe it was a bad decision\./);
  }
});

test('an unexpected failure renders the 500 page, with the stack only outside production', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { db } = await import('../src/db/connection.js');
  db.close(); // every later query now throws; keep this test last in the file

  const development = await app.get('/');
  assert.equal(development.status, 500);
  assert.match(development.html, /Something went wrong/);
  assert.match(development.html, /class="stack-trace"/);

  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const production = await app.get('/');
    assert.equal(production.status, 500);
    assert.doesNotMatch(production.html, /stack-trace/);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

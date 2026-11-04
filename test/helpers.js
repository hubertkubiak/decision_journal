/**
 * Starts the app on a free port against an in-memory database and returns a
 * small browser-like client: it posts forms and keeps the session cookie, so
 * flash messages behave as they do for a real visitor. It never runs any JS,
 * which is how the "works with JS disabled" criteria get tested.
 */
export async function startApp() {
  process.env.DB_PATH = ':memory:';
  process.env.SESSION_SECRET = 'test-secret';
  const { app } = await import('../src/server.js');
  const repo = await import('../src/repositories/decisions.js');

  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';

  async function request(path, options = {}) {
    const response = await fetch(base + path, {
      redirect: 'manual',
      ...options,
      headers: { ...options.headers, ...(cookie ? { cookie } : {}) },
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return {
      status: response.status,
      location: response.headers.get('location'),
      html: await response.text(),
    };
  }

  return {
    repo,
    get: (path) => request(path),
    post: (path, fields = {}) =>
      request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Undoes the HTML escaping Pug applies, so assertions can use plain text. */
export const unescape = (html) =>
  html
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

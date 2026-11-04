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

  /** One visitor, with its own session. */
  function createClient() {
    let cookie = '';
    let token = null;

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

    const get = (path) => request(path);

    /** Posts exactly these fields, with no CSRF token unless they include one. */
    const postRaw = (path, body) =>
      request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
      });

    /** The session's token, read from a page once. It stays the same per session. */
    async function getToken() {
      if (!token) {
        const { html } = await get('/decisions/new');
        [, token] = html.match(/name="_csrf" value="([^"]+)"/);
      }
      return token;
    }

    return {
      get,
      postRaw,
      getToken,
      /** Submits a form as a page from this app would, including the token. */
      post: async (path, fields = {}) => postRaw(path, { ...fields, _csrf: await getToken() }),
    };
  }

  return {
    repo,
    createClient,
    ...createClient(),
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

import { randomBytes, timingSafeEqual } from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function tokensMatch(expected, submitted) {
  // Repeated form fields arrive as arrays, which never count as a token.
  if (typeof submitted !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(submitted);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Synchronizer token: each session gets a random token, which every form sends
 * back as `_csrf`. Another site can make a browser submit a form here, but it
 * can't read our pages, so it can't know the token.
 *
 * Checks the method the request really arrived with, so POST ?_method=GET can't
 * skip the check. Must run after the session, body parser and method override.
 */
export function csrfProtection(req, res, next) {
  req.session.csrfToken ??= randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;

  const method = req.originalMethod ?? req.method;
  if (SAFE_METHODS.has(method) || tokensMatch(req.session.csrfToken, req.body?._csrf)) {
    return next();
  }
  res.status(403).render('errors/403');
}

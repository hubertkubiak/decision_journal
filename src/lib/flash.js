/** Queues a one-shot message for the next page the session renders. */
export function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

/** Moves a queued message from the session into the view locals. */
export function flashMiddleware(req, res, next) {
  if (req.session?.flash) {
    res.locals.flash = req.session.flash;
    delete req.session.flash;
  }
  next();
}

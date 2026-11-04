import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import methodOverride from 'method-override';
import { formatDate, pluralize, relativeDate } from './lib/dates.js';
import dashboardRoutes from './routes/dashboard.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const app = express();

app.set('view engine', 'pug');
app.set('views', path.join(rootDir, 'views'));
Object.assign(app.locals, { formatDate, relativeDate, pluralize });

app.use(express.static(path.join(rootDir, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(methodOverride('_method'));

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

app.use(dashboardRoutes);

app.use((req, res) => {
  res.status(404).render('errors/404');
});

// Express needs all four arguments to recognise this as an error handler.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  // A malformed URL such as /decisions/%E0 is a page that doesn't exist.
  if (err instanceof URIError) {
    return res.status(404).render('errors/404');
  }

  console.error(err);
  res.status(500).render('errors/500', {
    stack: process.env.NODE_ENV !== 'production' ? err.stack : null,
  });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  // Bound to loopback: v1 has no authentication and is meant to run locally.
  app.listen(port, '127.0.0.1', () => {
    console.log(`Decision Journal running at http://localhost:${port}`);
  });
}

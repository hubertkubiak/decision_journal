# Decision Journal

A small, server-rendered web app for logging decisions, recording predictions with a confidence level, reviewing them later, and seeing how well-calibrated your judgment really is.

It's built with Express, Pug and SQLite, using plain HTML forms and no front-end framework. It works with JavaScript turned off. The full design is in [SPEC.md](SPEC.md).

## Getting started

Requires Node.js 20 or newer.

```sh
npm install
npm run seed    # optional: adds demo data
npm start       # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Runs the app |
| `npm run dev` | Runs the app and restarts it when files change |
| `npm run seed` | Adds demo data to an empty journal; does nothing if the journal has data |
| `npm run reset` | **Deletes every decision**, then adds the demo data |
| `npm test` | Runs the tests |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DB_PATH` | `./data/journal.db` | SQLite database file, created on first run |
| `SESSION_SECRET` | a development value, with a console warning | Signs the session cookie used for flash messages |

The app has no login, so it only listens on `127.0.0.1`.

## How it's organised

```
src/
  server.js        app setup, middleware, error handlers
  db/              connection, migrations, seed data
  repositories/    all the SQL
  services/        calibration maths (pure functions)
  routes/          dashboard, decisions, calibration
  validation/      form validation, returns { values, errors }
  lib/             dates and flash messages
views/             Pug templates, mixins and partials
public/            one CSS file, the favicon, optional enhance.js
test/              node --test suites
```

To change the schema, add a numbered file such as `002_add_field.sql` to `src/db/migrations/`. It runs on the next start, inside a transaction.

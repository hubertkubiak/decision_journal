# Decision Journal — Project Specification

> A small, server-rendered web app for logging decisions, recording predictions with a confidence level, reviewing them later, and seeing how well-calibrated your judgment really is.

**Version:** 1.0 (MVP)
**Language of the UI:** English
**Audience:** a single user running the app locally (no auth in v1)

---

## 1. Goals

1. Make it fast to capture a decision *at the moment it's made*: what you decided, what you expect to happen, how confident you are, and when to check back.
2. Bring decisions back when their review date arrives, and make resolving them a 30-second task.
3. Show **calibration**: for each confidence level, how often you were actually right.
4. Be a clean learning project for **Express + Pug + SQLite**, with plain HTML forms and no front-end framework.
5. Look good: minimalist, typographic, calm. It should feel like a well-made notebook, not an admin panel.

### Non-goals (v1)

- Multi-user accounts, authentication, sharing
- Client-side frameworks, bundlers, build steps
- Notifications (email/push) for due reviews
- Mobile app / PWA / offline sync

---

## 2. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js ≥ 20 | ES modules (`"type": "module"`) |
| HTTP | Express 4 | `express.urlencoded({ extended: false })`, `express.static` |
| Views | Pug 3 | `app.set('view engine', 'pug')` |
| Database | SQLite via `better-sqlite3` | Synchronous API, one file: `data/journal.db` |
| Sessions / flash | `express-session` (memory store) | Only used for one-shot flash messages |
| Method override | `method-override` (query `?_method=`) | Allows DELETE/PATCH from HTML forms |
| Dev | `node --watch` | No nodemon needed |
| Styling | One hand-written `public/css/main.css` | CSS custom properties, no preprocessor |
| JavaScript in browser | None required | Optional progressive enhancement only (see §8.6) |

No ORM. Raw SQL with prepared statements in a thin repository module.

---

## 3. Project structure

```
decision-journal/
├── package.json
├── SPEC.md
├── README.md
├── src/
│   ├── server.js              # app bootstrap, middleware, error handlers
│   ├── db/
│   │   ├── connection.js      # opens DB, sets pragmas, runs migrations
│   │   ├── migrations/
│   │   │   └── 001_init.sql
│   │   └── seed.js            # optional demo data (npm run seed)
│   ├── repositories/
│   │   └── decisions.js       # all SQL lives here
│   ├── services/
│   │   └── calibration.js     # bucket + Brier score maths (pure functions)
│   ├── routes/
│   │   ├── dashboard.js
│   │   ├── decisions.js
│   │   └── calibration.js
│   ├── validation/
│   │   └── decision.js        # returns { values, errors }
│   └── lib/
│       ├── dates.js           # formatting, "in 3 days", "2 weeks ago"
│       └── flash.js
├── views/
│   ├── layout.pug
│   ├── partials/
│   │   ├── _header.pug
│   │   ├── _footer.pug
│   │   └── _flash.pug
│   ├── mixins/
│   │   ├── _decision-card.pug
│   │   ├── _form-fields.pug   # field(), textarea(), confidence(), dateInput()
│   │   ├── _confidence-bar.pug
│   │   ├── _status-pill.pug
│   │   └── _empty-state.pug
│   ├── dashboard.pug
│   ├── decisions/
│   │   ├── index.pug
│   │   ├── new.pug
│   │   ├── edit.pug
│   │   ├── show.pug
│   │   └── _form.pug          # shared between new/edit
│   ├── calibration.pug
│   └── errors/
│       ├── 404.pug
│       └── 500.pug
├── public/
│   ├── css/main.css
│   └── favicon.svg
└── data/                      # gitignored; created on first run
    └── journal.db
```

### npm scripts

```json
{
  "start": "node src/server.js",
  "dev": "node --watch src/server.js",
  "seed": "node src/db/seed.js",
  "reset": "rm -f data/journal.db && node src/db/seed.js"
}
```

Environment: `PORT` (default `3000`), `DB_PATH` (default `./data/journal.db`), `SESSION_SECRET` (default dev value with a console warning).

---

## 4. Data model (SQLite)

### 4.1 Migration `001_init.sql`

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE decisions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  context       TEXT,                                   -- why now, what options existed
  prediction    TEXT    NOT NULL CHECK (length(prediction) BETWEEN 3 AND 500),
  confidence    INTEGER NOT NULL CHECK (confidence BETWEEN 50 AND 99),
  review_on     TEXT    NOT NULL,                       -- ISO date 'YYYY-MM-DD'
  status        TEXT    NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'resolved')),
  outcome       TEXT    CHECK (outcome IN ('right', 'wrong', 'unclear')),
  reflection    TEXT,
  resolved_at   TEXT,                                   -- ISO datetime
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (status = 'open'     AND outcome IS NULL     AND resolved_at IS NULL) OR
    (status = 'resolved' AND outcome IS NOT NULL AND resolved_at IS NOT NULL)
  )
);

CREATE TABLE tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 30)
);

CREATE TABLE decision_tags (
  decision_id INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tags(id)      ON DELETE CASCADE,
  PRIMARY KEY (decision_id, tag_id)
);

CREATE INDEX idx_decisions_status_review ON decisions(status, review_on);
CREATE INDEX idx_decisions_created       ON decisions(created_at DESC);

CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 4.2 Rules

- Confidence is stored as an integer percentage **50–99**. Below 50 you'd be predicting the opposite; 100 is not allowed on principle.
- `outcome = 'unclear'` is a valid resolution but is **excluded from calibration** (it shows in counts as "unclear").
- `updated_at` is set by the repository on every update (no trigger needed).
- A decision is **due** when `status = 'open' AND review_on <= date('now', 'localtime')`.
- A decision is **overdue** when it has been due for more than 7 days. This is only a visual emphasis.

### 4.3 Connection setup

On boot, `connection.js`:
1. Creates `data/` if missing.
2. Opens the DB and sets `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 3000`.
3. Applies any migration files whose number isn't in `schema_migrations`, each inside a transaction.

### 4.4 Repository API (`repositories/decisions.js`)

```
listDecisions({ status, tag, q, sort, limit, offset }) -> { rows, total }
getDecision(id)                     -> decision with tags[] | undefined
createDecision(values, tagNames)    -> id
updateDecision(id, values, tagNames)
resolveDecision(id, { outcome, reflection })
reopenDecision(id)
deleteDecision(id)
listDue()                           -> open decisions with review_on <= today
listUpcoming(days = 14)             -> open decisions due in the next N days
listRecentlyResolved(limit = 5)
listTags()                          -> [{ name, count }]
calibrationRows()                   -> [{ confidence, outcome }] for resolved, outcome != 'unclear'
counts()                            -> { open, due, resolved, unclear }
```

Tag writes happen inside the same transaction as the decision write. Tags are upserted by name, and orphaned tags are deleted after updates.

---

## 5. Routes

All mutating routes follow **POST → redirect → GET** and set a flash message.

| Method | Path | Purpose | View |
|---|---|---|---|
| GET | `/` | Dashboard | `dashboard` |
| GET | `/decisions` | List with filters | `decisions/index` |
| GET | `/decisions/new` | New decision form | `decisions/new` |
| POST | `/decisions` | Create | redirect `/decisions/:id` |
| GET | `/decisions/:id` | Detail + resolve form | `decisions/show` |
| GET | `/decisions/:id/edit` | Edit (open decisions only) | `decisions/edit` |
| POST | `/decisions/:id?_method=PATCH` | Update | redirect `/decisions/:id` |
| POST | `/decisions/:id/resolve` | Resolve | redirect `/decisions/:id` |
| POST | `/decisions/:id/reopen` | Undo resolution | redirect `/decisions/:id` |
| POST | `/decisions/:id?_method=DELETE` | Delete | redirect `/decisions` |
| GET | `/calibration` | Calibration report | `calibration` |
| * | anything else | Not found | `errors/404` |

### 5.1 List query parameters (`/decisions`)

| Param | Values | Default |
|---|---|---|
| `status` | `all`, `open`, `due`, `resolved` | `all` |
| `tag` | tag name | — |
| `q` | free text, matched with `LIKE` on title and prediction | — |
| `sort` | `review` (soonest first), `newest`, `confidence` | `newest` |
| `page` | integer ≥ 1, page size 20 | `1` |

Filters are applied through a GET form, so the URL is always shareable and bookmarkable.

### 5.2 Edge cases

- Non-numeric or unknown `:id` → 404.
- Editing a resolved decision → redirect to detail with flash: *"Reopen this decision to edit it."* Predictions shouldn't be rewritten after the fact.
- Resolving an already-resolved decision → 409, rendered as a flash plus a redirect.
- Delete asks for confirmation through a dedicated `<details>` disclosure with a second button. No JS `confirm()`.

---

## 6. Validation

`validation/decision.js` exports `validateDecision(body)` and `validateResolution(body)`. Each returns `{ values, errors }`, where `errors` is `{ fieldName: 'Message' }`.

| Field | Rules | Message |
|---|---|---|
| `title` | trimmed, 3–120 chars | "Give it a short title (3–120 characters)." |
| `context` | optional, ≤ 2000 chars | "Keep context under 2000 characters." |
| `prediction` | trimmed, 3–500 chars | "What do you expect to happen?" |
| `confidence` | integer 50–99 | "Pick a confidence between 50% and 99%." |
| `review_on` | valid `YYYY-MM-DD`, ≥ today on create | "Choose a review date in the future." |
| `tags` | comma-separated, each 1–30 chars, max 5, lower-cased, deduped | "Up to 5 tags, 30 characters each." |
| `outcome` | `right` / `wrong` / `unclear` | "Did it turn out as you predicted?" |
| `reflection` | optional, ≤ 2000 chars | — |

When there are errors, the server re-renders the same form with **status 422**, the user's submitted values, and inline messages under each field. There is also a summary at the top, linking to each field (`href="#field-title"`) for accessibility.

### Quick review presets

The new-decision form offers review-date shortcuts as radio buttons next to the date input: **1 week / 1 month / 3 months / 6 months**. Only a chosen preset counts: if one is selected, the server computes `review_on` from it; if none is selected, it uses the date field. This works without JS.

---

## 7. Calibration (`services/calibration.js`)

Pure functions, unit-testable without a DB.

### 7.1 Buckets

| Bucket | Range | Midpoint (expected hit rate) |
|---|---|---|
| 50s | 50–59 | 55% |
| 60s | 60–69 | 65% |
| 70s | 70–79 | 75% |
| 80s | 80–89 | 85% |
| 90s | 90–99 | 95% |

For each bucket: `n` (resolved, excluding unclear), `hits` (`outcome = 'right'`), `hitRate = hits / n`, `expected = mean(confidence)/100`, and `gap = hitRate − expected`.

### 7.2 Labels

- `|gap| ≤ 0.05` → **"Well calibrated"**
- `gap < −0.05` → **"Overconfident"**
- `gap > 0.05` → **"Underconfident"**
- `n < 5` → **"Not enough data yet"**. The bar is still shown, but muted.

### 7.3 Summary numbers

- **Overall accuracy:** hits / n
- **Brier score:** `mean((p − o)²)`, where `p = confidence/100` and `o = 1` if right, `0` if wrong. Lower is better. Show it with a one-line explanation: *"0 is perfect, 0.25 is a coin flip."*
- **Average confidence vs. actual accuracy:** one sentence, e.g. *"You're on average 82% sure and right 71% of the time."*

If fewer than 5 decisions are resolved, the page shows an empty state instead of charts.

---

## 8. Views and UI

### 8.1 Layout (`layout.pug`)

- `doctype html`, `lang="en"`, `meta viewport`, `<title>` built from a `title` block plus " · Decision Journal"
- Header: wordmark on the left, then nav: **Today** (`/`), **Decisions**, **Calibration**. The primary button **New decision** sits on the right.
- The active nav item gets `aria-current="page"`, computed from `res.locals.currentPath`.
- `main` has a max width of `720px`, centered. The calibration page may use up to `880px`.
- Flash message region with `role="status"`
- Footer: a single muted line, for example the count of decisions logged.

### 8.2 Dashboard `/`

Sections, top to bottom:

1. **Greeting line** by time of day ("Good morning.") plus a one-line summary: *"2 decisions are ready for review."*
2. **Ready for review:** due decisions as cards with an inline resolve form (three outcome buttons: *Right*, *Wrong*, *Unclear*). If empty, show an empty state: *"Nothing to review. Future you is busy."*
3. **Coming up:** the next 14 days, as a compact list with relative dates ("in 3 days").
4. **Recently resolved:** the last 5, each with an outcome pill.
5. **Your calibration at a glance:** one number (accuracy vs. average confidence) and a link to the full report.

If the database is empty, show a first-run empty state: a short explanation of how the journal works in 3 steps, plus a primary button.

### 8.3 Decision list `/decisions`

- A filter bar as a GET form: status segmented control (radio inputs styled as tabs), tag select, search input, and sort select. Submit happens via a button. With optional JS, the form auto-submits on change.
- Rows show the title, prediction (truncated to 1 line), confidence bar, review date, status pill, and tags.
- Simple pagination: "Newer" / "Older".

### 8.4 Detail `/decisions/:id`

- The title is large.
- Metadata line: created date · review date · tags
- **Prediction** block, quoted style with a left rule, plus a confidence bar and number
- **Context**, if present
- When open and due: a resolve form with outcome radios styled as large choice cards, a reflection textarea, and a submit button.
- When open and not due: the same form, collapsed under `<details>` ("Resolve early").
- When resolved: an outcome banner (right / wrong / unclear), the reflection, the resolution date, and a "Reopen" link.
- Actions: Edit (open only) and Delete (inside `<details>` with confirmation).

### 8.5 Calibration `/calibration`

- Summary row: three stat tiles (Resolved · Accuracy · Brier score).
- **Calibration chart, CSS only:** five vertical bars, one per bucket. Bar height equals the actual hit rate. A thin horizontal tick on each bar marks the expected rate. `n` is shown under each bar. Bars use the accent color when well calibrated, a warm color when overconfident, and a cool color when underconfident. Muted at `n < 5`.
- The chart is built from `div`s with heights set through inline CSS custom properties (`style="--value: 0.71"`), plus a `<table>` below it with the same data for accessibility. The table is visually secondary.
- A short explanation section: what calibration means, in 3 sentences.

### 8.6 Optional progressive enhancement (`public/js/enhance.js`, < 50 lines)

- Shows the live value next to the confidence range slider.
- Auto-submits the filter form on change.
- Everything must work with JS disabled.

### 8.7 Pug features to exercise (learning checklist)

- [ ] `extends` / `block` / `block append` (page-specific `<head>` additions)
- [ ] `include` for partials
- [ ] `mixin` with arguments, default values, `&attributes`, and `block` content (e.g. `+card(decision)` wrapping custom content)
- [ ] `each … else` for empty states
- [ ] `if / else if`, `case / when` (status → pill style)
- [ ] Attribute interpolation and class objects: `class={ 'is-due': d.isDue }`
- [ ] Unescaped output only where explicitly safe (none expected in v1)
- [ ] Helpers passed through `app.locals` (`formatDate`, `relativeDate`, `pluralize`)

---

## 9. Visual design

**Direction:** "quiet notebook". Warm paper background, ink-colored type, generous whitespace, one accent color, and type doing most of the work. No shadows heavier than a hairline, no gradients, no icons beyond a few simple inline SVGs.

### 9.1 Design tokens (`:root`)

```css
:root {
  /* colour, light */
  --bg:          #FAF8F4;   /* warm paper */
  --surface:     #FFFFFF;
  --ink:         #1C1B19;   /* primary text */
  --ink-muted:   #6B675F;
  --ink-faint:   #A39E94;
  --rule:        #E7E2D9;   /* hairlines, borders */
  --accent:      #2F5D50;   /* deep green: primary actions, well calibrated */
  --accent-soft: #E3ECE8;
  --warm:        #B4552D;   /* wrong / overconfident */
  --warm-soft:   #F5E6DE;
  --cool:        #3B5B8C;   /* underconfident */
  --cool-soft:   #E3E9F3;
  --focus:       #2F5D50;

  /* type */
  --font-display: "Fraunces", Georgia, serif;
  --font-body:    "Inter", system-ui, -apple-system, sans-serif;
  --font-mono:    "JetBrains Mono", ui-monospace, monospace;

  --step--1: 0.875rem;
  --step-0:  1rem;
  --step-1:  1.25rem;
  --step-2:  1.75rem;
  --step-3:  2.5rem;

  /* space (4px scale) */
  --s-1: 0.25rem; --s-2: 0.5rem; --s-3: 0.75rem; --s-4: 1rem;
  --s-6: 1.5rem;  --s-8: 2rem;   --s-12: 3rem;   --s-16: 4rem;

  --radius: 10px;
  --radius-sm: 6px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg:        #161614;
    --surface:   #1F1E1B;
    --ink:       #ECE8E1;
    --ink-muted: #A8A296;
    --ink-faint: #6F6A61;
    --rule:      #2E2C28;
    --accent:    #7FB5A3;
    --accent-soft: #23332E;
    --warm:      #E08A63;
    --warm-soft: #3A2720;
    --cool:      #8FAEDC;
    --cool-soft: #222B3A;
  }
}
```

Fonts are loaded from Google Fonts (Fraunces 400/600 with optical sizing, Inter 400/500/600) using `display=swap`. The app must still look good on the fallback stack.

### 9.2 Typography

- Page titles: Fraunces at `--step-3`, weight 600, tight letter-spacing (`-0.01em`)
- Decision titles in cards: Fraunces at `--step-1`
- Body: Inter at `--step-0`, line-height 1.6
- Metadata, labels, pills: Inter at `--step--1`, `--ink-muted`, small caps or `letter-spacing: 0.04em` uppercase for labels
- Numbers (confidence, stats): `font-variant-numeric: tabular-nums`

### 9.3 Components

- **Card:** `--surface` background, 1px `--rule` border, `--radius`, padding `--s-6`. On hover only the border darkens slightly; no movement.
- **Confidence bar:** a 4px tall track in `--rule` with the fill in `--ink`, and the percentage on the right in tabular figures. In calibration contexts the fill takes the bucket's color.
- **Status pill:** small rounded label. *Open* uses an outline in `--ink-faint`, *Due* uses `--accent-soft` with `--accent` text, *Right* uses accent, *Wrong* uses warm, *Unclear* uses neutral.
- **Buttons:** primary is solid `--accent` with white text and `--radius-sm`. Secondary is transparent with a `--rule` border. Danger is text-only in `--warm`. Hit area is at least 40px tall.
- **Inputs:** full width, `--surface`, 1px `--rule` border. Focus shows a 2px `--focus` outline with a 2px offset. Labels sit above inputs. Hints and errors sit below, with errors in `--warm` and an `aria-describedby` link.
- **Outcome choice cards** (resolve form): three equal tiles built as radio inputs. The selected tile gets a colored border and a soft background in its outcome color.
- **Empty state:** centered, a small line-drawn SVG, one sentence, and one action.

### 9.4 Layout and motion

- Single column. The calibration chart can go wider.
- Mobile-first, with a 16px side gutter. The nav collapses to a horizontal scroll row under the wordmark below 560px. No hamburger menu.
- Motion is limited to color and border transitions of 120ms, plus the calibration bar heights animating once on load (`@starting-style` / transition). Everything respects `prefers-reduced-motion`.

### 9.5 Accessibility

- Semantic landmarks (`header`, `nav`, `main`, `footer`)
- Every input has a `<label>`. Error summaries use `role="alert"`.
- Color is never the only signal: pills and bars always carry text.
- Contrast is at least 4.5:1 for body text in both themes.
- Visible focus states everywhere.

---

## 10. Seed data (`npm run seed`)

About 25 plausible decisions spread over the last 8 months, mixing open, due, and resolved, with confidences across all buckets. Outcomes should be deliberately slightly overconfident in the 80s and 90s, so the calibration page tells a story on first run. Example titles:

- "Switch the team to Angular signals for new components"
- "Take the 3-month contract instead of the permanent role"
- "Run a half-marathon in spring"
- "Move the side project from JSON files to SQLite"
- "Submit a talk to a local meetup"

Tags: `career`, `tech`, `health`, `money`, `personal`.

---

## 11. Error handling

- A 404 handler renders `errors/404` ("This page doesn't exist. Maybe it was a bad decision.").
- An error handler logs to the console, then renders `errors/500` with status 500. The stack trace appears only when `NODE_ENV !== 'production'`.
- SQLite constraint errors from the repository are converted into validation errors where possible, rather than 500s.

---

## 12. Acceptance criteria (v1 done when…)

1. `npm install && npm run seed && npm start` serves the app on `:3000` with populated data.
2. A decision can be created, edited (while open), resolved, reopened, and deleted, all with JS disabled.
3. Invalid form submissions re-render with 422, preserved values, inline errors, and an error summary.
4. Due decisions appear on the dashboard on or after their review date and can be resolved inline.
5. The decision list filters by status, tag, and text, and sorts and paginates, with all state kept in the URL.
6. The calibration page shows the correct per-bucket hit rates and Brier score for the seed data. `services/calibration.js` has at least 5 unit tests using `node --test`.
7. Light and dark themes both look intentional. Layout works from 360px to desktop width with no horizontal scrolling.
8. Lighthouse accessibility score ≥ 95 on dashboard, detail, and form pages.

---

## 13. Milestones

1. **Skeleton:** Express, Pug layout, CSS tokens, static dashboard
2. **Data:** SQLite connection, migration, repository, seed
3. **CRUD:** new/edit/show/delete with validation and flash
4. **Review flow:** due logic, resolve/reopen, dashboard sections
5. **List:** filters, search, sort, pagination
6. **Calibration:** service and tests, chart, table
7. **Polish:** empty states, dark mode, a11y pass, optional `enhance.js`

---

## 14. Ideas for later (out of scope)

- CSV export / import
- Per-tag calibration
- "Pre-mortem" field: what would make this go wrong?
- A weekly digest page you can bookmark
- Simple password auth with a session for hosting it online

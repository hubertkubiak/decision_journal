// All SQL lives here. Dates in SQL use date('now', 'localtime') because review_on
// is a local calendar date, while the *_at columns are UTC timestamps.

import { db } from '../db/connection.js';
import { addDays, today } from '../lib/dates.js';

const IS_DUE = "status = 'open' AND review_on <= date('now', 'localtime')";

const SORT_ORDERS = {
  newest: 'created_at DESC, id DESC',
  review: 'review_on ASC, id DESC',
  confidence: 'confidence DESC, id DESC',
};

function withFlags(row) {
  const isDue = row.status === 'open' && row.review_on <= today();
  const isOverdue = isDue && row.review_on < addDays(today(), -7);
  return { ...row, isDue, isOverdue };
}

/** Adds tags[] and the due flags to rows, using one query for all of them. */
function hydrate(rows) {
  if (rows.length === 0) return [];
  const tagRows = db
    .prepare(
      `SELECT dt.decision_id AS id, t.name
         FROM decision_tags dt
         JOIN tags t ON t.id = dt.tag_id
        WHERE dt.decision_id IN (SELECT value FROM json_each(?))
        ORDER BY t.name`,
    )
    .all(JSON.stringify(rows.map((row) => row.id)));

  const tagsById = new Map();
  for (const { id, name } of tagRows) {
    if (!tagsById.has(id)) tagsById.set(id, []);
    tagsById.get(id).push(name);
  }
  return rows.map((row) => ({ ...withFlags(row), tags: tagsById.get(row.id) ?? [] }));
}

function deleteOrphanTags() {
  db.prepare(
    'DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM decision_tags)',
  ).run();
}

function replaceTags(decisionId, tagNames) {
  db.prepare('DELETE FROM decision_tags WHERE decision_id = ?').run(decisionId);
  const upsert = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT (name) DO NOTHING');
  const findId = db.prepare('SELECT id FROM tags WHERE name = ?').pluck();
  const link = db.prepare('INSERT OR IGNORE INTO decision_tags (decision_id, tag_id) VALUES (?, ?)');
  for (const name of tagNames) {
    upsert.run(name);
    link.run(decisionId, findId.get(name));
  }
  deleteOrphanTags();
}

/** Characters with a special meaning in LIKE must match literally in a search. */
const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

export function listDecisions({ status = 'all', tag, q, sort = 'newest', limit = 20, offset = 0 } = {}) {
  const where = [];
  const params = {};

  if (status === 'open') where.push("status = 'open'");
  else if (status === 'resolved') where.push("status = 'resolved'");
  else if (status === 'due') where.push(IS_DUE);

  if (tag) {
    where.push(`EXISTS (
      SELECT 1 FROM decision_tags dt JOIN tags t ON t.id = dt.tag_id
       WHERE dt.decision_id = decisions.id AND t.name = @tag)`);
    params.tag = tag;
  }
  if (q) {
    where.push("(title LIKE @q ESCAPE '\\' OR prediction LIKE @q ESCAPE '\\')");
    params.q = `%${escapeLike(q)}%`;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = SORT_ORDERS[sort] ?? SORT_ORDERS.newest;

  const total = db.prepare(`SELECT count(*) FROM decisions ${whereSql}`).pluck().get(params);
  const rows = db
    .prepare(`SELECT * FROM decisions ${whereSql} ORDER BY ${orderSql} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  return { rows: hydrate(rows), total };
}

export function getDecision(id) {
  const row = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
  return row ? hydrate([row])[0] : undefined;
}

export function createDecision(values, tagNames = []) {
  return db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO decisions (title, context, prediction, confidence, review_on)
         VALUES (@title, @context, @prediction, @confidence, @review_on)`,
      )
      .run({
        title: values.title,
        context: values.context || null,
        prediction: values.prediction,
        confidence: values.confidence,
        review_on: values.review_on,
      });
    const id = Number(lastInsertRowid);
    replaceTags(id, tagNames);
    return id;
  })();
}

/** Only open decisions can change. Returns false if nothing was updated. */
export function updateDecision(id, values, tagNames = []) {
  return db.transaction(() => {
    const { changes } = db
      .prepare(
        `UPDATE decisions
            SET title = @title, context = @context, prediction = @prediction,
                confidence = @confidence, review_on = @review_on,
                updated_at = datetime('now')
          WHERE id = @id AND status = 'open'`,
      )
      .run({
        id,
        title: values.title,
        context: values.context || null,
        prediction: values.prediction,
        confidence: values.confidence,
        review_on: values.review_on,
      });
    if (changes === 0) return false;
    replaceTags(id, tagNames);
    return true;
  })();
}

/**
 * Resolves an open decision. Returns false if it wasn't open. An undefined
 * reflection (the dashboard's one-click buttons send none) keeps what's stored,
 * which matters for a decision that was reopened; an empty string clears it.
 */
export function resolveDecision(id, { outcome, reflection }) {
  const { changes } = db
    .prepare(
      `UPDATE decisions
          SET status = 'resolved',
              outcome = @outcome,
              reflection = CASE WHEN @reflection IS NULL THEN reflection
                                ELSE NULLIF(@reflection, '') END,
              resolved_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = @id AND status = 'open'`,
    )
    .run({ id, outcome, reflection: reflection ?? null });
  return changes > 0;
}

/** Undoes a resolution. The reflection stays, so a mistaken click loses no writing. */
export function reopenDecision(id) {
  const { changes } = db
    .prepare(
      `UPDATE decisions
          SET status = 'open', outcome = NULL, resolved_at = NULL, updated_at = datetime('now')
        WHERE id = ? AND status = 'resolved'`,
    )
    .run(id);
  return changes > 0;
}

export function deleteDecision(id) {
  return db.transaction(() => {
    const { changes } = db.prepare('DELETE FROM decisions WHERE id = ?').run(id);
    deleteOrphanTags();
    return changes > 0;
  })();
}

export function listDue() {
  return hydrate(
    db.prepare(`SELECT * FROM decisions WHERE ${IS_DUE} ORDER BY review_on ASC, id ASC`).all(),
  );
}

export function listUpcoming(days = 14) {
  return hydrate(
    db
      .prepare(
        `SELECT * FROM decisions
          WHERE status = 'open'
            AND review_on > date('now', 'localtime')
            AND review_on <= date('now', 'localtime', '+' || ? || ' days')
          ORDER BY review_on ASC, id ASC`,
      )
      .all(days),
  );
}

export function listRecentlyResolved(limit = 5) {
  return hydrate(
    db
      .prepare(
        `SELECT * FROM decisions WHERE status = 'resolved'
          ORDER BY resolved_at DESC, id DESC LIMIT ?`,
      )
      .all(limit),
  );
}

export function listTags() {
  return db
    .prepare(
      `SELECT t.name, count(dt.decision_id) AS count
         FROM tags t JOIN decision_tags dt ON dt.tag_id = t.id
        GROUP BY t.id ORDER BY t.name`,
    )
    .all();
}

export function calibrationRows() {
  return db
    .prepare(
      `SELECT confidence, outcome FROM decisions
        WHERE status = 'resolved' AND outcome <> 'unclear'`,
    )
    .all();
}

export function counts() {
  return db
    .prepare(
      `SELECT
         coalesce(sum(status = 'open'), 0)      AS open,
         coalesce(sum(${IS_DUE}), 0)            AS due,
         coalesce(sum(status = 'resolved'), 0)  AS resolved,
         coalesce(sum(outcome = 'unclear'), 0)  AS unclear
       FROM decisions`,
    )
    .get();
}

/** Seed support: inserts a decision with explicit dates and resolution state. */
export function insertSeedDecision(row, tagNames) {
  return db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO decisions
           (title, context, prediction, confidence, review_on, status, outcome,
            reflection, resolved_at, created_at, updated_at)
         VALUES
           (@title, @context, @prediction, @confidence, @review_on, @status, @outcome,
            @reflection, @resolved_at, @created_at, @created_at)`,
      )
      .run(row);
    const id = Number(lastInsertRowid);
    replaceTags(id, tagNames);
    return id;
  })();
}

/** Seed support: empties the journal and restarts ids. */
export function deleteEverything() {
  db.transaction(() => {
    db.prepare('DELETE FROM decisions').run();
    db.prepare('DELETE FROM tags').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('decisions', 'tags')").run();
  })();
}

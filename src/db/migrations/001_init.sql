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

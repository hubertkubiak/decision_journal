import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..', '..');
const migrationsDir = path.join(here, 'migrations');

function appliedVersions(database) {
  // 001_init.sql creates schema_migrations itself, so it can't be assumed to exist yet.
  const tableExists = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!tableExists) return new Set();
  return new Set(
    database.prepare('SELECT version FROM schema_migrations').pluck().all(),
  );
}

function runMigrations(database) {
  const applied = appliedVersions(database);
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  for (const file of files) {
    const version = parseInt(file, 10);
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    database.transaction(() => {
      database.exec(sql);
      database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
    })();
  }
}

export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 3000');
  runMigrations(database);
  return database;
}

export const db = openDatabase(process.env.DB_PATH || path.join(rootDir, 'data', 'journal.db'));

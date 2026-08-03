-- D1 schema for the gymmap database (already applied to production).
-- Kept in-repo for reference and for recreating a local/dev database:
--   npx wrangler d1 execute gymmap --local --file=migrations/0001_schema.sql
CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT '',
  categories TEXT NOT NULL DEFAULT '[]',
  location TEXT DEFAULT '',
  region TEXT DEFAULT '',
  address TEXT DEFAULT '',
  website TEXT DEFAULT '',
  instagram TEXT DEFAULT '',
  specialties TEXT NOT NULL DEFAULT '[]',
  lat REAL,
  lon REAL,
  online INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  name TEXT DEFAULT '',
  type TEXT DEFAULT '',
  categories TEXT NOT NULL DEFAULT '[]',
  location TEXT DEFAULT '',
  address TEXT DEFAULT '',
  website TEXT DEFAULT '',
  instagram TEXT DEFAULT '',
  specialties TEXT NOT NULL DEFAULT '[]',
  online INTEGER NOT NULL DEFAULT 0,
  is_my_school INTEGER NOT NULL DEFAULT 0,
  submitter_name TEXT DEFAULT '',
  submitter_email TEXT DEFAULT '',
  notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  school_id TEXT,
  school_name TEXT DEFAULT '',
  claimant_name TEXT DEFAULT '',
  claimant_email TEXT DEFAULT '',
  claimant_phone TEXT DEFAULT '',
  message TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL CHECK (type IN ('view','click')),
  school TEXT,
  session_id TEXT
);
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON analytics_events(type);
CREATE INDEX IF NOT EXISTS idx_events_school ON analytics_events(school);
CREATE INDEX IF NOT EXISTS idx_schools_status ON schools(status);

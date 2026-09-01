// src/db.js
// لایه دیتابیس. از ماژول داخلی node:sqlite استفاده می‌شود تا بک‌اند بدون npm install
// و بدون دسترسی به اینترنت، مستقیماً با «node src/server.js» قابل اجراست.
// معماری DAL (Data Access Layer) عمداً از منطق کسب‌وکار جدا نگه داشته شده تا
// جایگزینی SQLite با PostgreSQL (از طریق pg یا Prisma) در آینده ساده باشد؛
// برای مسیر تولید/Production به prisma/schema.prisma و docs/schema.postgres.sql مراجعه کنید.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'nazerpro.db');
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

// ---------------------------------------------------------------------------
// Schema — معادل مستقیم موجودیت‌های بخش ۴۹ سند طراحی
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','SUPERVISOR','CONTRACTOR','OWNER')),
  discipline TEXT, -- برای نقش SUPERVISOR: عمران/معماری/برق/مکانیک
  phone TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS disciplines (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  code TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  address TEXT,
  city TEXT,
  building_type TEXT,     -- مسکونی/تجاری/ویلایی/...
  structure_type TEXT,    -- بتنی/فولادی/...
  floors INTEGER DEFAULT 0,
  owner_id TEXT REFERENCES users(id),
  contractor_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','suspended')),
  progress INTEGER NOT NULL DEFAULT 0,
  current_stage TEXT NOT NULL DEFAULT 'تجهیز کارگاه',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- تخصیص ناظر به پروژه به تفکیک رشته (چند ناظر برای چند رشته در هر پروژه)
CREATE TABLE IF NOT EXISTS project_supervisors (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  discipline TEXT NOT NULL,
  UNIQUE(project_id, discipline)
);

CREATE TABLE IF NOT EXISTS regulations (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,          -- مثال: "مبحث ۹"
  title TEXT NOT NULL,
  version TEXT,
  issue_date TEXT,
  effective_date TEXT,
  status TEXT NOT NULL DEFAULT 'معتبر' CHECK(status IN ('معتبر','منسوخ','نیازمند بررسی')),
  document_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- الگوهای چک‌لیست (Checklist Templates) — نسخه‌بندی‌شده، هیچ‌گاه Hard-code نیست
CREATE TABLE IF NOT EXISTS checklists (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  discipline TEXT NOT NULL,
  stage TEXT NOT NULL,
  regulation_id TEXT REFERENCES regulations(id),
  version TEXT NOT NULL DEFAULT 'v1.0',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','draft')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  mandatory INTEGER NOT NULL DEFAULT 0,
  photo_required INTEGER NOT NULL DEFAULT 0,
  comment_required_on_fail INTEGER NOT NULL DEFAULT 1,
  mip INTEGER NOT NULL DEFAULT 0, -- Mandatory Inspection Point
  regulation_reference TEXT,      -- مثال: "مبحث ۹"
  regulation_note TEXT,
  regulation_verified INTEGER NOT NULL DEFAULT 0, -- 0 = «نیازمند بررسی منبع»
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  discipline TEXT NOT NULL,
  stage TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  location_lat REAL,
  location_lng REAL,
  location_verified INTEGER NOT NULL DEFAULT 0,
  weather TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('draft','submitted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS visit_attendance (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  role_label TEXT NOT NULL, -- مالک/مجری/ناظر همکار/...
  present INTEGER NOT NULL DEFAULT 1,
  absent_reason TEXT
);

CREATE TABLE IF NOT EXISTS visit_checklists (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  checklist_id TEXT NOT NULL REFERENCES checklists(id),
  score INTEGER,
  status TEXT NOT NULL DEFAULT 'completed'
);

CREATE TABLE IF NOT EXISTS checklist_results (
  id TEXT PRIMARY KEY,
  visit_checklist_id TEXT NOT NULL REFERENCES visit_checklists(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES checklist_items(id),
  status TEXT NOT NULL CHECK(status IN ('تایید','عدم تایید','نیازمند اصلاح','بررسی نشده','غیرقابل اعمال')),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  visit_id TEXT REFERENCES visits(id),
  discipline TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  severity TEXT NOT NULL DEFAULT 'متوسط' CHECK(severity IN ('کم','متوسط','بحرانی')),
  status TEXT NOT NULL DEFAULT 'ثبت شده'
    CHECK(status IN ('ثبت شده','اعلام به مجری','در حال اصلاح','تایید ناظر','بسته شده','رد شده')),
  due_date TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_status_history (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  changed_by TEXT REFERENCES users(id),
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  visit_id TEXT REFERENCES visits(id),
  issue_id TEXT REFERENCES issues(id),
  checklist_item_id TEXT REFERENCES checklist_items(id),
  kind TEXT NOT NULL DEFAULT 'general' CHECK(kind IN ('general','before','after')),
  file_path TEXT NOT NULL,
  mime_type TEXT,
  watermark_project TEXT,
  watermark_date TEXT,
  watermark_inspection_id TEXT,
  location_lat REAL,
  location_lng REAL,
  description TEXT,
  uploaded_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  visit_id TEXT REFERENCES visits(id),
  discipline TEXT NOT NULL,
  stage TEXT,
  content_json TEXT NOT NULL, -- snapshot کامل گزارش در لحظه صدور (غیرقابل تغییر با تغییر بعدی چک‌لیست)
  compliance_score INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS minute_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  body_html TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS minutes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  template_id TEXT REFERENCES minute_templates(id),
  number TEXT NOT NULL,
  content_html TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  project_id TEXT REFERENCES projects(id),
  action TEXT NOT NULL,      -- create | update | status_change | delete
  entity TEXT NOT NULL,      -- e.g. 'ChecklistResult', 'Issue'
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_visits_project ON visits(project_id);
CREATE INDEX IF NOT EXISTS idx_photos_visit ON photos(visit_id);
CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist ON checklist_items(checklist_id);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_logs(project_id);
`);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
export function all(sql, params = []) { return db.prepare(sql).all(...params); }
export function get(sql, params = []) { return db.prepare(sql).get(...params); }
export function run(sql, params = []) { return db.prepare(sql).run(...params); }
export function tx(fn) {
  db.exec('BEGIN');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

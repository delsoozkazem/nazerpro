-- docs/schema.postgres.sql
-- DDL خام PostgreSQL — معادل مستقیم src/db.js (SQLite) برای استقرار Production.
-- اجرا: psql "$DATABASE_URL" -f docs/schema.postgres.sql
-- (در سندباکس فعلی به دلیل نبود دسترسی اینترنت/سرویس Postgres، این اسکریپت اجرا نشده است.)

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- برای gen_random_uuid()

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','SUPERVISOR','CONTRACTOR','OWNER')),
  discipline TEXT,
  phone TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE disciplines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  code TEXT UNIQUE NOT NULL
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  address TEXT,
  city TEXT,
  building_type TEXT,
  structure_type TEXT,
  floors INTEGER DEFAULT 0,
  owner_id UUID REFERENCES users(id),
  contractor_id UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','suspended')),
  progress INTEGER NOT NULL DEFAULT 0,
  current_stage TEXT NOT NULL DEFAULT 'تجهیز کارگاه',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_supervisors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  discipline TEXT NOT NULL,
  UNIQUE (project_id, discipline)
);

CREATE TABLE regulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  version TEXT,
  issue_date DATE,
  effective_date DATE,
  status TEXT NOT NULL DEFAULT 'معتبر' CHECK (status IN ('معتبر','منسوخ','نیازمند بررسی')),
  document_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  discipline TEXT NOT NULL,
  stage TEXT NOT NULL,
  regulation_id UUID REFERENCES regulations(id),
  version TEXT NOT NULL DEFAULT 'v1.0',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','draft')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  mandatory BOOLEAN NOT NULL DEFAULT false,
  photo_required BOOLEAN NOT NULL DEFAULT false,
  comment_required_on_fail BOOLEAN NOT NULL DEFAULT true,
  mip BOOLEAN NOT NULL DEFAULT false,
  regulation_reference TEXT,
  regulation_note TEXT,
  regulation_verified BOOLEAN NOT NULL DEFAULT false,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  user_id UUID NOT NULL REFERENCES users(id),
  discipline TEXT NOT NULL,
  stage TEXT NOT NULL,
  date DATE NOT NULL,
  time TIME NOT NULL,
  location_lat DOUBLE PRECISION,
  location_lng DOUBLE PRECISION,
  location_verified BOOLEAN NOT NULL DEFAULT false,
  weather TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft','submitted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE visit_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  role_label TEXT NOT NULL,
  present BOOLEAN NOT NULL DEFAULT true,
  absent_reason TEXT
);

CREATE TABLE visit_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL UNIQUE REFERENCES visits(id) ON DELETE CASCADE,
  checklist_id UUID NOT NULL REFERENCES checklists(id),
  score INTEGER,
  status TEXT NOT NULL DEFAULT 'completed'
);

CREATE TABLE checklist_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_checklist_id UUID NOT NULL REFERENCES visit_checklists(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES checklist_items(id),
  status TEXT NOT NULL CHECK (status IN ('تایید','عدم تایید','نیازمند اصلاح','بررسی نشده','غیرقابل اعمال')),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  visit_id UUID REFERENCES visits(id),
  discipline TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  severity TEXT NOT NULL DEFAULT 'متوسط' CHECK (severity IN ('کم','متوسط','بحرانی')),
  status TEXT NOT NULL DEFAULT 'ثبت شده'
    CHECK (status IN ('ثبت شده','اعلام به مجری','در حال اصلاح','تایید ناظر','بسته شده','رد شده')),
  due_date DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE issue_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  visit_id UUID REFERENCES visits(id),
  issue_id UUID REFERENCES issues(id),
  checklist_item_id UUID REFERENCES checklist_items(id),
  kind TEXT NOT NULL DEFAULT 'general' CHECK (kind IN ('general','before','after')),
  file_path TEXT NOT NULL,   -- در Production: کلید شیء در S3/R2 به‌جای مسیر دیسک محلی
  mime_type TEXT,
  watermark_project TEXT,
  watermark_date TEXT,
  watermark_inspection_id TEXT,
  location_lat DOUBLE PRECISION,
  location_lng DOUBLE PRECISION,
  description TEXT,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  visit_id UUID REFERENCES visits(id),
  discipline TEXT NOT NULL,
  stage TEXT,
  content_json JSONB NOT NULL,
  compliance_score INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE minute_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  body_html TEXT NOT NULL
);

CREATE TABLE minutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  template_id UUID REFERENCES minute_templates(id),
  number TEXT NOT NULL,
  content_html TEXT NOT NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  project_id UUID REFERENCES projects(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_issues_project ON issues(project_id);
CREATE INDEX idx_issues_status ON issues(status);
CREATE INDEX idx_visits_project ON visits(project_id);
CREATE INDEX idx_photos_visit ON photos(visit_id);
CREATE INDEX idx_checklist_items_checklist ON checklist_items(checklist_id);
CREATE INDEX idx_audit_project ON audit_logs(project_id);
CREATE INDEX idx_reports_content_gin ON reports USING GIN (content_json);

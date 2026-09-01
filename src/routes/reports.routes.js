import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, run, all } from '../db.js';
import { uuid, badRequest, notFound, forbidden, requireAuth, requireRole, audit } from '../lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

function assertProjectAccess(req, project) {
  const user = requireAuth(req);
  if (user.role === 'ADMIN') return;
  if (user.role === 'OWNER' && project.owner_id === user.sub) return;
  if (user.role === 'CONTRACTOR' && project.contractor_id === user.sub) return;
  if (user.role === 'SUPERVISOR') {
    const link = get(`SELECT 1 FROM project_supervisors WHERE project_id=? AND user_id=?`, [project.id, user.sub]);
    if (link) return;
  }
  throw forbidden('دسترسی مجاز نیست');
}

export function register(router) {
  // ---------------- Photos ----------------
  router.get('/api/photos/:id', async (req, res, ctx) => {
    requireAuth(req);
    const p = get(`SELECT * FROM photos WHERE id=?`, [ctx.params.id]);
    if (!p) throw notFound('تصویر یافت نشد');
    return p;
  });

  // پخش بایت‌های واقعی فایل تصویر
  router.get('/api/photos/:id/file', async (req, res, ctx) => {
    const p = get(`SELECT * FROM photos WHERE id=?`, [ctx.params.id]);
    if (!p) throw notFound('تصویر یافت نشد');
    const filePath = path.join(ROOT, p.file_path);
    if (!fs.existsSync(filePath)) throw notFound('فایل تصویر روی دیسک یافت نشد');
    const buf = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': p.mime_type || 'application/octet-stream', 'Content-Length': buf.length });
    res.end(buf);
    return undefined; // پاسخ مستقیماً ارسال شد
  });

  // ---------------- Reports (بخش ۲۸-۲۹، ۵۸) ----------------
  router.get('/api/reports', async (req, res, ctx) => {
    const user = requireAuth(req);
    const { project } = ctx.query;
    const clauses = [];
    const params = [];
    if (user.role === 'OWNER') { clauses.push(`r.project_id IN (SELECT id FROM projects WHERE owner_id=?)`); params.push(user.sub); }
    else if (user.role === 'CONTRACTOR') { clauses.push(`r.project_id IN (SELECT id FROM projects WHERE contractor_id=?)`); params.push(user.sub); }
    else if (user.role === 'SUPERVISOR') { clauses.push(`r.project_id IN (SELECT project_id FROM project_supervisors WHERE user_id=?)`); params.push(user.sub); }
    if (project) { clauses.push('r.project_id=?'); params.push(project); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return all(`SELECT id, project_id, visit_id, discipline, stage, compliance_score, status, created_at FROM reports r ${where} ORDER BY created_at DESC`, params);
  });

  router.get('/api/reports/:id', async (req, res, ctx) => {
    const report = get(`SELECT * FROM reports WHERE id=?`, [ctx.params.id]);
    if (!report) throw notFound('گزارش یافت نشد');
    const project = get(`SELECT * FROM projects WHERE id=?`, [report.project_id]);
    assertProjectAccess(req, project);
    return {
      ...report,
      content: JSON.parse(report.content_json),
      disclaimer:
        'این گزارش صرفاً یک ابزار مدیریت، کنترل و مستندسازی داخلی و پیش‌نویس قابل ویرایش توسط مهندس است. ' +
        'این سند به‌خودی‌خود معادل تأیید قانونی از سوی سازمان نظام مهندسی یا سایر مراجع ذی‌صلاح نیست، مگر آنکه ' +
        'قالب و فرآیند مربوط توسط آن مرجع تأیید شده باشد. کنترل‌های دارای وضعیت «نیازمند بررسی منبع» باید پیش از ' +
        'استناد نهایی توسط مهندس ناظر بررسی شوند.',
    };
  });

  // گزارش جامع پروژه — ترکیب همه رشته‌ها (بخش ۲۹)
  router.get('/api/projects/:id/reports/comprehensive', async (req, res, ctx) => {
    const project = get(`SELECT * FROM projects WHERE id=?`, [ctx.params.id]);
    if (!project) throw notFound('پروژه یافت نشد');
    assertProjectAccess(req, project);
    const reports = all(`SELECT * FROM reports WHERE project_id=? ORDER BY created_at DESC`, [project.id])
      .map(r => ({ ...r, content: JSON.parse(r.content_json) }));
    const byDiscipline = {};
    for (const r of reports) { (byDiscipline[r.discipline] ||= []).push(r); }
    const scores = reports.filter(r => r.compliance_score != null).map(r => r.compliance_score);
    const overallScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    return { project, byDiscipline, overallScore, totalReports: reports.length };
  });

  // ---------------- Minutes / صورتجلسه (بخش ۳۰-۳۱) ----------------
  router.post('/api/minutes', async (req, res, ctx) => {
    const user = requireRole(req, 'ADMIN', 'SUPERVISOR');
    const { projectId, templateId, contentHtml } = ctx.body;
    if (!projectId) throw badRequest('projectId الزامی است');
    const project = get(`SELECT * FROM projects WHERE id=?`, [projectId]);
    if (!project) throw notFound('پروژه یافت نشد');
    assertProjectAccess(req, project);

    let body = contentHtml;
    if (templateId) {
      const tpl = get(`SELECT * FROM minute_templates WHERE id=?`, [templateId]);
      if (!tpl) throw notFound('قالب مینوت یافت نشد');
      const owner = project.owner_id ? get(`SELECT name FROM users WHERE id=?`, [project.owner_id]) : null;
      const contractor = project.contractor_id ? get(`SELECT name FROM users WHERE id=?`, [project.contractor_id]) : null;
      body = tpl.body_html
        .replaceAll('{{PROJECT_NAME}}', project.name)
        .replaceAll('{{PROJECT_CODE}}', project.code)
        .replaceAll('{{OWNER_NAME}}', owner?.name || '—')
        .replaceAll('{{CONTRACTOR_NAME}}', contractor?.name || '—')
        .replaceAll('{{SUPERVISOR_NAME}}', ctx.body.supervisorName || '—')
        .replaceAll('{{DATE}}', new Date().toLocaleDateString('fa-IR'))
        .replaceAll('{{VISIT_NUMBER}}', ctx.body.visitNumber || '—')
        .replaceAll('{{CURRENT_STAGE}}', project.current_stage);
    }
    if (!body) throw badRequest('templateId یا contentHtml باید ارسال شود');

    const countRow = get(`SELECT COUNT(*) as c FROM minutes WHERE project_id=?`, [projectId]);
    const number = `${project.code}-M${String((countRow?.c ?? 0) + 1).padStart(3, '0')}`;
    const id = uuid();
    run(
      `INSERT INTO minutes (id, project_id, template_id, number, content_html, date, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [id, projectId, templateId || null, number, body, new Date().toISOString().slice(0, 10), user.sub]
    );
    audit({ userId: user.sub, projectId, action: 'create', entity: 'Minute', entityId: id, after: { number } });
    return get(`SELECT * FROM minutes WHERE id=?`, [id]);
  });

  router.get('/api/minutes/:id', async (req, res, ctx) => {
    const m = get(`SELECT * FROM minutes WHERE id=?`, [ctx.params.id]);
    if (!m) throw notFound('مینوت یافت نشد');
    const project = get(`SELECT * FROM projects WHERE id=?`, [m.project_id]);
    assertProjectAccess(req, project);
    return m;
  });

  router.get('/api/projects/:id/minutes', async (req, res, ctx) => {
    const project = get(`SELECT * FROM projects WHERE id=?`, [ctx.params.id]);
    if (!project) throw notFound('پروژه یافت نشد');
    assertProjectAccess(req, project);
    return all(`SELECT * FROM minutes WHERE project_id=? ORDER BY created_at DESC`, [ctx.params.id]);
  });
}

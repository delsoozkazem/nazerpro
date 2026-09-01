import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, run, all, tx } from '../db.js';
import {
  uuid, badRequest, notFound, forbidden, requireAuth, requireRole, audit,
} from '../lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const VALID_STATUS = ['تایید', 'عدم تایید', 'نیازمند اصلاح', 'بررسی نشده', 'غیرقابل اعمال'];

function assertProjectAccess(req, project) {
  const user = requireAuth(req);
  if (user.role === 'ADMIN') return;
  if (user.role === 'SUPERVISOR') {
    const link = get(`SELECT 1 FROM project_supervisors WHERE project_id=? AND user_id=?`, [project.id, user.sub]);
    if (link) return;
  }
  throw forbidden('شما اجازه ثبت بازدید برای این پروژه را ندارید');
}

// ذخیره تصویر Base64 روی دیسک به همراه متادیتای واترمارک (بخش ۳۳):
// نام پروژه، تاریخ، شماره بازدید — طبق طراحی این‌ها به‌صورت متادیتا ذخیره می‌شوند
// و رندر واقعی واترمارک روی پیکسل‌های تصویر در خط لوله پردازش تصویر تولید (خارج از این پروتوتایپ) انجام می‌شود.
function savePhoto({ base64, projectId, visitId, issueId, checklistItemId, kind, description, uploadedBy, watermark }) {
  if (!base64) throw badRequest('محتوای تصویر (base64) الزامی است');
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(base64);
  const mime = match ? match[1] : 'image/jpeg';
  const raw = match ? match[2] : base64;
  const ext = mime.split('/')[1] || 'jpg';
  const fileName = `${uuid()}.${ext}`;
  const dir = path.join(UPLOAD_DIR, projectId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), Buffer.from(raw, 'base64'));
  const id = uuid();
  run(
    `INSERT INTO photos (id, project_id, visit_id, issue_id, checklist_item_id, kind, file_path, mime_type,
      watermark_project, watermark_date, watermark_inspection_id, description, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, projectId, visitId || null, issueId || null, checklistItemId || null, kind || 'general',
      path.relative(path.join(__dirname, '..', '..'), path.join(dir, fileName)), mime,
      watermark?.project || null, watermark?.date || null, watermark?.inspectionId || null,
      description || null, uploadedBy || null]
  );
  return id;
}

function computeScore(results) {
  const applicable = results.filter(r => r.status !== 'غیرقابل اعمال');
  const approved = applicable.filter(r => r.status === 'تایید');
  if (!applicable.length) return 100;
  return Math.round((approved.length / applicable.length) * 100);
}

function fullVisit(visitId) {
  const visit = get(`SELECT * FROM visits WHERE id=?`, [visitId]);
  if (!visit) return null;
  const attendance = all(`SELECT * FROM visit_attendance WHERE visit_id=?`, [visitId]);
  const vc = get(`SELECT * FROM visit_checklists WHERE visit_id=?`, [visitId]);
  const results = vc ? all(
    `SELECT cr.*, ci.title, ci.mandatory, ci.photo_required, ci.mip, ci.regulation_reference, ci.regulation_note, ci.regulation_verified
     FROM checklist_results cr JOIN checklist_items ci ON ci.id = cr.item_id WHERE cr.visit_checklist_id=?`,
    [vc.id]
  ) : [];
  const photos = all(`SELECT * FROM photos WHERE visit_id=?`, [visitId]);
  const issuesRows = all(`SELECT * FROM issues WHERE visit_id=?`, [visitId]);
  const report = get(`SELECT * FROM reports WHERE visit_id=?`, [visitId]);
  return { ...visit, attendance, checklist: vc, results, photos, issues: issuesRows, report };
}

export function register(router) {
  // POST /api/visits — ثبت بازدید کامل (ویزارد ۱۱ مرحله‌ای فرانت‌اند در یک تراکنش سمت سرور)
  router.post('/api/visits', async (req, res, ctx) => {
    const user = requireRole(req, 'ADMIN', 'SUPERVISOR');
    const b = ctx.body;
    if (!b.projectId || !b.discipline || !b.stage || !b.checklistId) {
      throw badRequest('projectId، discipline، stage و checklistId الزامی است');
    }
    const project = get(`SELECT * FROM projects WHERE id=?`, [b.projectId]);
    if (!project) throw notFound('پروژه یافت نشد');
    assertProjectAccess(req, project);

    const checklist = get(`SELECT * FROM checklists WHERE id=?`, [b.checklistId]);
    if (!checklist) throw notFound('چک‌لیست یافت نشد');
    const items = all(`SELECT * FROM checklist_items WHERE checklist_id=?`, [checklist.id]);
    const itemsById = Object.fromEntries(items.map(i => [i.id, i]));

    const submittedItems = Array.isArray(b.items) ? b.items : [];
    // اعتبارسنجی سمت سرور: عکس اجباری و توضیح اجباری هرگز فقط سمت فرانت‌اند بررسی نمی‌شود
    for (const si of submittedItems) {
      const item = itemsById[si.itemId];
      if (!item) throw badRequest(`آیتم چک‌لیست ${si.itemId} متعلق به این چک‌لیست نیست`);
      if (!VALID_STATUS.includes(si.status)) throw badRequest(`وضعیت «${si.status}» نامعتبر است`);
      if (item.photo_required && !(si.photos && si.photos.length > 0)) {
        throw badRequest(`برای آیتم «${item.title}» ثبت حداقل یک تصویر الزامی است`);
      }
      if (item.comment_required_on_fail && ['عدم تایید', 'نیازمند اصلاح'].includes(si.status) && !si.comment?.trim()) {
        throw badRequest(`برای آیتم «${item.title}» با وضعیت «${si.status}» ثبت توضیحات الزامی است`);
      }
    }

    const visitId = uuid();
    const vcId = uuid();
    const inspectionRef = `${project.code}-${new Date().toISOString().slice(0, 10)}`;

    tx(() => {
      run(
        `INSERT INTO visits (id, project_id, user_id, discipline, stage, date, time, location_lat, location_lng,
          location_verified, weather, notes, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'submitted')`,
        [visitId, project.id, user.sub, b.discipline, b.stage,
          b.date || new Date().toISOString().slice(0, 10), b.time || new Date().toTimeString().slice(0, 5),
          b.location?.lat ?? null, b.location?.lng ?? null, b.location ? 1 : 0, b.weather || null, b.notes || null]
      );

      for (const a of (b.attendance || [])) {
        run(`INSERT INTO visit_attendance (id, visit_id, role_label, present, absent_reason) VALUES (?,?,?,?,?)`,
          [uuid(), visitId, a.roleLabel, a.present ? 1 : 0, a.present ? null : (a.absentReason || null)]);
      }

      run(`INSERT INTO visit_checklists (id, visit_id, checklist_id, status) VALUES (?,?,?, 'completed')`,
        [vcId, visitId, checklist.id]);

      const resultsForScore = [];
      for (const si of submittedItems) {
        run(`INSERT INTO checklist_results (id, visit_checklist_id, item_id, status, comment) VALUES (?,?,?,?,?)`,
          [uuid(), vcId, si.itemId, si.status, si.comment || null]);
        resultsForScore.push({ status: si.status });
        for (const ph of (si.photos || [])) {
          savePhoto({
            base64: ph.base64, projectId: project.id, visitId, checklistItemId: si.itemId, kind: 'general',
            description: ph.description, uploadedBy: user.sub,
            watermark: { project: project.name, date: b.date, inspectionId: inspectionRef },
          });
        }
      }

      const score = computeScore(resultsForScore);
      run(`UPDATE visit_checklists SET score=? WHERE id=?`, [score, vcId]);

      const createdIssueIds = [];
      for (const iss of (b.issues || [])) {
        const issueId = uuid();
        run(
          `INSERT INTO issues (id, project_id, visit_id, discipline, title, description, location, severity, due_date, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [issueId, project.id, visitId, b.discipline, iss.title || 'ایراد بدون عنوان', iss.description || null,
            iss.location || null, iss.severity || 'متوسط', iss.dueDate || null, user.sub]
        );
        run(`INSERT INTO issue_status_history (id, issue_id, from_status, to_status, note, changed_by) VALUES (?,?,?,?,?,?)`,
          [uuid(), issueId, null, 'ثبت شده', 'ایجاد شده در حین بازدید', user.sub]);
        createdIssueIds.push(issueId);
      }

      // اسنپ‌شات غیرقابل‌تغییر گزارش — طبق بخش ۵۱، تغییر بعدی چک‌لیست نباید گزارش‌های صادرشده را تغییر دهد
      const snapshot = {
        project: { id: project.id, name: project.name, code: project.code, owner_id: project.owner_id, contractor_id: project.contractor_id },
        discipline: b.discipline, stage: b.stage,
        checklist: { id: checklist.id, title: checklist.title, version: checklist.version },
        items: submittedItems.map(si => ({
          title: itemsById[si.itemId].title, status: si.status, comment: si.comment || null,
          regulation: { code: itemsById[si.itemId].regulation_reference, note: itemsById[si.itemId].regulation_note, verified: !!itemsById[si.itemId].regulation_verified },
        })),
        issues: b.issues || [], attendance: b.attendance || [], notes: b.notes || null, score,
        generatedAt: new Date().toISOString(),
      };
      run(
        `INSERT INTO reports (id, project_id, visit_id, discipline, stage, content_json, compliance_score, status)
         VALUES (?,?,?,?,?,?,?, 'final')`,
        [uuid(), project.id, visitId, b.discipline, b.stage, JSON.stringify(snapshot), score]
      );
    });

    audit({ userId: user.sub, projectId: project.id, action: 'create', entity: 'Visit', entityId: visitId, after: { discipline: b.discipline, stage: b.stage } });

    return fullVisit(visitId);
  });

  router.get('/api/visits/:id', async (req, res, ctx) => {
    requireAuth(req);
    const v = fullVisit(ctx.params.id);
    if (!v) throw notFound('بازدید یافت نشد');
    const project = get(`SELECT * FROM projects WHERE id=?`, [v.project_id]);
    assertProjectAccess(req, project);
    return v;
  });

  router.get('/api/projects/:id/visits', async (req, res, ctx) => {
    const project = get(`SELECT * FROM projects WHERE id=?`, [ctx.params.id]);
    if (!project) throw notFound('پروژه یافت نشد');
    assertProjectAccess(req, project);
    return all(`SELECT * FROM visits WHERE project_id=? ORDER BY created_at DESC`, [ctx.params.id]);
  });
}

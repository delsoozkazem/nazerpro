import { get, run, all } from '../db.js';
import { uuid, badRequest, notFound, forbidden, requireAuth, requireRole, audit } from '../lib.js';

const FLOW = ['ثبت شده', 'اعلام به مجری', 'در حال اصلاح', 'تایید ناظر', 'بسته شده'];

function assertProjectAccess(req, project) {
  const user = requireAuth(req);
  if (user.role === 'ADMIN') return;
  if (user.role === 'OWNER' && project.owner_id === user.sub) return;
  if (user.role === 'CONTRACTOR' && project.contractor_id === user.sub) return;
  if (user.role === 'SUPERVISOR') {
    const link = get(`SELECT 1 FROM project_supervisors WHERE project_id=? AND user_id=?`, [project.id, user.sub]);
    if (link) return;
  }
  throw forbidden('شما به ایرادات این پروژه دسترسی ندارید');
}

function issueWithPhotos(i) {
  const photos = all(`SELECT * FROM photos WHERE issue_id=? ORDER BY created_at`, [i.id]);
  const history = all(`SELECT * FROM issue_status_history WHERE issue_id=? ORDER BY changed_at`, [i.id]);
  return {
    ...i,
    before_photos: photos.filter(p => p.kind === 'before'),
    after_photos: photos.filter(p => p.kind === 'after'),
    other_photos: photos.filter(p => p.kind === 'general'),
    history,
  };
}

export function register(router) {
  // GET /api/issues?project=&status=&discipline=&severity=
  router.get('/api/issues', async (req, res, ctx) => {
    const user = requireAuth(req);
    const { project, status, discipline, severity } = ctx.query;
    const clauses = [];
    const params = [];

    if (user.role === 'OWNER') { clauses.push(`i.project_id IN (SELECT id FROM projects WHERE owner_id=?)`); params.push(user.sub); }
    else if (user.role === 'CONTRACTOR') { clauses.push(`i.project_id IN (SELECT id FROM projects WHERE contractor_id=?)`); params.push(user.sub); }
    else if (user.role === 'SUPERVISOR') { clauses.push(`i.project_id IN (SELECT project_id FROM project_supervisors WHERE user_id=?)`); params.push(user.sub); }

    if (project) { clauses.push('i.project_id=?'); params.push(project); }
    if (status) { clauses.push('i.status=?'); params.push(status); }
    if (discipline) { clauses.push('i.discipline=?'); params.push(discipline); }
    if (severity) { clauses.push('i.severity=?'); params.push(severity); }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = all(`SELECT i.* FROM issues i ${where} ORDER BY i.created_at DESC`, params);
    return rows.map(issueWithPhotos);
  });

  router.get('/api/issues/:id', async (req, res, ctx) => {
    const issue = get(`SELECT * FROM issues WHERE id=?`, [ctx.params.id]);
    if (!issue) throw notFound('ایراد یافت نشد');
    const project = get(`SELECT * FROM projects WHERE id=?`, [issue.project_id]);
    assertProjectAccess(req, project);
    return issueWithPhotos(issue);
  });

  // ثبت دستی ایراد (خارج از ویزارد بازدید)
  router.post('/api/issues', async (req, res, ctx) => {
    const user = requireRole(req, 'ADMIN', 'SUPERVISOR');
    const b = ctx.body;
    if (!b.projectId || !b.title || !b.discipline) throw badRequest('projectId، discipline و title الزامی است');
    const project = get(`SELECT * FROM projects WHERE id=?`, [b.projectId]);
    if (!project) throw notFound('پروژه یافت نشد');
    assertProjectAccess(req, project);
    const id = uuid();
    run(
      `INSERT INTO issues (id, project_id, visit_id, discipline, title, description, location, severity, due_date, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, project.id, b.visitId || null, b.discipline, b.title, b.description || null, b.location || null,
        b.severity || 'متوسط', b.dueDate || null, user.sub]
    );
    run(`INSERT INTO issue_status_history (id, issue_id, from_status, to_status, changed_by) VALUES (?,?,?,?,?)`,
      [uuid(), id, null, 'ثبت شده', user.sub]);
    audit({ userId: user.sub, projectId: project.id, action: 'create', entity: 'Issue', entityId: id, after: b });
    return issueWithPhotos(get(`SELECT * FROM issues WHERE id=?`, [id]));
  });

  // گردش کار ایراد (بخش ۲۶): فقط انتقال به مرحله بعدیِ مجاز در گردش کار پذیرفته می‌شود
  router.patch('/api/issues/:id/status', async (req, res, ctx) => {
    const user = requireRole(req, 'ADMIN', 'SUPERVISOR', 'CONTRACTOR');
    const issue = get(`SELECT * FROM issues WHERE id=?`, [ctx.params.id]);
    if (!issue) throw notFound('ایراد یافت نشد');
    const project = get(`SELECT * FROM projects WHERE id=?`, [issue.project_id]);
    assertProjectAccess(req, project);

    const { status: nextStatus, note } = ctx.body;
    if (!FLOW.includes(nextStatus) && nextStatus !== 'رد شده') throw badRequest('وضعیت نامعتبر است');

    const curIdx = FLOW.indexOf(issue.status);
    const nextIdx = FLOW.indexOf(nextStatus);
    const isForwardStep = curIdx >= 0 && nextIdx === curIdx + 1;
    const isRejection = nextStatus === 'رد شده';
    if (!isForwardStep && !isRejection) {
      throw badRequest(`انتقال از «${issue.status}» به «${nextStatus}» در گردش کار مجاز نیست. مسیر مجاز: ${FLOW.join(' → ')}`);
    }

    run(`UPDATE issues SET status=?, closed_at=? WHERE id=?`,
      [nextStatus, nextStatus === 'بسته شده' ? new Date().toISOString() : null, issue.id]);
    run(`INSERT INTO issue_status_history (id, issue_id, from_status, to_status, note, changed_by) VALUES (?,?,?,?,?,?)`,
      [uuid(), issue.id, issue.status, nextStatus, note || null, user.sub]);
    audit({ userId: user.sub, projectId: project.id, action: 'status_change', entity: 'Issue', entityId: issue.id, before: { status: issue.status }, after: { status: nextStatus } });
    return issueWithPhotos(get(`SELECT * FROM issues WHERE id=?`, [issue.id]));
  });

  // آپلود تصویر قبل/بعد برای یک ایراد (بخش ۲۷ Before/After)
  router.post('/api/issues/:id/photos', async (req, res, ctx) => {
    const user = requireRole(req, 'ADMIN', 'SUPERVISOR', 'CONTRACTOR');
    const issue = get(`SELECT * FROM issues WHERE id=?`, [ctx.params.id]);
    if (!issue) throw notFound('ایراد یافت نشد');
    const project = get(`SELECT * FROM projects WHERE id=?`, [issue.project_id]);
    assertProjectAccess(req, project);
    const { base64, kind, description } = ctx.body;
    if (!base64) throw badRequest('تصویر (base64) الزامی است');
    if (!['before', 'after'].includes(kind)) throw badRequest('kind باید before یا after باشد');

    // این تابع کمکی از ماژول visits دوباره‌نویسی نمی‌شود؛ پیاده‌سازی مستقل سبک برای جلوگیری از وابستگی چرخه‌ای
    const fsMod = await import('node:fs');
    const pathMod = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = pathMod.dirname(fileURLToPath(import.meta.url));
    const uploadDir = pathMod.join(__dirname, '..', '..', 'uploads', project.id);
    if (!fsMod.existsSync(uploadDir)) fsMod.mkdirSync(uploadDir, { recursive: true });
    const match = /^data:(image\/\w+);base64,(.+)$/.exec(base64);
    const mime = match ? match[1] : 'image/jpeg';
    const raw = match ? match[2] : base64;
    const fileName = `${uuid()}.${mime.split('/')[1] || 'jpg'}`;
    fsMod.writeFileSync(pathMod.join(uploadDir, fileName), Buffer.from(raw, 'base64'));

    const id = uuid();
    run(
      `INSERT INTO photos (id, project_id, issue_id, kind, file_path, mime_type, description, uploaded_by,
        watermark_project, watermark_date)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, project.id, issue.id, kind, `uploads/${project.id}/${fileName}`, mime, description || null, user.sub,
        project.name, new Date().toISOString().slice(0, 10)]
    );
    audit({ userId: user.sub, projectId: project.id, action: 'create', entity: 'Photo', entityId: id, after: { issueId: issue.id, kind } });
    return get(`SELECT * FROM photos WHERE id=?`, [id]);
  });
}

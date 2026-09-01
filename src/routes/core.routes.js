import { get, run, all, tx } from '../db.js';
import {
  uuid, hashPassword, badRequest, notFound, forbidden,
  requireAuth, requireRole, audit, pick,
} from '../lib.js';

function publicUser(u) { if (!u) return null; const { password_hash, ...rest } = u; return rest; }

// آیا کاربر جاری اجازه‌ی دیدن این پروژه را دارد؟
function assertProjectAccess(req, project) {
  const user = requireAuth(req);
  if (user.role === 'ADMIN') return;
  if (user.role === 'OWNER' && project.owner_id === user.sub) return;
  if (user.role === 'CONTRACTOR' && project.contractor_id === user.sub) return;
  if (user.role === 'SUPERVISOR') {
    const link = get(`SELECT 1 FROM project_supervisors WHERE project_id=? AND user_id=?`, [project.id, user.sub]);
    if (link) return;
  }
  throw forbidden('شما به این پروژه دسترسی ندارید');
}

function projectWithTeam(p) {
  const supervisors = all(
    `SELECT ps.discipline, u.id as user_id, u.name FROM project_supervisors ps
     JOIN users u ON u.id = ps.user_id WHERE ps.project_id=?`, [p.id]
  );
  const owner = p.owner_id ? get(`SELECT id,name FROM users WHERE id=?`, [p.owner_id]) : null;
  const contractor = p.contractor_id ? get(`SELECT id,name FROM users WHERE id=?`, [p.contractor_id]) : null;
  return { ...p, owner, contractor, supervisors };
}

export function register(router) {
  // ---------------- Users ----------------
  router.get('/api/users', async (req) => {
    requireRole(req, 'ADMIN');
    return all(`SELECT * FROM users ORDER BY created_at DESC`).map(publicUser);
  });

  router.get('/api/users/:id', async (req, res, ctx) => {
    const user = requireAuth(req);
    if (user.role !== 'ADMIN' && user.sub !== ctx.params.id) throw forbidden();
    const row = get(`SELECT * FROM users WHERE id=?`, [ctx.params.id]);
    if (!row) throw notFound('کاربر یافت نشد');
    return publicUser(row);
  });

  // ---------------- Disciplines ----------------
  router.get('/api/disciplines', async () => all(`SELECT * FROM disciplines ORDER BY name`));

  router.post('/api/disciplines', async (req, res, ctx) => {
    requireRole(req, 'ADMIN');
    const { name, code } = ctx.body;
    if (!name || !code) throw badRequest('نام و کد رشته الزامی است');
    const id = uuid();
    run(`INSERT INTO disciplines (id, name, code) VALUES (?,?,?)`, [id, name, code]);
    return get(`SELECT * FROM disciplines WHERE id=?`, [id]);
  });

  // ---------------- Regulations (Regulation Library — بخش ۲۱) ----------------
  router.get('/api/regulations', async () => all(`SELECT * FROM regulations ORDER BY code`));

  router.post('/api/regulations', async (req, res, ctx) => {
    requireRole(req, 'ADMIN');
    const { code, title, version, issue_date, effective_date, document_url } = ctx.body;
    if (!code || !title) throw badRequest('کد و عنوان مبحث الزامی است');
    const id = uuid();
    run(
      `INSERT INTO regulations (id, code, title, version, issue_date, effective_date, document_url)
       VALUES (?,?,?,?,?,?,?)`,
      [id, code, title, version || null, issue_date || null, effective_date || null, document_url || null]
    );
    audit({ userId: req.user.sub, action: 'create', entity: 'Regulation', entityId: id, after: ctx.body });
    return get(`SELECT * FROM regulations WHERE id=?`, [id]);
  });

  router.patch('/api/regulations/:id', async (req, res, ctx) => {
    requireRole(req, 'ADMIN');
    const before = get(`SELECT * FROM regulations WHERE id=?`, [ctx.params.id]);
    if (!before) throw notFound('مبحث یافت نشد');
    const fields = pick(ctx.body, ['title', 'version', 'issue_date', 'effective_date', 'status', 'document_url']);
    const keys = Object.keys(fields);
    if (keys.length) {
      run(`UPDATE regulations SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`, [...keys.map(k => fields[k]), ctx.params.id]);
    }
    const after = get(`SELECT * FROM regulations WHERE id=?`, [ctx.params.id]);
    audit({ userId: req.user.sub, action: 'update', entity: 'Regulation', entityId: ctx.params.id, before, after });
    return after;
  });

  // ---------------- Projects ----------------
  router.get('/api/projects', async (req) => {
    const user = requireAuth(req);
    let rows;
    if (user.role === 'ADMIN') rows = all(`SELECT * FROM projects ORDER BY created_at DESC`);
    else if (user.role === 'OWNER') rows = all(`SELECT * FROM projects WHERE owner_id=? ORDER BY created_at DESC`, [user.sub]);
    else if (user.role === 'CONTRACTOR') rows = all(`SELECT * FROM projects WHERE contractor_id=? ORDER BY created_at DESC`, [user.sub]);
    else rows = all(
      `SELECT p.* FROM projects p JOIN project_supervisors ps ON ps.project_id=p.id
       WHERE ps.user_id=? GROUP BY p.id ORDER BY p.created_at DESC`, [user.sub]);
    return rows.map(projectWithTeam);
  });

  router.post('/api/projects', async (req, res, ctx) => {
    requireRole(req, 'ADMIN');
    const { name, code, address, city, building_type, structure_type, floors, owner_id, contractor_id, current_stage, supervisors } = ctx.body;
    if (!name || !code) throw badRequest('نام و کد پروژه الزامی است');
    const id = uuid();
    tx(() => {
      run(
        `INSERT INTO projects (id,name,code,address,city,building_type,structure_type,floors,owner_id,contractor_id,current_stage)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id, name, code, address || null, city || null, building_type || null, structure_type || null,
          floors || 0, owner_id || null, contractor_id || null, current_stage || 'تجهیز کارگاه']
      );
      for (const s of (supervisors || [])) {
        run(`INSERT INTO project_supervisors (id, project_id, user_id, discipline) VALUES (?,?,?,?)`,
          [uuid(), id, s.userId, s.discipline]);
      }
    });
    audit({ userId: req.user.sub, action: 'create', entity: 'Project', entityId: id, after: ctx.body });
    return projectWithTeam(get(`SELECT * FROM projects WHERE id=?`, [id]));
  });

  router.get('/api/projects/:id', async (req, res, ctx) => {
    const project = get(`SELECT * FROM projects WHERE id=?`, [ctx.params.id]);
    if (!project) throw notFound('پروژه یافت نشد');
    assertProjectAccess(req, project);
    return projectWithTeam(project);
  });

  router.patch('/api/projects/:id', async (req, res, ctx) => {
    requireRole(req, 'ADMIN', 'SUPERVISOR');
    const before = get(`SELECT * FROM projects WHERE id=?`, [ctx.params.id]);
    if (!before) throw notFound('پروژه یافت نشد');
    assertProjectAccess(req, before);
    const fields = pick(ctx.body, ['address', 'city', 'progress', 'current_stage', 'status']);
    const keys = Object.keys(fields);
    if (keys.length) run(`UPDATE projects SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`, [...keys.map(k => fields[k]), ctx.params.id]);
    const after = get(`SELECT * FROM projects WHERE id=?`, [ctx.params.id]);
    audit({ userId: req.user.sub, projectId: ctx.params.id, action: 'update', entity: 'Project', entityId: ctx.params.id, before, after });
    return projectWithTeam(after);
  });

  // ---------------- Minute templates (قالب‌های مینوت‌نامه ثابت — بخش ۳۰) ----------------
  router.get('/api/minute-templates', async () => all(`SELECT * FROM minute_templates ORDER BY name`));
}

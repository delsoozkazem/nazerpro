import { get, run, all, tx } from '../db.js';
import { uuid, badRequest, notFound, requireRole, requireAuth, audit } from '../lib.js';

function checklistWithItems(c) {
  const items = all(`SELECT * FROM checklist_items WHERE checklist_id=? ORDER BY order_index`, [c.id])
    .map(it => ({
      ...it,
      mandatory: !!it.mandatory,
      photo_required: !!it.photo_required,
      comment_required_on_fail: !!it.comment_required_on_fail,
      mip: !!it.mip,
      regulation_verified: !!it.regulation_verified,
    }));
  return { ...c, items };
}

export function register(router) {
  // GET /api/checklists?discipline=عمران&stage=فونداسیون
  // موتور هوشمند انتخاب Checklist (بخش ۱۶): بر اساس رشته و مرحله، چک‌لیست فعال را برمی‌گرداند
  router.get('/api/checklists', async (req, res, ctx) => {
    requireAuth(req);
    const { discipline, stage } = ctx.query;
    let rows;
    if (discipline && stage) {
      rows = all(`SELECT * FROM checklists WHERE discipline=? AND stage=? AND status='active' ORDER BY version DESC`, [discipline, stage]);
    } else if (discipline) {
      rows = all(`SELECT * FROM checklists WHERE discipline=? AND status='active' ORDER BY stage`, [discipline]);
    } else {
      rows = all(`SELECT * FROM checklists WHERE status='active' ORDER BY discipline, stage`);
    }
    return rows.map(checklistWithItems);
  });

  router.get('/api/checklists/:id', async (req, res, ctx) => {
    requireAuth(req);
    const c = get(`SELECT * FROM checklists WHERE id=?`, [ctx.params.id]);
    if (!c) throw notFound('چک‌لیست یافت نشد');
    return checklistWithItems(c);
  });

  // ایجاد چک‌لیست جدید توسط مدیر — هیچ شماره بند جعلی مجاز نیست:
  // اگر regulation_verified مشخص نشود، آیتم به‌صورت پیش‌فرض «نیازمند بررسی منبع» علامت می‌خورد (بخش ۱ و ۵۹)
  router.post('/api/checklists', async (req, res, ctx) => {
    requireRole(req, 'ADMIN');
    const { title, discipline, stage, regulation_id, version, items } = ctx.body;
    if (!title || !discipline || !stage) throw badRequest('عنوان، رشته و مرحله الزامی است');
    const id = uuid();
    tx(() => {
      run(`INSERT INTO checklists (id, title, discipline, stage, regulation_id, version) VALUES (?,?,?,?,?,?)`,
        [id, title, discipline, stage, regulation_id || null, version || 'v1.0']);
      (items || []).forEach((it, idx) => {
        run(
          `INSERT INTO checklist_items
           (id, checklist_id, title, description, mandatory, photo_required, comment_required_on_fail, mip,
            regulation_reference, regulation_note, regulation_verified, order_index)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [uuid(), id, it.title, it.description || null, it.mandatory ? 1 : 0, it.photoRequired ? 1 : 0,
            it.commentRequiredOnFail !== false ? 1 : 0, it.mip ? 1 : 0,
            it.regulationReference || null, it.regulationNote || (it.regulationVerified ? null : 'نیازمند بررسی منبع'),
            it.regulationVerified ? 1 : 0, idx]
        );
      });
    });
    audit({ userId: req.user.sub, action: 'create', entity: 'Checklist', entityId: id, after: { title, discipline, stage } });
    return checklistWithItems(get(`SELECT * FROM checklists WHERE id=?`, [id]));
  });

  router.post('/api/checklists/:id/items', async (req, res, ctx) => {
    requireRole(req, 'ADMIN');
    const checklist = get(`SELECT * FROM checklists WHERE id=?`, [ctx.params.id]);
    if (!checklist) throw notFound('چک‌لیست یافت نشد');
    const it = ctx.body;
    if (!it.title) throw badRequest('عنوان آیتم الزامی است');
    const maxOrder = get(`SELECT MAX(order_index) as m FROM checklist_items WHERE checklist_id=?`, [ctx.params.id]);
    const id = uuid();
    run(
      `INSERT INTO checklist_items
       (id, checklist_id, title, description, mandatory, photo_required, comment_required_on_fail, mip,
        regulation_reference, regulation_note, regulation_verified, order_index)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, ctx.params.id, it.title, it.description || null, it.mandatory ? 1 : 0, it.photoRequired ? 1 : 0,
        it.commentRequiredOnFail !== false ? 1 : 0, it.mip ? 1 : 0,
        it.regulationReference || null, it.regulationNote || (it.regulationVerified ? null : 'نیازمند بررسی منبع'),
        it.regulationVerified ? 1 : 0, (maxOrder?.m ?? -1) + 1]
    );
    audit({ userId: req.user.sub, action: 'create', entity: 'ChecklistItem', entityId: id, after: it });
    return get(`SELECT * FROM checklist_items WHERE id=?`, [id]);
  });

  router.patch('/api/checklists/items/:id', async (req, res, ctx) => {
    requireRole(req, 'ADMIN');
    const before = get(`SELECT * FROM checklist_items WHERE id=?`, [ctx.params.id]);
    if (!before) throw notFound('آیتم یافت نشد');
    const b = ctx.body;
    const map = {
      title: b.title, description: b.description,
      mandatory: b.mandatory !== undefined ? (b.mandatory ? 1 : 0) : undefined,
      photo_required: b.photoRequired !== undefined ? (b.photoRequired ? 1 : 0) : undefined,
      regulation_reference: b.regulationReference, regulation_note: b.regulationNote,
      regulation_verified: b.regulationVerified !== undefined ? (b.regulationVerified ? 1 : 0) : undefined,
      order_index: b.orderIndex,
    };
    const keys = Object.keys(map).filter(k => map[k] !== undefined);
    if (keys.length) run(`UPDATE checklist_items SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`, [...keys.map(k => map[k]), ctx.params.id]);
    const after = get(`SELECT * FROM checklist_items WHERE id=?`, [ctx.params.id]);
    audit({ userId: req.user.sub, action: 'update', entity: 'ChecklistItem', entityId: ctx.params.id, before, after });
    return after;
  });

  router.delete('/api/checklists/items/:id', async (req, res, ctx) => {
    requireRole(req, 'ADMIN');
    const before = get(`SELECT * FROM checklist_items WHERE id=?`, [ctx.params.id]);
    if (!before) throw notFound('آیتم یافت نشد');
    run(`DELETE FROM checklist_items WHERE id=?`, [ctx.params.id]);
    audit({ userId: req.user.sub, action: 'delete', entity: 'ChecklistItem', entityId: ctx.params.id, before });
    return { ok: true };
  });

  // نسخه‌بندی چک‌لیست (بخش ۵۱): کپی کامل با شماره نسخه جدید، بدون تغییر گزارش‌های قدیمی
  router.post('/api/checklists/:id/version', async (req, res, ctx) => {
    requireRole(req, 'ADMIN');
    const src = get(`SELECT * FROM checklists WHERE id=?`, [ctx.params.id]);
    if (!src) throw notFound('چک‌لیست یافت نشد');
    const newVersion = ctx.body.version || `v${(parseFloat(src.version.replace('v', '')) + 1).toFixed(1)}`;
    const newId = uuid();
    tx(() => {
      run(`INSERT INTO checklists (id, title, discipline, stage, regulation_id, version, status) VALUES (?,?,?,?,?,?, 'active')`,
        [newId, src.title, src.discipline, src.stage, src.regulation_id, newVersion]);
      run(`UPDATE checklists SET status='archived' WHERE id=?`, [src.id]);
      const items = all(`SELECT * FROM checklist_items WHERE checklist_id=? ORDER BY order_index`, [src.id]);
      for (const it of items) {
        run(
          `INSERT INTO checklist_items (id, checklist_id, title, description, mandatory, photo_required,
            comment_required_on_fail, mip, regulation_reference, regulation_note, regulation_verified, order_index)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [uuid(), newId, it.title, it.description, it.mandatory, it.photo_required, it.comment_required_on_fail,
            it.mip, it.regulation_reference, it.regulation_note, it.regulation_verified, it.order_index]
        );
      }
    });
    audit({ userId: req.user.sub, action: 'create', entity: 'ChecklistVersion', entityId: newId, before: { from: src.id, fromVersion: src.version }, after: { newVersion } });
    return checklistWithItems(get(`SELECT * FROM checklists WHERE id=?`, [newId]));
  });
}

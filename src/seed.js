// src/seed.js — اجرا: node src/seed.js
import { db, run, get, all, tx } from './db.js';
import { uuid, hashPassword } from './lib.js';

function already(table) { return get(`SELECT COUNT(*) c FROM ${table}`).c > 0; }

console.log('🌱 در حال بررسی و آماده‌سازی داده نمونه...');

tx(() => {
  // ---------------- Disciplines ----------------
  const DISCIPLINES = [
    { name: 'عمران', code: 'CIVIL' },
    { name: 'معماری', code: 'ARCH' },
    { name: 'برق', code: 'ELEC' },
    { name: 'مکانیک', code: 'MECH' },
  ];
  const disciplineId = {};
  for (const d of DISCIPLINES) {
    let row = get(`SELECT * FROM disciplines WHERE code=?`, [d.code]);
    if (!row) { const id = uuid(); run(`INSERT INTO disciplines (id,name,code) VALUES (?,?,?)`, [id, d.name, d.code]); row = { id, ...d }; }
    disciplineId[d.name] = row.id;
  }

  // ---------------- Users ----------------
  function ensureUser(u) {
    let row = get(`SELECT * FROM users WHERE username=?`, [u.username]);
    if (row) return row;
    const id = uuid();
    run(`INSERT INTO users (id,name,username,password_hash,role,discipline,phone,email) VALUES (?,?,?,?,?,?,?,?)`,
      [id, u.name, u.username, hashPassword(u.password), u.role, u.discipline || null, u.phone || null, u.email || null]);
    return get(`SELECT * FROM users WHERE id=?`, [id]);
  }

  const admin = ensureUser({ name: 'مدیر سیستم', username: 'admin', password: 'admin123', role: 'ADMIN' });
  const supCivil = ensureUser({ name: 'مهندس رضایی', username: 'rezaei', password: 'pass123', role: 'SUPERVISOR', discipline: 'عمران', phone: '0912xxxxxxx' });
  const supArch = ensureUser({ name: 'مهندس صادقی', username: 'sadeghi', password: 'pass123', role: 'SUPERVISOR', discipline: 'معماری' });
  const supElec = ensureUser({ name: 'مهندس کریمی', username: 'karimi', password: 'pass123', role: 'SUPERVISOR', discipline: 'برق' });
  const supMech = ensureUser({ name: 'مهندس نوری', username: 'noori', password: 'pass123', role: 'SUPERVISOR', discipline: 'مکانیک' });
  const contractor1 = ensureUser({ name: 'شرکت سازه پویا', username: 'sazeh_pouya', password: 'pass123', role: 'CONTRACTOR' });
  const contractor2 = ensureUser({ name: 'مهندسین مشاور ساخت‌آور', username: 'sakhtavar', password: 'pass123', role: 'CONTRACTOR' });
  const contractor3 = ensureUser({ name: 'شرکت بنای البرز', username: 'bana_alborz', password: 'pass123', role: 'CONTRACTOR' });
  const owner1 = ensureUser({ name: 'آقای احمدی', username: 'ahmadi', password: 'pass123', role: 'OWNER' });
  const owner2 = ensureUser({ name: 'شرکت سرمایه‌گذاری سپهر', username: 'sepehr_inv', password: 'pass123', role: 'OWNER' });
  const owner3 = ensureUser({ name: 'خانم موسوی', username: 'mousavi', password: 'pass123', role: 'OWNER' });

  // ---------------- Regulations ----------------
  function ensureRegulation(r) {
    let row = get(`SELECT * FROM regulations WHERE code=?`, [r.code]);
    if (row) return row;
    const id = uuid();
    run(`INSERT INTO regulations (id,code,title,version,issue_date,status) VALUES (?,?,?,?,?,?)`,
      [id, r.code, r.title, r.version, r.issue_date, 'معتبر']);
    return get(`SELECT * FROM regulations WHERE id=?`, [id]);
  }
  const reg9 = ensureRegulation({ code: 'مبحث ۹', title: 'طرح و اجرای ساختمان‌های بتن‌آرمه', version: 'ویرایش ۱۴۰۰', issue_date: '1400-01-01' });
  const reg13 = ensureRegulation({ code: 'مبحث ۱۳', title: 'طرح و اجرای تأسیسات برقی ساختمان‌ها', version: 'ویرایش ۱۳۹۶', issue_date: '1396-01-01' });
  ensureRegulation({ code: 'مبحث ۳', title: 'حفاظت ساختمان‌ها در برابر حریق', version: 'ویرایش ۱۴۰۱', issue_date: '1401-01-01' });
  ensureRegulation({ code: 'مبحث ۱۹', title: 'صرفه‌جویی در مصرف انرژی', version: 'ویرایش ۱۳۹۹', issue_date: '1399-01-01' });
  ensureRegulation({ code: 'استاندارد ۲۸۰۰', title: 'آیین‌نامه طراحی ساختمان‌ها در برابر زلزله', version: 'ویرایش ۴', issue_date: '1392-01-01' });

  // ---------------- Checklist templates ----------------
  function ensureChecklist(c) {
    let row = get(`SELECT * FROM checklists WHERE discipline=? AND stage=? AND status='active'`, [c.discipline, c.stage]);
    if (row) return row;
    const id = uuid();
    run(`INSERT INTO checklists (id,title,discipline,stage,regulation_id,version) VALUES (?,?,?,?,?,?)`,
      [id, c.title, c.discipline, c.stage, c.regulationId || null, c.version || 'v1.0']);
    c.items.forEach((it, idx) => {
      run(
        `INSERT INTO checklist_items
         (id,checklist_id,title,description,mandatory,photo_required,comment_required_on_fail,mip,
          regulation_reference,regulation_note,regulation_verified,order_index)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [uuid(), id, it.title, it.description || null, it.mandatory ? 1 : 0, it.photoRequired ? 1 : 0, 1,
          it.mip ? 1 : 0, it.reg, it.verified ? null : 'نیازمند بررسی منبع', it.verified ? 1 : 0, idx]
      );
    });
    return get(`SELECT * FROM checklists WHERE id=?`, [id]);
  }

  ensureChecklist({
    title: 'چک‌لیست فونداسیون — ناظر عمران', discipline: 'عمران', stage: 'فونداسیون', regulationId: reg9.id, version: 'v1.2',
    items: [
      { title: 'کنترل ابعاد و محور فونداسیون مطابق نقشه', mandatory: true, reg: 'مبحث ۹', verified: true },
      { title: 'کنترل قطر، تعداد و فاصله میلگردهای اصلی و تقویتی', mandatory: true, photoRequired: true, reg: 'مبحث ۹' },
      { title: 'کنترل کاور بتن (فاصله میلگرد تا قالب)', mandatory: true, photoRequired: true, reg: 'مبحث ۹' },
      { title: 'کنترل اجرای بتن مگر', mandatory: true, reg: 'مبحث ۹' },
      { title: 'کنترل قالب‌بندی و تمیزی محل بتن‌ریزی', mandatory: true, reg: 'مبحث ۵ / ۹' },
      { title: 'تأیید آماده بودن شرایط بتن‌ریزی', mandatory: true, photoRequired: true, mip: true, reg: 'مبحث ۹', verified: true },
      { title: 'کنترل مصالح بتن (نوع سیمان، عیار، اسلامپ)', mandatory: false, reg: 'مبحث ۵' },
      { title: 'کنترل شرایط عمل‌آوری بتن پس از بتن‌ریزی', mandatory: false, reg: 'مبحث ۹' },
    ],
  });

  ensureChecklist({
    title: 'چک‌لیست تأسیسات برقی — ناظر برق', discipline: 'برق', stage: 'تاسیسات', regulationId: reg13.id, version: 'v1.0',
    items: [
      { title: 'کنترل محل نصب و دسترسی تابلوهای برق اصلی و فرعی', mandatory: true, photoRequired: true, reg: 'مبحث ۱۳', verified: true },
      { title: 'کنترل سیستم اتصال زمین و هم‌بندی تجهیزات فلزی', mandatory: true, photoRequired: true, reg: 'مبحث ۱۳' },
      { title: 'کنترل تفکیک مدارها، برچسب‌گذاری و شماره‌گذاری', mandatory: true, reg: 'مبحث ۱۳' },
      { title: 'کنترل مسیر و سایز لوله‌گذاری کابل‌ها', mandatory: false, reg: 'مبحث ۱۳' },
      { title: 'کنترل روشنایی اضطراری راه‌پله و مشاعات', mandatory: true, reg: 'مبحث ۳ / ۱۳' },
      { title: 'کنترل تجهیزات و کابل‌کشی سیستم اعلام حریق', mandatory: true, photoRequired: true, reg: 'مبحث ۳' },
    ],
  });

  ensureChecklist({
    title: 'چک‌لیست نازک‌کاری — ناظر معماری', discipline: 'معماری', stage: 'نازک‌کاری', version: 'v1.1',
    items: [
      { title: 'کنترل شیب‌بندی و آب‌بندی کف سرویس‌ها و تراس‌ها', mandatory: true, photoRequired: true, reg: 'مبحث ۴' },
      { title: 'کنترل کیفیت اجرای کاشی و سرامیک و درزبندی', mandatory: false, reg: 'مبحث ۴ / ۵' },
      { title: 'کنترل عایق حرارتی و رطوبتی پشت‌بام', mandatory: true, photoRequired: true, reg: 'مبحث ۱۸ / ۱۹', verified: true },
      { title: 'کنترل تطابق نازک‌کاری با نقشه‌های معماری مصوب', mandatory: false, reg: '—' },
    ],
  });

  // ---------------- Minute templates (بخش ۳۰) ----------------
  function ensureTemplate(t) {
    let row = get(`SELECT * FROM minute_templates WHERE code=?`, [t.code]);
    if (row) return;
    run(`INSERT INTO minute_templates (id,name,code,body_html) VALUES (?,?,?,?)`, [uuid(), t.name, t.code, t.body]);
  }
  ensureTemplate({
    code: 'VISIT_MINUTE', name: 'صورتجلسه بازدید',
    body: `<h2>صورتجلسه بازدید</h2><p>پروژه: {{PROJECT_NAME}} ({{PROJECT_CODE}})</p><p>تاریخ: {{DATE}} — شماره بازدید: {{VISIT_NUMBER}}</p><p>مرحله فعلی: {{CURRENT_STAGE}}</p><p>مالک: {{OWNER_NAME}} — مجری: {{CONTRACTOR_NAME}} — ناظر: {{SUPERVISOR_NAME}}</p>`,
  });
  ensureTemplate({
    code: 'DEFECT_NOTICE', name: 'اخطار نقص اجرایی',
    body: `<h2>اخطار نقص اجرایی</h2><p>پروژه: {{PROJECT_NAME}} ({{PROJECT_CODE}}) — تاریخ: {{DATE}}</p><p>خطاب به مجری: {{CONTRACTOR_NAME}}</p><p>لطفاً نسبت به رفع نواقص اعلام‌شده در چک‌لیست بازدید شماره {{VISIT_NUMBER}} اقدام نمایید.</p>`,
  });
  ensureTemplate({
    code: 'CONTRACTOR_ABSENT', name: 'عدم حضور مجری',
    body: `<h2>گزارش عدم حضور مجری</h2><p>پروژه: {{PROJECT_NAME}} — تاریخ: {{DATE}}</p><p>مجری ({{CONTRACTOR_NAME}}) در بازدید شماره {{VISIT_NUMBER}} حضور نداشته است.</p>`,
  });
  ensureTemplate({
    code: 'OWNER_ABSENT', name: 'عدم حضور مالک',
    body: `<h2>گزارش عدم حضور مالک</h2><p>پروژه: {{PROJECT_NAME}} — تاریخ: {{DATE}}</p><p>مالک ({{OWNER_NAME}}) در بازدید شماره {{VISIT_NUMBER}} حضور نداشته است.</p>`,
  });
  ensureTemplate({
    code: 'STAGE_APPROVAL', name: 'تأیید مرحله',
    body: `<h2>تأیید مرحله ساخت</h2><p>پروژه: {{PROJECT_NAME}} — مرحله: {{CURRENT_STAGE}} — تاریخ: {{DATE}}</p><p>ناظر: {{SUPERVISOR_NAME}} این مرحله را مورد تأیید قرار داد.</p>`,
  });

  // ---------------- Projects ----------------
  function ensureProject(p) {
    let row = get(`SELECT * FROM projects WHERE code=?`, [p.code]);
    if (row) return row;
    const id = uuid();
    run(
      `INSERT INTO projects (id,name,code,address,city,building_type,structure_type,floors,owner_id,contractor_id,status,progress,current_stage)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, p.name, p.code, p.address || null, p.city, p.building_type, p.structure_type, p.floors,
        p.owner_id, p.contractor_id, 'active', p.progress, p.current_stage]
    );
    for (const s of p.supervisors) {
      run(`INSERT INTO project_supervisors (id,project_id,user_id,discipline) VALUES (?,?,?,?)`, [uuid(), id, s.userId, s.discipline]);
    }
    return get(`SELECT * FROM projects WHERE id=?`, [id]);
  }

  const p1 = ensureProject({
    name: 'پروژه مسکونی آفتاب', code: 'AFT-1402-01', city: 'تهران', building_type: 'مسکونی', structure_type: 'بتنی', floors: 5,
    owner_id: owner1.id, contractor_id: contractor1.id, progress: 62, current_stage: 'اسکلت',
    supervisors: [
      { userId: supCivil.id, discipline: 'عمران' }, { userId: supArch.id, discipline: 'معماری' },
      { userId: supElec.id, discipline: 'برق' }, { userId: supMech.id, discipline: 'مکانیک' },
    ],
  });
  const p2 = ensureProject({
    name: 'مجتمع تجاری سپهر', code: 'SPR-1402-02', city: 'اصفهان', building_type: 'تجاری', structure_type: 'فولادی', floors: 8,
    owner_id: owner2.id, contractor_id: contractor2.id, progress: 74, current_stage: 'تاسیسات',
    supervisors: [
      { userId: supCivil.id, discipline: 'عمران' }, { userId: supArch.id, discipline: 'معماری' },
      { userId: supElec.id, discipline: 'برق' }, { userId: supMech.id, discipline: 'مکانیک' },
    ],
  });
  const p3 = ensureProject({
    name: 'ویلایی البرز', code: 'ALB-1402-03', city: 'کرج', building_type: 'ویلایی', structure_type: 'بتنی', floors: 2,
    owner_id: owner3.id, contractor_id: contractor3.id, progress: 81, current_stage: 'نازک‌کاری',
    supervisors: [{ userId: supCivil.id, discipline: 'عمران' }, { userId: supArch.id, discipline: 'معماری' }],
  });

  // ---------------- Sample issues (بدون بازدید مرتبط — برای نمایش اولیه) ----------------
  function ensureIssue(i) {
    const exists = get(`SELECT id FROM issues WHERE project_id=? AND title=?`, [i.project_id, i.title]);
    if (exists) return;
    const id = uuid();
    run(
      `INSERT INTO issues (id,project_id,discipline,title,description,severity,status,due_date,created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, i.project_id, i.discipline, i.title, i.description, i.severity, i.status, i.due, supCivil.id]
    );
    run(`INSERT INTO issue_status_history (id,issue_id,from_status,to_status,changed_by) VALUES (?,?,?,?,?)`,
      [uuid(), id, null, i.status, supCivil.id]);
  }

  ensureIssue({ project_id: p1.id, discipline: 'عمران', title: 'عدم رعایت کاور بتن در آرماتوربندی ستون محور B3', description: 'فاصله میلگرد تا قالب کمتر از حد الزامی اجرا شده است.', severity: 'بحرانی', status: 'اعلام به مجری', due: '1403-05-20' });
  ensureIssue({ project_id: p1.id, discipline: 'برق', title: 'عدم اتصال زمین تابلوی فرعی طبقه سوم', description: 'هادی حفاظتی تابلو به سیستم ارتینگ مشترک متصل نشده است.', severity: 'متوسط', status: 'در حال اصلاح', due: '1403-05-18' });
  ensureIssue({ project_id: p2.id, discipline: 'مکانیک', title: 'عدم عایق‌کاری لوله‌های آب گرم موتورخانه', description: 'بخشی از لوله‌های رفت موتورخانه فاقد عایق حرارتی است.', severity: 'کم', status: 'تایید ناظر', due: '1403-05-15' });
  ensureIssue({ project_id: p3.id, discipline: 'معماری', title: 'عدم اجرای شیب‌بندی صحیح کف حمام طبقه دوم', description: 'شیب کف به سمت کفشوی اصلاح و مجدداً کنترل شد.', severity: 'متوسط', status: 'بسته شده', due: '1403-05-05' });
  ensureIssue({ project_id: p2.id, discipline: 'عمران', title: 'عدم مطابقت جوش اتصال تیر به ستون با نقشه', description: 'کیفیت ظاهری جوش در اتصال محور C4 نیازمند بررسی مجدد است.', severity: 'بحرانی', status: 'ثبت شده', due: '1403-05-22' });
});

console.log('✅ داده نمونه با موفقیت آماده شد.');
console.log('');
console.log('کاربران نمونه (username / password):');
console.log('  admin / admin123        (مدیر سیستم)');
console.log('  rezaei / pass123        (ناظر عمران)');
console.log('  sadeghi / pass123       (ناظر معماری)');
console.log('  karimi / pass123        (ناظر برق)');
console.log('  noori / pass123         (ناظر مکانیک)');
console.log('  sazeh_pouya / pass123   (مجری - پروژه آفتاب)');
console.log('  ahmadi / pass123        (مالک - پروژه آفتاب)');

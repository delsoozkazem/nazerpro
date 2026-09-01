import { get, run, all } from '../db.js';
import {
  uuid, hashPassword, verifyPassword, signJWT, verifyJWT, hashToken,
  badRequest, unauthorized, requireRole, ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL, audit,
} from '../lib.js';

function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

function issueTokens(user) {
  const accessToken = signJWT({ sub: user.id, role: user.role, discipline: user.discipline }, ACCESS_TOKEN_TTL);
  const refreshToken = signJWT({ sub: user.id, type: 'refresh' }, REFRESH_TOKEN_TTL);
  run(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?,?,?,datetime('now','+30 days'))`,
    [uuid(), user.id, hashToken(refreshToken)]
  );
  return { accessToken, refreshToken };
}

export function register(router) {
  // POST /api/auth/login
  router.post('/api/auth/login', async (req, res, ctx) => {
    const { username, password } = ctx.body;
    if (!username || !password) throw badRequest('نام کاربری و رمز عبور الزامی است');
    const user = get(`SELECT * FROM users WHERE username = ?`, [username]);
    if (!user || user.status !== 'active' || !verifyPassword(password, user.password_hash)) {
      throw unauthorized('نام کاربری یا رمز عبور نادرست است');
    }
    const tokens = issueTokens(user);
    return { user: publicUser(user), ...tokens };
  });

  // POST /api/auth/refresh
  router.post('/api/auth/refresh', async (req, res, ctx) => {
    const { refreshToken } = ctx.body;
    if (!refreshToken) throw badRequest('refreshToken الزامی است');
    let payload;
    try { payload = verifyJWT(refreshToken); } catch { throw unauthorized('توکن تازه‌سازی نامعتبر است'); }
    if (payload.type !== 'refresh') throw unauthorized('نوع توکن نامعتبر است');
    const row = get(
      `SELECT * FROM refresh_tokens WHERE user_id=? AND token_hash=? AND revoked=0 AND expires_at > datetime('now')`,
      [payload.sub, hashToken(refreshToken)]
    );
    if (!row) throw unauthorized('توکن تازه‌سازی نامعتبر یا منقضی شده است');
    const user = get(`SELECT * FROM users WHERE id=?`, [payload.sub]);
    if (!user) throw unauthorized();
    const accessToken = signJWT({ sub: user.id, role: user.role, discipline: user.discipline }, ACCESS_TOKEN_TTL);
    return { accessToken };
  });

  // POST /api/auth/logout
  router.post('/api/auth/logout', async (req, res, ctx) => {
    const { refreshToken } = ctx.body;
    if (refreshToken) run(`UPDATE refresh_tokens SET revoked=1 WHERE token_hash=?`, [hashToken(refreshToken)]);
    return { ok: true };
  });

  // GET /api/auth/me
  router.get('/api/auth/me', async (req) => {
    const user = get(`SELECT * FROM users WHERE id=?`, [req.user.sub]);
    if (!user) throw unauthorized();
    return { user: publicUser(user) };
  });

  // POST /api/auth/register — فقط ادمین می‌تواند کاربر جدید (ناظر/مجری/مالک) بسازد
  router.post('/api/auth/register', async (req, res, ctx) => {
    requireRole(req, 'ADMIN');
    const { name, username, password, role, discipline, phone, email } = ctx.body;
    if (!name || !username || !password || !role) throw badRequest('نام، نام‌کاربری، رمز عبور و نقش الزامی است');
    if (!['ADMIN', 'SUPERVISOR', 'CONTRACTOR', 'OWNER'].includes(role)) throw badRequest('نقش نامعتبر است');
    const exists = get(`SELECT id FROM users WHERE username=?`, [username]);
    if (exists) throw badRequest('این نام کاربری قبلاً ثبت شده است');
    const id = uuid();
    run(
      `INSERT INTO users (id, name, username, password_hash, role, discipline, phone, email) VALUES (?,?,?,?,?,?,?,?)`,
      [id, name, username, hashPassword(password), role, discipline || null, phone || null, email || null]
    );
    audit({ userId: req.user.sub, action: 'create', entity: 'User', entityId: id, after: { name, username, role } });
    return publicUser(get(`SELECT * FROM users WHERE id=?`, [id]));
  });
}

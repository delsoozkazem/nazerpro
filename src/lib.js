// src/lib.js
import crypto from 'node:crypto';
import { run } from './db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production-please';
export const ACCESS_TOKEN_TTL = 15 * 60;            // 15 دقیقه
export const REFRESH_TOKEN_TTL = 30 * 24 * 3600;    // 30 روز

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'احراز هویت نامعتبر است') => new HttpError(401, msg);
export const forbidden = (msg = 'دسترسی مجاز نیست') => new HttpError(403, msg);
export const notFound = (msg = 'مورد یافت نشد') => new HttpError(404, msg);

export const uuid = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// رمز عبور — scrypt (بدون وابستگی خارجی)
// ---------------------------------------------------------------------------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// JWT سبک (HS256) — بدون کتابخانه خارجی
// ---------------------------------------------------------------------------
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (str) => Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function signJWT(payload, ttlSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest();
  return `${data}.${b64url(sig)}`;
}
export function verifyJWT(token) {
  if (!token) throw unauthorized('توکن ارسال نشده است');
  const parts = token.split('.');
  if (parts.length !== 3) throw unauthorized('قالب توکن نامعتبر است');
  const [h, p, s] = parts;
  const expected = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest());
  if (expected !== s) throw unauthorized('امضای توکن نامعتبر است');
  const payload = JSON.parse(fromB64url(p).toString());
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) throw unauthorized('توکن منقضی شده است');
  return payload;
}
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------
export function requireAuth(req) {
  if (!req.user) throw unauthorized();
  return req.user;
}
export function requireRole(req, ...roles) {
  const user = requireAuth(req);
  if (!roles.includes(user.role)) throw forbidden(`این عملیات فقط برای نقش‌های [${roles.join(', ')}] مجاز است`);
  return user;
}

// ---------------------------------------------------------------------------
// Audit log — طبق بخش ۴۷ سند طراحی: هر عملیات مهم با کاربر/زمان/مقدار قبل و بعد ثبت شود
// ---------------------------------------------------------------------------
export function audit({ userId, projectId, action, entity, entityId, before, after }) {
  run(
    `INSERT INTO audit_logs (id, user_id, project_id, action, entity, entity_id, before_json, after_json)
     VALUES (?,?,?,?,?,?,?,?)`,
    [uuid(), userId || null, projectId || null, action, entity, entityId || null,
      before !== undefined ? JSON.stringify(before) : null,
      after !== undefined ? JSON.stringify(after) : null]
  );
}

// ---------------------------------------------------------------------------
// پاسخ‌های HTTP
// ---------------------------------------------------------------------------
export function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    const MAX = 15 * 1024 * 1024; // 15MB (کافی برای تصاویر base64 نمونه)
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX) { reject(badRequest('حجم درخواست بیش از حد مجاز است')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(badRequest('بدنه درخواست JSON معتبر نیست')); }
    });
    req.on('error', reject);
  });
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export function parseQuery(url) {
  return Object.fromEntries(url.searchParams.entries());
}

// src/server.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from './router.js';
import { sendJSON, readJSONBody, verifyJWT, HttpError, parseQuery } from './lib.js';

import * as authRoutes from './routes/auth.routes.js';
import * as coreRoutes from './routes/core.routes.js';
import * as checklistRoutes from './routes/checklists.routes.js';
import * as visitRoutes from './routes/visits.routes.js';
import * as issueRoutes from './routes/issues.routes.js';
import * as reportRoutes from './routes/reports.routes.js';
import * as miscRoutes from './routes/misc.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INDEX_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'));

const router = new Router();
[authRoutes, coreRoutes, checklistRoutes, visitRoutes, issueRoutes, reportRoutes, miscRoutes]
  .forEach(mod => mod.register(router));

// مسیرهایی که بدون توکن قابل دسترسی‌اند
const PUBLIC_PATHS = [
  { method: 'POST', path: '/api/auth/login' },
  { method: 'POST', path: '/api/auth/refresh' },
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/photos' }, // فایل تصویر عمومی است (پیش‌نمایش)؛ متادیتا نیاز به احراز دارد
];

router.get('/api/health', async () => ({ status: 'ok', service: 'nazerpro-backend', time: new Date().toISOString() }));

const PORT = Number(process.env.PORT || 4000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS — برای اجازه به فرانت‌اند (پروتوتایپ React/HTML) که روی origin دیگری اجرا می‌شود
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    // فرانت‌اند (SPA) — هر مسیر GET غیر از /api/* همان index.html را برمی‌گرداند
    if (req.method === 'GET' && !pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': INDEX_HTML.length });
      res.end(INDEX_HTML);
      return;
    }

    // پخش مستقیم فایل تصویر بدون نیاز به توکن (پیش‌نمایش سریع در UI)
    const match = router.match(req.method, pathname);
    if (!match) return sendJSON(res, 404, { error: 'مسیر یافت نشد', path: pathname });

    // احراز هویت — همه مسیرها به‌جز موارد PUBLIC_PATHS و فایل تصویر نیاز به Authorization: Bearer <token> دارند
    const isPublic = PUBLIC_PATHS.some(p => p.method === req.method && pathname.startsWith(p.path)) ||
      /^\/api\/photos\/[^/]+\/file$/.test(pathname);

    let user = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try { user = verifyJWT(authHeader.slice(7)); } catch (e) { if (!isPublic) throw e; }
    } else if (!isPublic) {
      throw new HttpError(401, 'هدر Authorization با توکن Bearer الزامی است');
    }
    req.user = user;

    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readJSONBody(req) : {};
    const ctx = { params: match.params, query: parseQuery(url), body };

    const result = await match.handler(req, res, ctx);
    if (result === undefined && res.writableEnded) return; // هندلر خودش پاسخ را ارسال کرده (مثل فایل تصویر)
    return sendJSON(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) return sendJSON(res, err.status, { error: err.message, details: err.details });
    console.error('❌ خطای غیرمنتظره سرور:', err);
    return sendJSON(res, 500, { error: 'خطای داخلی سرور' });
  }
});

server.listen(PORT, () => {
  console.log(`✅ NazerPro backend روی http://localhost:${PORT} در حال اجراست`);
  console.log(`   سلامت سرویس: GET http://localhost:${PORT}/api/health`);
});

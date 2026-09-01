import { get, all } from '../db.js';
import { requireAuth, requireRole, badRequest } from '../lib.js';

function scopedProjectIds(user) {
  if (user.role === 'ADMIN') return null; // یعنی بدون محدودیت
  if (user.role === 'OWNER') return all(`SELECT id FROM projects WHERE owner_id=?`, [user.sub]).map(r => r.id);
  if (user.role === 'CONTRACTOR') return all(`SELECT id FROM projects WHERE contractor_id=?`, [user.sub]).map(r => r.id);
  return all(`SELECT project_id as id FROM project_supervisors WHERE user_id=?`, [user.sub]).map(r => r.id);
}

export function register(router) {
  // ---------------- Search (بخش ۴۱) ----------------
  router.get('/api/search', async (req, res, ctx) => {
    const user = requireAuth(req);
    const q = (ctx.query.q || '').trim();
    if (!q) throw badRequest('پارامتر q الزامی است');
    const like = `%${q}%`;
    const ids = scopedProjectIds(user);
    const scopeSQL = ids === null ? '' : `AND project_id IN (${ids.length ? ids.map(() => '?').join(',') : "'-'"})`;
    const scopeParams = ids === null ? [] : ids;

    const projects = all(
      `SELECT id, name, code, 'project' as type FROM projects WHERE (name LIKE ? OR code LIKE ?) ${ids === null ? '' : `AND id IN (${ids.length ? ids.map(() => '?').join(',') : "'-'"})`}`,
      ids === null ? [like, like] : [like, like, ...scopeParams]
    );
    const issues = all(
      `SELECT id, title, 'issue' as type FROM issues WHERE title LIKE ? ${scopeSQL}`,
      [like, ...scopeParams]
    );
    const minutesRows = all(
      `SELECT id, number as title, 'minute' as type FROM minutes WHERE number LIKE ? ${scopeSQL}`,
      [like, ...scopeParams]
    );
    return { query: q, results: [...projects, ...issues, ...minutesRows] };
  });

  // ---------------- Analytics / Dashboard (بخش ۳۵، ۴۲) ----------------
  router.get('/api/analytics/overview', async (req) => {
    const user = requireAuth(req);
    const ids = scopedProjectIds(user);
    const scopeSQL = (col) => ids === null ? '' : `WHERE ${col} IN (${ids.length ? ids.map(() => '?').join(',') : "'-'"})`;
    const p = (ids === null ? [] : ids);

    const activeProjects = get(`SELECT COUNT(*) c FROM projects ${scopeSQL('id')} ${ids === null ? "WHERE status='active'" : "AND status='active'"}`, p).c;
    const completedProjects = get(`SELECT COUNT(*) c FROM projects ${scopeSQL('id')} ${ids === null ? "WHERE status='completed'" : "AND status='completed'"}`, p).c;
    const todayVisits = get(`SELECT COUNT(*) c FROM visits ${scopeSQL('project_id')} ${ids === null ? "WHERE date = date('now')" : "AND date = date('now')"}`, p).c;
    const openIssues = get(`SELECT COUNT(*) c FROM issues ${scopeSQL('project_id')} ${ids === null ? "WHERE status != 'بسته شده'" : "AND status != 'بسته شده'"}`, p).c;
    const criticalIssues = get(`SELECT COUNT(*) c FROM issues ${scopeSQL('project_id')} ${ids === null ? "WHERE severity='بحرانی' AND status != 'بسته شده'" : "AND severity='بحرانی' AND status != 'بسته شده'"}`, p).c;
    const readyReports = get(`SELECT COUNT(*) c FROM reports ${scopeSQL('project_id')} ${ids === null ? "WHERE status='final'" : "AND status='final'"}`, p).c;
    const recentMinutes = get(`SELECT COUNT(*) c FROM minutes ${scopeSQL('project_id')} ${ids === null ? "WHERE date >= date('now','-7 day')" : "AND date >= date('now','-7 day')"}`, p).c;

    return { activeProjects, completedProjects, todayVisits, incompleteChecklists: 0, openIssues, criticalIssues, readyReports, recentMinutes };
  });

  router.get('/api/analytics/projects/:id', async (req, res, ctx) => {
    requireAuth(req);
    const project = get(`SELECT * FROM projects WHERE id=?`, [ctx.params.id]);
    const issuesByDiscipline = all(
      `SELECT discipline, COUNT(*) as count FROM issues WHERE project_id=? GROUP BY discipline`, [ctx.params.id]
    );
    const issueResolutionRate = get(
      `SELECT
         (SELECT COUNT(*) FROM issues WHERE project_id=? AND status='بسته شده') as closed,
         (SELECT COUNT(*) FROM issues WHERE project_id=?) as total`,
      [ctx.params.id, ctx.params.id]
    );
    const visitsCount = get(`SELECT COUNT(*) c FROM visits WHERE project_id=?`, [ctx.params.id]).c;
    const avgScore = get(`SELECT AVG(compliance_score) a FROM reports WHERE project_id=?`, [ctx.params.id]).a;
    return {
      project,
      visitsCount,
      issuesByDiscipline,
      issueResolutionRate: issueResolutionRate.total ? Math.round((issueResolutionRate.closed / issueResolutionRate.total) * 100) : null,
      averageComplianceScore: avgScore != null ? Math.round(avgScore) : null,
    };
  });

  // ---------------- Audit log (بخش ۴۷) ----------------
  router.get('/api/audit-logs', async (req, res, ctx) => {
    requireRole(req, 'ADMIN', 'SUPERVISOR');
    const { project, user: userId, entity } = ctx.query;
    const clauses = []; const params = [];
    if (project) { clauses.push('project_id=?'); params.push(project); }
    if (userId) { clauses.push('user_id=?'); params.push(userId); }
    if (entity) { clauses.push('entity=?'); params.push(entity); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return all(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT 200`, params);
  });
}

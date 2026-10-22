import { db } from '../supabase.js';
import { advance } from './run.js';

// Imports findings.json produced by Cloudflare's security-audit skill
// (github.com/cloudflare/security-audit-skill, MIT) run on the client's
// source code, and turns it into audit checks.
//
//   confirmed         -> a finding with its severity (overall_severity)
//   needs_validation  -> shown as a lead with NO severity
//   rejected          -> dropped (kept out of the client's view)
//
// The skill itself runs in a coding agent with a sandbox: it needs the code,
// parallel sub-agents and Node. Stash only imports its verified output.

const SEV = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', informational: 'low' };
const cut = (s, n) => (s == null ? '' : String(s).slice(0, n));

function toCheck(r, i) {
  if (!r || typeof r !== 'object') return null;
  if (r.verdict === 'rejected') return null;
  const where = Array.isArray(r.trace) && r.trace.length ? r.trace[r.trace.length - 1] : null;
  const evidence = (r.trace || []).slice(0, 6).map((t) => t.kind + ': ' + t.file + ':' + t.line + ' ' + t.scope + ' — ' + cut(t.description, 160));
  if (r.verdict === 'confirmed') {
    const sev = SEV[r.severity?.overall_severity] || 'medium';
    const info = r.severity?.overall_severity === 'informational';
    return {
      id: 'code-audit-' + (i + 1),
      category: 'Security',
      verdict: info ? 'hardening' : 'confirmed',
      severity: sev,
      source: 'code-audit',
      title: cut(r.title, 160),
      why: cut(r.description, 700),
      fix: cut(r.remediation?.strategy, 700),
      evidence: [cut(r.root_cause, 300), ...evidence].filter(Boolean),
      likelihood: cut(r.severity?.likelihood?.score + ': ' + (r.severity?.likelihood?.reason || ''), 200),
      impact: cut(r.severity?.impact?.score + ': ' + (r.severity?.impact?.reason || ''), 200),
      code_changes: (r.remediation?.code_changes || []).slice(0, 5).map((c) => ({ file: cut(c.file_name, 200), code: cut(c.fixed_code, 2000) })),
      confidence: r.confidence?.score || null,
      file: where ? where.file + ':' + where.line : null,
    };
  }
  if (r.verdict === 'needs_validation') {
    return {
      id: 'code-audit-' + (i + 1),
      category: 'Security',
      verdict: 'needs_validation',
      severity: 'low',
      source: 'code-audit',
      title: cut(r.title || 'Unresolved security lead', 160),
      why: cut(r.description || r.reason || r.unresolved_fact, 700),
      fix: cut(r.unresolved_fact ? 'Resolve: ' + r.unresolved_fact : r.remediation?.strategy, 400),
      evidence,
    };
  }
  return null;
}

/** Accepts the array, or an object holding it under findings / records. */
export function parseFindings(input) {
  const arr = Array.isArray(input) ? input : input?.findings || input?.records || input?.results;
  if (!Array.isArray(arr)) throw new Error('Expected findings.json: an array of records, or { "findings": [...] }');
  const checks = arr.map(toCheck).filter(Boolean);
  const rejected = arr.filter((r) => r?.verdict === 'rejected').length;
  return { checks, rejected, total: arr.length };
}

export async function importCodeFindings(auditId, input) {
  const { checks: add, rejected, total } = parseFindings(input);
  const { data: audit } = await db.from('audits').select('id,checks,status').eq('id', Number(auditId)).maybeSingle();
  if (!audit) throw new Error('No audit ' + auditId);
  const kept = (audit.checks || []).filter((c) => c.source !== 'code-audit'); // re-importing replaces
  await db.from('audits').update({ checks: [...kept, ...add], status: 'planning', step_detail: 'Re-ranking with the code review' }).eq('id', audit.id);
  await advance(audit.id, 55000).catch(() => {});
  return { imported: add.length, confirmed: add.filter((c) => c.verdict === 'confirmed').length, needs_validation: add.filter((c) => c.verdict === 'needs_validation').length, hardening: add.filter((c) => c.verdict === 'hardening').length, rejected_ignored: rejected, records: total };
}

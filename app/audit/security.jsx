'use client';

// Live-site security scan (lib/audit/security.js) plus findings imported from
// a code audit. Wording follows Cloudflare's rules: only confirmed issues
// carry a severity; unproven leads say what is still unknown; extra layers
// that are missing are hardening notes.

const SEV_TONE = { critical: 'r', high: 'r', medium: 'y', low: '' };
const VERDICT = { confirmed: 'Confirmed', hardening: 'Hardening', needs_validation: 'Needs validation' };

function Item({ f }) {
  return (
    <li className='aif-row' style={{ listStyle: 'none', padding: '10px 0', borderTop: '1px solid var(--line, #e7e3da)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b>{f.title}</b>
        {f.verdict === 'confirmed' && f.severity ? <span className={'zpill ' + (SEV_TONE[f.severity] || '')}>{f.severity}</span> : null}
        <span className='zpill'>{VERDICT[f.verdict] || 'Finding'}</span>
        {f.source === 'code-audit' ? <span className='zpill'>from code review</span> : null}
      </div>
      {f.why ? <p style={{ margin: '4px 0' }}>{f.why}</p> : null}
      {f.fix ? <p className='sub' style={{ margin: '2px 0' }}><b>Fix:</b> {f.fix}</p> : null}
      {f.evidence?.length ? <details><summary className='sub'>Evidence</summary><ul>{f.evidence.map((e, i) => <li key={i} className='sub'>{e}</li>)}</ul></details> : null}
      {f.likelihood || f.impact ? <p className='sub' style={{ margin: '2px 0' }}>Likelihood: {f.likelihood || 'n/a'}. Impact: {f.impact || 'n/a'}.</p> : null}
    </li>
  );
}

export function SecurityCard({ security, checks = [] }) {
  const scan = (checks || []).filter((c) => c.source === 'security-scan' || c.source === 'code-audit');
  const sec = scan.length || security;
  if (!sec) return null;
  const groups = ['confirmed', 'needs_validation', 'hardening'].map((v) => [v, scan.filter((f) => f.verdict === v)]);
  const confirmed = groups[0][1];
  return (
    <section id='security' className='zcard pad'>
      <h2>Security scan</h2>
      <div className='sub'>A passive check of what any visitor can reach: exposed files, secrets in the page code, outdated libraries, error pages and risky settings. Nothing was attacked or logged into.</div>
      <div className='pills' style={{ margin: '10px 0' }}>
        {confirmed.length ? <span className='zpill r'>{confirmed.length} confirmed</span> : <span className='zpill g'>✓ Nothing confirmed</span>}
        {groups[1][1].length ? <span className='zpill y'>{groups[1][1].length} to validate</span> : null}
        {groups[2][1].length ? <span className='zpill'>{groups[2][1].length} hardening</span> : null}
        {security?.scripts_checked != null ? <span className='zpill'>{security.scripts_checked} script file{security.scripts_checked === 1 ? '' : 's'} read</span> : null}
      </div>
      {groups.map(([v, list]) => list.length ? (
        <div key={v}>
          <h3 className='prg-h'>{VERDICT[v]}{v === 'needs_validation' ? <span className='sub'> a lead we could not prove, no severity given</span> : v === 'hardening' ? <span className='sub'> extra layers, not vulnerabilities</span> : null}</h3>
          <ul style={{ margin: 0, padding: 0 }}>{list.map((f) => <Item key={f.id + (f.title || '')} f={f} />)}</ul>
        </div>
      ) : null)}
      {!scan.length ? <p className='sub'>No exposed files, leaked keys or known-vulnerable libraries were found. Header, certificate and cookie checks are in the technical list.</p> : null}
      <p className='sub' style={{ marginTop: 8 }}>A passive scan cannot see server code or logins. For a full review of the site's source, use the code review import.</p>
    </section>
  );
}

/** One line for the client report. */
export function SecurityReport({ checks = [] }) {
  const scan = (checks || []).filter((c) => c.source === 'security-scan' || c.source === 'code-audit');
  const n = scan.filter((f) => f.verdict === 'confirmed').length;
  if (!scan.length && !checks.length) return null;
  return <p className='sub' style={{ marginTop: 10 }}>{n ? n + ' security issue' + (n === 1 ? '' : 's') + ' need fixing, listed in the plan.' : 'Our passive security scan found nothing exploitable.'}</p>;
}

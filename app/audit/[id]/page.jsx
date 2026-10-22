'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { howtoFor } from '@/lib/audit/howto';
import { fixPrompt, briefMarkdown } from '@/lib/audit/brief';
import { Progress, PagesCard } from '../progress';
import { AICard, aiCtx } from '../ai';
import AuditChat from '../chat';
import { FieldCard } from '../field';
import { SecurityCard } from '../security';
import { BacklinkCard } from '../backlinks';
import '../dz.css';

// One audit, laid out as a structured report: scores that link to their
// checks, fixes that open into how-tos, sections with pictures from the page,
// and the library tools suggested for them. Every block has an anchor, so any
// part can be linked to or jumped to.

const STEPS = ['capturing', 'measuring', 'classifying', 'designing', 'planning', 'done'];
const STEP_LABEL = {
  queued: 'Starting', capturing: 'Reading the page', measuring: 'Testing on a phone',
  classifying: 'Scoring each section', designing: 'Designing fixes', planning: 'Ranking what to fix', done: 'Done',
};
const TIER = { now: 'Fix now', next: 'Next', later: 'Later' };
const LH_LABEL = { performance: 'Speed', accessibility: 'Accessibility', seo: 'SEO', 'best-practices': 'Best practices' };
const SITE_SCORES = [['security', 'Security', 'Security'], ['privacy', 'Privacy', 'Privacy'], ['seo', 'SEO checks', 'SEO'], ['performance_checks', 'Speed checks', 'Performance'], ['ai_visibility', 'AI visibility', 'AI visibility']];

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const col = (v) => (v >= 80 ? '#067647' : v >= 55 ? '#b54708' : '#b42318');
const label = (s) => (s === 'cta' || s === 'faq' ? s.toUpperCase() : String(s || 'section').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));
const pillCls = (v) => (v === 'strong' || v === 'g' ? 'g' : v === 'weak' || v === 'r' ? 'r' : v === 'b' ? 'b' : 'a');

export default function AuditPage() {
  const { id } = useParams();
  const [audit, setAudit] = useState(null);
  const [err, setErr] = useState(null);
  const [toast, setToast] = useState(null);
  const [shotFailed, setShotFailed] = useState(0);
  const [openFix, setOpenFix] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [active, setActive] = useState('overview');
  const [rivalText, setRivalText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [brandForm, setBrandForm] = useState(null);
  const [log, setLog] = useState([]);
  const statusRef = useRef('queued');
  const alive = useRef(true);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  useEffect(() => {
    alive.current = true;
    (async () => {
      try {
        let res = await fetch('/api/audit/' + id);
        let a = await res.json();
        if (!res.ok) throw new Error(a.error || 'Not found');
        if (alive.current) setAudit(a);
        // Keep nudging it forward until it finishes. Each call does up to ~45s of work.
        let stalls = 0;
        while (alive.current && a.status !== 'done' && a.status !== 'error' && stalls < 40) {
          res = await fetch('/api/audit/' + id, { method: 'POST' });
          const next = await res.json();
          if (!res.ok) { stalls++; await new Promise((r) => setTimeout(r, 3000)); continue; }
          a = next;
          if (alive.current) setAudit(a);
        }
      } catch (e) {
        if (alive.current) setErr(e.message);
      }
    })();
    // While it runs, refresh every couple of seconds so the progress is live even
    // while a long step is still in flight.
    const poll = setInterval(async () => {
      if (!alive.current || statusRef.current === 'done' || statusRef.current === 'error') return;
      try {
        const r = await fetch('/api/audit/' + id, { cache: 'no-store' });
        const a = await r.json();
        if (r.ok && alive.current) setAudit(a);
      } catch { /* the next tick will try again */ }
    }, 2500);
    return () => { alive.current = false; clearInterval(poll); };
  }, [id]);

  // A running record of what Stash is doing, built from the step text as it changes.
  useEffect(() => {
    if (!audit) return;
    statusRef.current = audit.status;
    const msg = audit.step_detail || (audit.status === 'done' ? 'Audit complete' : null);
    if (!msg) return;
    setLog((l) => (l[0]?.msg === msg ? l : [{ t: Date.now(), msg }, ...l].slice(0, 40)));
  }, [audit?.step_detail, audit?.status]);

  // Deep links: #fix-3 opens that fix, #s12 or #checks-Security scroll to it.
  useEffect(() => {
    if (!audit) return;
    const go = () => {
      const h = decodeURIComponent(window.location.hash.slice(1));
      if (!h) return;
      const m = /^fix-(\d+)$/.exec(h);
      if (m) setOpenFix(Number(m[1]));
      setTimeout(() => document.getElementById(h)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, [!!audit]);

  // Which block the sticky rail highlights.
  useEffect(() => {
    if (!audit) return;
    const ids = ['overview', 'pages', 'fix', 'sections', 'tools', 'compete', 'checks', 'ask'];
    const onScroll = () => {
      let cur = ids[0];
      for (const i of ids) { const e = document.getElementById(i); if (e && e.getBoundingClientRect().top < 160) cur = i; }
      setActive(cur);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [!!audit]);

  async function ask(q) {
    const text = (q ?? question).trim();
    if (!text || asking) return;
    setQuestion(text); setAsking(true); setAnswer(null);
    try {
      const res = await fetch('/api/audit/' + id + '/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: text }) });
      const j = await res.json();
      setAnswer(j.answer || j.error || 'No answer.');
    } catch (e) { setAnswer('Could not reach Stash: ' + e.message); } finally { setAsking(false); }
  }

  async function pick(section, idx) {
    const picked = section.picked === idx ? null : idx;
    setAudit((a) => ({ ...a, sections: a.sections.map((s) => (s.id === section.id ? { ...s, picked } : s)) }));
    const res = await fetch('/api/audit/' + id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ section_id: section.id, picked }) });
    const j = await res.json().catch(() => ({}));
    if (picked != null && j.tools?.length) flash('Filed ' + j.tools.length + ' tool(s) under ' + j.filed_under);
  }

  // 👍/👎 on a finding. Stash learns per-issue thresholds from these.
  async function vote(itemKey, verdict, issueLabel) {
    const current = audit.plan?.feedback?.[itemKey]?.verdict || null;
    const next = current === verdict ? null : verdict;
    setAudit((a) => {
      const fb = { ...(a.plan?.feedback || {}) };
      if (next) fb[itemKey] = { verdict: next }; else delete fb[itemKey];
      return { ...a, plan: { ...a.plan, feedback: fb } };
    });
    await fetch('/api/audit/' + id + '/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item_key: itemKey, verdict: next, issue_label: issueLabel || null }) }).catch(() => {});
    if (next === 'down') flash('Marked as not an issue. Stash will weigh this in future audits');
  }

  async function rerun() {
    flash('Starting a fresh audit…');
    const res = await fetch('/api/audit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: audit.url, client: audit.client }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.id) window.location.href = '/audit/' + j.id;
    else flash(j.error || 'Could not start');
  }

  const patchPlan = (patch) => setAudit((a) => ({ ...a, plan: { ...a.plan, ...patch } }));

  // Your own progress on a fix: open, doing or done. Saved with the audit.
  async function setStatus(itemKey, status) {
    const map = { ...(audit.plan?.status || {}) };
    if (status === 'open') delete map[itemKey]; else map[itemKey] = { status, at: new Date().toISOString() };
    patchPlan({ status: map });
    await fetch('/api/audit/' + id + '/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'status', item_key: itemKey, status }) }).catch(() => {});
  }

  async function saveBrand() {
    const b = brandForm || {};
    const res = await fetch('/api/audit/' + id + '/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'brand', logo_url: b.logo_url, color: b.color, agency: b.agency }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok) { patchPlan({ brand: j.brand }); flash('Report branding saved'); } else flash(j.error || 'Could not save');
  }

  async function scanRivals() {
    const urls = rivalText.split(/[\s,]+/).filter(Boolean);
    if (!urls.length || scanning) return;
    setScanning(true);
    flash('Scanning ' + Math.min(urls.length, 3) + ' site' + (urls.length > 1 ? 's' : '') + '… about 30 seconds');
    try {
      const res = await fetch('/api/audit/' + id + '/compete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ urls }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok) { patchPlan({ competitors: j.competitors }); setRivalText(''); } else flash(j.error || 'Scan failed');
    } catch (e) { flash('Scan failed: ' + e.message); } finally { setScanning(false); }
  }

  async function removeRival(host) {
    patchPlan({ competitors: (audit.plan?.competitors || []).filter((c) => c.host !== host) });
    await fetch('/api/audit/' + id + '/compete', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host }) }).catch(() => {});
  }

  const copyText = (text, msg) => navigator.clipboard.writeText(text).then(() => flash(msg || 'Copied'), () => flash('Could not copy'));
  const anchorLink = (hash) => copyText(window.location.origin + window.location.pathname + '#' + hash, 'Link copied');

  const site = audit?.site || {};
  const url = audit?.url || '';
  const ctx = aiCtx(audit, { host: hostOf(url), url });
  const sections = audit?.sections || [];
  const toFix = sections.filter((s) => s.status === 'designed' || s.status === 'classified' || s.status === 'error');
  const solid = sections.filter((s) => s.status === 'skipped');
  const secById = useMemo(() => Object.fromEntries(sections.map((s) => [s.id, s])), [audit]);

  // Every library tool suggested anywhere in the audit, with the sections it was suggested for.
  const suggested = useMemo(() => {
    const m = new Map();
    for (const s of sections) {
      const sug = s.suggestion || {};
      const add = (tid, via) => {
        const t = audit?.tools?.[tid];
        if (!t) return;
        const e = m.get(tid) || { tool: t, sections: new Map(), label: null, why: null, borrow: null, dirs: 0 };
        e.sections.set(s.id, s);
        if (via?.label && (!e.label || via.label === 'strong' || (via.label === 'decent' && e.label === 'weak'))) { e.label = via.label; e.why = via.why; e.borrow = via.borrow; }
        if (via?.dir) e.dirs += 1;
        m.set(tid, e);
      };
      (sug.visuals || []).forEach((v) => add(v.tool_id, v));
      (sug.directions || []).forEach((d) => (d.tool_ids || []).forEach((tid) => add(tid, { dir: true })));
    }
    const rank = { strong: 0, decent: 1, weak: 3, null: 2 };
    return [...m.values()].sort((a, b) => (rank[a.label] - rank[b.label]) || (b.sections.size - a.sections.size));
  }, [audit]);

  if (err) return <Frame><div className='err'>{err}</div></Frame>;
  if (!audit) return <Frame><div className='sub'>Loading…</div></Frame>;

  const running = audit.status !== 'done' && audit.status !== 'error';
  const stepIdx = STEPS.indexOf(audit.status);
  const shot = shotFailed === 0 ? site.screenshot : shotFailed === 1 ? site.screenshot_fallback : null;
  const plan = audit.plan;
  const health = audit.summary?.health;
  const items = (plan?.items || []);
  const dismissed = (k) => plan?.feedback?.[k]?.verdict === 'down';
  const statusOf = (k) => plan?.status?.[k]?.status || 'open';
  const approved = new Set(plan?.approvals?.keys || []);
  const howOf = (it) => howtoFor(it.key, it.category, ctx);
  const sectionOfItem = (it) => (it.section_id ? secById[it.section_id] : null);
  const liveItems = items.filter((it) => !dismissed(it.key));
  const doneCount = liveItems.filter((it) => statusOf(it.key) === 'done').length;
  const rivals = plan?.competitors || [];
  const brief = (list) => briefMarkdown(audit, list, howOf, sectionOfItem, (it) => statusOf(it.key));
  const downloadBrief = (list, name) => {
    const blob = new Blob([brief(list)], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (name || 'fixes') + '-' + hostOf(url) + '.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const shown = items.map((it, i) => ({ ...it, n: i + 1 })).filter((it) => (filter === 'all' || (filter === 'approved' ? approved.has(it.key) : it.tier === filter)) && (!query || (it.title + it.why + it.category).toLowerCase().includes(query.toLowerCase())));
  const cats = [...new Set((audit.checks || []).map((c) => c.category || 'Other'))];
  const nPages = (site.pages || []).length;
  const rail = [['overview', 'Overview', ''], ...(nPages > 1 && !running ? [['pages', 'Pages', nPages]] : []), ...(site.ai && !running ? [['ai', 'AI visibility', site.ai.score]] : []), ['fix', 'Fix first', items.length || ''], ['sections', 'Sections', sections.length || ''], ['tools', 'Suggested tools', suggested.length || ''], ...(plan ? [['compete', 'Competitors', rivals.length || '']] : []), ['checks', 'Technical checks', (audit.checks || []).length || ''], ['ask', 'Ask', '']];
  const scores = SITE_SCORES.filter(([k]) => audit.summary?.site_scores?.[k] != null).map(([k, name, cat]) => ({ name, cat, v: audit.summary.site_scores[k] }));

  return (
    <Frame client={audit.client} host={hostOf(url)} extra={
      <>
        <button className='btn' onClick={() => copyText(window.location.href, 'Link copied')}>Copy link</button>
        {!running ? <button className='btn' onClick={rerun}>Re-run</button> : null}
        {audit.status === 'done' ? <a className='btn pri' href={'/audit/' + audit.id + '/report'} target='_blank' rel='noopener noreferrer'>Client report ↗</a> : null}
      </>
    }>
      <div className='wrap'>
        <nav className='rail'>
          {rail.map(([k, name, n]) => (
            <a key={k} href={'#' + k} className={active === k ? 'on' : ''}>{name}<small>{n}</small></a>
          ))}
          <div className='sep' />
          <a className='ext' href={url} target='_blank' rel='noopener noreferrer'>Open live site ↗</a>
          <a className='ext' href='/audit'>All audits</a>
          <a className='ext' href='/'>Tool library</a>
        </nav>

        <main>
          <section id='overview' className='zcard pad'>
            <div className='head'>
              <div>
                <div className='eyebrow'>{audit.client ? audit.client + ' · ' : ''}{hostOf(url)}</div>
                <h1>{audit.title || hostOf(url)}</h1>
                <a className='sub' href={url} target='_blank' rel='noopener noreferrer'>{url} ↗</a>
                <div className='pills'>
                  {site.framework ? <span className='zpill'>{site.framework}</span> : null}
                  {(site.fonts || []).slice(0, 3).map((f) => <span key={f} className='zpill'>{f}</span>)}
                  {(site.colours || []).slice(0, 6).map((c) => <span key={c} title={c} style={{ width: 18, height: 18, borderRadius: 6, background: c, border: '1px solid var(--line)', display: 'inline-block' }} />)}
                </div>
                {site.judgement ? (
                  <div className='pills'>
                    <span className='zpill b'>{String(site.judgement.business_type || '').replace(/-/g, ' ')}</span>
                    <span className='zpill'>Goal: {String(site.judgement.contact_goal || '').replace(/-/g, ' ')}</span>
                    {site.judgement.offer_clarity != null ? <span className={'zpill ' + (site.judgement.offer_clarity >= 0.66 ? 'g' : site.judgement.offer_clarity < 0.34 ? 'r' : '')}>Offer clarity {Math.round(site.judgement.offer_clarity * 100)}%</span> : null}
                    {site.judgement.proof_on_page != null ? <span className={'zpill ' + (site.judgement.proof_on_page >= 0.6 ? 'g' : 'r')}>{site.judgement.proof_on_page >= 0.6 ? 'Proof on page' : 'Little proof on page'}</span> : null}
                  </div>
                ) : null}
                {site.visual && !site.visual.skipped ? (
                  <div className='pills'>
                    {site.visual.look ? <span className='sub'>Looks: {site.visual.look}</span> : null}
                    <span className='zpill'>Imagery: {String(site.visual.imagery).replace(/-/g, ' ')}</span>
                    <span className={'zpill ' + (site.visual.hierarchy === 'weak' ? 'r' : site.visual.hierarchy === 'strong' ? 'g' : '')}>Hierarchy {site.visual.hierarchy}</span>
                    <span className={'zpill ' + (site.visual.density === 'crowded' ? 'r' : '')}>{site.visual.density}</span>
                    {(site.visual.issues || []).map((k) => <span key={k} className='zpill r'>{k.replace(/-/g, ' ')}</span>)}
                  </div>
                ) : site.visual?.skipped ? <div className='sub' style={{ marginTop: 10 }}>Visual read skipped: {site.visual.skipped}</div> : null}
              </div>
              {health != null ? (
                <div className='ring'>
                  <Ring v={health} />
                  <b>{health}</b><span>design health</span>
                </div>
              ) : null}
            </div>
          </section>

          {running || audit.status === 'error' ? <Progress audit={audit} log={log} /> : null}
          {audit.status === 'error' ? <div className='err'>The audit stopped: {audit.error}</div> : null}

          {(scores.length || audit.psi?.scores) ? (
            <div className='kpis'>
              {scores.map((s) => (
                <a key={s.name} className='kpi' href={'#checks-' + s.cat}>
                  <small>{s.name}</small>
                  <b style={{ color: col(s.v) }}>{s.v}</b>
                  {s.v < 100 ? <span className='d'>+{100 - s.v} if fixed</span> : <span className='d n'>Nothing to fix</span>}
                  <span className='go'>See checks →</span>
                </a>
              ))}
              {Object.entries(audit.psi?.scores || {}).map(([k, v]) => (
                <a key={k} className='kpi' href='#fix'>
                  <small>{LH_LABEL[k] || k} (Lighthouse)</small>
                  <b style={{ color: col(v) }}>{v}</b>
                  <span className='d n'>Measured on mobile</span>
                  <span className='go'>See fixes →</span>
                </a>
              ))}
            </div>
          ) : audit.psi?.skipped ? <div className='callout w'>Speed &amp; contrast not measured: {audit.psi.skipped}</div> : null}

          {audit.compare ? (
            <section id='since' className='zcard pad'>
              <div className='sechead'>
                <div>
                  <h2>Since the last audit</h2>
                  <div className='sub'>Compared with the audit from {new Date(audit.compare.prev_date).toLocaleDateString()}.</div>
                </div>
                <a className='btn sm' href={'/audit/' + audit.compare.prev_id}>Open previous ↗</a>
              </div>
              <div className='kpis' style={{ marginTop: 14 }}>
                {[['Design health', audit.compare.health], ...SITE_SCORES.filter(([k]) => audit.compare.scores[k]).map(([k, n]) => [n, audit.compare.scores[k]])].filter(([, d]) => d).map(([n, d]) => (
                  <div key={n} className='kpi' style={{ cursor: 'default' }}>
                    <small>{n}</small>
                    <b style={{ color: col(d.to) }}>{d.to}</b>
                    <span className={'d' + (d.change === 0 ? ' n' : '')} style={d.change < 0 ? { color: 'var(--now)' } : undefined}>
                      {d.change > 0 ? '▲ +' + d.change : d.change < 0 ? '▼ ' + d.change : 'No change'} from {d.from}
                    </span>
                  </div>
                ))}
              </div>
              <div className='two' style={{ marginTop: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 14, color: 'var(--ok)' }}>Resolved ({audit.compare.resolved.length})</h3>
                  <div className='rel'>{audit.compare.resolved.length ? audit.compare.resolved.map((r) => <span key={r.key + r.title} style={{ fontSize: 13.5, fontWeight: 600 }}>✓ {r.title}</span>) : <span className='sub'>Nothing resolved yet.</span>}</div>
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 14, color: 'var(--now)' }}>New since then ({audit.compare.added.length})</h3>
                  <div className='rel'>{audit.compare.added.length ? audit.compare.added.map((r) => <span key={r.key + r.title} style={{ fontSize: 13.5, fontWeight: 600 }}>＋ {r.title}</span>) : <span className='sub'>No new problems.</span>}</div>
                </div>
              </div>
              <div className='sub' style={{ marginTop: 12 }}>{audit.compare.still} finding{audit.compare.still === 1 ? '' : 's'} carried over unchanged.</div>
            </section>
          ) : null}

          {plan && !running ? (
            <details className='zcard pad'>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>White-label the client report{plan.brand?.agency || plan.brand?.logo_url ? ' · set' : ''}</summary>
              <div className='sub' style={{ marginTop: 6 }}>Your name, logo and colour on the report you share. Saved with this audit.</div>
              <div className='ask' style={{ flexWrap: 'wrap' }}>
                <input placeholder='Your agency name' defaultValue={plan.brand?.agency || ''} onChange={(e) => setBrandForm((b) => ({ ...(b || plan.brand || {}), agency: e.target.value }))} />
                <input placeholder='Logo address (https://…)' defaultValue={plan.brand?.logo_url || ''} onChange={(e) => setBrandForm((b) => ({ ...(b || plan.brand || {}), logo_url: e.target.value }))} />
                <input placeholder='Accent colour, e.g. #2447d6' defaultValue={plan.brand?.color || ''} style={{ maxWidth: 200 }} onChange={(e) => setBrandForm((b) => ({ ...(b || plan.brand || {}), color: e.target.value }))} />
                <button className='btn pri' onClick={saveBrand}>Save</button>
              </div>
            </details>
          ) : null}

          {(site.network || audit.psi?.vitals) ? (
            <section className='zcard pad'>
              <h2>How the site is served</h2>
              <div className='pills'>
                {site.network?.tls?.days_left != null ? <span className='zpill'>Certificate {site.network.tls.days_left} days left</span> : null}
                {site.network?.cdn ? <span className='zpill'>{site.network.cdn}</span> : null}
                {site.network?.ttfb_ms ? <span className='zpill'>Server {Math.round(site.network.ttfb_ms)} ms</span> : null}
                {(site.network?.trackers || []).length ? <span className='zpill'>{site.network.trackers.length} tracker{site.network.trackers.length > 1 ? 's' : ''}</span> : null}
                {Object.entries(audit.psi?.vitals || {}).map(([k, v]) => v.value ? <span key={k} className={'zpill ' + (v.score >= 0.9 ? 'g' : v.score < 0.5 ? 'r' : '')}>{k} {v.value}</span> : null)}
              </div>
            </section>
          ) : null}

          {!running && site.google ? <FieldCard google={site.google} /> : null}
          {!running && (site.security || (audit.checks || []).some((c) => c.source === 'security-scan' || c.source === 'code-audit')) ? <SecurityCard security={site.security} checks={audit.checks} /> : null}
          {!running ? <BacklinkCard audit={audit} /> : null}

          {!running ? <PagesCard audit={audit} /> : null}

          {!running && site.ai ? <AICard audit={audit} items={items.map((it, i) => ({ ...it, n: i + 1 }))} copy={copyText} /> : null}

          {plan ? (
            <section id='fix' className='zcard pad'>
              <div className='sechead'>
                <div>
                  <h2>Fix first</h2>
                  <div className='sub'>Ranked by impact on enquiries, then effort. {plan.counts.now} now · {plan.counts.next} next · {plan.counts.later} later. Open any row for the how-to.</div>
                </div>
                <div className='tools'>
                  <input className='search' placeholder='Search fixes' value={query} onChange={(e) => setQuery(e.target.value)} />
                  <span className='chips'>
                    {['all', 'now', 'next', 'later', ...(approved.size ? ['approved'] : [])].map((c) => <button key={c} className={'zchip' + (filter === c ? ' on' : '')} onClick={() => setFilter(c)}>{c === 'all' ? 'All' : c === 'approved' ? 'Client approved' : TIER[c]}</button>)}
                  </span>
                </div>
              </div>
              {plan.overview ? <p style={{ margin: '14px 0 0', maxWidth: '72ch', color: '#1e2b42' }}>{plan.overview}</p> : null}
              <div className='tools' style={{ marginTop: 14 }}>
                <span className='zpill g'>{doneCount} of {liveItems.length} done</span>
                <button className='btn sm' onClick={() => copyText(brief(liveItems.filter((i) => i.tier === 'now')), 'Brief copied')}>Copy brief: fix now</button>
                <button className='btn sm' onClick={() => downloadBrief(liveItems, 'all-fixes')}>Download all (.md)</button>
                {approved.size ? <button className='btn sm pri' onClick={() => downloadBrief(liveItems.filter((i) => approved.has(i.key)), 'approved-fixes')}>Download approved (.md)</button> : null}
              </div>
              {plan.approvals?.at ? (
                <div className='callout g' style={{ marginTop: 14 }}>
                  <b>Client approved {approved.size} item{approved.size === 1 ? '' : 's'}</b> on {new Date(plan.approvals.at).toLocaleDateString()}{plan.approvals.name ? ' (' + plan.approvals.name + ')' : ''}.
                  {plan.approvals.note ? <div style={{ marginTop: 4 }}>“{plan.approvals.note}”</div> : null}
                </div>
              ) : null}
              {(plan.strengths || []).length ? <div className='pills'>{plan.strengths.map((s) => <span key={s} className='zpill g'>✓ {s}</span>)}</div> : null}
              <div className='mini' style={{ marginTop: 16 }}>
                {shown.map((it) => (
                  <FixRow key={it.key} it={it} open={openFix === it.n} onToggle={() => { const next = openFix === it.n ? null : it.n; setOpenFix(next); if (next) history.replaceState(null, '', '#fix-' + it.n); }}
                    fb={plan.feedback?.[it.key]?.verdict} dismissed={dismissed(it.key)} onVote={vote} onLink={() => anchorLink('fix-' + it.n)} onCopy={copyText}
                    how={howOf(it)} section={sectionOfItem(it)} status={statusOf(it.key)} onStatus={setStatus} approved={approved.has(it.key)}
                    prompt={fixPrompt(audit, it, howOf(it), sectionOfItem(it))} />
                ))}
                {!shown.length ? <div className='sub'>No fixes match.</div> : null}
              </div>
            </section>
          ) : null}

          {audit.summary ? (
            <section className='zcard pad'>
              <h2>Most common problems</h2>
              <div className='pills'>
                {(audit.summary.common_issues || []).length
                  ? audit.summary.common_issues.map((c) => <span key={c.issue} className='zpill r'>{c.issue} · {c.sections}</span>)
                  : <span className='sub'>Nothing recurring.</span>}
                {(audit.summary.basics || []).map((b) => <span key={b} className='zpill'>{b}</span>)}
              </div>
            </section>
          ) : null}

          <section id='sections' className='zcard pad'>
            <div className='sechead'>
              <div>
                <h2>Sections</h2>
                <div className='sub'>The page top to bottom, with a picture from each section. Open one for its diagnosis and directions.</div>
              </div>
            </div>
            <div className='heat' style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(56px,1fr))' }}>
              {sections.map((s) => (
                <a key={s.id} href={'#s' + s.id} className={['designed', 'classified', 'error'].includes(s.status) ? 'd' : ''} title={(s.signals?.page_path || '') + ' · ' + label(s.type)}>
                  <span>{(s.signals?.page_pos ?? s.position) + 1}</span><em>{(nPages > 1 && s.signals?.page_path && s.signals.page_path !== '/' ? s.signals.page_path + ' ' : '') + label(s.type)}</em>
                </a>
              ))}
            </div>
          </section>

          {toFix.map((s) => (
            <SectionCard key={s.id} s={s} multi={nPages > 1} tools={audit.tools} onPick={pick} onCopy={copyText} onLink={() => anchorLink('s' + s.id)}
              feedback={plan?.feedback || {}} onVote={plan ? vote : null}
              fixes={items.map((it, i) => ({ ...it, n: i + 1 })).filter((it) => it.section_id === s.id)} />
          ))}

          {solid.length ? (
            <section className='zcard pad'>
              <h2>Already solid</h2>
              <div className='srows' style={{ marginTop: 10 }}>
                {solid.map((s) => (
                  <div key={s.id} className='srow' id={'s' + s.id} style={{ gridTemplateColumns: '28px 86px 1fr' }}>
                    <span className='n'>{s.position + 1}</span>
                    {s.signals?.previews?.[0] ? <Snip src={s.signals.previews[0]} small /> : <span />}
                    <span><b style={{ fontWeight: 600 }}>{label(s.type)}</b><br /><span className='sub' style={{ fontSize: 12.5 }}>{s.heading || (s.text_excerpt || '').slice(0, 90)}</span></span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {suggested.length ? (
            <section id='tools' className='zcard pad'>
              <h2>Suggested tools</h2>
              <div className='sub'>Everything from your library the audit suggests for this site, strongest matches first. Each shows the sections it is meant for.</div>
              <div className='tgrid'>
                {suggested.map((e) => <ToolTile key={e.tool.id} e={e} />)}
              </div>
            </section>
          ) : null}

          {plan ? (
            <section id='compete' className='zcard pad'>
              <h2>Competitors</h2>
              <div className='sub'>Scan up to three rival sites with the same security, privacy, SEO and speed checks, then see where this site leads and trails.</div>
              <div className='ask'>
                <input value={rivalText} onChange={(e) => setRivalText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') scanRivals(); }} placeholder='rival1.com, rival2.com, rival3.com' />
                <button className='btn pri' onClick={scanRivals} disabled={scanning || !rivalText.trim()}>{scanning ? 'Scanning…' : 'Scan'}</button>
              </div>
              {rivals.length ? <Rivals own={{ host: hostOf(url), scores: audit.summary?.site_scores || {}, ttfb: site.network?.ttfb_ms, findings: (audit.checks || []).length, trackers: (site.network?.trackers || []).length, sections: sections.length }} rivals={rivals} onRemove={removeRival} /> : null}
            </section>
          ) : null}

          {(audit.checks || []).length ? (
            <section id='checks' className='zcard pad'>
              <h2>Technical checks</h2>
              <div className='sub'>What was found in the page, its headers, certificate and DNS. Open the fix for steps and code.</div>
              <div className='tech'>
                {cats.map((cat) => {
                  const list = audit.checks.filter((c) => (c.category || 'Other') === cat);
                  return (
                    <div key={cat} id={'checks-' + cat} className='tg'>
                      <h3>{cat}<span className='zpill r'>{list.length} to fix</span></h3>
                      <ul>
                        {list.map((c) => {
                          const idx = items.findIndex((it) => it.key === 'check:' + c.id);
                          return <li key={c.id} className='f'>{idx >= 0 ? <a href={'#fix-' + (idx + 1)}>{c.title} →</a> : c.title}</li>;
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {(audit.psi?.mobile_screenshot || shot) ? (
            <section className='zcard pad'>
              <h2>Phone and desktop</h2>
              <div className='sub'>The same page as a phone sees it (Google's view) and as a wide screen sees it. Look for things that only break on one.</div>
              <div style={{ display: 'flex', gap: 16, marginTop: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {audit.psi?.mobile_screenshot ? (
                  <div style={{ width: 200 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={audit.psi.mobile_screenshot} alt='Mobile screenshot' style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />
                    <div className='snips-cap'>Phone</div>
                  </div>
                ) : null}
                {shot ? (
                  <div style={{ flex: 1, minWidth: 260, maxHeight: 520, overflow: 'hidden', borderRadius: 10, border: '1px solid var(--line)', position: 'relative' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shot} alt={'Screenshot of ' + hostOf(url)} loading='lazy' style={{ width: '100%', display: 'block' }} onError={() => setShotFailed((n) => n + 1)} />
                    <div className='snips-cap' style={{ position: 'absolute', left: 10, bottom: 8, background: '#fff', padding: '2px 8px', borderRadius: 6, margin: 0 }}>Desktop, top of page</div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {shot ? (
            <details className='zcard pad'>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Full-page screenshot</summary>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot} alt={'Screenshot of ' + hostOf(url)} loading='lazy' style={{ width: '100%', marginTop: 12, borderRadius: 10 }} onError={() => setShotFailed((n) => n + 1)} />
            </details>
          ) : null}

          {audit.status === 'done' ? (
            <section id='ask' className='zcard pad'>
              <h2>Ask about this audit</h2>
              <div className='ask'>
                <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ask(); }} placeholder='e.g. What can I fix in one hour? Why is the FAQ flagged?' />
                <button className='btn pri' onClick={() => ask()} disabled={asking || !question.trim()}>{asking ? 'Thinking…' : 'Ask'}</button>
                <button className='btn' onClick={() => setChatOpen(true)}>Open chat ✦</button>
              </div>
              <div className='pills'>
                {['What should I fix in the first hour?', 'Explain the top 3 problems to my client in simple words', 'Which issues hurt enquiries the most?'].map((q) => <button key={q} className='zchip' onClick={() => ask(q)}>{q}</button>)}
              </div>
              {answer ? <div className='answer'>{answer}</div> : null}
            </section>
          ) : null}

          {audit.engines?.decide || audit.engines?.design_used ? (
            <div className='sub' style={{ textAlign: 'center' }}>
              Scored by {audit.engines.decide || '—'} · Designed by {audit.engines.design_used || audit.engines.design || '—'}
              {plan?.impact_engine ? ' · Prioritised by ' + plan.impact_engine : ''}
            </div>
          ) : null}
        </main>
      </div>
      {audit.status === 'done' ? <AuditChat id={id} open={chatOpen} setOpen={setChatOpen} hasAI={!!site.ai} hasRivals={rivals.length > 0} onJump={(hash) => { document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(null, '', '#' + hash); }} /> : null}
      {toast ? <div className='ztoast'>{toast}</div> : null}
    </Frame>
  );
}

/* ------------------------------------------------------------- pieces */

function Ring({ v }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <svg width='128' height='128'>
      <circle cx='64' cy='64' r={r} fill='none' stroke='#e6eaf0' strokeWidth='10' />
      <circle cx='64' cy='64' r={r} fill='none' stroke={col(v)} strokeWidth='10' strokeLinecap='round' strokeDasharray={(c * v / 100) + ' ' + c} />
    </svg>
  );
}

// A picture from the page. Hides itself if the image cannot be loaded.
function Snip({ src, small }) {
  const [bad, setBad] = useState(false);
  if (bad) return small ? <span /> : <div className='snip ph'>Image unavailable</div>;
  return (
    <a className='snip' href={src} target='_blank' rel='noopener noreferrer' style={small ? { width: 86, height: 54, aspectRatio: 'auto' } : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt='' loading='lazy' referrerPolicy='no-referrer' onError={() => setBad(true)} />
    </a>
  );
}

// Tool picture with a lettered fallback when the library has no image or it fails.
function ToolImg({ tool }) {
  const [bad, setBad] = useState(false);
  return (
    <div className='img'>
      {tool.image && !bad
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={tool.image} alt='' loading='lazy' referrerPolicy='no-referrer' onError={() => setBad(true)} />
        : <b>{String(tool.title || '?').slice(0, 2)}</b>}
    </div>
  );
}

function ToolTile({ e }) {
  const t = e.tool;
  const secs = [...e.sections.values()];
  return (
    <div className={'tile' + (e.label === 'weak' ? ' weak' : '')}>
      <ToolImg tool={t} />
      <div className='body'>
        <b className='t'>{t.title}</b>
        <div className='pills' style={{ margin: 0 }}>
          {e.label ? <span className={'zpill ' + pillCls(e.label)}>{e.label} match</span> : <span className='zpill'>used in {e.dirs} direction{e.dirs === 1 ? '' : 's'}</span>}
          {t.usage_format ? <span className='zpill'>{t.usage_format.replace(/-/g, ' ')}</span> : t.type ? <span className='zpill'>{t.type}</span> : null}
        </div>
        {e.why ? <span className='sub' style={{ fontSize: 13 }}>{e.why}</span> : null}
        {e.borrow ? <span style={{ fontSize: 13 }}><b>Borrow:</b> {e.borrow}</span> : null}
        <span className='used'>For {secs.map((s, i) => <span key={s.id}>{i ? ', ' : ''}<a href={'#s' + s.id}>#{s.position + 1} {label(s.type)}</a></span>)}</span>
      </div>
      <div className='acts'>
        <a className='btn sm pri' href={'/?open=' + t.id}>In Stash</a>
        {t.url ? <a className='btn sm' href={t.url} target='_blank' rel='noopener noreferrer'>Open ↗</a> : null}
      </div>
    </div>
  );
}

function CodeBox({ code, onCopy }) {
  const keys = Object.keys(code);
  const [k, setK] = useState(keys[0]);
  return (
    <div style={{ marginTop: 14 }}>
      <div className='tabs' style={{ marginTop: 0 }}>
        {keys.map((x) => <button key={x} className={x === k ? 'on' : ''} onClick={() => setK(x)}>{x}</button>)}
      </div>
      <div className='codewrap'>
        <pre className='zcode'>{code[k]}</pre>
        <button className='cpb' onClick={() => onCopy(code[k], 'Code copied')}>Copy</button>
      </div>
    </div>
  );
}

function FixRow({ it, open, onToggle, fb, dismissed, onVote, onLink, onCopy, how, section, status, onStatus, approved, prompt }) {
  return (
    <div id={'fix-' + it.n} className={'fixrow' + (open ? ' open' : '') + (dismissed ? ' dim' : '')} style={{ position: 'relative', border: '1px solid var(--line)', borderRadius: 12, background: open ? '#fafbff' : '#fff' }}>
      <button onClick={onToggle} style={{ all: 'unset', cursor: 'pointer', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center', padding: '12px 14px', width: 'calc(100% - 28px)' }}>
        <span className={'tier ' + it.tier}>{dismissed ? 'Not an issue' : TIER[it.tier]}</span>
        <span>
          <b style={{ fontWeight: 600, display: 'block' }}>{it.title}</b>
          <span className='sub' style={{ fontSize: 13 }}>{it.category} · {it.effort} effort{approved ? ' · ' : ''}{approved ? <span className='a-ok'>client approved</span> : null}</span>
        </span>
        <span style={{ color: 'var(--soft)', fontSize: 18 }}>{open ? '⌃' : '⌄'}</span>
      </button>
      <span style={{ position: 'absolute', right: 44, top: 12 }}><button className={'stat ' + (status === 'doing' ? 'doing' : status === 'done' ? 'done' : '')} onClick={() => onStatus(it.key, status === 'open' ? 'doing' : status === 'doing' ? 'done' : 'open')} title='Click to change status'>{status === 'open' ? 'Open' : status === 'doing' ? 'In progress' : 'Done ✓'}</button></span>
      {open ? (
        <div style={{ padding: '0 14px 16px' }}>
          <p style={{ margin: '0 0 8px', color: '#1e2b42' }}>{it.why}</p>
          {it.pages?.length > 1 ? (
            <div className='sub' style={{ marginBottom: 8 }}>
              Found on {it.pages.length} pages:{' '}
              {it.pages.slice(0, 8).map((u, i) => { let path = u; try { path = new URL(u).pathname || '/'; } catch { /* keep the address */ } return <span key={u}>{i ? ', ' : ''}<a href={u} target='_blank' rel='noopener noreferrer' style={{ color: 'var(--brand)' }}>{path}</a></span>; })}
              {it.pages.length > 8 ? ' and ' + (it.pages.length - 8) + ' more' : ''}
            </div>
          ) : null}
          {how?.meaning ? <div className='callout w' style={{ marginBottom: 8 }}><b>What it means for enquiries:</b> {how.meaning}</div> : null}
          <div className='callout b'><b>Fix:</b> {it.fix}{it.wcag ? ' · WCAG ' + it.wcag : ''}</div>
          {how?.steps ? (
            <ol className='steps'>{how.steps.map((x) => <li key={x[0]}><div><b>{x[0]}</b><span>{x[1]}</span></div></li>)}</ol>
          ) : null}
          {how?.code ? <CodeBox code={how.code} onCopy={onCopy} /> : null}
          <div className='tools' style={{ marginTop: 14 }}>
            {section ? <a className='btn sm pri' href={'#s' + section.id}>Go to section #{section.position + 1}</a> : null}
            {(how?.verify || []).map((v) => <a key={v[1]} className='btn sm' href={v[1]} target='_blank' rel='noopener noreferrer' title={v[2]}>{v[0]} ↗</a>)}
            {(how?.docs || []).map((v) => <a key={v[1]} className='btn sm' href={v[1]} target='_blank' rel='noopener noreferrer'>{v[0]} ↗</a>)}
            <button className='btn sm' onClick={() => onCopy(prompt, 'Build prompt copied')}>Copy build prompt</button>
            <button className='btn sm' onClick={onLink}>Copy link</button>
            <span className='vote'>
              <button className={fb === 'up' ? 'on' : ''} onClick={() => onVote(it.key, 'up')} title='Right call'>👍</button>
              <button className={fb === 'down' ? 'on' : ''} onClick={() => onVote(it.key, 'down')} title='Not an issue'>👎</button>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SectionCard({ s, tools, onPick, onCopy, onLink, feedback, onVote, fixes, multi }) {
  const sug = s.suggestion || {};
  const pct = Math.round((Number(s.needs_work) || 0) * 100);
  const issueKey = (l) => 'issue:' + s.id + ':' + l;
  const previews = s.signals?.previews || [];
  const visuals = (sug.visuals || []).filter((v) => tools?.[v.tool_id]);
  return (
    <article className='zcard pad' id={'s' + s.id}>
      <div className='dh'>
        <div>
          <div className='eyebrow'>{multi && s.signals?.page_path ? (s.signals.page_path === '/' ? 'Homepage' : s.signals.page_path) + ' · ' : ''}Section {(s.signals?.page_pos ?? s.position) + 1}</div>
          <h2 style={{ fontSize: 20, marginTop: 2 }}>{label(s.type)}</h2>
          <div className='sub'>{s.heading || (s.text_excerpt || '').slice(0, 110)}</div>
        </div>
        <div className='tools'>
          <div style={{ width: 150 }} title={'Needs work: ' + pct + '%'}>
            <div className='bar'><div className='l'><span style={{ fontSize: 12 }}>Needs work</span><span style={{ color: col(100 - pct) }}>{pct}%</span></div><div className='t'><i style={{ width: pct + '%', background: col(100 - pct) }} /></div></div>
          </div>
          <button className='btn sm' onClick={onLink}>Copy link</button>
        </div>
      </div>

      {previews.length ? (
        <>
          <div className='snips'>{previews.map((p) => <Snip key={p} src={p} />)}</div>
          <div className='snips-cap'>From this section of the page</div>
        </>
      ) : null}

      {(s.issues || []).length ? (
        <div className='pills'>
          {s.issues.map((i) => {
            const off = feedback?.[issueKey(i)]?.verdict === 'down';
            return onVote ? (
              <button key={i} className={'zpill r' + (off ? ' dim' : '')} style={{ border: 0, cursor: 'pointer' }} onClick={() => onVote(issueKey(i), 'down', i)}
                title={off ? 'Restore this problem' : 'Not an issue here. Click to dismiss'}>{i} {off ? '↺' : '×'}</button>
            ) : <span key={i} className='zpill r'>{i}</span>;
          })}
        </div>
      ) : null}
      {s.scores?.uncertain ? <div className='callout w' style={{ marginTop: 12 }}>Jev was split on this one. Worth a look yourself before acting.</div> : null}
      {s.status === 'classified' ? <div className='sub' style={{ marginTop: 12 }}>Designing directions for this section…</div> : null}
      {s.status === 'error' ? <div className='err' style={{ marginTop: 12 }}>Could not design this one: {sug.error}</div> : null}

      {sug.diagnosis ? <p className='q' style={{ margin: '16px 0 0' }}>{sug.diagnosis}</p> : null}
      {sug.keep ? <div className='sub' style={{ marginTop: 10 }}><b style={{ color: 'var(--ink)' }}>Keep:</b> {sug.keep}</div> : null}
      {sug.copy?.headline || sug.copy?.cta ? (
        <div className='sub' style={{ marginTop: 6 }}>
          {sug.copy.headline ? <span><b style={{ color: 'var(--ink)' }}>Suggested headline:</b> {sug.copy.headline} <button className='stat' onClick={() => onCopy(sug.copy.headline, 'Headline copied')}>Copy</button> </span> : null}
          {sug.copy.cta ? <span style={{ marginLeft: 10 }}><b style={{ color: 'var(--ink)' }}>Button:</b> {sug.copy.cta}</span> : null}
        </div>
      ) : null}

      {fixes?.length ? (
        <div className='rel' style={{ marginTop: 12 }}>
          {fixes.map((f) => <a key={f.key} href={'#fix-' + f.n}>→ Fix #{f.n}: {f.title}</a>)}
        </div>
      ) : null}

      {visuals.length ? (
        <>
          <h3 style={{ margin: '22px 0 0', fontSize: 14 }}>Best visual references <span className='sub' style={{ fontWeight: 500 }}>(a vision model compared their screenshots with this site)</span></h3>
          <div className='tgrid'>
            {visuals.map((v) => (
              <ToolTile key={v.tool_id} e={{ tool: tools[v.tool_id], sections: new Map([[s.id, s]]), label: v.label, why: v.why, borrow: v.borrow, dirs: 0 }} />
            ))}
          </div>
        </>
      ) : null}

      {(sug.directions || []).length ? <h3 style={{ margin: '22px 0 0', fontSize: 14 }}>Directions</h3> : null}
      <div className='dirs' style={{ marginTop: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        {(sug.directions || []).map((d, i) => (
          <div key={i} className='dir' style={s.picked === i ? { borderColor: 'var(--brand)', background: '#f5f8ff' } : undefined}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <b>{'ABCDE'[i]}. {d.title}</b>
              <span className={'zpill ' + (d.effort === 'quick' ? 'g' : d.effort === 'bigger' ? 'r' : 'a')}>{d.effort}</span>
            </div>
            <p>{d.idea}</p>
            {d.checks ? (
              <div className='fx'>
                <span>Fixes the problems</span>
                <span className='t'><i style={{ width: Math.round(d.checks.fixes_problems * 100) + '%' }} /></span>
                {Math.round(d.checks.fixes_problems * 100)}%
                <span style={{ marginLeft: 8, color: d.checks.invents_facts < 0.3 ? 'var(--ok)' : 'var(--now)' }}>{d.checks.invents_facts < 0.3 ? 'No made-up facts' : 'Check the facts'}</span>
              </div>
            ) : null}
            {d.flag ? <div className='callout w' style={{ marginTop: 10 }}>{d.flag}</div> : null}
            {(d.tool_ids || []).map((tid) => tools?.[tid]).filter(Boolean).length ? (
              <div className='tgrid' style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', marginTop: 12 }}>
                {d.tool_ids.map((tid) => tools?.[tid]).filter(Boolean).map((t) => (
                  <div key={t.id} className='tile'>
                    <ToolImg tool={t} />
                    <div className='body'><b className='t' style={{ fontSize: 13 }}>{t.title}</b><span className='sub' style={{ fontSize: 12 }}>{t.usage_format ? t.usage_format.replace(/-/g, ' ') : t.type}</span></div>
                    <div className='acts'>
                      <a className='btn sm' href={'/?open=' + t.id}>In Stash</a>
                      {t.url ? <a className='btn sm' href={t.url} target='_blank' rel='noopener noreferrer'>Open ↗</a> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className='tools' style={{ marginTop: 12 }}>
              {d.prompt ? <button className='btn sm' onClick={() => onCopy(d.prompt, 'Prompt copied')}>Copy build prompt</button> : null}
              <button className={'btn sm' + (s.picked === i ? ' pri' : '')} onClick={() => onPick(s, i)}>{s.picked === i ? 'Picked ✓' : 'Use this'}</button>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function Rivals({ own, rivals, onRemove }) {
  const all = [{ host: own.host, own: true, scores: own.scores, facts: { ttfb_ms: own.ttfb != null ? Math.round(own.ttfb) : null, findings: own.findings, trackers: own.trackers, sections: own.sections } }, ...rivals.filter((r) => !r.error)];
  const failed = rivals.filter((r) => r.error);
  const rows = [
    ['Security', (c) => c.scores?.security, 'high'], ['Privacy', (c) => c.scores?.privacy, 'high'], ['SEO checks', (c) => c.scores?.seo, 'high'], ['Speed checks', (c) => c.scores?.performance_checks, 'high'],
    ['Server response (ms)', (c) => c.facts?.ttfb_ms, 'low'], ['Open findings', (c) => c.facts?.findings, 'low'], ['Trackers', (c) => c.facts?.trackers, 'low'], ['Sections', (c) => c.facts?.sections, 'info'],
  ];
  const lead = [], trail = [];
  const table = rows.map(([name, get, dir]) => {
    const vals = all.map(get);
    const num = vals.filter((v) => v != null);
    const best = dir === 'info' || !num.length ? null : dir === 'high' ? Math.max(...num) : Math.min(...num);
    const mine = vals[0];
    const others = vals.slice(1).filter((v) => v != null);
    if (best != null && mine != null && others.length) {
      const bestOther = dir === 'high' ? Math.max(...others) : Math.min(...others);
      if (mine === best && mine !== bestOther) lead.push(name);
      else if (mine !== best) trail.push(name + ' (' + mine + ' vs ' + bestOther + ')');
    }
    return { name, vals, best, dir };
  });
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr><th>Check</th>{all.map((c) => <th key={c.host}>{c.own ? 'This site' : <span>{c.host} <button className='stat' onClick={() => onRemove(c.host)} title='Remove'>×</button></span>}</th>)}</tr>
          </thead>
          <tbody>
            {table.map((r) => (
              <tr key={r.name}>
                <td className='area'>{r.name}</td>
                {r.vals.map((v, i) => <td key={i} style={{ fontWeight: v != null && v === r.best ? 700 : 500, color: v != null && v === r.best ? 'var(--ok)' : undefined }}>{v == null ? '—' : v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className='two' style={{ marginTop: 14 }}>
        <div className='callout g'><b>Where this site leads:</b> {lead.length ? lead.join(', ') : 'nowhere yet'}</div>
        <div className='callout w'><b>Where it trails:</b> {trail.length ? trail.join(', ') : 'nowhere'}</div>
      </div>
      {all.slice(1).map((c) => (
        <details key={c.host} style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{c.host}: their biggest problems ({(c.top_issues || []).length})</summary>
          <div className='rel'>
            {(c.top_issues || []).map((t) => <span key={t.title} style={{ fontSize: 13.5 }}>{t.category}: {t.title} <span className='sub'>({t.severity})</span></span>)}
            <a href={c.url} target='_blank' rel='noopener noreferrer' style={{ fontSize: 13.5, color: 'var(--brand)', fontWeight: 600 }}>Open {c.host} ↗</a>
          </div>
        </details>
      ))}
      {failed.map((c) => <div key={c.host} className='callout w' style={{ marginTop: 10 }}>Could not scan {c.host}: {c.error}</div>)}
    </div>
  );
}

function Frame({ children, client, host, extra }) {
  return (
    <div className='dz'>
      <div className='top'>
        <a className='logo' href='/'><i />stash</a>
        <div className='crumb'>
          <a href='/audit'>Audits</a>{host ? <> / <b>{client || host}</b></> : null}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>{extra}</div>
      </div>
      {host ? children : <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>{children}</div>}
    </div>
  );
}

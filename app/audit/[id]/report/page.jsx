'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

// A clean, light, printable report for the client. No jargon, no tool names,
// no internal scores they would not understand — just what was found, why it
// matters to their visitors, and what will be done. "Save as PDF" from the
// browser's print dialog gives a shareable file.

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const TIER = { now: 'Priority', next: 'Next', later: 'Later' };
const LH_LABEL = { performance: 'Speed on mobile', accessibility: 'Accessibility', seo: 'Search visibility', 'best-practices': 'Technical health' };
const label = (s) => (s === 'cta' || s === 'faq' ? s.toUpperCase() : String(s || 'Section').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));

const CSS = [
  'body{background:#fff !important;color:#16181d !important}',
  '.rp{max-width:820px;margin:0 auto;padding:48px 28px 80px;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6}',
  '.rp h1{font-size:30px;letter-spacing:-.02em;margin:6px 0 4px}',
  '.rp h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin:38px 0 12px}',
  '.rp .kick{color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:.08em}',
  '.rp .lead{font-size:16.5px;color:#1f2937}',
  '.rp .scores{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}',
  '.rp .score{flex:1 1 140px;border:1px solid #e5e7eb;border-radius:14px;padding:14px;text-align:center}',
  '.rp .score b{display:block;font-size:28px}',
  '.rp .score span{font-size:12px;color:#6b7280}',
  '.rp .good{color:#15803d}.rp .ok{color:#b45309}.rp .bad{color:#b91c1c}',
  '.rp ol{padding-left:20px}.rp li{margin:0 0 16px}',
  '.rp .tag{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:2px 8px;border-radius:6px;background:#f3f4f6;color:#374151;margin-right:6px}',
  '.rp .tag.now{background:#fee2e2;color:#b91c1c}',
  '.rp p{margin:4px 0}',
  '.rp .muted{color:#6b7280;font-size:13.5px}',
  '.rp .card{border:1px solid #e5e7eb;border-radius:14px;padding:16px;margin:0 0 12px}',
  '.rp .print{position:fixed;right:20px;top:20px;padding:9px 16px;border-radius:10px;border:0;background:#111827;color:#fff;font-weight:600;cursor:pointer}',
  '@media print{.rp .print{display:none}.rp{padding:0}}',
].join('\n');

export default function ClientReport() {
  const { id } = useParams();
  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch('/api/audit/' + id).then((r) => r.json()).then((j) => (j.error ? setErr(j.error) : setA(j))).catch((e) => setErr(e.message));
  }, [id]);

  if (err) return <div className='rp'><style>{CSS}</style>{err}</div>;
  if (!a) return <div className='rp'><style>{CSS}</style>Loading…</div>;
  if (a.status !== 'done') return <div className='rp'><style>{CSS}</style>This audit is still running. Open it in Stash to finish, then come back.</div>;

  const plan = a.plan || {};
  const items = (plan.items || []).filter((i) => i.tier !== 'later').slice(0, 10);
  const sections = (a.sections || []).filter((s) => s.status === 'designed');
  const band = (v) => (v >= 75 ? 'good' : v >= 50 ? 'ok' : 'bad');

  return (
    <div className='rp'>
      <style>{CSS}</style>
      <button className='print' onClick={() => window.print()}>Save as PDF</button>

      <div className='kick'>Website review · {new Date(a.updated_at || a.created_at).toLocaleDateString()}</div>
      <h1>{a.client || a.title || hostOf(a.url)}</h1>
      <div className='muted'>{a.url}</div>

      <div className='scores'>
        {a.summary?.health != null ? (
          <div className='score'><b className={band(a.summary.health)}>{a.summary.health}</b><span>Design &amp; content</span></div>
        ) : null}
        {Object.entries(a.psi?.scores || {}).map(([k, v]) => (
          <div key={k} className='score'><b className={band(v)}>{v}</b><span>{LH_LABEL[k] || k}</span></div>
        ))}
      </div>

      {plan.client_summary ? <p className='lead'>{plan.client_summary}</p> : null}

      {(plan.strengths || []).length ? (
        <>
          <h2>What is already working</h2>
          <ul>{plan.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
        </>
      ) : null}

      {items.length ? (
        <>
          <h2>What we recommend fixing</h2>
          <ol>
            {items.map((it) => (
              <li key={it.key}>
                <span className={'tag ' + it.tier}>{TIER[it.tier]}</span><b>{it.title}</b>
                <p>{it.why}</p>
                <p className='muted'>What we will do: {it.fix}</p>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {sections.length ? (
        <>
          <h2>Page sections we will improve</h2>
          {sections.map((s) => {
            const d = s.suggestion?.directions?.[s.picked ?? 0];
            return (
              <div key={s.id} className='card'>
                <b>{label(s.type)}{s.heading ? ' — “' + s.heading + '”' : ''}</b>
                <p>{s.suggestion?.diagnosis}</p>
                {d ? <p className='muted'>Plan: {d.title}. {d.idea}</p> : null}
              </div>
            );
          })}
        </>
      ) : null}
    </div>
  );
}

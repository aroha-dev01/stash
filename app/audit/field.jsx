'use client';

// Real visitors (Chrome UX Report) and Google Safe Browsing, from site.google.

const TONE = { good: 'g', 'needs work': 'y', poor: 'r' };
const NAMES = { LCP: 'Main content shows', INP: 'Reacts to taps', CLS: 'Layout stays still', FCP: 'First paint', TTFB: 'Server answers' };

function Row({ title, f }) {
  if (!f) return null;
  if (f.error) return <p className='sub'>{title}: Google did not answer ({f.error}).</p>;
  if (f.none || !f.metrics) return <p className='sub'>{title}: Google has no visitor data for this site. That is normal for sites with few visitors.</p>;
  return (
    <div style={{ overflowX: 'auto', marginTop: 8 }}>
      <div className='sub' style={{ marginBottom: 4 }}>{title}{f.level === 'site' ? ' (whole site)' : ' (this page)'}{f.period ? ' · ' + f.period.from + ' to ' + f.period.to : ''}</div>
      <table>
        <thead><tr><th>Measure</th><th>Typical visitor</th><th>Verdict</th><th>Good / poor experiences</th></tr></thead>
        <tbody>
          {Object.entries(f.metrics).map(([k, m]) => (
            <tr key={k}>
              <td className='iss'><b>{k}</b><span>{NAMES[k] || ''}</span></td>
              <td>{m.p75}{m.unit}</td>
              <td><span className={'zpill ' + (TONE[m.rating] || '')}>{m.rating}</span></td>
              <td className='area'>{m.good_pct ?? '–'}% / {m.poor_pct ?? '–'}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FieldCard({ google }) {
  if (!google || google.skipped) return null;
  const { field, safe } = google;
  const flagged = safe?.flagged || [];
  return (
    <section id='field' className='zcard pad'>
      <h2>Real visitors and safety</h2>
      <div className='sub'>What Google knows about this site from real Chrome users, and whether it is flagged as unsafe.</div>

      <h3 className='prg-h'>Google Safe Browsing</h3>
      {safe?.error ? <p className='sub'>Could not check ({safe.error}).</p> : flagged.length ? (
        <div className='pills'>
          <span className='zpill r'>Flagged as unsafe</span>
          {flagged.map((m) => <span key={m.url + m.type} className='zpill r'>{String(m.type).replace(/_/g, ' ').toLowerCase()} · {m.url}</span>)}
        </div>
      ) : <div className='pills'><span className='zpill g'>✓ Not flagged</span><span className='zpill'>{safe?.checked || 0} page{safe?.checked === 1 ? '' : 's'} checked</span></div>}

      <h3 className='prg-h'>How real visitors experience it <span className='sub'>last 28 days, 75th percentile</span></h3>
      <Row title='On phones' f={field?.phone} />
      <Row title='On desktop' f={field?.desktop} />
      <p className='sub' style={{ marginTop: 8 }}>Unlike the lab test above, this is measured from actual visitors. Google only publishes it when a site has enough traffic.</p>
    </section>
  );
}

/** One line for the client report. */
export function FieldReport({ google }) {
  if (!google || google.skipped) return null;
  const flagged = google.safe?.flagged || [];
  const m = google.field?.phone?.metrics;
  const bad = m ? Object.entries(m).filter(([n, v]) => ['LCP', 'INP', 'CLS'].includes(n) && v.rating !== 'good') : [];
  if (!flagged.length && !m) return null;
  return (
    <p className='sub' style={{ marginTop: 10 }}>
      {flagged.length ? 'Google currently warns visitors about this site. ' : google.safe?.checked ? 'Google does not flag the site as unsafe. ' : ''}
      {m ? (bad.length ? 'Real visitors on phones find ' + bad.map(([n]) => ({ LCP: 'the main content slow to appear', INP: 'taps slow to respond', CLS: 'the layout jumpy' }[n])).join(', ') + '.' : 'Real visitors on phones have a good speed experience.') : ''}
    </p>
  );
}

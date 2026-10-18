// Turns audit findings into briefs a builder (you, or an AI website builder)
// can act on without reading the whole audit. Pure text, runs in the browser.

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function stackLine(audit) {
  const s = audit.site || {};
  const bits = [s.framework && 'built with ' + s.framework, s.network?.cdn && 'served through ' + s.network.cdn, s.fonts?.[0] && 'font ' + s.fonts[0]].filter(Boolean);
  return bits.length ? bits.join(', ') : 'stack unknown';
}

function codeBlock(code) {
  if (!code) return '';
  return Object.entries(code).map(([k, v]) => '```' + (k === 'HTML' ? 'html' : k === 'React' ? 'jsx' : '') + '\n// ' + k + '\n' + v + '\n```').join('\n\n');
}

/** One fix as a self-contained instruction for a builder. */
export function fixPrompt(audit, item, how, section) {
  const host = hostOf(audit.url);
  const lines = [
    'You are working on ' + host + ' (' + stackLine(audit) + '). Make one change and nothing else.',
    '',
    'Task: ' + item.title,
    'Why: ' + item.why,
    'What to do: ' + item.fix,
  ];
  if (section) {
    lines.push('', 'Section: #' + (section.position + 1) + ' ' + (section.type || 'section') + (section.heading ? ' ("' + section.heading + '")' : ''));
    const d = section.suggestion?.directions?.[section.picked ?? 0];
    if (d?.prompt) lines.push('', 'Chosen direction: ' + d.title, d.prompt);
    else if (d) lines.push('', 'Chosen direction: ' + d.title + '. ' + d.idea);
    const tools = (section.suggestion?.visuals || []).filter((v) => v.label !== 'weak');
    if (tools.length) lines.push('', 'Reference these for the look: ' + tools.map((v) => v.why).filter(Boolean).slice(0, 2).join(' '));
  }
  if (how?.steps) lines.push('', 'Steps:', ...how.steps.map((s, i) => (i + 1) + '. ' + s[0] + ': ' + s[1]));
  if (how?.code) lines.push('', 'Reference code:', codeBlock(how.code));
  lines.push('', 'Done when: ' + (how?.verify?.length ? 'this passes ' + how.verify.map((v) => v[0]).join(' and ') + '.' : 'the change is live and the page still looks and works as before.'), 'Do not change copy, layout or anything not named above.');
  return lines.join('\n');
}

/** A whole plan as one markdown brief: client, stack, then each fix in order. */
export function briefMarkdown(audit, items, how, sectionOf, statusOf) {
  const host = hostOf(audit.url);
  const out = [
    '# Website fixes for ' + (audit.client || host),
    '',
    audit.url + ' · audited ' + new Date(audit.updated_at || audit.created_at).toLocaleDateString() + ' · ' + stackLine(audit),
    '',
  ];
  if (audit.plan?.approvals?.at) out.push('Client approved ' + (audit.plan.approvals.keys || []).length + ' items on ' + new Date(audit.plan.approvals.at).toLocaleDateString() + (audit.plan.approvals.name ? ' (' + audit.plan.approvals.name + ')' : '') + '.', '');
  items.forEach((it, i) => {
    const st = statusOf?.(it);
    out.push('## ' + (i + 1) + '. ' + it.title + (st && st !== 'open' ? '  [' + st + ']' : ''), '', '- Priority: ' + it.tier + ' · ' + it.category + ' · ' + it.effort + ' effort', '- Why: ' + it.why, '- Fix: ' + it.fix);
    const h = how(it);
    if (h?.steps) out.push('', ...h.steps.map((s, j) => (j + 1) + '. **' + s[0] + '.** ' + s[1]));
    if (h?.code) out.push('', codeBlock(h.code));
    if (h?.verify?.length) out.push('', 'Check it: ' + h.verify.map((v) => '[' + v[0] + '](' + v[1] + ')').join(' · '));
    const sec = sectionOf?.(it);
    if (sec?.suggestion?.directions?.length) {
      const d = sec.suggestion.directions[sec.picked ?? 0];
      out.push('', 'Section #' + (sec.position + 1) + ' direction: **' + d.title + '**. ' + d.idea);
    }
    out.push('');
  });
  return out.join('\n');
}

// Passive vulnerability scan of a live site: the deeper layer on top of the
// header / TLS / cookie checks in probe.js.
//
// Rules, taken from Cloudflare's security-audit skill (MIT):
//   * Only call something "confirmed" when the evidence shows the boundary
//     actually failed (the file is really served and looks like the real thing,
//     not a soft-404 page).
//   * A lead we could not prove is "needs_validation" with the exact unresolved
//     fact, and carries NO severity.
//   * A missing extra layer is a "hardening" note, never a vulnerability.
//   * Severity = likelihood x impact, with the reason stated.
//
// Safety: only GET/HEAD/OPTIONS, one request at a time per path, same host as
// the audit, identifiable user-agent, hard time cap. Nothing is sent that tries
// to exploit anything; secrets found in public JS are reported masked.

const UA = 'StashAuditBot/1.0 (+passive security check; contact site owner to opt out)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { method = 'GET', ms = 6000, max = 400_000, headers = {} } = {}) {
  try {
    const res = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(ms), headers: { 'user-agent': UA, ...headers } });
    let body = '';
    if (method === 'GET') {
      const ct = res.headers.get('content-type') || '';
      if (/text|json|javascript|xml|octet|html/i.test(ct) || !ct) {
        const buf = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
        body = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, max));
      }
    }
    return { status: res.status, headers: res.headers, body, location: res.headers.get('location') };
  } catch {
    return null;
  }
}

// severity: likelihood x impact, stated. verdict decides how it is shown.
function finding(id, verdict, severity, title, why, fix, extra = {}) {
  return {
    id,
    category: 'Security',
    verdict, // confirmed | needs_validation | hardening
    severity: verdict === 'needs_validation' ? 'low' : severity, // ranking only; hidden for needs_validation
    title, why, fix,
    source: 'security-scan',
    ...extra,
  };
}

const mask = (s) => (s.length <= 10 ? '****' : s.slice(0, 4) + '…' + s.slice(-3));

/* ----------------------------------------------- 1. exposed files and panels */

// path, a check that the body really is that file (guards against soft-404s),
// and what it means.
const EXPOSED = [
  { path: '/.git/HEAD', ok: (b) => /^ref: refs\//m.test(b), id: 'exposed-git', sev: 'critical', title: 'The site\'s source repository (.git) is downloadable',
    why: 'Anyone can rebuild the full source code and its history, including old passwords and keys that were deleted later.',
    fix: 'Block /.git at the web server (deny all) or stop deploying the .git folder. Rotate any secret that was ever committed.' },
  { path: '/.env', ok: (b) => /^[A-Z][A-Z0-9_]{2,}\s*=/m.test(b) && !/<html/i.test(b), id: 'exposed-env', sev: 'critical', title: 'A .env configuration file is publicly readable',
    why: 'These files normally hold database passwords and API keys. Anyone can read them with a normal web request.',
    fix: 'Remove the file from the web root, deny dotfiles in the server config, and rotate every key it contained.' },
  { path: '/wp-config.php.bak', ok: (b) => /DB_PASSWORD|DB_NAME/.test(b), id: 'exposed-backup', sev: 'critical', title: 'A backup of the site configuration is downloadable',
    why: 'The backup holds the database login in plain text.', fix: 'Delete backup files from the web root and rotate the database password.' },
  { path: '/backup.zip', ok: (b, r) => /zip|octet/i.test(r.headers.get('content-type') || '') && b.startsWith('PK'), id: 'exposed-backup', sev: 'high', title: 'A site backup archive is downloadable',
    why: 'Archives usually contain the source and database dump.', fix: 'Delete it from the web root and keep backups off public paths.' },
  { path: '/phpinfo.php', ok: (b) => /PHP Version|phpinfo\(\)/i.test(b), id: 'exposed-phpinfo', sev: 'medium', title: 'phpinfo() page is public',
    why: 'It lists server paths, modules and environment values that help an attacker plan.', fix: 'Delete the file.' },
  { path: '/server-status', ok: (b) => /Apache Server Status/i.test(b), id: 'exposed-server-status', sev: 'medium', title: 'Apache server-status is public',
    why: 'Shows live requests and visitor IP addresses.', fix: 'Restrict /server-status to localhost or disable mod_status.' },
  { path: '/.DS_Store', ok: (b) => b.startsWith('\u0000\u0000\u0000\u0001Bud1'), id: 'exposed-dsstore', sev: 'low', title: 'A .DS_Store file leaks folder contents',
    why: 'It lists file names in the folder, which reveals hidden files to look for.', fix: 'Delete .DS_Store files and add them to the deploy ignore list.' },
  { path: '/composer.json', ok: (b) => /"require"\s*:/.test(b), id: 'exposed-manifest', sev: 'low', title: 'Dependency list (composer.json) is public',
    why: 'Shows exactly which libraries and versions the site runs, so known bugs can be targeted.', fix: 'Do not deploy manifest files to the web root.' },
  { path: '/package.json', ok: (b) => /"(dependencies|devDependencies|scripts)"\s*:/.test(b), id: 'exposed-manifest', sev: 'low', title: 'Dependency list (package.json) is public',
    why: 'Shows exactly which libraries and versions the site runs.', fix: 'Do not deploy manifest files to the web root.' },
];

const SURFACES = [
  { path: '/swagger.json', ok: (b) => /"swagger"|"openapi"/.test(b), id: 'api-docs-public', label: 'Swagger / OpenAPI' },
  { path: '/openapi.json', ok: (b) => /"openapi"/.test(b), id: 'api-docs-public', label: 'OpenAPI' },
  { path: '/api-docs', ok: (b) => /swagger|openapi/i.test(b), id: 'api-docs-public', label: 'API docs' },
  { path: '/graphql?query=%7B__typename%7D', ok: (b) => /"__typename"/.test(b), id: 'graphql-public', label: 'GraphQL endpoint' },
];

async function exposedFiles(origin, add, facts) {
  const hits = [];
  // A soft-404 baseline: if a random path returns 200 HTML, "200" proves nothing,
  // and the body checks above are what we rely on.
  for (const e of EXPOSED) {
    const r = await get(origin + e.path, { ms: 5000, max: 60_000 });
    await sleep(120);
    if (r && r.status === 200 && e.ok(r.body, r)) {
      hits.push(e.path);
      add(e.id, 'confirmed', e.sev, e.title, e.why, e.fix, {
        evidence: [origin + e.path + ' returned 200 and the content matches the file type'],
        likelihood: 'high: needs only a normal web request', impact: e.sev,
      });
    }
  }
  for (const s of SURFACES) {
    const r = await get(origin + s.path, { ms: 5000, max: 80_000 });
    await sleep(120);
    if (r && r.status === 200 && s.ok(r.body)) {
      hits.push(s.path);
      add(s.id, 'hardening', 'low', s.label + ' is open to the public',
        'Public API documentation or schema shows every endpoint and field. That is fine for a public API, but a gift to attackers if the API was meant to be private.',
        'If this API is not meant to be public, require login for the docs and disable GraphQL introspection in production.',
        { evidence: [origin + s.path] });
    }
  }
  facts.exposed_paths = hits;
}

/* --------------------------------------------- 2. directory listing, WP, errors */

async function surfaceChecks(origin, add, facts) {
  // WordPress user enumeration through the REST API
  const wp = await get(origin + '/wp-json/wp/v2/users?per_page=3', { ms: 5000, max: 40_000 });
  if (wp?.status === 200 && /^\s*\[\s*\{[^]*"slug"/.test(wp.body)) {
    let names = [];
    try { names = JSON.parse(wp.body).map((u) => u.slug).filter(Boolean).slice(0, 3); } catch {}
    add('wp-user-enum', 'confirmed', 'medium', 'WordPress lists its usernames to anyone',
      'Attackers get valid admin usernames for free, which halves the work of a password-guessing attack.',
      'Disable the public /wp-json/wp/v2/users endpoint (a small snippet or a security plugin) and use strong, unique admin logins with 2-factor.',
      { evidence: ['Usernames returned: ' + names.join(', ')], likelihood: 'high', impact: 'medium: account-guessing aid, not access by itself' });
    facts.cms = 'WordPress';
  }
  await sleep(120);
  const xml = await get(origin + '/xmlrpc.php', { ms: 5000, max: 5000 });
  if (xml && xml.status !== 404 && /XML-RPC server accepts POST/i.test(xml.body)) {
    add('wp-xmlrpc', 'hardening', 'low', 'WordPress XML-RPC is switched on',
      'XML-RPC is an old remote-access door that is often used for password-guessing and DDoS amplification. Most sites do not need it.',
      'Disable XML-RPC unless an app you use needs it (a one-line filter or a plugin setting).');
    facts.cms = 'WordPress';
  }
  await sleep(120);

  // Error pages that leak stack traces or file paths
  const bad = await get(origin + '/stash-probe-' + Math.random().toString(36).slice(2, 8) + '%00', { ms: 5000, max: 40_000 });
  if (bad) {
    const leak = bad.body.match(/(Traceback \(most recent call last\)|at [\w$.]+ \([^)]*\.(?:js|ts):\d+:\d+\)|Fatal error:.*on line \d+|<b>Warning<\/b>:.*on line|Stack trace:|SQLSTATE\[|ORA-\d{5}|You have an error in your SQL syntax)/i);
    if (leak) {
      add('error-disclosure', 'confirmed', 'medium', 'Error pages reveal internal details',
        'A broken address returned a stack trace or database error. That shows file paths, framework versions or queries an attacker can use.',
        'Turn off debug mode in production and show a plain error page. Log details privately instead.',
        { evidence: ['Matched: ' + leak[0].slice(0, 80)], likelihood: 'high: any visitor can trigger it', impact: 'medium: information disclosure' });
    }
  }
  await sleep(120);

  // Directory listing on common asset folders
  for (const p of ['/uploads/', '/wp-content/uploads/', '/assets/', '/static/', '/images/']) {
    const r = await get(origin + p, { ms: 4000, max: 20_000 });
    if (r?.status === 200 && /<title>\s*Index of \//i.test(r.body)) {
      add('directory-listing', 'confirmed', 'medium', 'A folder lists all its files (' + p + ')',
        'Directory listing shows every file in the folder, including ones never linked anywhere, such as exports and old uploads.',
        'Disable directory listing (Options -Indexes on Apache, autoindex off on nginx) and check what is in that folder.',
        { evidence: [origin + p], likelihood: 'high', impact: 'medium: depends on what the folder holds' });
      break;
    }
  }
  await sleep(120);

  // HTTP methods
  const opt = await get(origin + '/', { method: 'OPTIONS', ms: 5000 });
  const allow = (opt?.headers.get('allow') || '').toUpperCase();
  if (/\b(TRACE|TRACK)\b/.test(allow)) {
    add('trace-enabled', 'hardening', 'low', 'HTTP TRACE is enabled',
      'TRACE echoes requests back and has been used to steal cookies in old browsers. Modern browsers block this, so it is a hardening gap.',
      'Disable TRACE (TraceEnable off on Apache).');
  }
}

/* ---------------------------------------- 3. what the page ships to visitors */

const SECRET_PATTERNS = [
  { re: /AKIA[0-9A-Z]{16}/g, name: 'AWS access key ID', sev: 'critical', needsPair: true },
  { re: /sk_live_[0-9a-zA-Z]{20,}/g, name: 'Stripe live secret key', sev: 'critical' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g, name: 'private key', sev: 'critical' },
  { re: /xox[baprs]-[0-9A-Za-z-]{20,}/g, name: 'Slack token', sev: 'high' },
  { re: /ghp_[0-9A-Za-z]{36}/g, name: 'GitHub token', sev: 'high' },
  { re: /sk-ant-[0-9A-Za-z_-]{30,}/g, name: 'Anthropic API key', sev: 'critical' },
  { re: /sk-(?:proj-)?[0-9A-Za-z_-]{40,}/g, name: 'OpenAI-style API key', sev: 'critical' },
  { re: /SG\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{30,}/g, name: 'SendGrid API key', sev: 'high' },
];

function jwtRole(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return p.role || null;
  } catch { return null; }
}

// Known-vulnerable client libraries, from the version in the file name or header comment.
const LIBS = [
  { name: 'jQuery', re: /jquery[-.\/ ]v?(\d+\.\d+\.\d+)(?:\.min)?\.js|jQuery v(\d+\.\d+\.\d+)/i, below: [3, 5, 0], issue: 'cross-site scripting bugs fixed in 3.5.0 (CVE-2020-11022/11023)', fix: 'Update jQuery to 3.7 or later.' },
  { name: 'Bootstrap', re: /bootstrap[-.\/ ]v?(\d+\.\d+\.\d+)(?:\.min)?\.(?:js|css)|Bootstrap v(\d+\.\d+\.\d+)/i, below: [4, 3, 1], issue: 'cross-site scripting bugs in older 3.x/4.x tooltips and data attributes', fix: 'Update Bootstrap to 5.3 or later.' },
  { name: 'AngularJS', re: /angular(?:\.min)?\.js.*?v?(1\.\d+\.\d+)|AngularJS v(1\.\d+\.\d+)/i, below: [2, 0, 0], issue: 'AngularJS reached end of life in January 2022 and has unpatched sandbox-escape bugs', fix: 'Plan a move to a maintained framework; until then avoid rendering user input in templates.' },
  { name: 'Lodash', re: /lodash[-.\/ ]v?(\d+\.\d+\.\d+)(?:\.min)?\.js|lodash (\d+\.\d+\.\d+)/i, below: [4, 17, 21], issue: 'prototype-pollution and command-injection bugs fixed by 4.17.21', fix: 'Update Lodash to 4.17.21 or later.' },
  { name: 'Moment.js', re: /moment[-.\/ ]v?(\d+\.\d+\.\d+)(?:\.min)?\.js|moment\.js.*?version\s*:?\s*(\d+\.\d+\.\d+)/i, below: [2, 29, 4], issue: 'path-traversal and ReDoS bugs fixed by 2.29.4', fix: 'Update Moment to 2.29.4 or move to date-fns/Day.js.' },
];
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); return 0; };

async function clientSide(origin, html, add, facts) {
  const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  const urls = [...new Set(srcs.map((s) => { try { return new URL(s, origin).href; } catch { return null; } }).filter(Boolean))];
  const own = urls.filter((u) => new URL(u).origin === origin).slice(0, 8);
  facts.scripts_checked = own.length;

  // outdated libraries: from any script URL (first or third party) and from file headers
  const libsSeen = new Map();
  const bodies = [];
  for (const u of own) {
    const r = await get(u, { ms: 6000, max: 700_000 });
    if (r?.status === 200) bodies.push({ url: u, body: r.body });
    await sleep(80);
  }
  const sources = [...urls.map((u) => ({ url: u, text: u })), ...bodies.map((b) => ({ url: b.url, text: b.body.slice(0, 2500) }))];
  for (const s of sources) {
    for (const L of LIBS) {
      const m = s.text.match(L.re);
      const v = m && (m[1] || m[2]);
      if (!v) continue;
      const parts = v.split('.').map(Number);
      if (cmp(parts, L.below) < 0 && !libsSeen.has(L.name)) libsSeen.set(L.name, { ...L, version: v, url: s.url });
    }
  }
  if (libsSeen.size) {
    const list = [...libsSeen.values()];
    add('outdated-libraries', 'confirmed', list.some((l) => l.name === 'AngularJS') ? 'high' : 'medium',
      list.length + ' outdated library' + (list.length > 1 ? ' versions have' : ' version has') + ' known security bugs (' + list.map((l) => l.name + ' ' + l.version).join(', ') + ')',
      list.map((l) => l.name + ' ' + l.version + ': ' + l.issue + '.').join(' ') + ' Whether a bug is reachable depends on how the site uses the library, so treat this as exposure to check, not proof of a break-in.',
      list.map((l) => l.fix).join(' '),
      { evidence: list.map((l) => l.name + ' ' + l.version + ' at ' + l.url), likelihood: 'medium: needs a usable code path', impact: 'medium: cross-site scripting in the visitor\'s browser' });
  }

  // secrets in shipped JavaScript and HTML
  const found = [];
  for (const b of [{ url: origin, body: html }, ...bodies]) {
    for (const p of SECRET_PATTERNS) {
      for (const m of b.body.matchAll(p.re)) {
        if (found.some((f) => f.val === m[0])) continue;
        found.push({ ...p, val: m[0], url: b.url });
      }
    }
    for (const m of b.body.matchAll(/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g)) {
      const role = jwtRole(m[0]);
      if (role === 'service_role' && !found.some((f) => f.val === m[0])) found.push({ name: 'Supabase service_role key', sev: 'critical', val: m[0], url: b.url });
    }
  }
  if (found.length) {
    const top = found.sort((a, b) => ['critical', 'high'].indexOf(a.sev) - ['critical', 'high'].indexOf(b.sev))[0];
    add('secrets-in-js', 'confirmed', top.sev,
      'A secret key is exposed in the page\'s code (' + [...new Set(found.map((f) => f.name))].join(', ') + ')',
      'Anything shipped to the browser is public. A key like this lets anyone act as the site against that service: read data, send messages or run up bills.',
      'Revoke and rotate the key now, then move the call to a server route or edge function so the key never reaches the browser.',
      { evidence: found.slice(0, 4).map((f) => f.name + ' ' + mask(f.val) + ' in ' + f.url), likelihood: 'high: visible to every visitor', impact: top.sev + ': full use of that service account' });
  }

  // source maps expose original source
  const mapped = bodies.filter((b) => /\/\/[#@]\s*sourceMappingURL=(?!data:)([^\s]+\.map)/.test(b.body.slice(-400)));
  const probed = [];
  for (const b of mapped.slice(0, 2)) {
    const m = b.body.slice(-400).match(/sourceMappingURL=([^\s]+\.map)/);
    const mu = new URL(m[1], b.url).href;
    const r = await get(mu, { ms: 6000, max: 4000 });
    if (r?.status === 200 && /"sources"\s*:/.test(r.body + '"sources":')) probed.push(mu);
    await sleep(80);
  }
  if (probed.length) {
    add('source-maps-public', 'hardening', 'low', 'Source maps publish the original code',
      'Anyone can read the un-minified source, including comments and internal routes. That makes bugs and hidden endpoints easier to find. It is not a break-in on its own.',
      'Stop publishing .map files in production, or serve them only to your error-tracking tool.',
      { evidence: probed });
  }
}

/* ------------------------------------------------------------------ entry */

/**
 * @param url the audited homepage
 * @returns { facts, findings } never throws; partial on timeout
 */
export async function securityScan(url, capMs = 20000) {
  const findings = [];
  const facts = { fetched_at: new Date().toISOString() };
  const add = (id, verdict, sev, title, why, fix, extra) => findings.push(finding(id, verdict, sev, title, why, fix, extra));
  let origin;
  try { origin = new URL(url).origin; } catch { return { facts: { skipped: 'Bad URL' }, findings: [] }; }

  const run = async () => {
    const home = await get(origin + '/', { ms: 7000, max: 600_000 });
    // follow one redirect (http -> https, www) so we scan the real page
    let page = home;
    if (home && [301, 302, 307, 308].includes(home.status) && home.location) {
      try { const next = new URL(home.location, origin); if (next.hostname.replace(/^www\./, '') === new URL(origin).hostname.replace(/^www\./, '')) { origin = next.origin; page = await get(origin + '/', { ms: 7000, max: 600_000 }); } } catch {}
    }
    const html = page?.status === 200 ? page.body : '';
    await Promise.allSettled([
      exposedFiles(origin, add, facts),
      surfaceChecks(origin, add, facts),
      html ? clientSide(origin, html, add, facts) : null,
    ]);
  };
  await Promise.race([run(), sleep(capMs)]);

  const order = { critical: 4, high: 3, medium: 2, low: 1 };
  findings.sort((a, b) => (order[b.severity] || 0) - (order[a.severity] || 0));
  facts.counts = {
    confirmed: findings.filter((f) => f.verdict === 'confirmed').length,
    hardening: findings.filter((f) => f.verdict === 'hardening').length,
    needs_validation: findings.filter((f) => f.verdict === 'needs_validation').length,
  };
  return { facts, findings: [...findings] };
}

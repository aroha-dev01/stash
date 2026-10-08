import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { fetchRepo } from '@/lib/scrape';
import { enrichLink } from '@/lib/enrich';
import { fetchTimeout, USER_AGENT } from '@/lib/util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The freshness sweep.
//
// Saved data rots quietly: repos get archived, star counts drift, domains
// lapse, and an enrichment that failed once stays failed forever. Nothing in
// the app noticed any of that until now.
//
// It runs daily and works through a SLICE rather than the whole library,
// oldest-checked first. Three reasons: a serverless function has 60 seconds,
// checking every link would hammer other people's servers, and a rolling
// window means the collection stays evenly fresh instead of being perfect the
// day it runs and stale by the end of the week.

const BATCH = 25;        // links health-checked per run
const REPO_REFRESH = 10; // GitHub calls per run - unauthenticated is rate limited
const REENRICH = 3;      // slowest step, so the tightest cap

function authorised(req) {
  // Vercel signs its own cron invocations with CRON_SECRET when it is set.
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') || '';

  if (secret) return auth === 'Bearer ' + secret;

  // No secret configured: accept Vercel's own scheduler, or a manual run
  // carrying the MCP token if one exists.
  if (req.headers.get('x-vercel-cron')) return true;
  const token = process.env.STASH_TOKEN;
  if (token) return auth === 'Bearer ' + token;
  return true;
}

/**
 * Is this URL still there?
 *
 * Three outcomes, not two, and the distinction matters.
 *
 *   'gone'    an explicit 404 or 410. The server answered and said no.
 *   'alive'   any other response, including 401 and 403 - gated is not gone.
 *   'unknown' the request never completed: timeout, DNS, connection reset.
 *
 * The first version of this collapsed 'unknown' into 'gone' and immediately
 * flagged eight live GitHub repos as broken, anthropics/skills among them,
 * because GitHub throttles rapid sequential requests from one address. A
 * network error says something about the network, not about the link. Only a
 * repeated failure across separate days is worth acting on.
 *
 * HEAD first because it is cheap, then GET, because plenty of sites behind a
 * CDN reject HEAD with 403 or 405 while serving GET perfectly well.
 */
async function checkAlive(url) {
  const headers = { 'user-agent': USER_AGENT, accept: '*/*' };

  try {
    const head = await fetchTimeout(url, { method: 'HEAD', headers }, 8000);
    if (head.status === 404 || head.status === 410) return { state: 'gone', reason: 'HTTP ' + head.status };
    if (head.ok) return { state: 'alive' };
  } catch {
    // Ambiguous so far; try a real GET before drawing any conclusion.
  }

  try {
    const get = await fetchTimeout(url, { method: 'GET', headers }, 10000);
    if (get.status === 404 || get.status === 410) return { state: 'gone', reason: 'HTTP ' + get.status };
    return { state: 'alive' };
  } catch (e) {
    const why = e.name === 'TimeoutError' ? 'no response' : e.message;
    return { state: 'unknown', reason: why.slice(0, 120) };
  }
}

/** Consecutive failed sweeps before an unreachable link is called broken. */
const STRIKES = 3;

export async function GET(req) {
  if (!authorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const started = Date.now();
  const report = {
    checked: 0, revived: 0, newly_dead: 0, unclear: 0,
    repos_refreshed: 0, star_changes: [], re_enriched: 0,
  };

  // Oldest first, and never-checked before that.
  const { data: due, error } = await db
    .from('links')
    .select('id,url,status,dead,fail_count,repo_owner,repo_name,repo_stars,title')
    .order('checked_at', { ascending: true, nullsFirst: true })
    .limit(BATCH);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let repoBudget = REPO_REFRESH;
  let enrichBudget = REENRICH;

  for (const link of due || []) {
    // Leave headroom so the function always gets to write its results.
    if (Date.now() - started > 45000) break;

    const patch = { checked_at: new Date().toISOString() };

    const check = await checkAlive(link.url);

    if (check.state === 'gone') {
      // The server answered and said no. Believe it immediately.
      patch.dead = true;
      patch.dead_reason = check.reason;
      patch.fail_count = (link.fail_count || 0) + 1;
      if (!link.dead) report.newly_dead += 1;
    } else if (check.state === 'unknown') {
      const strikes = (link.fail_count || 0) + 1;
      patch.fail_count = strikes;
      if (strikes >= STRIKES) {
        patch.dead = true;
        patch.dead_reason = 'Unreachable on ' + strikes + ' separate checks (' + check.reason + ')';
        if (!link.dead) report.newly_dead += 1;
      } else {
        // Counted, but not condemned on one bad afternoon.
        report.unclear += 1;
      }
    } else {
      patch.dead = false;
      patch.dead_reason = null;
      patch.fail_count = 0;
      if (link.dead) report.revived += 1;
    }
    report.checked += 1;

    // A brief pause so 25 checks do not look like a burst to any one host.
    // GitHub in particular throttles, which is what produced the first run's
    // false positives.
    await new Promise((r) => setTimeout(r, 120));

    // Star counts are the fastest-moving fact in the whole record.
    if (check.state === 'alive' && repoBudget > 0 && link.repo_owner && link.repo_name) {
      repoBudget -= 1;
      const repo = await fetchRepo(link.url);
      if (repo) {
        if (repo.repo_stars != null && repo.repo_stars !== link.repo_stars) {
          report.star_changes.push({
            title: link.title,
            from: link.repo_stars,
            to: repo.repo_stars,
          });
        }
        patch.repo_stars = repo.repo_stars;
        patch.repo_forks = repo.repo_forks;
        patch.repo_open_issues = repo.repo_open_issues;
        patch.repo_open_prs = repo.repo_open_prs;
        patch.repo_language = repo.repo_language;
        patch.repo_license = repo.repo_license;
        patch.repo_pushed_at = repo.repo_pushed_at;
        report.repos_refreshed += 1;
      }
    }

    await db.from('links').update(patch).eq('id', link.id);

    // A link that never finished enriching gets another go, now that whatever
    // was failing may have passed.
    if (check.state === 'alive' && enrichBudget > 0 && link.status !== 'ready') {
      enrichBudget -= 1;
      try {
        await enrichLink(link.id);
        report.re_enriched += 1;
      } catch {
        // Next sweep will try again.
      }
    }
  }

  const { data: facets } = await db.rpc('stash_facets');

  return NextResponse.json({
    ok: true,
    took_ms: Date.now() - started,
    ...report,
    library: facets?.stats ?? null,
  });
}

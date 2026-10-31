import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth';
import { policyFor } from '@/lib/access';
import { overview } from '@/lib/browse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Counts for the landing page and the explore rail: per toolkit, per type,
 * and how much of each this viewer can open. Only aggregates, never rows.
 * Never the facets RPC, whose collections are client project names.
 */
export async function GET() {
  const policy = await policyFor(await getViewer());
  try {
    return NextResponse.json({ ...(await overview(policy)), level: policy.level });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

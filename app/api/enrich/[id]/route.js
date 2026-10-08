import { NextResponse } from 'next/server';
import { enrichLink } from '@/lib/enrich';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Enrichment does up to three sequential network calls: fetch the page, ask
// GitHub, ask the model. 60s is the Hobby ceiling and each internal step has a
// tighter timeout so the total cannot run away.
export const maxDuration = 60;

export async function POST(_req, { params }) {
  const { id } = await params;
  const result = await enrichLink(Number(id));
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

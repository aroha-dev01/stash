import { NextResponse } from 'next/server';
import { db, shape } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Your whole stash as JSON. The embedding column is dropped — it's derived. */
export async function GET() {
  const { data, error } = await db
    .from('links')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const links = (data || []).map((r) => {
    const { embedding, fts, ...rest } = r;
    return shape(rest);
  });

  return new NextResponse(JSON.stringify({ exported_at: new Date().toISOString(), count: links.length, links }, null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="stash-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

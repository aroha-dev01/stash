import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSetting, setSetting } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  return NextResponse.json({ catalogue: await getSetting('catalogue') });
}

export async function PATCH(req) {
  const { error } = await requireAdmin();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  if (typeof body.new_entries_premium !== 'boolean') {
    return NextResponse.json({ error: 'Send new_entries_premium: true or false' }, { status: 400 });
  }
  return NextResponse.json({ catalogue: await setSetting('catalogue', { new_entries_premium: body.new_entries_premium }) });
}

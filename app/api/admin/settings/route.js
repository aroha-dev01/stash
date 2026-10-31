import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSetting, setSetting } from '@/lib/settings';
import { TOOLKITS } from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIERS = ['public', 'free', 'premium'];

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  return NextResponse.json({ catalogue: await getSetting('catalogue') });
}

/** { new_entries_access?: tier, premium_toolkits?: toolkit keys } */
export async function PATCH(req) {
  const { error } = await requireAdmin();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const patch = {};

  if ('new_entries_access' in body) {
    if (!TIERS.includes(body.new_entries_access)) {
      return NextResponse.json({ error: 'new_entries_access must be public, free or premium' }, { status: 400 });
    }
    patch.new_entries_access = body.new_entries_access;
    patch.new_entries_premium = body.new_entries_access !== 'public'; // for the deployment that still reads it
  }
  if ('premium_toolkits' in body) {
    if (!Array.isArray(body.premium_toolkits)) {
      return NextResponse.json({ error: 'premium_toolkits must be a list of toolkit keys' }, { status: 400 });
    }
    patch.premium_toolkits = [...new Set(body.premium_toolkits)].filter((k) => TOOLKITS.some((t) => t.key === k));
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'Send new_entries_access or premium_toolkits' }, { status: 400 });
  }
  return NextResponse.json({ catalogue: await setSetting('catalogue', patch) });
}

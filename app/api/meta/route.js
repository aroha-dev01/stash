import { NextResponse } from 'next/server';
import { llmStatus } from '@/lib/llm';
import { CATEGORIES } from '@/lib/taxonomy';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { error: denied } = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json({
    categories: CATEGORIES,
    llm: llmStatus(),
    semantic: {
      enabled: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      via: 'supabase gte-small',
    },
    supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
}

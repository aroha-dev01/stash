import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import AdminApp from './admin-app';
import '../globals.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Curate' };

/** The curator's tool for adding, editing and tagging catalogue entries. Admins only. */
export default async function AdminPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login?next=/admin');
  if (!viewer.isAdmin) redirect('/explore');
  return <AdminApp />;
}

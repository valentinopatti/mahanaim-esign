'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from './RequireAuth';
import { supabase } from '../lib/supabaseClient';

export default function AppHeader() {
  const { profile } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  return (
    <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
      <Link href="/dashboard" className="font-bold text-slate-800 text-sm sm:text-base">Mahanaim Studio Sign</Link>
      <nav className="flex items-center gap-3 sm:gap-4 text-xs sm:text-sm font-medium text-slate-600">
        <Link href="/dashboard" className="hover:text-blue-600">Dashboard</Link>
        <Link href="/profile" className="hover:text-blue-600">Profil</Link>
        {profile?.is_admin && <Link href="/admin/users" className="hover:text-blue-600">Kelola User</Link>}
        <span className="hidden sm:inline text-slate-300">|</span>
        <span className="hidden sm:inline text-slate-400">{profile?.full_name}</span>
        <button onClick={handleLogout} className="text-red-500 hover:text-red-600 font-semibold">Keluar</button>
      </nav>
    </header>
  );
}

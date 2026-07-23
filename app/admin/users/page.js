'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import RequireAuth, { useAuth } from '../../components/RequireAuth';
import AppHeader from '../../components/AppHeader';
import { authedFetch } from '../../lib/authedFetch';

function AdminUsersContent() {
  const { profile } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadUsers = async () => {
    const res = await authedFetch('/api/admin/users');
    if (res.ok) setUsers((await res.json()).users);
  };

  useEffect(() => {
    if (profile && !profile.is_admin) {
      router.replace('/dashboard');
      return;
    }
    if (profile?.is_admin) loadUsers();
  }, [profile]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const res = await authedFetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ full_name: fullName, email, password }),
    });
    setSubmitting(false);
    if (res.ok) {
      setFullName(''); setEmail(''); setPassword('');
      loadUsers();
    } else {
      const { error: msg } = await res.json();
      setError(msg || 'Gagal menambahkan user.');
    }
  };

  if (!profile?.is_admin) return null;

  return (
    <div className="min-h-[100dvh] bg-slate-100">
      <AppHeader />
      <main className="max-w-xl mx-auto p-4 sm:p-6 space-y-6">
        <h1 className="text-lg font-bold text-slate-800">Kelola User</h1>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-700">+ Tambah User Baru</h2>
          <input required placeholder="Nama lengkap" value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input required type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input required type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-lg">
            {submitting ? 'Menambahkan...' : 'Tambah User'}
          </button>
        </form>

        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {users.map((u) => (
            <div key={u.id} className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-800">{u.full_name}{u.is_admin && <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">Admin</span>}</p>
                <p className="text-xs text-slate-400">{u.email}</p>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <RequireAuth>
      <AdminUsersContent />
    </RequireAuth>
  );
}

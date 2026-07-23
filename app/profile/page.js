'use client';

import { useState } from 'react';
import RequireAuth, { useAuth } from '../components/RequireAuth';
import AppHeader from '../components/AppHeader';
import SignaturePad from '../components/SignaturePad';
import { authedFetch } from '../lib/authedFetch';
import { supabase } from '../lib/supabaseClient';

function ProfileContent() {
  const { profile, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [nameMsg, setNameMsg] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [padOpen, setPadOpen] = useState(false);

  const saveName = async (e) => {
    e.preventDefault();
    setSavingName(true);
    setNameMsg('');
    const res = await authedFetch('/api/profile', { method: 'PATCH', body: JSON.stringify({ full_name: fullName }) });
    setSavingName(false);
    setNameMsg(res.ok ? 'Tersimpan.' : 'Gagal menyimpan.');
    if (res.ok) refreshProfile();
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) { setPasswordMsg('Password minimal 6 karakter.'); return; }
    setSavingPassword(true);
    setPasswordMsg('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    setPasswordMsg(error ? 'Gagal mengubah password.' : 'Password berhasil diubah.');
    if (!error) setNewPassword('');
  };

  const handleSaveSignature = async (dataUrl) => {
    const res = await authedFetch('/api/profile', { method: 'PATCH', body: JSON.stringify({ saved_signature: dataUrl }) });
    if (res.ok) { await refreshProfile(); setPadOpen(false); }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-100">
      <AppHeader />
      <main className="max-w-xl mx-auto p-4 sm:p-6 space-y-6">
        <h1 className="text-lg font-bold text-slate-800">Profil Saya</h1>

        <form onSubmit={saveName} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-700">Informasi Akun</h2>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Nama</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
            <input value={profile?.email || ''} disabled className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm text-slate-400" />
          </div>
          {nameMsg && <p className="text-xs text-emerald-600">{nameMsg}</p>}
          <button type="submit" disabled={savingName} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-lg">
            {savingName ? 'Menyimpan...' : 'Simpan Nama'}
          </button>
        </form>

        <form onSubmit={changePassword} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-700">Ubah Password</h2>
          <input
            type="password" placeholder="Password baru" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          {passwordMsg && <p className="text-xs text-slate-500">{passwordMsg}</p>}
          <button type="submit" disabled={savingPassword} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-lg">
            {savingPassword ? 'Menyimpan...' : 'Ubah Password'}
          </button>
        </form>

        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-700">Tanda Tangan Saya</h2>
          <p className="text-xs text-slate-500">Tanda tangan ini akan otomatis dipakai setiap kali Anda menandatangani dokumen.</p>
          {profile?.saved_signature ? (
            <img src={profile.saved_signature} alt="Tanda tangan tersimpan" className="h-16 border border-slate-200 rounded bg-slate-50 object-contain" />
          ) : (
            <p className="text-xs text-slate-400 italic">Belum ada tanda tangan tersimpan.</p>
          )}
          <button onClick={() => setPadOpen(true)} className="bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold px-4 py-2 rounded-lg">
            {profile?.saved_signature ? 'Ubah Tanda Tangan' : 'Buat Tanda Tangan'}
          </button>
        </div>

        {padOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-xl">
              <h3 className="text-base font-bold text-slate-800 mb-3">Buat Tanda Tangan</h3>
              <SignaturePad onSave={handleSaveSignature} onCancel={() => setPadOpen(false)} saveLabel="Simpan" />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileContent />
    </RequireAuth>
  );
}

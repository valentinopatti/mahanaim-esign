'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import RequireAuth from '../../components/RequireAuth';
import AppHeader from '../../components/AppHeader';
import { authedFetch } from '../../lib/authedFetch';
import { loadPdfjs } from '../../lib/pdfjs';

export default function NewDocumentPage() {
  const router = useRouter();
  const [allUsers, setAllUsers] = useState([]);
  const [file, setFile] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [signingMode, setSigningMode] = useState('parallel');
  const [recipients, setRecipients] = useState([]);
  const [requiredPagesByUser, setRequiredPagesByUser] = useState({});
  const [pickUserId, setPickUserId] = useState('');
  const [pickRole, setPickRole] = useState('signer');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const res = await authedFetch('/api/users');
      if (res.ok) setAllUsers((await res.json()).users);
    })();
  }, []);

  const availableUsers = allUsers.filter((u) => !recipients.some((r) => r.user_id === u.id));

  const handleFileChange = async (e) => {
    const selected = e.target.files[0];
    setFile(selected);
    setNumPages(null);
    if (!selected) return;
    const pdfjsLib = await loadPdfjs();
    const arrayBuffer = await selected.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    setNumPages(pdf.numPages);
  };

  const addRecipient = () => {
    if (!pickUserId) return;
    const user = allUsers.find((u) => u.id === pickUserId);
    const signerCount = recipients.filter((r) => r.role === 'signer').length;
    setRecipients([...recipients, {
      user_id: user.id,
      full_name: user.full_name,
      role: pickRole,
      order_index: pickRole === 'signer' ? signerCount + 1 : 1,
    }]);
    setPickUserId('');
  };

  const removeRecipient = (userId) => {
    setRecipients(recipients.filter((r) => r.user_id !== userId));
    setRequiredPagesByUser((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  };

  const updateOrder = (userId, orderIndex) => {
    setRecipients(recipients.map((r) => (r.user_id === userId ? { ...r, order_index: orderIndex } : r)));
  };

  const toggleRequiredPage = (userId, pageNum) => {
    setRequiredPagesByUser((prev) => {
      const current = prev[userId] || [];
      const next = current.includes(pageNum) ? current.filter((p) => p !== pageNum) : [...current, pageNum].sort((a, b) => a - b);
      return { ...prev, [userId]: next };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!file) return setError('Pilih file PDF terlebih dahulu.');
    if (recipients.length === 0) return setError('Tambahkan minimal 1 penerima.');

    const missingRequired = recipients.filter((r) => r.role === 'signer' && (!requiredPagesByUser[r.user_id] || requiredPagesByUser[r.user_id].length === 0));
    if (missingRequired.length > 0) {
      return setError(`Tentukan halaman wajib TTD untuk: ${missingRequired.map((r) => r.full_name).join(', ')}.`);
    }

    setSubmitting(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('signing_mode', signingMode);
    formData.append('recipients', JSON.stringify(recipients.map(({ user_id, role, order_index }) => ({ user_id, role, order_index }))));
    formData.append('required_pages', JSON.stringify(requiredPagesByUser));

    const res = await authedFetch('/api/documents', { method: 'POST', body: formData });
    setSubmitting(false);
    if (res.ok) {
      router.push('/dashboard');
    } else {
      const { error: msg } = await res.json();
      setError(msg || 'Gagal mengirim dokumen.');
    }
  };

  return (
    <RequireAuth>
      <div className="min-h-[100dvh] bg-slate-100">
        <AppHeader />
        <main className="max-w-xl mx-auto p-4 sm:p-6">
          <h1 className="text-lg font-bold text-slate-800 mb-4">Kirim Dokumen Baru</h1>
          <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">1. Upload Dokumen (PDF)</label>
              <input type="file" accept=".pdf" required onChange={handleFileChange} className="w-full text-sm" />
              {file && !numPages && <p className="text-[11px] text-slate-400 mt-1">Menganalisis jumlah halaman...</p>}
              {numPages && <p className="text-[11px] text-slate-400 mt-1">{numPages} halaman terdeteksi.</p>}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-2">2. Mode Tanda Tangan</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSigningMode('parallel')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold border ${signingMode === 'parallel' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300'}`}>
                  Paralel (bersamaan)
                </button>
                <button type="button" onClick={() => setSigningMode('sequential')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold border ${signingMode === 'sequential' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300'}`}>
                  Berjenjang (urut)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-2">3. Tambah Penerima</label>
              <div className="flex gap-2 mb-3">
                <select value={pickUserId} onChange={(e) => setPickUserId(e.target.value)} className="flex-1 border border-slate-300 rounded-lg px-2 py-2 text-sm">
                  <option value="">Pilih orang...</option>
                  {availableUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
                <select value={pickRole} onChange={(e) => setPickRole(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-2 text-sm">
                  <option value="signer">Tanda Tangan</option>
                  <option value="viewer">Lihat Saja</option>
                </select>
                <button type="button" onClick={addRecipient} className="bg-slate-800 text-white px-3 rounded-lg text-sm font-bold">+</button>
              </div>

              <div className="space-y-2">
                {recipients.map((r) => (
                  <div key={r.user_id} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-700">{r.full_name}</p>
                        <p className="text-[11px] text-slate-400">{r.role === 'signer' ? 'Tanda Tangan' : 'Lihat Saja'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {signingMode === 'sequential' && r.role === 'signer' && (
                          <input
                            type="number" min={1} value={r.order_index}
                            onChange={(e) => updateOrder(r.user_id, Number(e.target.value))}
                            className="w-14 border border-slate-300 rounded px-1 py-1 text-xs text-center"
                            title="Urutan tanda tangan"
                          />
                        )}
                        <button type="button" onClick={() => removeRecipient(r.user_id)} className="text-red-500 text-xs font-bold">Hapus</button>
                      </div>
                    </div>

                    {r.role === 'signer' && (
                      <div className="mt-2 pt-2 border-t border-slate-200">
                        <p className="text-[11px] font-semibold text-slate-500 mb-1">Wajib TTD di halaman:</p>
                        {!numPages ? (
                          <p className="text-[11px] text-slate-400">Unggah PDF dulu untuk memilih halaman.</p>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
                              const isChecked = (requiredPagesByUser[r.user_id] || []).includes(pageNum);
                              return (
                                <button
                                  key={pageNum} type="button"
                                  onClick={() => toggleRequiredPage(r.user_id, pageNum)}
                                  className={`w-7 h-7 rounded text-[11px] font-bold border ${isChecked ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-300'}`}
                                >
                                  {pageNum}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {recipients.length === 0 && <p className="text-xs text-slate-400">Belum ada penerima ditambahkan.</p>}
              </div>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <button type="submit" disabled={submitting} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-lg py-2.5 text-sm">
              {submitting ? 'Mengirim...' : 'Kirim Dokumen'}
            </button>
          </form>
        </main>
      </div>
    </RequireAuth>
  );
}

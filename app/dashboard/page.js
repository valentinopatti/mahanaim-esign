'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import RequireAuth from '../components/RequireAuth';
import AppHeader from '../components/AppHeader';
import { authedFetch } from '../lib/authedFetch';

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function StatusBadge({ status }) {
  const map = {
    pending: ['Belum dikirim', 'bg-slate-100 text-slate-600'],
    waiting: ['Menunggu giliran', 'bg-amber-100 text-amber-700'],
    notified: ['Perlu tindakan', 'bg-blue-100 text-blue-700'],
    viewed: ['Sudah dilihat', 'bg-blue-100 text-blue-700'],
    signed: ['Selesai', 'bg-emerald-100 text-emerald-700'],
  };
  const [label, cls] = map[status] || [status, 'bg-slate-100 text-slate-600'];
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const res = await authedFetch('/api/documents');
      if (res.ok) setData(await res.json());
      else setError('Gagal memuat dokumen.');
    })();
  }, []);

  const actionable = data?.assigned.filter((r) => r.role === 'viewer' || ['notified', 'viewed'].includes(r.status)) || [];
  const waiting = data?.assigned.filter((r) => r.role === 'signer' && r.status === 'waiting') || [];
  const doneAsSigner = data?.assigned.filter((r) => r.status === 'signed') || [];

  return (
    <RequireAuth>
      <div className="min-h-[100dvh] bg-slate-100">
        <AppHeader />
        <main className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-slate-800">Dashboard</h1>
            <Link href="/dashboard/new" className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2 rounded-lg">
              + Kirim Dokumen
            </Link>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <section>
            <h2 className="text-sm font-bold text-slate-600 mb-2">Perlu Tindakan Saya</h2>
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
              {actionable.length === 0 && <p className="p-4 text-sm text-slate-400">Tidak ada dokumen yang perlu tindakan.</p>}
              {actionable.map((r) => (
                <Link key={r.id} href={`/sign/${r.documents.id}`} className="flex items-center justify-between p-4 hover:bg-slate-50">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{r.documents.file_name}</p>
                    <p className="text-xs text-slate-400">{r.role === 'signer' ? 'Perlu tanda tangan' : 'Perlu ditinjau'}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </Link>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-bold text-slate-600 mb-2">Menunggu Giliran</h2>
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
              {waiting.length === 0 && <p className="p-4 text-sm text-slate-400">Tidak ada.</p>}
              {waiting.map((r) => (
                <div key={r.id} className="flex items-center justify-between p-4">
                  <p className="text-sm font-semibold text-slate-800">{r.documents.file_name}</p>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-bold text-slate-600 mb-2">Dokumen yang Saya Kirim</h2>
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
              {(!data?.owned || data.owned.length === 0) && <p className="p-4 text-sm text-slate-400">Belum ada dokumen dikirim.</p>}
              {data?.owned.map((doc) => (
                <div key={doc.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Link href={`/sign/${doc.id}`} className="text-sm font-semibold text-slate-800 hover:text-blue-600">{doc.file_name}</Link>
                    <StatusBadge status={doc.status === 'completed' ? 'signed' : doc.status === 'in_progress' ? 'notified' : 'pending'} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {doc.document_recipients.map((r) => (
                      <div key={r.id} className="text-[11px] bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-700">
                            {r.profiles.full_name} <span className="font-normal text-slate-400">({r.role === 'signer' ? 'TTD' : 'Lihat'})</span>
                          </span>
                          <StatusBadge status={r.status} />
                        </div>
                        {(r.viewed_at || r.signed_at) && (
                          <div className="text-slate-400 mt-0.5">
                            {r.viewed_at && <span>Dilihat: {formatDateTime(r.viewed_at)}</span>}
                            {r.viewed_at && r.signed_at && <span> &middot; </span>}
                            {r.signed_at && <span>TTD: {formatDateTime(r.signed_at)}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {doneAsSigner.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-slate-600 mb-2">Riwayat Saya</h2>
              <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
                {doneAsSigner.map((r) => (
                  <Link key={r.id} href={`/sign/${r.documents.id}`} className="flex items-center justify-between p-4 hover:bg-slate-50">
                    <p className="text-sm text-slate-700">{r.documents.file_name}</p>
                    <StatusBadge status={r.status} />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </RequireAuth>
  );
}

'use client';
import { useState } from 'react';

export default function AdminPage() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [generatedLink, setGeneratedLink] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!selectedFile) return alert("Silakan pilih file PDF terlebih dahulu!");
    
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('signer_email', email);
      formData.append('signer_name', name);
      formData.append('file', selectedFile);

      // --- PERBAIKAN DI SINI: Biarkan browser menentukan Content-Type secara otomatis ---
      const response = await fetch('/api/setup-document', {
        method: 'POST',
        body: formData // Cukup kirim formData langsung tanpa header tambahan apa pun
      });

      const result = await response.json();
      if (result.success) {
        const link = `${window.location.origin}/sign/${result.docId}`;
        setGeneratedLink(link);
      } else {
        alert("Gagal menyimpan ke database: " + result.error);
      }
    } catch (err) {
      alert("Terjadi kesalahan koneksi server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-lg shadow-md border text-black">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Kirim Dokumen Baru (Supabase Form)</h2>
      <form onSubmit={handleSend} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">1. Upload Dokumen (PDF Resmi)</label>
          <input 
            type="file" 
            accept=".pdf" 
            onChange={(e) => setSelectedFile(e.target.files[0])} 
            className="w-full p-2 border rounded mt-1 text-xs bg-gray-50" 
            required 
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">2. Nama Rekan Kerja</label>
          <input type="text" className="w-full p-2 border rounded mt-1 bg-white text-sm" required onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">3. Email Rekan Kerja</label>
          <input type="email" className="w-full p-2 border rounded mt-1 bg-white text-sm" required onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-2 rounded font-semibold hover:bg-blue-700 text-sm disabled:opacity-50">
          {loading ? 'Sedang Mengunggah...' : 'Buat Link Tanda Tangan Resmi'}
        </button>
      </form>

      {generatedLink && (
        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg text-sm">
          <p className="font-bold text-green-800 mb-1">🎉 Link Sukses Dibuat!</p>
          <input type="text" readOnly value={generatedLink} className="w-full p-2 bg-white border rounded text-blue-600 text-xs font-mono select-all focus:outline-none" />
          <a href={generatedLink} target="_blank" className="block text-center mt-3 text-xs bg-green-600 text-white py-2 rounded-md font-bold hover:bg-green-700">
            Buka Halaman Ttd Penerima ➡️
          </a>
        </div>
      )}
    </div>
  );
}
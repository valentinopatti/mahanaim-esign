'use client';
import React, { useEffect, useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import * as pdfjsLib from 'pdfjs-dist';

// Menggunakan worker internal bawaan dari folder node_modules Anda agar stabil tanpa internet/CDN
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
}

export default function SignClient({ id }) {
  const sigPad = useRef({});
  const canvasRef = useRef(null);
  
  const [dbData, setDbData] = useState(null);
  const [uploadImg, setUploadImg] = useState(null);
  const [activeSignature, setActiveSignature] = useState(null);
  
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;

    async function fetchDocument() {
      try {
        const res = await fetch(`/api/get-document?id=${id}`);
        const result = await res.json();
        if (result.success && result.data) {
          setDbData(result.data);
          loadPDF(result.data.file_url);
        }
      } catch (err) {
        console.error("Gagal terhubung ke API pembaca dokumen", err);
      }
    }
    fetchDocument();
  }, [id]);

  // Mengonversi string Base64 dari database menjadi format biner yang dipahami mesin PDF
  const loadPDF = async (pdfBase64) => {
    try {
      const base64Content = pdfBase64.includes(';base64,') 
        ? pdfBase64.split(';base64,')[1] 
        : pdfBase64;

      const raw = window.atob(base64Content);
      const rawLength = raw.length;
      const array = new Uint8Array(new ArrayBuffer(rawLength));

      for (let i = 0; i < rawLength; i++) {
        array[i] = raw.charCodeAt(i);
      }

      const loadingTask = pdfjsLib.getDocument({ data: array });
      const pdf = await loadingTask.promise;
      
      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
      renderPage(1, pdf);
    } catch (error) {
      console.error("Gagal membaca visualisasi halaman PDF:", error);
    }
  };

  const renderPage = async (pageNo, pdf) => {
    if (!pdf || !canvasRef.current) return;
    try {
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({ scale: 1.2 });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      await page.render({ canvasContext: context, viewport }).promise;
    } catch (err) {
      console.error("Gagal menggambar halaman PDF ke kanvas:", err);
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      renderPage(newPage, pdfDoc);
    }
  };

  const applySignatureSource = () => {
    if (uploadImg) setActiveSignature(uploadImg);
    else if (!sigPad.current.isEmpty()) setActiveSignature(sigPad.current.getTrimmedCanvas().toDataURL('image/png'));
  };

  // Fungsi Baru: Mengirimkan data tanda tangan fisik untuk dijahit di backend
  const handleSaveDocument = async () => {
    if (!activeSignature) return alert("Silakan kunci dan tempel tanda tangan Anda terlebih dahulu pada dokumen!");

    setSaving(true);
    try {
      const res = await fetch('/api/save-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: id,
          signatureImage: activeSignature,
          coordinateX: position.x,
          coordinateY: position.y,
          pageNumber: currentPage
        })
      });

      const result = await res.json();
      if (result.success) {
        alert("🎉 Sukses! Dokumen Mahanaim telah resmi ditandatangani dan disimpan permanen!");
      } else {
        alert("Gagal memproses dokumen: " + result.error);
      }
    } catch (err) {
      console.error(err);
      alert("Terjadi kesalahan koneksi server saat menjahit berkas.");
    } finally {
      setSaving(false);
    }
  };

  if (!dbData) return <div className="text-center p-10 text-black font-semibold">Memuat dokumen resmi dari database Mahanaim...</div>;

  return (
    <div className="max-w-7xl mx-auto mt-6 p-4 grid grid-cols-1 lg:grid-cols-12 gap-6 text-black">
      
      {/* PANEL KONTROL KIRI */}
      <div className="lg:col-span-4 bg-white p-5 rounded-xl shadow-lg border h-fit space-y-5">
        <div>
          <h2 className="text-lg font-bold text-gray-800">E-Signature Mahanaim</h2>
          <p className="text-xs text-blue-600 font-semibold mt-1">File: {dbData.file_name}</p>
          <p className="text-xs text-gray-500">Penerima: {dbData.signer_name}</p>
        </div>

        <div className="border-t pt-3">
          <label className="block text-xs font-bold mb-2 text-gray-700">1. BUAT ATAU UPLOAD TANDA TANGAN</label>
          <div className="border bg-gray-50 rounded p-1">
            <SignatureCanvas ref={sigPad} penColor="black" canvasProps={{ width: 300, height: 120, className: 'w-full bg-white border' }} />
          </div>
          <button onClick={() => sigPad.current.clear()} className="text-[10px] text-red-500 mt-1 block">Hapus Coretan</button>
          
          <input type="file" accept="image/*" onChange={(e) => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onloadend = () => setUploadImg(reader.result);
            reader.readAsDataURL(file);
          }} className="block w-full text-xs mt-3 text-gray-500" />
          
          <button onClick={applySignatureSource} className="w-full mt-3 bg-blue-600 text-white py-1.5 rounded text-xs font-bold hover:bg-blue-700">
            Kunci & Tempel TTD ⬇️
          </button>
        </div>

        <div className="border-t pt-3">
          <label className="block text-xs font-bold mb-2 text-gray-700">2. NAVIGASI HALAMAN DOKUMEN</label>
          <div className="flex items-center justify-between bg-gray-50 p-2 rounded border text-xs">
            <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className="px-2 py-1 bg-white border rounded disabled:opacity-50">⬅️</button>
            <span className="font-medium">Halaman {currentPage} dari {totalPages}</span>
            <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className="px-2 py-1 bg-white border rounded disabled:opacity-50">➡️</button>
          </div>
        </div>

        <button 
          onClick={handleSaveDocument} 
          disabled={saving}
          className="w-full bg-green-600 text-white py-2.5 rounded-lg text-sm font-bold shadow hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? 'Sedang Memproses PDF...' : 'Kirim Dokumen Selesai'}
        </button>
      </div>

      {/* PANEL TAMPILAN DOKUMEN ASLI KANAN */}
      <div className="lg:col-span-8 bg-gray-200 p-4 rounded-xl flex flex-col items-center overflow-auto max-h-[85vh]">
        <div 
          onMouseMove={(e) => { if (isDragging.current) setPosition({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }); }}
          onMouseUp={() => isDragging.current = false}
          onMouseLeave={() => isDragging.current = false}
          className="relative bg-white shadow-2xl border"
        >
          <canvas ref={canvasRef} className="max-w-full" />
          {activeSignature && (
            <div
              onMouseDown={(e) => { isDragging.current = true; dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }; }}
              className="absolute p-1 border-2 border-blue-500 bg-blue-100 bg-opacity-60 rounded cursor-move shadow-md"
              style={{ top: `${position.y}px`, left: `${position.x}px`, width: '130px', height: '65px' }}
            >
              <img src={activeSignature} alt="TTD" className="w-full h-full object-contain pointer-events-none" />
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
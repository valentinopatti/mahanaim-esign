'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import * as pdfjsLib from 'pdfjs-dist';

// Mengatur worker internal PDFJS menggunakan CDN unpkg resmi
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://khlpzyyshtuwronalntr.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function SignDocumentPage() {
  const { id } = useParams();
  const router = useRouter();

  // State Manajemen Dokumen
  const [documentData, setDocumentData] = useState(null);
  const [signatureImage, setSignatureImage] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pdfRenderLoading, setPdfRenderLoading] = useState(true);
  const [pdfLoadError, setPdfLoadError] = useState(false);

  // State Posisi Penempatan Tanda Tangan (Persentase 0 - 100%)
  const [position, setPosition] = useState({ x: 20, y: 40 });
  const [isPlaced, setIsPlaced] = useState(false);

  // Ref Komponen Utama
  const signatureCanvasRef = useRef(null);
  const pdfCanvasRef = useRef(null);
  const containerRef = useRef(null);

  // Pelacak gerakan seret (Drag & Drop)
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const positionStart = useRef({ x: 20, y: 40 });

  // 1. Ambil Data Dokumen dan Render PDF ke Kanvas Gambar secara Lokal
  useEffect(() => {
    async function fetchAndRenderPDF() {
      try {
        setPdfRenderLoading(true);
        const { data, error } = await supabase
          .from('documents')
          .select('id, file_name, file_url')
          .eq('id', id)
          .single();

        if (error) throw error;
        if (!data || !data.file_url) throw new Error("File URL tidak ditemukan");
        
        setDocumentData(data);

        // Unduh berkas PDF sebagai blob data biner langsung ke memori lokal browser
        const response = await fetch(data.file_url);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();

        // Muat dokumen biner menggunakan PDFJS
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        // Ambil halaman pertama untuk pratinjau tanda tangan
        const page = await pdf.getPage(1);
        
        // Sesuaikan skala penampil agar tajam dan pas di dalam box kontainer
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = pdfCanvasRef.current;
        if (canvas) {
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          const renderContext = {
            canvasContext: context,
            viewport: viewport,
          };
          await page.render(renderContext).promise;
        }
        setPdfRenderLoading(false);
      } catch (err) {
        console.error("Gagal merender berkas PDF halaman pertama:", err);
        setPdfLoadError(true);
        setPdfRenderLoading(false);
      }
    }

    if (id) fetchAndRenderPDF();
  }, [id]);

  // 2. Logika Coretan Papan Tanda Tangan (Modal Canvas)
  let isDrawing = false;
  const startDrawing = (e) => {
    isDrawing = true;
    draw(e);
  };
  const stopDrawing = () => {
    isDrawing = false;
    if (signatureCanvasRef.current) {
      signatureCanvasRef.current.getContext('2d').beginPath();
    }
  };
  const draw = (e) => {
    if (!isDrawing || !signatureCanvasRef.current) return;
    const canvas = signatureCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000000';

    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
  };

  const clearCanvas = () => {
    if (!signatureCanvasRef.current) return;
    const canvas = signatureCanvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  };

  const saveCanvasImage = () => {
    if (!signatureCanvasRef.current) return;
    const dataUrl = signatureCanvasRef.current.toDataURL('image/png');
    setSignatureImage(dataUrl);
    setIsModalOpen(false);
    setIsPlaced(true);
  };

  // 3. Logika Geser TTD Multi-Device (Mouse Laptop & Sentuhan Jari HP)
  const handleStart = (e) => {
    isDragging.current = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragStart.current = { x: clientX, y: clientY };
    positionStart.current = { ...position };
    if (e.cancelable) e.preventDefault();
  };

  const handleMove = (e) => {
    if (!isDragging.current || !containerRef.current) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const deltaX = clientX - dragStart.current.x;
    const deltaY = clientY - dragStart.current.y;
    const containerRect = containerRef.current.getBoundingClientRect();

    let newX = positionStart.current.x + (deltaX / containerRect.width) * 100;
    let newY = positionStart.current.y + (deltaY / containerRect.height) * 100;

    if (newX < 0) newX = 0;
    if (newY < 0) newY = 0;
    if (newX > 85) newX = 85;
    if (newY > 92) newY = 92;

    setPosition({ x: newX, y: newY });
  };

  const handleEnd = () => {
    isDragging.current = false;
  };

  // 4. Kirim Data Koordinat Posisi Akhir Ke Backend
  const handleSubmitSignature = async () => {
    if (!signatureImage) return alert("Silakan buat tanda tangan terlebih dahulu!");
    setLoading(true);

    try {
      const response = await fetch('/api/save-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: id,
          signatureImage: signatureImage,
          percentX: position.x,
          percentY: position.y,
          pageNumber: 1
        })
      });

      if (response.ok) {
        alert("🎉 Dokumen Berhasil Ditandatangani!");
        router.push('/documents');
      } else {
        const errData = await response.json();
        alert(`Gagal menyimpan: ${errData.error}`);
      }
    } catch (err) {
      alert("Terjadi gangguan koneksi jaringan.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '850px', margin: '0 auto', userSelect: 'none' }}>
      <header style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h1 style={{ fontSize: '18px', margin: 0, color: '#1e3a8a' }}>Mahanaim Studio Sign</h1>
          <p style={{ fontSize: '12px', color: '#666', margin: '2px 0 0 0' }}>Berkas: {documentData?.file_name || 'Memuat berkas...'}</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          style={{ padding: '10px 16px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}
        >
          ✍️ Buat & Tempel TTD
        </button>
      </header>

      {/* KOTAK VIEWPORT UTAMA PREVIEW */}
      <div 
        ref={containerRef} 
        style={{ 
          position: 'relative', 
          border: '2px solid #cbd5e1', 
          borderRadius: '8px', 
          backgroundColor: '#f1f5f9', 
          width: '100%', 
          height: '70vh',
          overflow: 'auto',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '10px'
        }}
      >
        {pdfRenderLoading && (
          <div style={{ color: '#475569', fontSize: '14px', alignSelf: 'center' }}>⏳ Sistem sedang merender halaman dokumen secara langsung...</div>
        )}

        {pdfLoadError && (
          <div style={{ color: '#ef4444', textAlign: 'center', padding: '20px', alignSelf: 'center' }}>
            ⚠️ Gagal memuat pratinjau PDF. Pastikan file tersimpan dengan benar di Supabase.
          </div>
        )}

        {/* KANVAS PDF UTAMA YANG AKAN DI-RENDER */}
        <canvas ref={pdfCanvasRef} style={{ maxWidth: '100%', height: 'auto', display: pdfRenderLoading ? 'none' : 'block', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} />

        {/* KOTAK ELEMEN TANDA TANGAN DI ATAS KANVAS */}
        {isPlaced && signatureImage && !pdfRenderLoading && (
          <div
            onMouseDown={handleStart}
            onMouseMove={handleMove}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            onTouchStart={handleStart}
            onTouchMove={handleMove}
            onTouchEnd={handleEnd}
            style={{
              position: 'absolute',
              left: `${position.x}%`,
              top: `${position.y}%`,
              width: '105px',
              padding: '4px',
              border: '2px dashed #16a34a',
              backgroundColor: 'rgba(240, 253, 244, 0.85)',
              cursor: 'move',
              zIndex: 99,
              touchAction: 'none', // Cegah layar bergulir naik-turun saat jari menyeret TTD
              borderRadius: '4px'
            }}
          >
            <img src={signatureImage} alt="Signature" style={{ width: '100%', display: 'block', pointerEvents: 'none' }} />
            <div style={{ fontSize: '8px', color: '#16a34a', textAlign: 'center', marginTop: '2px', fontWeight: 'bold' }}>👆 Geser Posisi</div>
          </div>
        )}
      </div>

      {/* FOOTER TOMBOL AKSI SIMPAN */}
      {isPlaced && !pdfRenderLoading && (
        <footer style={{ marginTop: '15px', textAlign: 'right' }}>
          <button
            onClick={handleSubmitSignature}
            disabled={loading}
            style={{ padding: '12px 28px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px', width: '100%', maxWidth: '200px' }}
          >
            {loading ? "⏳ Menyimpan..." : "💾 Simpan Hasil PDF"}
          </button>
        </footer>
      )}

      {/* POPUP MODAL KANVAS CORETAN TANDA TANGAN */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', width: '92%', maxWidth: '420px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Goreskan Tanda Tangan</h3>
            <canvas
              ref={signatureCanvasRef}
              width={380}
              height={180}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
              style={{ border: '1px solid #cbd5e1', borderRadius: '6px', backgroundColor: '#f8fafc', width: '100%', height: '180px', display: 'block', touchAction: 'none' }}
            />
            <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={clearCanvas} style={{ padding: '8px 12px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Hapus</button>
              <div>
                <button onClick={() => setIsModalOpen(false)} style={{ padding: '8px 12px', backgroundColor: '#6b7280', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', marginRight: '6px', fontSize: '13px' }}>Batal</button>
                <button onClick={saveCanvasImage} style={{ padding: '8px 14px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>Terapkan</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
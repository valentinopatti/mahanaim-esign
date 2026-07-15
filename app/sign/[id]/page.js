'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

// Inisialisasi Supabase Client Langsung di Frontend
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://khlpzyyshtuwronalntr.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function SignDocumentPage() {
  const { id } = useParams();
  const router = useRouter();

  // State Utama
  const [documentData, setDocumentData] = useState(null);
  const [signatureImage, setSignatureImage] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pdfLoadError, setPdfLoadError] = useState(false);

  // State Posisi Penempatan Tanda Tangan (Persentase 0 - 100%)
  const [position, setPosition] = useState({ x: 15, y: 35 });
  const [isPlaced, setIsPlaced] = useState(false);

  // Ref Komponen Utama
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Variabel bantuan pelacak gerakan (Desktop & Mobile)
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const positionStart = useRef({ x: 15, y: 35 });

  // 1. AMBIL DATA DOKUMEN LANGSUNG DARI SUPABASE (Bebas dari Error API 404)
  useEffect(() => {
    async function getDocumentFromSupabase() {
      try {
        const { data, error } = await supabase
          .from('documents')
          .select('id, file_name, file_url')
          .eq('id', id)
          .single();

        if (error) throw error;

        if (data) {
          setDocumentData(data);
        }
      } catch (err) {
        console.error("Gagal mengambil data dari Supabase:", err);
        setPdfLoadError(true);
      }
    }
    if (id) getDocumentFromSupabase();
  }, [id]);

  // 2. Fungsi Kanvas Coretan Tanda Tangan
  let isDrawing = false;

  const startDrawing = (e) => {
    isDrawing = true;
    draw(e);
  };

  const stopDrawing = () => {
    isDrawing = false;
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx.beginPath();
    }
  };

  const draw = (e) => {
    if (!isDrawing || !canvasRef.current) return;
    const canvas = canvasRef.current;
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
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const saveCanvasImage = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    setSignatureImage(dataUrl);
    setIsModalOpen(false);
    setIsPlaced(true);
  };

  // 3. FUNGSI DRAG & DROP MULTI-DEVICE (HP TOUCH & DESKTOP MOUSE)
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

    // Mengubah pergeseran piksel menjadi persentase (%)
    const deltaPercentX = (deltaX / containerRect.width) * 100;
    const deltaPercentY = (deltaY / containerRect.height) * 100;

    let newX = positionStart.current.x + deltaPercentX;
    let newY = positionStart.current.y + deltaPercentY;

    // Kunci batas penempatan tanda tangan agar tidak keluar halaman
    if (newX < 0) newX = 0;
    if (newY < 0) newY = 0;
    if (newX > 85) newX = 85;
    if (newY > 92) newY = 92;

    setPosition({ x: newX, y: newY });
  };

  const handleEnd = () => {
    isDragging.current = false;
  };

  // 4. Kirim Data Hasil Akhir Ke API
  const handleSubmitSignature = async () => {
    if (!signatureImage) return alert("Silakan tempel tanda tangan terlebih dahulu!");
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
      alert("Terjadi gangguan koneksi sistem.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '850px', margin: '0 auto', userSelect: 'none' }}>
      <header style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h1 style={{ fontSize: '18px', margin: 0, color: '#1e3a8a' }}>Mahanaim Studio Sign</h1>
          <p style={{ fontSize: '12px', color: '#666', margin: '2px 0 0 0' }}>Berkas: {documentData?.file_name || 'Memuat dokumen dari database...'}</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          style={{ padding: '10px 16px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}
        >
          ✍️ Buat & Tempel TTD
        </button>
      </header>

      {/* BOX AREA PRATINJAU UTAMA */}
      <div 
        ref={containerRef} 
        style={{ 
          position: 'relative', 
          border: '2px solid #cbd5e1', 
          borderRadius: '8px', 
          backgroundColor: '#ffffff', 
          width: '100%', 
          height: '75vh',
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }}
      >
        {pdfLoadError ? (
          <div style={{ color: '#ef4444', textAlign: 'center', padding: '20px' }}>
            ⚠️ Gagal memuat dokumen. Periksa kembali ID dokumen atau koneksi database Supabase Anda.
          </div>
        ) : documentData?.file_url ? (
          <iframe 
            src={`${documentData.file_url}#toolbar=0`}
            style={{ width: '100%', height: '100%', border: 'none' }}
            title="Pratinjau Kertas Dokumen"
          />
        ) : (
          <div style={{ color: '#666', fontSize: '14px' }}>⏳ Mengunduh berkas dari cloud server...</div>
        )}

        {/* KOTAK TANDA TANGAN (TOUCH DRAG DI HP LOCK) */}
        {isPlaced && signatureImage && (
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
              width: '110px',
              padding: '5px',
              border: '2px dashed #16a34a',
              backgroundColor: 'rgba(240, 253, 244, 0.9)',
              cursor: 'move',
              zIndex: 99,
              touchAction: 'none', // Mengunci gulir layar bawaan HP saat jari menggeser TTD
              borderRadius: '4px',
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
            }}
          >
            <img 
              src={signatureImage} 
              alt="Coretan fisik" 
              style={{ width: '100%', display: 'block', pointerEvents: 'none' }} 
            />
            <div style={{ fontSize: '8px', color: '#16a34a', textAlign: 'center', marginTop: '3px', fontWeight: 'bold' }}>👆 Geser Atur Posisi</div>
          </div>
        )}
      </div>

      {/* FOOTER AKSI PENYIMPANAN */}
      {isPlaced && (
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

      {/* MODAL KANVAS TANDA TANGAN */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', width: '92%', maxWidth: '420px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Goreskan Tanda Tangan</h3>
            <canvas
              ref={canvasRef}
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
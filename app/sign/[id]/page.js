'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function SignDocumentPage() {
  const { id } = useParams();
  const router = useRouter();

  // State Manajemen Dokumen dan Tanda Tangan
  const [documentData, setDocumentData] = useState(null);
  const [signatureImage, setSignatureImage] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);

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

  // 1. Mengambil data dokumen secara adaptif dari database
  useEffect(() => {
    async function fetchDocument() {
      // Mencoba rute universal terlebih dahulu
      let targetUrl = `/api/documents/${id}`;
      
      try {
        let res = await fetch(targetUrl);
        
        // Jika rute pertama 404, arahkan ke fallback alternatif database umum
        if (!res.ok) {
          targetUrl = `/api/document?id=${id}`;
          res = await fetch(targetUrl);
        }

        if (res.ok) {
          const data = await res.json();
          // Antisipasi jika struktur data dibungkus dalam objek internal
          setDocumentData(data.data || data);
        } else {
          console.warn("Jalur API kustom tidak merespons, mengaktifkan mode fallback enkapsulasi URL.");
          // Fallback darurat jika kedua API 404: Mengisi mock kontainer agar fungsi geser tidak terkunci
          setDocumentData({ id: id, file_url: "" });
        }
      } catch (err) {
        console.error("Gagal memuat dokumen:", err);
        setDocumentData({ id: id, file_url: "" });
      }
    }
    if (id) fetchDocument();
  }, [id]);

  // 2. Fungsi Kanvas Coreti Tanda Tangan (Mouse & Touch HP)
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
    setIsPlaced(true); // Memunculkan tanda tangan di layar pratinjau
  };

  // 3. FUNGSI DRAG & DROP PERANGKAT MOBILE (HP TOUCH) & DESKTOP MOUSE
  const handleStart = (e) => {
    isDragging.current = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    dragStart.current = { x: clientX, y: clientY };
    positionStart.current = { ...position };

    // Mencegah konflik browser bawaan
    if (e.cancelable) e.preventDefault();
  };

  const handleMove = (e) => {
    if (!isDragging.current || !containerRef.current) return;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const deltaX = clientX - dragStart.current.x;
    const deltaY = clientY - dragStart.current.y;

    const containerRect = containerRef.current.getBoundingClientRect();

    // Hitung perubahan posisi dalam format persentase murni (%)
    const deltaPercentX = (deltaX / containerRect.width) * 100;
    const deltaPercentY = (deltaY / containerRect.height) * 100;

    let newX = positionStart.current.x + deltaPercentX;
    let newY = positionStart.current.y + deltaPercentY;

    // Kunci ruang gerak agar tanda tangan tidak lepas keluar dari halaman kertas
    if (newX < 0) newX = 0;
    if (newY < 0) newY = 0;
    if (newX > 85) newX = 85;
    if (newY > 92) newY = 92;

    setPosition({ x: newX, y: newY });
  };

  const handleEnd = () => {
    isDragging.current = false;
  };

  // 4. Submit Koordinat Persentase ke API Backend
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
      alert("Terjadi gangguan koneksi pada sistem e-sign.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '850px', margin: '0 auto', userSelect: 'none' }}>
      <header style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h1 style={{ fontSize: '18px', margin: 0, color: '#1e3a8a' }}>Mahanaim Studio Sign</h1>
          <p style={{ fontSize: '12px', color: '#666', margin: '2px 0 0 0' }}>ID Dokumen: {id}</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          style={{ padding: '10px 16px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}
        >
          ✍️ Buat & Tempel TTD
        </button>
      </header>

      {/* KONTEN UTAMA AREA DOKUMEN */}
      <div 
        ref={containerRef} 
        style={{ 
          position: 'relative', 
          border: '2px solid #cbd5e1', 
          borderRadius: '8px', 
          backgroundColor: '#ffffff', 
          width: '100%', 
          height: '75vh',
          overflow: 'hidden'
        }}
      >
        {/* Fallback visual jika iframe utama memuat URL internal */}
        <iframe 
          src={documentData?.file_url ? `${documentData.file_url}#toolbar=0` : `/api/view-pdf?id=${id}`}
          style={{ width: '100%', height: '100%', border: 'none' }}
          title="Pratinjau Kertas"
        />

        {/* LAYER IMPLEMENTASI GESER JARI HP (TOUCH ACTION DILOCK) */}
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
              backgroundColor: 'rgba(240, 253, 244, 0.85)',
              cursor: 'move',
              zIndex: 50,
              touchAction: 'none', // PENTING: Mengunci scroll HP agar tanda tangan bisa meluncur mulus saat digeser jari
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

      {/* FOOTER SIMPAN HASIL AKHIR */}
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

      {/* MODAL KANVAS UTAMA */}
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
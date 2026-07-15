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
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [isPlaced, setIsPlaced] = useState(false);

  // Ref Komponen Utama
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const dragRef = useRef(null);

  // Variabel bantuan pelacak gerakan (Desktop & Mobile)
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const positionStart = useRef({ x: 20, y: 20 });

  // 1. Ambil data dokumen dari API internal saat halaman dibuka
  useEffect(() => {
    async function fetchDocument() {
      try {
        const res = await fetch(`/api/documents/${id}`);
        if (res.ok) {
          const data = await res.json();
          setDocumentData(data);
        }
      } catch (err) {
        console.error("Gagal mengambil dokumen:", err);
      }
    }
    fetchDocument();
  }, [id]);

  // 2. Fungsi Canvas Tanda Tangan Tangan (Mouse & Touch)
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

    // Deteksi koordinat dari mouse atau sentuhan HP
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
    setIsPlaced(true); // Tampilkan kotak tanda tangan di layar agar bisa digeser
  };

  // 3. FUNGSI DRAG & DROP MULTI-DEVICE (Mendukung Mouse & Sentuhan Jari HP)
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

    // Hitung jarak pergeseran pixel
    const deltaX = clientX - dragStart.current.x;
    const deltaY = clientY - dragStart.current.y;

    const containerRect = containerRef.current.getBoundingClientRect();

    // Konversi pergeseran pixel ke nilai persentase (%) murni terhadap kontainer dokumen
    const deltaPercentX = (deltaX / containerRect.width) * 100;
    const deltaPercentY = (deltaY / containerRect.height) * 100;

    let newX = positionStart.current.x + deltaPercentX;
    let newY = positionStart.current.y + deltaPercentY;

    // Kunci batas geser (0% - 90%) agar tidak keluar dari tepi dokumen pratinjau
    if (newX < 0) newX = 0;
    if (newY < 0) newY = 0;
    if (newX > 90) newX = 90;
    if (newY > 95) newY = 95;

    setPosition({ x: newX, y: newY });
  };

  const handleEnd = () => {
    isDragging.current = false;
  };

  // 4. Pengiriman Akhir ke Backend API Menggunakan Persentase Absolut
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
          percentX: position.x, // Mengirim data persentase X matang
          percentY: position.y, // Mengirim data persentase Y matang
          pageNumber: 1,        // Halaman dokumen target
        })
      });

      if (response.ok) {
        alert("🎉 Dokumen Berhasil Ditandatangani & Email Terkirim!");
        router.push('/documents');
      } else {
        const errData = await response.json();
        alert(`Gagal: ${errData.error}`);
      }
    } catch (err) {
      alert("Terjadi kesalahan sistem saat menyimpan dokumen.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <header style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '20px', margin: 0 }}>Mahanaim E-Sign Studio</h1>
          <p style={{ fontSize: '13px', color: '#666', margin: '4px 0 0 0' }}>Berkas: {documentData?.file_name || 'Memuat berkas...'}</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          style={{ padding: '10px 16px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          ✍️ Kunci & Tempel TTD
        </button>
      </header>

      {/* AREA UTAMA PRATINJAU DOKUMEN */}
      <div 
        ref={containerRef} 
        style={{ position: 'relative', border: '2px solid #ddd', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#f9f9f9', width: '100%', minHeight: '600px' }}
      >
        {documentData?.file_url && (
          <iframe 
            src={`${documentData.file_url}#toolbar=0`}
            style={{ width: '100%', height: '800px', border: 'none' }}
            title="Pratinjau Dokumen Mahanaim"
          />
        )}

        {/* KOTAK TANDA TANGAN YANG BISA DIGESER (DESKTOP MOUSE & HP TOUCH) */}
        {isPlaced && signatureImage && (
          <div
            ref={dragRef}
            onMouseDown={handleStart}
            onMouseMove={handleMove}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            onTouchStart={handleStart} // Aktifkan geser jari di HP
            onTouchMove={handleMove}   // Aktifkan tracking pergerakan di HP
            onTouchEnd={handleEnd}     // Selesai geser di HP
            style={{
              position: 'absolute',
              left: `${position.x}%`,
              top: `${position.y}%`,
              width: '120px',
              padding: '6px',
              border: '2px dashed #2563eb',
              backgroundColor: 'rgba(219, 234, 254, 0.7)',
              cursor: 'move',
              userSelect: 'none',
              touchAction: 'none', // Mematikan scroll bawaan HP agar fokus menggeser objek ttd
              borderRadius: '4px',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
            }}
          >
            <img 
              src={signatureImage} 
              alt="Tanda tangan fisik" 
              style={{ width: '100%', display: 'block', pointerEvents: 'none' }} 
            />
            <div style={{ fontSize: '9px', color: '#2563eb', textAlign: 'center', marginTop: '4px', fontWeight: 'bold' }}>👋 Geser Atur Posisi</div>
          </div>
        )}
      </div>

      {/* FOOTER AKSI SIMPAN */}
      {isPlaced && (
        <footer style={{ marginTop: '20px', textAlign: 'right' }}>
          <button
            onClick={handleSubmitSignature}
            disabled={loading}
            style={{ padding: '12px 24px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}
          >
            {loading ? "⏳ Memproses Dokumen..." : "💾 Simpan & Selesai PDF"}
          </button>
        </footer>
      )}

      {/* MODAL KANVAS CORETAN TANDA TANGAN */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', width: '90%', maxWidth: '450px' }}>
            <h3 style={{ margin: '0 0 15px 0' }}>Goreskan Tanda Tangan Anda</h3>
            <canvas
              ref={canvasRef}
              width={400}
              height={200}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
              style={{ border: '1px solid #ccc', borderRadius: '6px', backgroundColor: '#fafafa', width: '100%', height: '200px', display: 'block', touchAction: 'none' }}
            />
            <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={clearCanvas} style={{ padding: '8px 14px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Hapus Coretan</button>
              <div>
                <button onClick={() => setIsModalOpen(false)} style={{ padding: '8px 14px', backgroundColor: '#6b7280', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', marginRight: '8px' }}>Batal</button>
                <button onClick={saveCanvasImage} style={{ padding: '8px 14px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Terapkan</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://khlpzyyshtuwronalntr.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function SignDocumentPage() {
  const { id } = useParams();
  const router = useRouter();

  // State Utama Dokumen
  const [documentData, setDocumentData] = useState(null);
  const [signatureImage, setSignatureImage] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pdfRenderLoading, setPdfRenderLoading] = useState(true);
  const [pdfPages, setPdfPages] = useState([]);
  const [activePageTarget, setActivePageTarget] = useState(null);

  // State Baru: Mengatur Skala Zoom Dokumen (Default: 1.2)
  const [zoomScale, setZoomScale] = useState(1.2);

  // State Pilihan Metode Input Tanda Tangan ('draw' atau 'upload')
  const [signMethod, setSignMethod] = useState('draw');

  // State Posisi & Ukuran Lebar TTD
  const [position, setPosition] = useState({ x: 35, y: 70 });
  const [sigWidth, setSigWidth] = useState(120);
  const [isDraggingActive, setIsDraggingActive] = useState(false);

  // Ref Komponen Kanvas & File Input
  const signatureCanvasRef = useRef(null);
  const fileInputRef = useRef(null);

  // Variabel Pembantu Drag
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const positionStart = useRef({ x: 35, y: 70 });

  // 1. Ambil PDF & Simpan Mentahannya ke State Sementara
  const [pdfInstance, setPdfInstance] = useState(null);

  useEffect(() => {
    async function loadPDF() {
      try {
        setPdfRenderLoading(true);
        const { data, error } = await supabase
          .from('documents')
          .select('id, file_name, file_url, recipient_email')
          .eq('id', id)
          .single();

        if (error) throw error;
        if (!data || !data.file_url) throw new Error("File URL kosong");
        setDocumentData(data);

        const response = await fetch(data.file_url);
        const arrayBuffer = await response.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        setPdfInstance(pdf);
      } catch (err) {
        console.error("Gagal memuat berkas:", err);
        setPdfRenderLoading(false);
      }
    }
    if (id) loadPDF();
  }, [id]);

  // 2. Render Ulang Halaman Setiap Kali Nilai Skala Zoom (zoomScale) Berubah
  useEffect(() => {
    if (!pdfInstance) return;

    async function renderPages() {
      setPdfRenderLoading(true);
      const pagesArray = [];
      
      for (let i = 1; i <= pdfInstance.numPages; i++) {
        const page = await pdfInstance.getPage(i);
        // Skala viewport berubah secara dinamis mengikuti state zoomScale
        const viewport = page.getViewport({ scale: zoomScale });
        pagesArray.push({ pageNumber: i, pdfPageInstance: page, viewport: viewport });
      }
      
      setPdfPages(pagesArray);
      setPdfRenderLoading(false);
    }
    
    renderPages();
  }, [pdfInstance, zoomScale]);

  // 3. Menggambar Hasil Render ke Elemen Kanvas HTML
  useEffect(() => {
    pdfPages.forEach(async (pageObj) => {
      const canvas = document.getElementById(`pdf-canvas-p-${pageObj.pageNumber}`);
      if (canvas) {
        const context = canvas.getContext('2d');
        canvas.height = pageObj.viewport.height;
        canvas.width = pageObj.viewport.width;
        await pageObj.pdfPageInstance.render({ canvasContext: context, viewport: pageObj.viewport }).promise;
      }
    });
  }, [pdfPages]);

  // Tombol Pengendali Zoom Halaman Dokumen
  const zoomIn = () => setZoomScale(prev => Math.min(prev + 0.2, 2.2));
  const zoomOut = () => setZoomScale(prev => Math.max(prev - 0.2, 0.6));

  // Logika Menggambar Coretan Tanda Tangan
  let isDrawing = false;
  const startDrawing = (e) => { isDrawing = true; draw(e); };
  const stopDrawing = () => { isDrawing = false; if (signatureCanvasRef.current) signatureCanvasRef.current.getContext('2d').beginPath(); };
  const draw = (e) => {
    if (!isDrawing || !signatureCanvasRef.current) return;
    const canvas = signatureCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#000000';
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke(); ctx.beginPath(); ctx.moveTo(clientX - rect.left, clientY - rect.top);
  };
  const clearCanvas = () => {
    if (!signatureCanvasRef.current) return;
    const canvas = signatureCanvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  };

  // Logika Unggah Gambar TTD & Membuat Background Transparan
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 200 && data[i+1] > 200 && data[i+2] > 200) { data[i+3] = 0; }
        }
        ctx.putImageData(imgData, 0, 0);
        setSignatureImage(canvas.toDataURL('image/png'));
        setIsModalOpen(false);
        setPosition({ x: 35, y: 70 });
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const saveCanvasImage = () => {
    if (!signatureCanvasRef.current) return;
    setSignatureImage(signatureCanvasRef.current.toDataURL('image/png'));
    setIsModalOpen(false);
    setPosition({ x: 35, y: 70 });
  };

  const handleOpenPadForPage = (pageNum) => {
    setActivePageTarget(pageNum);
    setIsModalOpen(true);
  };

  // Logika Seret (Drag) TTD Relatif terhadap Skala Halaman
  const handleStart = (e) => {
    if (e.target.className.includes('nodrag')) return;
    isDragging.current = true;
    setIsDraggingActive(true);
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragStart.current = { x: clientX, y: clientY };
    positionStart.current = { ...position };
    if (e.cancelable) e.preventDefault();
  };

  const handleMove = (e) => {
    if (!isDragging.current || !activePageTarget) return;
    const container = document.getElementById(`page-wrapper-${activePageTarget}`);
    if (!container) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const deltaX = clientX - dragStart.current.x;
    const deltaY = clientY - dragStart.current.y;
    const rect = container.getBoundingClientRect();

    let newX = positionStart.current.x + (deltaX / rect.width) * 100;
    let newY = positionStart.current.y + (deltaY / rect.height) * 100;

    if (newX < 0) newX = 0; if (newY < 0) newY = 0;
    if (newX > 82) newX = 82; if (newY > 93) newY = 93;
    setPosition({ x: newX, y: newY });
  };

  const handleEnd = () => { isDragging.current = false; setIsDraggingActive(false); };

  const handleSubmitSignature = async () => {
    if (!signatureImage || !activePageTarget) return alert("Silakan pasang tanda tangan Anda!");
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
          pageNumber: activePageTarget,
          signatureWidth: sigWidth
        })
      });
      if (response.ok) {
        alert(`🎉 Berhasil Disimpan! Salinan PDF dikirim ke: ${documentData?.recipient_email}`);
        router.push('/documents');
      } else {
        const errData = await response.json();
        alert(`Gagal menyimpan: ${errData.error}`);
      }
    } catch (err) { alert("Gangguan koneksi internet."); } finally { setLoading(false); }
  };

  return (
    <div style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '850px', margin: '0 auto', userSelect: 'none' }}>
      <header style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h1 style={{ fontSize: '18px', margin: 0, color: '#1e3a8a' }}>Mahanaim Studio Sign</h1>
          <p style={{ fontSize: '12px', color: '#555', margin: '2px 0 0 0' }}>
            File: {documentData?.file_name || 'Memuat...'} | Kirim Ke: <b>{documentData?.recipient_email || '-'}</b>
          </p>
        </div>

        {/* TOOLBAR CONTROLLER: ZOOM IN & ZOOM OUT */}
        <div style={{ display: 'flex', gap: '5px', alignItems: 'center', backgroundColor: '#f1f5f9', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
          <button onClick={zoomOut} style={{ padding: '6px 12px', cursor: 'pointer', fontWeight: 'bold', border: '1px solid #cbd5e1', borderRadius: '4px', backgroundColor: '#fff' }}>➖ Zoom Out</button>
          <span style={{ fontSize: '12px', minWidth: '45px', textAlign: 'center', fontWeight: 'bold', color: '#334155' }}>{Math.round(zoomScale * 100)}%</span>
          <button onClick={zoomIn} style={{ padding: '6px 12px', cursor: 'pointer', fontWeight: 'bold', border: '1px solid #cbd5e1', borderRadius: '4px', backgroundColor: '#fff' }}>➕ Zoom In</button>
        </div>
      </header>

      {/* VIEWPORT AREA LIVE VIEW DOKUMEN */}
      <div style={{ border: '2px solid #cbd5e1', borderRadius: '8px', backgroundColor: '#e2e8f0', width: '100%', height: '70vh', overflowY: 'auto', padding: '10px', WebkitOverflowScrolling: 'touch' }}>
        {pdfRenderLoading && (
          <div style={{ color: '#475569', fontSize: '14px', textAlign: 'center', marginTop: '25vh' }}>⏳ Sedang memproses rendering skala halaman...</div>
        )}

        <div style={{ display: pdfRenderLoading ? 'none' : 'block' }}>
          {pdfPages.map((pageObj) => (
            <div key={pageObj.pageNumber} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '25px' }}>
              
              <div style={{ alignSelf: 'flex-start', maxWidth: `${pageObj.viewport.width}px`, width: '100%', margin: '0 auto 6px auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', backgroundColor: '#cbd5e1', padding: '3px 8px', borderRadius: '4px' }}>Halaman {pageObj.pageNumber}</span>
                <button
                  onClick={() => handleOpenPadForPage(pageObj.pageNumber)}
                  style={{ padding: '5px 12px', backgroundColor: activePageTarget === pageObj.pageNumber ? '#16a34a' : '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  {activePageTarget === pageObj.pageNumber ? '✨ Ganti TTD Di Sini' : `📍 Taruh TTD di Hal ${pageObj.pageNumber}`}
                </button>
              </div>

              {/* DOKUMEN CONTAINER */}
              <div 
                id={`page-wrapper-${pageObj.pageNumber}`} 
                style={{ 
                  position: 'relative', 
                  width: `${pageObj.viewport.width}px`, 
                  maxWidth: '100%', 
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)', 
                  backgroundColor: '#ffffff' 
                }}
              >
                <canvas id={`pdf-canvas-p-${pageObj.pageNumber}`} style={{ width: '100%', height: 'auto', display: 'block' }} />

                {/* LOGIKA TTD TRANSPARAN SAAT DI-DRAG */}
                {activePageTarget === pageObj.pageNumber && signatureImage && (
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
                      width: `${sigWidth}px`,
                      padding: '5px',
                      border: isDraggingActive ? '2px dashed #3b82f6' : '2px dashed #16a34a',
                      // Background dibuat sangat transparan (rgba alpha 0.25) saat digeser agar teks di bawahnya terlihat jelas
                      backgroundColor: isDraggingActive ? 'rgba(219, 234, 254, 0.4)' : 'rgba(240, 253, 244, 0.25)', 
                      opacity: isDraggingActive ? 0.5 : 1, // Tembus pandang 50% saat diseret
                      cursor: 'move',
                      zIndex: 999,
                      touchAction: 'none',
                      borderRadius: '6px',
                      transition: 'opacity 0.1s ease'
                    }}
                  >
                    <img src={signatureImage} alt="Signature" style={{ width: '100%', display: 'block', pointerEvents: 'none', mixBlendMode: 'multiply' }} />
                    
                    {/* CONTROLLER RESIZE */}
                    <div style={{ backgroundColor: '#ffffff', padding: '4px', borderRadius: '4px', border: '1px solid #cbd5e1', marginTop: '4px' }} className="nodrag">
                      <input 
                        type="range" min="60" max="220" value={sigWidth} className="nodrag"
                        onChange={(e) => setSigWidth(Number(e.target.value))}
                        style={{ width: '100%', display: 'block', margin: 0 }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* FOOTER ACTION */}
      {signatureImage && activePageTarget && !pdfRenderLoading && (
        <footer style={{ marginTop: '15px', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleSubmitSignature}
            disabled={loading}
            style={{ padding: '12px 28px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px', width: '100%', maxWidth: '240px' }}
          >
            {loading ? "⏳ Menyimpan berkas..." : "💾 Simpan Hasil & Kirim"}
          </button>
        </footer>
      )}

      {/* POPUP MODAL MULTI-METODE (CORET / UPLOAD) */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', width: '92%', maxWidth: '440px' }}>
            <h3 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#1e3a8a' }}>Pilih Metode Tanda Tangan</h3>
            
            <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', marginBottom: '15px' }}>
              <button onClick={() => setSignMethod('draw')} style={{ flex: 1, padding: '10px', border: 'none', background: 'none', fontWeight: 'bold', color: signMethod === 'draw' ? '#2563eb' : '#64748b', borderBottom: signMethod === 'draw' ? '3px solid #2563eb' : 'none', cursor: 'pointer' }}>🖊️ Garis / Coret</button>
              <button onClick={() => setSignMethod('upload')} style={{ flex: 1, padding: '10px', border: 'none', background: 'none', fontWeight: 'bold', color: signMethod === 'upload' ? '#2563eb' : '#64748b', borderBottom: signMethod === 'upload' ? '3px solid #2563eb' : 'none', cursor: 'pointer' }}>📁 Unggah Gambar</button>
            </div>

            {signMethod === 'draw' && (
              <div>
                <canvas ref={signatureCanvasRef} width={380} height={180} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing} style={{ border: '1px solid #cbd5e1', borderRadius: '6px', backgroundColor: '#f8fafc', width: '100%', height: '180px', display: 'block', touchAction: 'none' }} />
                <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'space-between' }}>
                  <button onClick={clearCanvas} style={{ padding: '8px 14px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Hapus</button>
                  <div>
                    <button onClick={() => setIsModalOpen(false)} style={{ padding: '8px 14px', backgroundColor: '#6b7280', color: '#fff', border: 'none', borderRadius: '6px', marginRight: '6px', fontSize: '13px' }}>Batal</button>
                    <button onClick={saveCanvasImage} style={{ padding: '8px 16px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', fontSize: '13px' }}>Terapkan</button>
                  </div>
                </div>
              </div>
            )}

            {signMethod === 'upload' && (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>Pilih gambar tanda tangan. Latar belakang putih otomatis dihapus murni.</p>
                <input type="file" ref={fileInputRef} accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
                <button onClick={() => fileInputRef.current.click()} style={{ padding: '12px 20px', backgroundColor: '#f1f5f9', border: '2px dashed #cbd5e1', borderRadius: '8px', cursor: 'pointer', width: '100%', fontSize: '14px', color: '#334155', fontWeight: '500' }}>🔍 Cari File Foto TTD</button>
                <div style={{ marginTop: '20px', textAlign: 'right' }}>
                  <button onClick={() => setIsModalOpen(false)} style={{ padding: '8px 14px', backgroundColor: '#6b7280', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px' }}>Batal</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
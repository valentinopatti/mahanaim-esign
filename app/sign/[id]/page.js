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
  const [pdfLoadError, setPdfLoadError] = useState(false);
  
  // State Halaman PDF
  const [pdfPages, setPdfPages] = useState([]);
  const [activePageTarget, setActivePageTarget] = useState(null);

  // State Koordinat Posisi TTD (Persentase)
  const [position, setPosition] = useState({ x: 35, y: 70 });
  
  // State Baru: Mengatur Lebar Ukuran TTD (dalam pixel)
  const [sigWidth, setSigWidth] = useState(115);

  // Ref Komponen
  const signatureCanvasRef = useRef(null);

  // Pelacak gerakan seret (Drag & Drop)
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const positionStart = useRef({ x: 35, y: 70 });

  // 1. Ambil Berkas PDF dari Supabase
  useEffect(() => {
    async function loadAndSplitPDF() {
      try {
        setPdfRenderLoading(true);
        const { data, error } = await supabase
          .from('documents')
          .select('id, file_name, file_url')
          .eq('id', id)
          .single();

        if (error) throw error;
        if (!data || !data.file_url) throw new Error("File URL kosong");
        setDocumentData(data);

        const response = await fetch(data.file_url);
        const arrayBuffer = await response.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        const pagesArray = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.3 });
          pagesArray.push({
            pageNumber: i,
            pdfPageInstance: page,
            viewport: viewport
          });
        }
        setPdfPages(pagesArray);
        setPdfRenderLoading(false);
      } catch (err) {
        console.error("Gagal memproses dokumen:", err);
        setPdfLoadError(true);
        setPdfRenderLoading(false);
      }
    }
    if (id) loadAndSplitPDF();
  }, [id]);

  // 2. Render Kanvas PDF ke DOM
  useEffect(() => {
    pdfPages.forEach(async (pageObj) => {
      const canvas = document.getElementById(`pdf-canvas-p-${pageObj.pageNumber}`);
      if (canvas) {
        const context = canvas.getContext('2d');
        canvas.height = pageObj.viewport.height;
        canvas.width = pageObj.viewport.width;
        await pageObj.pdfPageInstance.render({
          canvasContext: context,
          viewport: pageObj.viewport
        }).promise;
      }
    });
  }, [pdfPages]);

  // 3. Logika Kanvas Coretan Tanda Tangan
  let isDrawing = false;
  const startDrawing = (e) => {
    isDrawing = true;
    draw(e);
  };
  const stopDrawing = () => {
    isDrawing = false;
    if (signatureCanvasRef.current) signatureCanvasRef.current.getContext('2d').beginPath();
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

  const handleOpenPadForPage = (pageNum) => {
    setActivePageTarget(pageNum);
    setIsModalOpen(true);
  };

  const saveCanvasImage = () => {
    if (!signatureCanvasRef.current) return;
    const dataUrl = signatureCanvasRef.current.toDataURL('image/png');
    setSignatureImage(dataUrl);
    setIsModalOpen(false);
    setPosition({ x: 35, y: 70 }); 
  };

  // 4. Logika Geser TTD Relatif Terhadap Halaman
  const handleStart = (e) => {
    // Abaikan drag jika pengguna sedang menggeser slider pengubah ukuran
    if (e.target.tagName.toLowerCase() === 'input') return;

    isDragging.current = true;
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

    if (newX < 0) newX = 0;
    if (newY < 0) newY = 0;
    if (newX > 80) newX = 80;
    if (newY > 92) newY = 92;

    setPosition({ x: newX, y: newY });
  };

  const handleEnd = () => {
    isDragging.current = false;
  };

  // 5. Simpan TTD dan Lebar Ukurannya ke Backend API
  const handleSubmitSignature = async () => {
    if (!signatureImage || !activePageTarget) return alert("Silakan tempel tanda tangan terlebih dahulu!");
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
          signatureWidth: sigWidth // Mengirimkan ukuran lebar kustom ke backend
        })
      });

      if (response.ok) {
        alert(`🎉 Dokumen Berhasil Disimpan di Halaman ${activePageTarget}!`);
        router.push('/documents');
      } else {
        const errData = await response.json();
        alert(`Gagal menyimpan: ${errData.error}`);
      }
    } catch (err) {
      alert("Terjadi gangguan koneksi internet.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '15px', fontFamily: 'sans-serif', maxWidth: '850px', margin: '0 auto', userSelect: 'none' }}>
      <header style={{ marginBottom: '15px' }}>
        <h1 style={{ fontSize: '18px', margin: 0, color: '#1e3a8a' }}>Mahanaim Studio Sign</h1>
        <p style={{ fontSize: '12px', color: '#666', margin: '2px 0 0 0' }}>
          Berkas: {documentData?.file_name || 'Memuat...'} {pdfPages.length > 0 && `(${pdfPages.length} Halaman)`}
        </p>
      </header>

      {/* VIEWPORT SCROLLABLE */}
      <div 
        style={{ 
          border: '2px solid #cbd5e1', 
          borderRadius: '8px', 
          backgroundColor: '#e2e8f0', 
          width: '100%', 
          height: '72vh',
          overflowY: 'auto',
          padding: '10px',
          WebkitOverflowScrolling: 'touch'
        }}
      >
        {pdfRenderLoading && (
          <div style={{ color: '#475569', fontSize: '14px', textAlign: 'center', marginTop: '25vh' }}>⏳ Sedang memuat halaman dokumen...</div>
        )}

        {!pdfRenderLoading && pdfPages.map((pageObj) => (
          <div key={pageObj.pageNumber} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '25px' }}>
            
            <div style={{ alignSelf: 'flex-start', maxWidth: '650px', width: '100%', margin: '0 auto 6px auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', backgroundColor: '#cbd5e1', padding: '3px 8px', borderRadius: '4px' }}>
                Halaman {pageObj.pageNumber} dari {pdfPages.length}
              </span>
              <button
                onClick={() => handleOpenPadForPage(pageObj.pageNumber)}
                style={{ padding: '5px 12px', backgroundColor: activePageTarget === pageObj.pageNumber ? '#16a34a' : '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {activePageTarget === pageObj.pageNumber ? '✍️ Ubah TTD Halaman Ini' : `📍 Tempel TTD di Hal ${pageObj.pageNumber}`}
              </button>
            </div>

            {/* KOTAK HALAMAN PDF */}
            <div 
              id={`page-wrapper-${pageObj.pageNumber}`}
              style={{ position: 'relative', width: '100%', maxWidth: '650px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', borderRadius: '4px', backgroundColor: '#ffffff' }}
            >
              <canvas id={`pdf-canvas-p-${pageObj.pageNumber}`} style={{ width: '100%', height: 'auto', display: 'block', borderRadius: '4px' }} />

              {/* TANDA TANGAN DENGAN FITUR RESIZE */}
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
                    width: `${sigWidth}px`, // Lebar diatur dinamis via state
                    padding: '6px',
                    border: '2px dashed #16a34a',
                    backgroundColor: 'rgba(240, 253, 244, 0.95)',
                    cursor: 'move',
                    zIndex: 99,
                    touchAction: 'none',
                    borderRadius: '6px',
                    boxShadow: '0 10px 15px -3px rgba(0,0,0,0.2)'
                  }}
                >
                  <img src={signatureImage} alt="Signature" style={{ width: '100%', display: 'block', pointerEvents: 'none', marginBottom: '5px' }} />
                  
                  {/* SLIDER PENGUBAH UKURAN (RESIZE) */}
                  <div style={{ backgroundColor: '#ffffff', padding: '4px', borderRadius: '4px', border: '1px solid #bbf7d0' }} className="nodrag">
                    <div style={{ fontSize: '8px', color: '#475569', fontWeight: 'bold', marginBottom: '2px', textAlign: 'center' }}>📐 Ukuran TTD:</div>
                    <input 
                      type="range" 
                      min="60" 
                      max="200" 
                      value={sigWidth} 
                      onChange={(e) => setSigWidth(Number(e.target.value))}
                      style={{ width: '100%', display: 'block', margin: 0, cursor: 'pointer' }}
                    />
                  </div>
                </div>
              )}
            </div>

          </div>
        ))}
      </div>

      {/* FOOTER TOMBOL SIMPAN */}
      {signatureImage && activePageTarget && !pdfRenderLoading && (
        <footer style={{ marginTop: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <span style={{ fontSize: '13px', color: '#16a34a', fontWeight: 'bold' }}>📍 Gunakan slider di kotak hijau untuk membesarkan/mengecilkan TTD.</span>
          <button
            onClick={handleSubmitSignature}
            disabled={loading}
            style={{ padding: '12px 28px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px', width: '100%', maxWidth: '200px' }}
          >
            {loading ? "⏳ Menyimpan..." : "💾 Simpan Hasil PDF"}
          </button>
        </footer>
      )}

      {/* POPUP MODAL PAD TTD */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', width: '92%', maxWidth: '420px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '15px' }}>Buat TTD untuk Halaman {activePageTarget}</h3>
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
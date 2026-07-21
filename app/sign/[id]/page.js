'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import * as pdfjsLib from 'pdfjs-dist';

if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://khlpzyyshtuwronalntr.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.5;
const MIN_SIG_PERCENT = 8;
const MAX_SIG_PERCENT = 32;
const DEFAULT_SIG_PERCENT = 15;

export default function SignDocumentPage() {
  const { id } = useParams();

  const [documentData, setDocumentData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [pdfInstance, setPdfInstance] = useState(null);
  const [pdfPages, setPdfPages] = useState([]);
  const [pdfRenderLoading, setPdfRenderLoading] = useState(true);

  const [zoomScale, setZoomScale] = useState(1);
  const [currentVisiblePage, setCurrentVisiblePage] = useState(1);
  const [pageJumpOpen, setPageJumpOpen] = useState(false);
  const [pageJumpValue, setPageJumpValue] = useState('');

  const [signatureImage, setSignatureImage] = useState(null);
  const [activePageTarget, setActivePageTarget] = useState(null);
  const [position, setPosition] = useState({ x: 60, y: 78 });
  const [sigWidthPercent, setSigWidthPercent] = useState(DEFAULT_SIG_PERCENT);
  const [isDraggingActive, setIsDraggingActive] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [signMethod, setSignMethod] = useState('draw');

  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [toast, setToast] = useState(null);

  const signatureCanvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const pageRefs = useRef({});
  const initializedZoom = useRef(false);
  const baseFitScale = useRef(1);

  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const positionStart = useRef({ x: 60, y: 78 });
  const isDrawing = useRef(false);

  const showToast = useCallback((message, type = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // 1. Ambil metadata dokumen dari Supabase, lalu unduh PDF-nya
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function loadPDF() {
      try {
        setLoadError(null);
        setPdfRenderLoading(true);
        const { data, error } = await supabase
          .from('documents')
          .select('*')
          .eq('id', id)
          .single();

        if (error) throw error;
        if (!data || !data.file_url) throw new Error('Berkas dokumen tidak ditemukan.');
        if (cancelled) return;
        setDocumentData(data);

        const response = await fetch(data.file_url);
        const arrayBuffer = await response.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (cancelled) return;
        setPdfInstance(pdf);
      } catch (err) {
        console.error('Gagal memuat berkas:', err);
        if (!cancelled) {
          setLoadError(err.message || 'Gagal memuat dokumen.');
          setPdfRenderLoading(false);
        }
      }
    }
    loadPDF();
    return () => { cancelled = true; };
  }, [id]);

  // 2. Skala awal menyesuaikan lebar layar (fit-to-width), seperti pembuka PDF di HP/Acrobat
  useEffect(() => {
    if (!pdfInstance || initializedZoom.current) return;
    let cancelled = false;
    (async () => {
      const page = await pdfInstance.getPage(1);
      const nativeViewport = page.getViewport({ scale: 1 });
      const containerWidth = scrollContainerRef.current?.clientWidth || 800;
      const fit = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (containerWidth - 32) / nativeViewport.width));
      if (cancelled) return;
      baseFitScale.current = fit;
      setZoomScale(fit);
      initializedZoom.current = true;
    })();
    return () => { cancelled = true; };
  }, [pdfInstance]);

  // 3. Render ulang seluruh halaman setiap kali skala zoom berubah
  useEffect(() => {
    if (!pdfInstance || !initializedZoom.current) return;
    let cancelled = false;

    async function renderPages() {
      const pagesArray = [];
      for (let i = 1; i <= pdfInstance.numPages; i++) {
        const page = await pdfInstance.getPage(i);
        const viewport = page.getViewport({ scale: zoomScale });
        pagesArray.push({ pageNumber: i, pdfPageInstance: page, viewport });
      }
      if (cancelled) return;
      setPdfPages(pagesArray);
      setPdfRenderLoading(false);
    }
    renderPages();
    return () => { cancelled = true; };
  }, [pdfInstance, zoomScale]);

  // 4. Gambar hasil render ke elemen kanvas HTML
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

  // 5. Lacak halaman yang sedang terlihat saat scroll (seperti indikator halaman di Acrobat)
  useEffect(() => {
    if (!pdfPages.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let best = null;
        entries.forEach((entry) => {
          if (entry.isIntersecting && (!best || entry.intersectionRatio > best.intersectionRatio)) {
            best = entry;
          }
        });
        if (best) setCurrentVisiblePage(Number(best.target.dataset.page));
      },
      { root: scrollContainerRef.current, threshold: [0.1, 0.25, 0.5, 0.75, 0.9] }
    );
    Object.values(pageRefs.current).forEach((node) => node && observer.observe(node));
    return () => observer.disconnect();
  }, [pdfPages]);

  const zoomIn = () => setZoomScale((prev) => Math.min(MAX_ZOOM, prev * 1.2));
  const zoomOut = () => setZoomScale((prev) => Math.max(MIN_ZOOM, prev / 1.2));
  const resetZoom = () => setZoomScale(baseFitScale.current);

  const jumpToPage = (n) => {
    const num = Math.min(Math.max(1, n), pdfPages.length);
    pageRefs.current[num]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setPageJumpOpen(false);
  };

  // --- Menggambar coretan tanda tangan ---
  const startDrawing = (e) => { isDrawing.current = true; draw(e); };
  const stopDrawing = () => {
    isDrawing.current = false;
    if (signatureCanvasRef.current) signatureCanvasRef.current.getContext('2d').beginPath();
  };
  const draw = (e) => {
    if (!isDrawing.current || !signatureCanvasRef.current) return;
    const canvas = signatureCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#000000';
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    ctx.lineTo(x, y);
    ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y);
    if (e.cancelable) e.preventDefault();
  };
  const clearCanvas = () => {
    if (!signatureCanvasRef.current) return;
    const canvas = signatureCanvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  };

  // --- Menempatkan/mengganti tanda tangan ---
  const finalizeSignature = (dataUrl) => {
    setSignatureImage(dataUrl);
    setIsModalOpen(false);
    setActivePageTarget((prev) => prev || currentVisiblePage);
    setPosition({ x: 60, y: 78 });
  };

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
          if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) data[i + 3] = 0;
        }
        ctx.putImageData(imgData, 0, 0);
        finalizeSignature(canvas.toDataURL('image/png'));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const saveCanvasImage = () => {
    if (!signatureCanvasRef.current) return;
    finalizeSignature(signatureCanvasRef.current.toDataURL('image/png'));
  };

  const openSignatureModal = () => {
    setActivePageTarget((prev) => prev || currentVisiblePage);
    setIsModalOpen(true);
  };

  const handlePageButtonClick = (pageNum) => {
    if (!signatureImage) {
      setActivePageTarget(pageNum);
      setIsModalOpen(true);
    } else {
      setActivePageTarget(pageNum);
      setPosition({ x: 60, y: 78 });
    }
  };

  const detachSignatureFromPage = () => setActivePageTarget(null);

  // --- Seret (drag) tanda tangan, posisi dalam persen relatif terhadap halaman (independen dari zoom) ---
  const handleStart = (e) => {
    if (e.target.className?.includes?.('nodrag')) return;
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
    const container = pageRefs.current[activePageTarget];
    if (!container) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const deltaX = clientX - dragStart.current.x;
    const deltaY = clientY - dragStart.current.y;
    const rect = container.getBoundingClientRect();

    let newX = positionStart.current.x + (deltaX / rect.width) * 100;
    let newY = positionStart.current.y + (deltaY / rect.height) * 100;

    if (newX < 0) newX = 0; if (newY < 0) newY = 0;
    if (newX > 90) newX = 90; if (newY > 95) newY = 95;
    setPosition({ x: newX, y: newY });
  };

  const handleEnd = () => { isDragging.current = false; setIsDraggingActive(false); };

  // Dengarkan gerakan di seluruh window (bukan hanya di dalam kotak TTD) selama proses geser,
  // supaya drag tidak terhenti begitu kursor bergerak cepat keluar dari area kotak.
  useEffect(() => {
    if (!isDraggingActive) return;
    const onMove = (e) => handleMove(e);
    const onUp = () => handleEnd();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [isDraggingActive, activePageTarget]);

  const handleSubmitSignature = async () => {
    if (!signatureImage || !activePageTarget) return showToast('Silakan pasang tanda tangan Anda terlebih dahulu.');
    setSubmitting(true);
    try {
      const response = await fetch('/api/save-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: id,
          signatureImage,
          percentX: position.x,
          percentY: position.y,
          pageNumber: activePageTarget,
          percentWidth: sigWidthPercent
        })
      });
      if (response.ok) {
        setSubmitSuccess(true);
      } else {
        const errData = await response.json();
        showToast(`Gagal menyimpan: ${errData.error}`);
      }
    } catch (err) {
      showToast('Gangguan koneksi internet.');
    } finally {
      setSubmitting(false);
    }
  };

  const recipientEmail = documentData?.recipient_email || documentData?.signer_email || '-';
  const activePageObj = pdfPages.find((p) => p.pageNumber === activePageTarget);

  if (loadError) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-slate-100 px-6">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-6 text-center">
          <div className="text-3xl mb-2">⚠️</div>
          <h2 className="font-bold text-slate-800 mb-1">Dokumen Tidak Bisa Dibuka</h2>
          <p className="text-sm text-slate-500">{loadError}</p>
        </div>
      </div>
    );
  }

  if (submitSuccess) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-slate-100 px-6">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-3xl">✓</div>
          <h2 className="font-bold text-lg text-slate-800 mb-1">Dokumen Berhasil Ditandatangani</h2>
          <p className="text-sm text-slate-500 mb-1">{documentData?.file_name}</p>
          <p className="text-xs text-slate-400">Salinan hasil dikirim ke <b>{recipientEmail}</b></p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-100 select-none">
      <header className="shrink-0 z-30 bg-white border-b border-slate-200 shadow-sm px-3 sm:px-5 py-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-sm sm:text-base font-bold text-slate-800 truncate">Mahanaim Studio Sign</h1>
          <p className="text-[11px] sm:text-xs text-slate-500 truncate">
            {documentData?.file_name || 'Memuat dokumen...'} <span className="text-slate-300">|</span> Kirim ke <b className="text-slate-600">{recipientEmail}</b>
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-1 bg-slate-100 rounded-full px-1 py-1 border border-slate-200 shrink-0">
          <button onClick={zoomOut} className="w-8 h-8 rounded-full hover:bg-white text-slate-600 font-bold">−</button>
          <span className="text-xs font-semibold text-slate-500 w-12 text-center">{Math.round(zoomScale * 100)}%</span>
          <button onClick={zoomIn} className="w-8 h-8 rounded-full hover:bg-white text-slate-600 font-bold">+</button>
        </div>
      </header>

      <main
        ref={scrollContainerRef}
        className="relative flex-1 overflow-y-auto overflow-x-hidden bg-slate-200/70 px-2 sm:px-6 py-6"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {pdfRenderLoading && (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm gap-2">
            <div className="w-6 h-6 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
            Sedang memuat dokumen...
          </div>
        )}

        {!pdfRenderLoading && pdfPages.map((pageObj) => {
          const isTargetPage = activePageTarget === pageObj.pageNumber;
          return (
            <div
              key={pageObj.pageNumber}
              ref={(el) => { pageRefs.current[pageObj.pageNumber] = el; }}
              data-page={pageObj.pageNumber}
              className="flex flex-col items-center mb-6"
            >
              <div className="flex items-center justify-between mb-1.5" style={{ width: pageObj.viewport.width, maxWidth: '100%' }}>
                <span className="text-[11px] font-bold text-slate-500 bg-slate-300/70 px-2 py-0.5 rounded">
                  Halaman {pageObj.pageNumber}
                </span>
                <button
                  onClick={() => handlePageButtonClick(pageObj.pageNumber)}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-full text-white shadow-sm transition-colors ${isTargetPage ? 'bg-emerald-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                  {isTargetPage ? '✓ TTD di sini' : signatureImage ? 'Taruh TTD di sini' : '+ Tanda tangan di sini'}
                </button>
              </div>

              <div
                id={`page-wrapper-${pageObj.pageNumber}`}
                className="relative bg-white shadow-lg rounded-sm overflow-hidden"
                style={{ width: pageObj.viewport.width, maxWidth: '100%' }}
              >
                <canvas id={`pdf-canvas-p-${pageObj.pageNumber}`} className="block w-full h-auto" />

                {isTargetPage && signatureImage && (
                  <div
                    onMouseDown={handleStart}
                    onTouchStart={handleStart}
                    className="absolute rounded-lg cursor-move transition-opacity"
                    style={{
                      left: `${position.x}%`,
                      top: `${position.y}%`,
                      width: `${(sigWidthPercent / 100) * pageObj.viewport.width}px`,
                      padding: '6px',
                      border: isDraggingActive ? '2px dashed #3b82f6' : '2px dashed #16a34a',
                      backgroundColor: isDraggingActive ? 'rgba(219, 234, 254, 0.4)' : 'rgba(240, 253, 244, 0.25)',
                      opacity: isDraggingActive ? 0.55 : 1,
                      zIndex: 20,
                      touchAction: 'none'
                    }}
                  >
                    <button
                      onClick={detachSignatureFromPage}
                      className="nodrag absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-slate-700 text-white text-[10px] leading-5 text-center shadow"
                      title="Lepas dari halaman ini"
                    >✕</button>
                    <img src={signatureImage} alt="Signature" className="w-full block pointer-events-none" style={{ mixBlendMode: 'multiply' }} />
                    <div className="nodrag bg-white/95 backdrop-blur rounded p-1 border border-slate-200 mt-1">
                      <input
                        type="range" min={MIN_SIG_PERCENT} max={MAX_SIG_PERCENT} step={0.5} value={sigWidthPercent}
                        onChange={(e) => setSigWidthPercent(Number(e.target.value))}
                        className="nodrag w-full block"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {!pdfRenderLoading && pdfPages.length > 1 && (
          <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center">
            <button
              onClick={() => { setPageJumpValue(String(currentVisiblePage)); setPageJumpOpen((v) => !v); }}
              className="bg-slate-900/80 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg backdrop-blur"
            >
              Hal {currentVisiblePage} / {pdfPages.length}
            </button>
            {pageJumpOpen && (
              <div className="mt-2 bg-white rounded-lg shadow-xl border border-slate-200 p-2 flex items-center gap-2">
                <input
                  type="number" min={1} max={pdfPages.length} value={pageJumpValue}
                  onChange={(e) => setPageJumpValue(e.target.value)}
                  className="w-14 text-center border border-slate-300 rounded px-1 py-1 text-sm"
                />
                <button onClick={() => jumpToPage(Number(pageJumpValue))} className="text-xs bg-blue-600 text-white px-2 py-1 rounded font-semibold">Ke</button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Kontrol zoom mengambang, mudah dijangkau ibu jari di HP */}
      <div className="fixed right-3 bottom-24 sm:bottom-28 z-40 flex flex-col items-center bg-white/95 backdrop-blur rounded-full shadow-lg border border-slate-200 overflow-hidden sm:hidden">
        <button onClick={zoomIn} className="w-10 h-10 text-slate-700 font-bold text-lg">+</button>
        <button onClick={resetZoom} className="w-10 h-8 text-[10px] font-semibold text-slate-500 border-y border-slate-100">{Math.round(zoomScale * 100)}%</button>
        <button onClick={zoomOut} className="w-10 h-10 text-slate-700 font-bold text-lg">−</button>
      </div>

      <footer
        className="shrink-0 z-30 bg-white border-t border-slate-200 px-3 sm:px-5 py-3 flex items-center justify-between gap-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {!signatureImage ? (
          <button
            onClick={openSignatureModal}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg py-3 text-sm shadow"
          >
            ✍️ Tempatkan Tanda Tangan
          </button>
        ) : (
          <>
            <button onClick={openSignatureModal} className="flex items-center gap-2 shrink-0">
              <img src={signatureImage} alt="TTD" className="h-8 w-14 object-contain border border-slate-200 rounded bg-slate-50" />
              <span className="text-xs font-semibold text-blue-600">Ganti</span>
            </button>
            <button
              onClick={handleSubmitSignature}
              disabled={submitting || !activePageTarget}
              className="flex-1 max-w-[240px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-lg py-3 text-sm shadow"
            >
              {submitting ? 'Menyimpan...' : !activePageTarget ? 'Pilih halaman dulu' : '💾 Selesai & Kirim'}
            </button>
          </>
        )}
      </footer>

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg">
          {toast.message}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-xl">
            <h3 className="text-base font-bold text-slate-800 mb-3">Pilih Metode Tanda Tangan</h3>

            <div className="flex border-b-2 border-slate-100 mb-4">
              <button
                onClick={() => setSignMethod('draw')}
                className={`flex-1 py-2 font-bold text-sm ${signMethod === 'draw' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400'}`}
              >🖊️ Garis / Coret</button>
              <button
                onClick={() => setSignMethod('upload')}
                className={`flex-1 py-2 font-bold text-sm ${signMethod === 'upload' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400'}`}
              >📁 Unggah Gambar</button>
            </div>

            {signMethod === 'draw' && (
              <div>
                <canvas
                  ref={signatureCanvasRef} width={380} height={180}
                  onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing}
                  className="border border-slate-300 rounded-lg bg-slate-50 w-full h-[180px] block"
                  style={{ touchAction: 'none' }}
                />
                <div className="mt-4 flex justify-between">
                  <button onClick={clearCanvas} className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-semibold">Hapus</button>
                  <div className="flex gap-2">
                    <button onClick={() => setIsModalOpen(false)} className="px-3 py-2 bg-slate-500 hover:bg-slate-600 text-white rounded-lg text-xs font-semibold">Batal</button>
                    <button onClick={saveCanvasImage} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold">Terapkan</button>
                  </div>
                </div>
              </div>
            )}

            {signMethod === 'upload' && (
              <div className="text-center py-2">
                <p className="text-xs text-slate-500 mb-3">Pilih gambar tanda tangan. Latar belakang putih otomatis dihapus.</p>
                <input type="file" ref={fileInputRef} accept="image/*" onChange={handleImageUpload} className="hidden" />
                <button
                  onClick={() => fileInputRef.current.click()}
                  className="w-full py-4 bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg text-sm font-medium text-slate-600"
                >🔍 Cari File Foto TTD</button>
                <div className="mt-5 text-right">
                  <button onClick={() => setIsModalOpen(false)} className="px-3 py-2 bg-slate-500 hover:bg-slate-600 text-white rounded-lg text-xs font-semibold">Batal</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import RequireAuth, { useAuth } from '../../components/RequireAuth';
import SignaturePad from '../../components/SignaturePad';
import { authedFetch } from '../../lib/authedFetch';
import { loadPdfjs } from '../../lib/pdfjs';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.5;
const MIN_SIG_PERCENT = 6;
const MAX_SIG_PERCENT = 40;
const DEFAULT_SIG_PERCENT = 15;

function newPlacementId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random()}`;
}

function SignPageContent() {
  const { id } = useParams();
  const router = useRouter();
  const { profile } = useAuth();

  const [accessState, setAccessState] = useState('loading'); // loading | forbidden | waiting | viewer | signer | signed | notFound
  const [documentMeta, setDocumentMeta] = useState(null);
  const [blockingSigner, setBlockingSigner] = useState(null);
  const [requiredPages, setRequiredPages] = useState([]); // [{ page_number, fulfilled }]
  const [canRetract, setCanRetract] = useState(false);
  const [retractDeadline, setRetractDeadline] = useState(null);
  const [retracting, setRetracting] = useState(false);

  const [pdfInstance, setPdfInstance] = useState(null);
  const [pdfPages, setPdfPages] = useState([]);
  const [pdfRenderLoading, setPdfRenderLoading] = useState(true);

  const [zoomScale, setZoomScale] = useState(1);
  const [currentVisiblePage, setCurrentVisiblePage] = useState(1);
  const [pageJumpOpen, setPageJumpOpen] = useState(false);
  const [pageJumpValue, setPageJumpValue] = useState('');

  const [signatureImage, setSignatureImage] = useState(null);
  // Setiap penempatan TTD independen: bisa lebih dari satu, di halaman berbeda-beda.
  const [placements, setPlacements] = useState([]); // [{ id, pageNumber, x, y, widthPercent }]
  const [activeDragId, setActiveDragId] = useState(null);
  const [activeResizeId, setActiveResizeId] = useState(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalIntent, setModalIntent] = useState({ type: 'addToPage', pageNumber: null });

  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [toast, setToast] = useState(null);

  const scrollContainerRef = useRef(null);
  const pagesWrapperRef = useRef(null);
  const pinchState = useRef({ active: false, initialDistance: 0, initialZoom: 1 });
  const pageRefs = useRef({});
  const initializedZoom = useRef(false);
  const baseFitScale = useRef(1);

  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const positionStart = useRef({ x: 0, y: 0 });

  const isResizing = useRef(false);
  const resizeStart = useRef({ x: 0, widthPercent: DEFAULT_SIG_PERCENT, containerWidth: 1 });

  // Menandai permintaan loadDocument() mana yang terbaru, supaya panggilan lama yang masih
  // berjalan (mis. akibat React StrictMode memanggil effect dua kali saat development, atau
  // dipanggil ulang cepat setelah retract) tidak menimpa hasil dari panggilan yang lebih baru.
  const loadRequestId = useRef(0);

  const showToast = useCallback((message) => {
    setToast({ message });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // 1. Ambil metadata dokumen lewat API (server memutuskan hak akses saya di sini).
  // Fungsi ini dipakai ulang saat pertama kali dibuka, dan setelah tanda tangan/retract
  // (lewat tombol "Lihat Dokumen" atau setelah retract berhasil) untuk memuat versi terbaru.
  const loadDocument = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    const isStale = () => requestId !== loadRequestId.current;

    const res = await authedFetch(`/api/documents/${id}`);
    if (isStale()) return;
    if (res.status === 404) { setAccessState('notFound'); return; }
    if (res.status === 403) { setAccessState('forbidden'); return; }
    if (!res.ok) { setAccessState('forbidden'); return; }

    const payload = await res.json();
    if (isStale()) return;
    setDocumentMeta(payload);
    setBlockingSigner(payload.blockingSigner);
    setRequiredPages(payload.myRequiredPages || []);
    setCanRetract(payload.canRetract);
    setRetractDeadline(payload.retractDeadline);
    setPlacements([]);

    if (payload.myRecipient?.role === 'viewer') {
      setAccessState('viewer');
    } else if (payload.myRecipient?.status === 'waiting') {
      setAccessState('waiting');
    } else if (payload.myRecipient?.status === 'signed') {
      setAccessState('signed');
    } else {
      setAccessState('signer');
    }

    if (profile?.saved_signature) setSignatureImage(profile.saved_signature);

    setPdfRenderLoading(true);
    setPdfInstance(null);
    initializedZoom.current = false;
    const pdfjsLib = await loadPdfjs();
    const response = await fetch(payload.document.current_file_url);
    const arrayBuffer = await response.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    if (isStale()) return;
    setPdfInstance(pdf);
  }, [id, profile]);

  useEffect(() => {
    if (!id) return;
    loadDocument();
  }, [id, loadDocument]);

  // 2. Skala awal menyesuaikan lebar layar (fit-to-width)
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

  // 5. Lacak halaman yang sedang terlihat saat scroll
  useEffect(() => {
    if (!pdfPages.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let best = null;
        entries.forEach((entry) => {
          if (entry.isIntersecting && (!best || entry.intersectionRatio > best.intersectionRatio)) best = entry;
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

  // Pinch dua jari khusus mengubah ukuran area dokumen saja (lewat CSS transform, tanpa
  // render ulang PDF.js di setiap gerakan jari supaya tetap mulus), bukan zoom bawaan browser
  // yang tadinya ikut membesarkan tombol/header/footer. Ukuran final baru dikomit ke zoomScale
  // (memicu render ulang PDF.js yang sesungguhnya, lebih tajam) begitu jari dilepas.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const getDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onTouchStart = (e) => {
      if (e.touches.length !== 2) return;
      pinchState.current.active = true;
      pinchState.current.initialDistance = getDistance(e.touches);
      pinchState.current.initialZoom = zoomScale;
      const wrapper = pagesWrapperRef.current;
      if (wrapper) {
        const rect = wrapper.getBoundingClientRect();
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        wrapper.style.transformOrigin = `${((midX - rect.left) / rect.width) * 100}% ${((midY - rect.top) / rect.height) * 100}%`;
      }
    };

    const onTouchMove = (e) => {
      if (!pinchState.current.active || e.touches.length !== 2) return;
      e.preventDefault();
      const factor = getDistance(e.touches) / pinchState.current.initialDistance;
      if (pagesWrapperRef.current) pagesWrapperRef.current.style.transform = `scale(${factor})`;
    };

    const endPinch = () => {
      if (!pinchState.current.active) return;
      pinchState.current.active = false;
      const wrapper = pagesWrapperRef.current;
      if (!wrapper) return;
      const match = wrapper.style.transform.match(/scale\(([\d.]+)\)/);
      const factor = match ? parseFloat(match[1]) : 1;
      wrapper.style.transform = '';
      wrapper.style.transformOrigin = '';
      setZoomScale(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchState.current.initialZoom * factor)));
    };

    const onTouchEnd = (e) => { if (e.touches.length < 2) endPinch(); };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [zoomScale]);

  const addPlacementToPage = (pageNum) => {
    setPlacements((prev) => [...prev, { id: newPlacementId(), pageNumber: pageNum, x: 60, y: 78, widthPercent: DEFAULT_SIG_PERCENT }]);
  };

  // Menghitung halaman yang benar-benar terlihat SEKARANG lewat pengukuran posisi langsung,
  // bukan mengandalkan state currentVisiblePage yang bisa terlambat mengikuti (terutama saat
  // scroll cepat/inertia di HP) — ini yang menyebabkan salah halaman saat "Sign This Page" diklik.
  const getCurrentPageNow = () => {
    const container = scrollContainerRef.current;
    if (!container || pdfPages.length === 0) return currentVisiblePage;
    const containerRect = container.getBoundingClientRect();
    const referenceY = containerRect.top + containerRect.height / 2;
    let bestPage = pdfPages[0].pageNumber;
    let bestDistance = Infinity;
    for (const pageObj of pdfPages) {
      const el = pageRefs.current[pageObj.pageNumber];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top <= referenceY && rect.bottom >= referenceY) return pageObj.pageNumber;
      const distance = Math.min(Math.abs(rect.top - referenceY), Math.abs(rect.bottom - referenceY));
      if (distance < bestDistance) { bestDistance = distance; bestPage = pageObj.pageNumber; }
    }
    return bestPage;
  };

  // Perkiraan rasio tinggi/lebar gambar TTD, untuk memusatkan kotak TTD secara vertikal juga (bukan cuma horizontal).
  const getImageAspectRatio = (dataUrl) => new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve(img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.4);
    img.onerror = () => resolve(0.4);
    img.src = dataUrl;
  });

  // Menempatkan TTD tepat di tengah area layar yang sedang terlihat saat ini (bukan di posisi baku),
  // pada halaman yang sedang di-scroll.
  const addPlacementCenteredOnPage = async (pageNum, imageForAspect) => {
    const container = pageRefs.current[pageNum];
    if (!container || !scrollContainerRef.current) {
      addPlacementToPage(pageNum);
      return;
    }
    const viewportRect = scrollContainerRef.current.getBoundingClientRect();
    const pageRect = container.getBoundingClientRect();
    const centerClientX = viewportRect.left + viewportRect.width / 2;
    const centerClientY = viewportRect.top + viewportRect.height / 2;

    const widthPercent = DEFAULT_SIG_PERCENT;
    const aspect = await getImageAspectRatio(imageForAspect);
    const widthPx = (widthPercent / 100) * pageRect.width;
    const heightPercentOfPage = ((widthPx * aspect) / pageRect.height) * 100;

    let x = ((centerClientX - pageRect.left) / pageRect.width) * 100 - widthPercent / 2;
    let y = ((centerClientY - pageRect.top) / pageRect.height) * 100 - heightPercentOfPage / 2;
    x = Math.min(90, Math.max(0, x));
    y = Math.min(95, Math.max(0, y));

    setPlacements((prev) => [...prev, { id: newPlacementId(), pageNumber: pageNum, x, y, widthPercent }]);
  };

  const finalizeSignature = (dataUrl) => {
    setSignatureImage(dataUrl);
    setIsModalOpen(false);
    if (modalIntent.type === 'addToPage') {
      addPlacementCenteredOnPage(modalIntent.pageNumber || getCurrentPageNow(), dataUrl);
    }
  };

  const handleSignThisPage = () => {
    const pageNow = getCurrentPageNow();
    if (!signatureImage) {
      setModalIntent({ type: 'addToPage', pageNumber: pageNow });
      setIsModalOpen(true);
    } else {
      addPlacementCenteredOnPage(pageNow, signatureImage);
    }
  };

  const openChangeSignatureModal = () => {
    setModalIntent({ type: 'replaceImage' });
    setIsModalOpen(true);
  };

  const removePlacement = (placementId) => setPlacements((prev) => prev.filter((p) => p.id !== placementId));

  // --- Seret (drag) satu penempatan TTD, posisi dalam persen relatif terhadap halamannya (independen dari zoom) ---
  const handleDragStart = (e, placementId) => {
    if (e.target.className?.includes?.('nodrag')) return;
    isDragging.current = true;
    setActiveDragId(placementId);
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragStart.current = { x: clientX, y: clientY };
    const placement = placements.find((p) => p.id === placementId);
    positionStart.current = { x: placement.x, y: placement.y };
    if (e.cancelable) e.preventDefault();
  };

  const handleDragMove = (e) => {
    if (!isDragging.current || !activeDragId) return;
    const placement = placements.find((p) => p.id === activeDragId);
    if (!placement) return;
    const container = pageRefs.current[placement.pageNumber];
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
    setPlacements((prev) => prev.map((p) => (p.id === activeDragId ? { ...p, x: newX, y: newY } : p)));
  };

  const handleDragEnd = () => { isDragging.current = false; setActiveDragId(null); };

  // --- Ubah ukuran lewat gagang anak panah di sudut kanan bawah: ditarik keluar makin besar, ditarik ke dalam makin kecil ---
  const handleResizeStart = (e, placementId) => {
    e.stopPropagation();
    isResizing.current = true;
    setActiveResizeId(placementId);
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const placement = placements.find((p) => p.id === placementId);
    const container = pageRefs.current[placement.pageNumber];
    const rect = container.getBoundingClientRect();
    resizeStart.current = { x: clientX, widthPercent: placement.widthPercent, containerWidth: rect.width };
    if (e.cancelable) e.preventDefault();
  };

  const handleResizeMove = (e) => {
    if (!isResizing.current || !activeResizeId) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const deltaX = clientX - resizeStart.current.x;
    const deltaPercent = (deltaX / resizeStart.current.containerWidth) * 100;
    let newWidthPercent = resizeStart.current.widthPercent + deltaPercent;
    newWidthPercent = Math.min(MAX_SIG_PERCENT, Math.max(MIN_SIG_PERCENT, newWidthPercent));
    setPlacements((prev) => prev.map((p) => (p.id === activeResizeId ? { ...p, widthPercent: newWidthPercent } : p)));
  };

  const handleResizeEnd = () => { isResizing.current = false; setActiveResizeId(null); };

  // Dengarkan gerakan di seluruh window (bukan hanya di dalam kotak TTD) selama drag/resize,
  // supaya gerakan cepat tidak menghentikan proses lebih awal.
  useEffect(() => {
    if (!activeDragId && !activeResizeId) return;
    const onMove = (e) => {
      if (activeDragId) handleDragMove(e);
      if (activeResizeId) handleResizeMove(e);
    };
    const onUp = () => { handleDragEnd(); handleResizeEnd(); };
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
  }, [activeDragId, activeResizeId]);

  const handleSubmitSignature = async () => {
    if (!signatureImage || placements.length === 0) return showToast('Tempatkan minimal 1 tanda tangan terlebih dahulu.');
    if (unmetRequiredPages.length > 0) return showToast(`Wajib TTD di halaman: ${unmetRequiredPages.join(', ')}.`);
    setSubmitting(true);
    try {
      const res = await authedFetch('/api/sign', {
        method: 'POST',
        body: JSON.stringify({
          documentId: id,
          signatureImage,
          placements: placements.map((p) => ({
            pageNumber: p.pageNumber,
            percentX: p.x,
            percentY: p.y,
            percentWidth: p.widthPercent,
          })),
        }),
      });
      if (res.ok) {
        setSubmitSuccess(true);
      } else {
        const errData = await res.json();
        showToast(`Gagal menyimpan: ${errData.error}`);
      }
    } catch {
      showToast('Gangguan koneksi internet.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewSignedDocument = async () => {
    setSubmitSuccess(false);
    await loadDocument();
  };

  // Selalu ambil versi PDF terbaru langsung dari server saat diunduh, supaya tidak
  // bergantung pada state lokal yang mungkin belum sinkron dengan hasil tanda tangan terbaru.
  const handleDownload = async () => {
    const res = await authedFetch(`/api/documents/${id}`);
    if (!res.ok) { showToast('Gagal mengunduh dokumen.'); return; }
    const payload = await res.json();
    const link = document.createElement('a');
    link.href = payload.document.current_file_url;
    link.download = payload.document.file_name || 'dokumen.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRetract = async () => {
    if (!window.confirm('Yakin ingin membatalkan tanda tangan Anda pada dokumen ini?')) return;
    setRetracting(true);
    try {
      const res = await authedFetch('/api/sign/retract', {
        method: 'POST',
        body: JSON.stringify({ documentId: id }),
      });
      if (res.ok) {
        showToast('Tanda tangan berhasil dibatalkan.');
        await loadDocument();
      } else {
        const err = await res.json();
        showToast(err.error || 'Gagal membatalkan tanda tangan.');
      }
    } catch {
      showToast('Gangguan koneksi internet.');
    } finally {
      setRetracting(false);
    }
  };

  if (accessState === 'loading') {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-slate-100">
        <div className="w-6 h-6 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (accessState === 'notFound' || accessState === 'forbidden') {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-slate-100 px-6">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-6 text-center">
          <div className="text-3xl mb-2">⚠️</div>
          <h2 className="font-bold text-slate-800 mb-1">
            {accessState === 'notFound' ? 'Dokumen tidak ditemukan.' : 'Anda tidak memiliki akses ke dokumen ini.'}
          </h2>
        </div>
      </div>
    );
  }

  if (accessState === 'waiting') {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-slate-100 px-6">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-6 text-center">
          <div className="text-3xl mb-2">⏳</div>
          <h2 className="font-bold text-slate-800 mb-1">Menunggu Giliran Anda</h2>
          <p className="text-sm text-slate-500">{documentMeta?.document.file_name}</p>
          {blockingSigner && (
            <p className="text-xs text-slate-400 mt-2">Masih menunggu tanda tangan dari <b>{blockingSigner.full_name}</b> terlebih dahulu.</p>
          )}
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
          <p className="text-sm text-slate-500 mb-5">{documentMeta?.document.file_name}</p>
          <div className="flex flex-col gap-2">
            <button onClick={handleDownload} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg py-2.5 text-sm">
              ⬇️ Download Dokumen
            </button>
            <div className="flex gap-2">
              <button onClick={() => router.push('/dashboard')} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg py-2.5 text-sm">
                ← Dashboard
              </button>
              <button onClick={handleViewSignedDocument} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg py-2.5 text-sm">
                📄 Lihat Dokumen
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isViewer = accessState === 'viewer';
  const isAlreadySigned = accessState === 'signed';
  const isReadOnly = isViewer || isAlreadySigned;
  const requiredPageNumbers = requiredPages.map((rp) => rp.page_number);
  const unmetRequiredPages = requiredPageNumbers.filter((pn) => !placements.some((p) => p.pageNumber === pn));
  const canSubmit = signatureImage && placements.length > 0 && unmetRequiredPages.length === 0;

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-100 select-none">
      <header className="shrink-0 z-30 bg-white border-b border-slate-200 shadow-sm px-3 sm:px-5 py-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-sm sm:text-base font-bold text-slate-800 truncate">Mahanaim Studio Sign</h1>
          <p className="text-[11px] sm:text-xs text-slate-500 truncate">
            {documentMeta?.document.file_name} <span className="text-slate-300">|</span> {isViewer ? 'Mode Lihat Saja' : isAlreadySigned ? 'Sudah Anda Tanda Tangani' : `Masuk sebagai ${profile?.full_name}`}
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
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
      >
        {pdfRenderLoading && (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm gap-2">
            <div className="w-6 h-6 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
            Sedang memuat dokumen...
          </div>
        )}

        {!pdfRenderLoading && documentMeta?.document.message && (
          <div className="mx-auto mb-4 max-w-xl rounded-xl bg-white border border-slate-200 shadow-sm p-3 text-sm">
            <p className="text-[11px] font-bold text-slate-500 mb-1">
              Pesan dari {documentMeta.document.profiles?.full_name || 'pengirim'}:
            </p>
            <p className="text-slate-700 whitespace-pre-wrap">{documentMeta.document.message}</p>
          </div>
        )}

        {!pdfRenderLoading && isAlreadySigned && (
          <div className={`sticky top-0 z-30 mx-auto mb-4 max-w-fit rounded-full px-3 py-1.5 text-xs font-semibold shadow ${canRetract ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
            {canRetract
              ? `Anda bisa membatalkan tanda tangan sampai ${new Date(retractDeadline).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`
              : '✓ Dokumen sudah Anda tanda tangani'}
          </div>
        )}

        {!pdfRenderLoading && !isReadOnly && requiredPageNumbers.length > 0 && (
          <div className={`sticky top-0 z-30 mx-auto mb-4 max-w-fit rounded-full px-3 py-1.5 text-xs font-semibold shadow ${unmetRequiredPages.length > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
            {unmetRequiredPages.length > 0
              ? `Wajib TTD di halaman: ${unmetRequiredPages.join(', ')}`
              : '✓ Semua halaman wajib sudah ditandatangani'}
          </div>
        )}

        <div ref={pagesWrapperRef}>
        {!pdfRenderLoading && pdfPages.map((pageObj) => {
          const pagePlacements = placements.filter((p) => p.pageNumber === pageObj.pageNumber);
          return (
            <div
              key={pageObj.pageNumber}
              ref={(el) => { pageRefs.current[pageObj.pageNumber] = el; }}
              data-page={pageObj.pageNumber}
              className="flex flex-col items-center mb-6"
            >
              <div className="flex items-center justify-between mb-1.5" style={{ width: pageObj.viewport.width, maxWidth: '100%' }}>
                <span className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-slate-500 bg-slate-300/70 px-2 py-0.5 rounded">
                    Halaman {pageObj.pageNumber}
                  </span>
                  {!isReadOnly && requiredPageNumbers.includes(pageObj.pageNumber) && (
                    pagePlacements.length > 0 ? (
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">✓ Wajib TTD</span>
                    ) : (
                      <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">⚠ Wajib TTD</span>
                    )
                  )}
                </span>
              </div>

              <div
                id={`page-wrapper-${pageObj.pageNumber}`}
                className="relative bg-white shadow-lg rounded-sm overflow-hidden"
                style={{ width: pageObj.viewport.width, maxWidth: '100%' }}
              >
                <canvas id={`pdf-canvas-p-${pageObj.pageNumber}`} className="block w-full h-auto" />

                {!isReadOnly && signatureImage && pagePlacements.map((placement) => {
                  const isDraggingThis = activeDragId === placement.id;
                  return (
                    <div
                      key={placement.id}
                      onMouseDown={(e) => handleDragStart(e, placement.id)}
                      onTouchStart={(e) => handleDragStart(e, placement.id)}
                      className="absolute rounded-lg cursor-move transition-opacity"
                      style={{
                        left: `${placement.x}%`,
                        top: `${placement.y}%`,
                        width: `${(placement.widthPercent / 100) * pageObj.viewport.width}px`,
                        padding: '6px',
                        border: isDraggingThis ? '2px dashed #3b82f6' : '2px dashed #16a34a',
                        backgroundColor: isDraggingThis ? 'rgba(219, 234, 254, 0.4)' : 'rgba(240, 253, 244, 0.25)',
                        opacity: isDraggingThis ? 0.55 : 1,
                        zIndex: 20,
                        touchAction: 'none',
                      }}
                    >
                      <button
                        onClick={() => removePlacement(placement.id)}
                        className="nodrag absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-slate-700 text-white text-[10px] leading-5 text-center shadow"
                        title="Hapus penempatan ini"
                      >✕</button>
                      <img src={signatureImage} alt="Signature" className="w-full block pointer-events-none" style={{ mixBlendMode: 'multiply' }} />
                      <div
                        onMouseDown={(e) => handleResizeStart(e, placement.id)}
                        onTouchStart={(e) => handleResizeStart(e, placement.id)}
                        className="nodrag absolute -bottom-2.5 -right-2.5 w-6 h-6 bg-white border border-slate-300 rounded-full shadow flex items-center justify-center text-slate-500 text-xs font-bold"
                        style={{ cursor: 'nwse-resize' }}
                        title="Tarik untuk mengubah ukuran"
                      >⤡</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>

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

      <div className="fixed right-3 bottom-24 sm:bottom-28 z-40 flex flex-col items-center bg-white/95 backdrop-blur rounded-full shadow-lg border border-slate-200 overflow-hidden sm:hidden">
        <button onClick={zoomIn} className="w-10 h-10 text-slate-700 font-bold text-lg">+</button>
        <button onClick={resetZoom} className="w-10 h-8 text-[10px] font-semibold text-slate-500 border-y border-slate-100">{Math.round(zoomScale * 100)}%</button>
        <button onClick={zoomOut} className="w-10 h-10 text-slate-700 font-bold text-lg">−</button>
      </div>

      {!isViewer && (
        <footer
          className="shrink-0 z-30 bg-white border-t border-slate-200 px-3 sm:px-5 py-3 flex items-center justify-between gap-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          {isAlreadySigned ? (
            <>
              <button onClick={() => router.push('/dashboard')} className="text-sm font-bold text-slate-600 px-3 py-3">
                ← Dashboard
              </button>
              <button onClick={handleDownload} className="flex-1 max-w-[220px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg py-3 text-sm shadow">
                ⬇️ Download
              </button>
              {canRetract && (
                <button
                  onClick={handleRetract}
                  disabled={retracting}
                  className="flex-1 max-w-[240px] bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-lg py-3 text-sm shadow"
                >
                  {retracting ? 'Membatalkan...' : '🗑️ Batalkan Tanda Tangan'}
                </button>
              )}
            </>
          ) : (
            <>
              {signatureImage && (
                <button onClick={openChangeSignatureModal} className="shrink-0" title="Ganti tanda tangan">
                  <img src={signatureImage} alt="TTD" className="h-10 w-12 object-contain border border-slate-200 rounded bg-slate-50" />
                </button>
              )}
              <button
                onClick={handleSignThisPage}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg py-3 text-sm shadow"
              >
                ✍️ Sign This Page
              </button>
              <button
                onClick={handleSubmitSignature}
                disabled={submitting || !canSubmit}
                className="flex-1 max-w-[220px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-lg py-3 text-sm shadow"
              >
                {submitting
                  ? 'Menyimpan...'
                  : placements.length === 0
                    ? 'Tempatkan TTD dulu'
                    : unmetRequiredPages.length > 0
                      ? `Wajib TTD di hal. ${unmetRequiredPages.join(', ')}`
                      : `💾 Selesai & Kirim (${placements.length})`}
              </button>
            </>
          )}
        </footer>
      )}

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg">
          {toast.message}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-xl">
            <h3 className="text-base font-bold text-slate-800 mb-3">Pilih Metode Tanda Tangan</h3>
            <SignaturePad onSave={finalizeSignature} onCancel={() => setIsModalOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function SignDocumentPage() {
  return (
    <RequireAuth>
      <SignPageContent />
    </RequireAuth>
  );
}

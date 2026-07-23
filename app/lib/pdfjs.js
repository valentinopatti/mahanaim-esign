'use client';

// pdfjs-dist references browser-only globals (e.g. DOMMatrix) at module scope,
// which crashes if it's ever evaluated during server-side prerendering. Loading
// it lazily, only when actually needed client-side, avoids that entirely.
let pdfjsPromise;

export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((mod) => {
      if (!mod.GlobalWorkerOptions.workerSrc) {
        mod.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      }
      return mod;
    });
  }
  return pdfjsPromise;
}

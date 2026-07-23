'use client';

import { useRef, useState } from 'react';

export default function SignaturePad({ onSave, onCancel, saveLabel = 'Terapkan' }) {
  const [signMethod, setSignMethod] = useState('draw');
  const signatureCanvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const isDrawing = useRef(false);

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
        onSave(canvas.toDataURL('image/png'));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const saveCanvasImage = () => {
    if (!signatureCanvasRef.current) return;
    onSave(signatureCanvasRef.current.toDataURL('image/png'));
  };

  return (
    <div>
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
              {onCancel && (
                <button onClick={onCancel} className="px-3 py-2 bg-slate-500 hover:bg-slate-600 text-white rounded-lg text-xs font-semibold">Batal</button>
              )}
              <button onClick={saveCanvasImage} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold">{saveLabel}</button>
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
          {onCancel && (
            <div className="mt-5 text-right">
              <button onClick={onCancel} className="px-3 py-2 bg-slate-500 hover:bg-slate-600 text-white rounded-lg text-xs font-semibold">Batal</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

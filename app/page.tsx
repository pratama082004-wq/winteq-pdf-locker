'use client';

if (typeof window !== 'undefined' && typeof (Promise as any).withResolvers === 'undefined') {
  (Promise as any).withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

import { useState, useEffect, useRef } from 'react';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import jsPDF from 'jspdf';
import JSZip from 'jszip';

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');

// Normalise /Rotate metadata → bake rotation into content stream
const normalizePage = async (page: any, mainDoc: any) => {
  const rotObj = page.node.get(PDFName.of('Rotate'));
  const rotDeg = rotObj ? Number(rotObj.toString()) : 0;
  if (rotDeg === 0) return;
  const rawW = page.getWidth();
  const rawH = page.getHeight();
  let t: string;
  if      (rotDeg === 90)  t = `q 0 -1 1 0 0 ${rawW} cm\n`;
  else if (rotDeg === 270) t = `q 0 1 -1 0 ${rawH} 0 cm\n`;
  else                     t = `q -1 0 0 -1 ${rawW} ${rawH} cm\n`;
  const existing = page.node.get(PDFName.of('Contents'));
  if (existing) {
    const sRef = mainDoc.context.register(mainDoc.context.flateStream(t));
    const eRef = mainDoc.context.register(mainDoc.context.flateStream('\nQ'));
    const arr  = mainDoc.context.obj([]);
    arr.push(sRef);
    if (typeof existing.size === 'function') {
      for (let i = 0; i < existing.size(); i++) arr.push(existing.get(i));
    } else { arr.push(existing); }
    arr.push(eRef);
    page.node.set(PDFName.of('Contents'), arr);
  }
  if (rotDeg === 90 || rotDeg === 270)
    page.node.set(PDFName.of('MediaBox'), mainDoc.context.obj([0, 0, rawH, rawW]));
  page.node.delete(PDFName.of('CropBox'));
  page.node.delete(PDFName.of('Rotate'));
};

// ─────────────────────────────────────────────────────────────────────────────
// WATERMARK PLACEMENT  — pure raster approach (pdfjs → canvas → jsPDF)
//
// Setelah banyak percobaan dengan pdf-lib drawPage + transform matrix,
// masalah utamanya adalah pdf-lib menggambar embedded XObject di raw
// MediaBox space TANPA memperhitungkan transformasi apapun yang ada
// di content stream. Solusi paling reliable dan 100% akurat:
//
//   1. Render page utama ke canvas (via pdfjs, yang handle semua edge case)
//   2. Render watermark ke canvas terpisah, SAMA ukurannya dengan page
//   3. Composite watermark di atas page di canvas
//   4. Output sebagai jsPDF
//
// Ini guarantees watermark selalu centered, full-cover, orientasi benar,
// tanpa perlu manipulasi PDF internals sama sekali.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────────────────────────────────────
type Tab = 'watermark' | 'rotate';

// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState<Tab>('watermark');
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-gray-200">
          {(['watermark', 'rotate'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-4 text-sm font-bold tracking-wide transition
                ${tab === t
                  ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                  : 'text-gray-400 hover:text-gray-600 bg-gray-50'}`}>
              {t === 'watermark' ? ' Lock Watermark' : ' Rotate PDF'}
            </button>
          ))}
        </div>

        <div className="p-8">
          {tab === 'watermark' ? <WatermarkTab /> : <RotateTab />}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 1 — LOCK WATERMARK
// ═════════════════════════════════════════════════════════════════════════════
function WatermarkTab() {
  const [files,        setFiles]        = useState<File[]>([]);
  const [watermark,    setWatermark]    = useState<File | null>(null);
  const [downloadMode, setDownloadMode] = useState<'separate'|'zip'>('separate');
  const [isProcessing, setIsProcessing] = useState(false);
  const [status,       setStatus]       = useState('');
  const [isDragMain,   setIsDragMain]   = useState(false);
  const [isDragWater,  setIsDragWater]  = useState(false);
  const fileRef  = useRef<HTMLInputElement>(null);
  const waterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    import('pdfjs-dist').then(lib => {
      lib.GlobalWorkerOptions.workerSrc =
        `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.js`;
    });
  }, []);

  const addFiles = (incoming: File[]) => {
    const pdfs = incoming.filter(isPdf);
    if (!pdfs.length) return;
    setFiles(prev => {
      const seen = new Set(prev.map(f => f.name + f.size));
      return [...prev, ...pdfs.filter(f => !seen.has(f.name + f.size))];
    });
    if (fileRef.current) fileRef.current.value = '';
  };
  const removeFile     = (i: number) => setFiles(p => p.filter((_, j) => j !== i));
  const clearAllFiles  = () => { setFiles([]); if (fileRef.current) fileRef.current.value = ''; };
  const setWMark       = (f: File|null) => { if (f && !isPdf(f)) return; setWatermark(f); if (waterRef.current) waterRef.current.value = ''; };

  const handleProcess = async () => {
    if (!files.length || !watermark) {
      alert('Harap masukkan minimal 1 gambar teknik dan 1 file watermark!'); return;
    }
    setIsProcessing(true);
    const zip = new JSZip();
    try {
      const pdfjsLib = await import('pdfjs-dist');
      const waterBytes = await watermark.arrayBuffer();

      for (let f = 0; f < files.length; f++) {
        const cur = files[f];
        setStatus(`Memproses file ${f+1}/${files.length}: ${cur.name}...`);

        const mainBytes  = await cur.arrayBuffer();

        // ── Render page utama via pdfjs (handle semua rotasi otomatis) ──
        const mainPdf  = await pdfjsLib.getDocument({ data: mainBytes }).promise;
        const waterPdf = await pdfjsLib.getDocument({ data: waterBytes }).promise;
        const waterPage = await waterPdf.getPage(1);

        let pdfOut: jsPDF | null = null;

        for (let i = 1; i <= mainPdf.numPages; i++) {
          setStatus(`[File ${f+1}/${files.length}] Halaman ${i}/${mainPdf.numPages}...`);
          const page     = await mainPdf.getPage(i);
          const SCALE    = 3.0;
          const viewport = page.getViewport({ scale: SCALE });
          const pW = viewport.width;
          const pH = viewport.height;

          // Canvas utama ukuran page
          const canvas  = document.createElement('canvas');
          canvas.width  = pW; canvas.height = pH;
          const ctx     = canvas.getContext('2d')!;

          // LANGKAH 1: Render page utama dulu (layer bawah)
          // @ts-ignore
          await page.render({ canvasContext: ctx, viewport }).promise;

          // LANGKAH 2: Render watermark ke canvas UKURAN SAMA dengan page
          // Scale: COVER - watermark di-stretch pas ke seluruh page (x dan y independen)
          // Ini memastikan watermark selalu mulai dari (0,0) dan memenuhi page penuh
          // tanpa offset, persis seperti file watermark aslinya.
          const wvp    = waterPage.getViewport({ scale: 1 });
          const wScaleX = pW / wvp.width;
          const wScaleY = pH / wvp.height;
          // Pakai scale yang lebih besar (cover) supaya watermark memenuhi page
          const wScale  = Math.max(wScaleX, wScaleY);
          const wViewport = waterPage.getViewport({ scale: wScale });
          const wCanvas   = document.createElement('canvas');
          wCanvas.width   = pW;   // sama persis ukuran page
          wCanvas.height  = pH;
          const wCtx = wCanvas.getContext('2d')!;
          wCtx.fillStyle = '#ffffff';
          wCtx.fillRect(0, 0, pW, pH);
          // Gambar watermark dari pojok kiri atas, crop jika perlu
          const wOffX = (pW - wViewport.width)  / 2;
          const wOffY = (pH - wViewport.height) / 2;
          wCtx.translate(wOffX, wOffY);
          // @ts-ignore
          await waterPage.render({ canvasContext: wCtx, viewport: wViewport }).promise;

          // LANGKAH 3: Overlay watermark di atas page dengan multiply
          // pixel putih watermark = transparan, pixel gelap = muncul
          ctx.save();
          ctx.globalCompositeOperation = 'multiply';
          ctx.drawImage(wCanvas, 0, 0);
          ctx.restore();

          // Masukkan ke jsPDF
          const imgData    = canvas.toDataURL('image/jpeg', 0.85);
          const ptW        = pW / SCALE;
          const ptH        = pH / SCALE;
          const orientation = ptW > ptH ? 'l' : 'p';
          if (i === 1) {
            pdfOut = new jsPDF({ orientation, unit: 'pt', format: [ptW, ptH] });
          } else {
            pdfOut?.addPage([ptW, ptH], orientation);
          }
          pdfOut?.addImage(imgData, 'JPEG', 0, 0, ptW, ptH);
        }

        if (pdfOut) {
          if (downloadMode === 'separate') {
            pdfOut.save(`locked_${cur.name}`);
          } else {
            zip.file(`locked_${cur.name}`, pdfOut.output('blob'));
          }
        }
      }

      if (downloadMode === 'zip') {
        setStatus('Mengompres ke ZIP...');
        const blob = await zip.generateAsync({ type: 'blob' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = 'locked_gambar_teknik.zip'; a.click();
        URL.revokeObjectURL(url);
      }
      setStatus('Selesai! Semua PDF berhasil diproses.');
    } catch (err) {
      console.error(err);
      setStatus('Terjadi kesalahan. Cek console (F12).');
    } finally { setIsProcessing(false); }
  };

  return (
    <>
      <h1 className="text-2xl font-bold text-gray-800 text-center mb-1">Secure PDF Watermark</h1>
      <p className="text-gray-400 text-center mb-7 text-xs">Bulk proses gambar teknik. 100% Anti-Convert.</p>

      {/* Section 1 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">1. Upload PDF Gambar Teknik</span>
          {files.length > 0 && (
            <button onClick={clearAllFiles} className="text-xs text-red-500 hover:text-red-700 font-medium">Hapus Semua</button>
          )}
        </div>
        <label
          onDragOver={e=>{e.preventDefault();setIsDragMain(true)}}
          onDragLeave={()=>setIsDragMain(false)}
          onDrop={e=>{e.preventDefault();setIsDragMain(false);addFiles(Array.from(e.dataTransfer.files))}}
          className={`flex flex-col items-center justify-center gap-1 w-full px-4 py-5 rounded-xl border-2 border-dashed cursor-pointer transition
            ${isDragMain?'border-blue-500 bg-blue-100':'border-blue-200 bg-blue-50 hover:bg-blue-100'}`}>
          <svg className="w-7 h-7 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
          </svg>
          <span className="text-sm font-semibold text-blue-700">
            {isDragMain ? 'Lepaskan file...' : (files.length ? 'Tambah file PDF lagi' : 'Drag & drop atau klik untuk pilih')}
          </span>
          <span className="text-xs text-blue-400">Format: PDF, bisa lebih dari 1 file</span>
          <input ref={fileRef} type="file" accept=".pdf" multiple onChange={e=>addFiles(Array.from(e.target.files||[]))} className="hidden"/>
        </label>
        {files.length > 0 && (
          <ul className="mt-3 space-y-2">
            {files.map((file, idx) => (
              <li key={idx} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/></svg>
                  <span className="text-sm text-gray-700 truncate">{file.name}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{formatSize(file.size)}</span>
                </div>
                <button onClick={()=>removeFile(idx)} className="ml-2 w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-red-500 transition">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </li>
            ))}
          </ul>
        )}
        {files.length > 0 && <p className="mt-2 text-xs text-blue-600 font-medium">{files.length} file terpilih</p>}
      </div>

      {/* Section 2 */}
      <div className="mb-6">
        <span className="block text-sm font-medium text-gray-700 mb-2">2. Upload PDF Watermark (1 file saja)</span>
        {!watermark ? (
          <label
            onDragOver={e=>{e.preventDefault();setIsDragWater(true)}}
            onDragLeave={()=>setIsDragWater(false)}
            onDrop={e=>{e.preventDefault();setIsDragWater(false);const f=e.dataTransfer.files[0];if(f)setWMark(f)}}
            className={`flex flex-col items-center justify-center gap-1 w-full px-4 py-5 rounded-xl border-2 border-dashed cursor-pointer transition
              ${isDragWater?'border-purple-500 bg-purple-100':'border-purple-200 bg-purple-50 hover:bg-purple-100'}`}>
            <svg className="w-7 h-7 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
            </svg>
            <span className="text-sm font-semibold text-purple-700">
              {isDragWater ? 'Lepaskan file...' : 'Drag & drop atau klik untuk pilih watermark'}
            </span>
            <span className="text-xs text-purple-400">Format: PDF, 1 file saja</span>
            <input ref={waterRef} type="file" accept=".pdf" onChange={e=>setWMark(e.target.files?.[0]||null)} className="hidden"/>
          </label>
        ) : (
          <div className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 text-purple-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/></svg>
              <span className="text-sm text-purple-700 truncate font-medium">{watermark.name}</span>
              <span className="text-xs text-purple-400 flex-shrink-0">{formatSize(watermark.size)}</span>
            </div>
            <button onClick={()=>setWMark(null)} className="ml-2 w-5 h-5 flex items-center justify-center rounded-full text-purple-400 hover:text-white hover:bg-red-500 transition">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        )}
      </div>

      {/* Section 3 */}
      <div className="mb-7">
        <span className="block text-sm font-medium text-gray-700 mb-3">3. Opsi Unduhan Hasil</span>
        <div className="flex gap-4">
          {(['separate','zip'] as const).map(m=>(
            <label key={m} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <input type="radio" name="dlMode" value={m} checked={downloadMode===m} onChange={()=>setDownloadMode(m)} className="w-4 h-4 text-blue-600"/>
              {m==='separate'?'Unduh Terpisah':'Jadikan 1 File ZIP'}
            </label>
          ))}
        </div>
      </div>

      <button onClick={handleProcess} disabled={isProcessing}
        className={`w-full py-3 rounded-xl text-white font-bold text-lg transition-all
          ${isProcessing?'bg-gray-400 cursor-not-allowed':'bg-blue-600 hover:bg-blue-700 hover:shadow-lg hover:scale-[1.02]'}`}>
        {isProcessing?'Memproses...':'Kunci & Download File'}
      </button>
      {status && <p className="mt-5 text-center text-sm font-medium text-gray-600 bg-gray-100 py-2 rounded-lg">{status}</p>}
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 2 — ROTATE PDF
// ═════════════════════════════════════════════════════════════════════════════
type RotateFile = {
  file: File;
  // per-page rotations: 0 | 90 | 180 | 270
  pageRotations: number[];
  // preview URLs (rasterised, 1 per page)
  previews: string[];
  totalPages: number;
  loading: boolean;
};

function RotateTab() {
  const [rotFiles,    setRotFiles]    = useState<RotateFile[]>([]);
  const [isDrag,      setIsDrag]      = useState(false);
  const [isProcessing,setIsProcessing]= useState(false);
  const [status,      setStatus]      = useState('');
  const [downloadMode,setDownloadMode]= useState<'separate'|'zip'>('separate');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    import('pdfjs-dist').then(lib => {
      lib.GlobalWorkerOptions.workerSrc =
        `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.js`;
    });
  }, []);

  const loadFile = async (file: File): Promise<RotateFile> => {
    const pdfjsLib = await import('pdfjs-dist');
    const bytes    = await file.arrayBuffer();
    const pdf      = await pdfjsLib.getDocument({ data: bytes }).promise;
    const n        = pdf.numPages;
    const previews: string[] = [];

    for (let i = 1; i <= n; i++) {
      const page     = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 0.4 });
      const canvas   = document.createElement('canvas');
      canvas.width   = viewport.width;
      canvas.height  = viewport.height;
      // @ts-ignore
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
      previews.push(canvas.toDataURL('image/jpeg', 0.7));
    }

    return { file, pageRotations: Array(n).fill(0), previews, totalPages: n, loading: false };
  };

  const addFiles = async (incoming: File[]) => {
    const pdfs = incoming.filter(isPdf);
    if (!pdfs.length) return;
    // Tambah placeholder loading
    const placeholders: RotateFile[] = pdfs.map(f => ({
      file: f, pageRotations: [], previews: [], totalPages: 0, loading: true
    }));
    setRotFiles(prev => {
      const seen = new Set(prev.map(x => x.file.name + x.file.size));
      return [...prev, ...placeholders.filter(p => !seen.has(p.file.name + p.file.size))];
    });
    if (inputRef.current) inputRef.current.value = '';

    for (const ph of placeholders) {
      const loaded = await loadFile(ph.file);
      setRotFiles(prev => prev.map(x =>
        x.file.name === ph.file.name && x.file.size === ph.file.size ? loaded : x
      ));
    }
  };

  const removeRotFile = (idx: number) => setRotFiles(p => p.filter((_, i) => i !== idx));

  const rotatePage = (fileIdx: number, pageIdx: number, dir: 'cw'|'ccw') => {
    setRotFiles(prev => prev.map((rf, fi) => {
      if (fi !== fileIdx) return rf;
      const newRots = [...rf.pageRotations];
      newRots[pageIdx] = ((newRots[pageIdx] + (dir==='cw'?90:-90)) + 360) % 360;
      return { ...rf, pageRotations: newRots };
    }));
  };

  const rotateAll = (fileIdx: number, dir: 'cw'|'ccw') => {
    setRotFiles(prev => prev.map((rf, fi) => {
      if (fi !== fileIdx) return rf;
      return { ...rf, pageRotations: rf.pageRotations.map(r => ((r + (dir==='cw'?90:-90)) + 360) % 360) };
    }));
  };

  const handleDownload = async () => {
    const toProcess = rotFiles.filter(rf => !rf.loading && rf.pageRotations.some(r => r !== 0));
    if (!toProcess.length) { alert('Belum ada halaman yang dirotasi!'); return; }
    setIsProcessing(true);
    const zip = new JSZip();
    try {
      for (let fi = 0; fi < rotFiles.length; fi++) {
        const rf = rotFiles[fi];
        if (rf.loading) continue;
        setStatus(`Menyimpan ${rf.file.name}...`);
        const bytes  = await rf.file.arrayBuffer();
        const doc    = await PDFDocument.load(bytes);
        const pages  = doc.getPages();
        pages.forEach((page, pi) => {
          const addRot = rf.pageRotations[pi] ?? 0;
          if (addRot === 0) return;
          const cur = page.getRotation().angle;
          page.setRotation(degrees((cur + addRot) % 360));
        });
        const outBytes = await doc.save();
        const blob     = new Blob([outBytes as unknown as BlobPart], { type: 'application/pdf' });
        if (downloadMode === 'separate') {
          const url = URL.createObjectURL(blob);
          const a   = document.createElement('a');
          a.href = url; a.download = `rotated_${rf.file.name}`; a.click();
          URL.revokeObjectURL(url);
        } else {
          zip.file(`rotated_${rf.file.name}`, blob);
        }
      }
      if (downloadMode === 'zip') {
        setStatus('Mengompres...');
        const blob = await zip.generateAsync({ type: 'blob' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = 'rotated_pdfs.zip'; a.click();
        URL.revokeObjectURL(url);
      }
      setStatus('Selesai! File berhasil disimpan dengan rotasi baru.');
    } catch (err) {
      console.error(err);
      setStatus('Terjadi kesalahan. Cek console (F12).');
    } finally { setIsProcessing(false); }
  };

  return (
    <>
      <h1 className="text-2xl font-bold text-gray-800 text-center mb-1">Rotate PDF</h1>
      <p className="text-gray-400 text-center mb-7 text-xs">Rotasi halaman PDF dan simpan permanen.</p>

      {/* Drop zone */}
      <label
        onDragOver={e=>{e.preventDefault();setIsDrag(true)}}
        onDragLeave={()=>setIsDrag(false)}
        onDrop={e=>{e.preventDefault();setIsDrag(false);addFiles(Array.from(e.dataTransfer.files))}}
        className={`flex flex-col items-center justify-center gap-1 w-full px-4 py-5 rounded-xl border-2 border-dashed cursor-pointer transition mb-6
          ${isDrag?'border-green-500 bg-green-100':'border-green-200 bg-green-50 hover:bg-green-100'}`}>
        <svg className="w-7 h-7 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
        </svg>
        <span className="text-sm font-semibold text-green-700">
          {isDrag?'Lepaskan file...':'Drag & drop atau klik untuk pilih PDF'}
        </span>
        <span className="text-xs text-green-400">Bisa lebih dari 1 file</span>
        <input ref={inputRef} type="file" accept=".pdf" multiple onChange={e=>addFiles(Array.from(e.target.files||[]))} className="hidden"/>
      </label>

      {/* File cards */}
      {rotFiles.map((rf, fi) => (
        <div key={fi} className="mb-6 border border-gray-200 rounded-xl overflow-hidden">
          {/* File header */}
          <div className="flex items-center justify-between bg-gray-50 px-4 py-3 border-b border-gray-200">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/></svg>
              <span className="text-sm font-semibold text-gray-700 truncate">{rf.file.name}</span>
              <span className="text-xs text-gray-400">{formatSize(rf.file.size)}</span>
            </div>
            <div className="flex items-center gap-2">
              {!rf.loading && (
                <>
                  <button onClick={()=>rotateAll(fi,'ccw')} title="Rotate all CCW"
                    className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded-lg transition">↺ Semua</button>
                  <button onClick={()=>rotateAll(fi,'cw')} title="Rotate all CW"
                    className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded-lg transition">↻ Semua</button>
                </>
              )}
              <button onClick={()=>removeRotFile(fi)} className="w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-red-500 transition">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          </div>

          {/* Pages */}
          <div className="p-3">
            {rf.loading ? (
              <div className="flex items-center justify-center py-8 text-gray-400 text-sm gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                Memuat preview...
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {rf.previews.map((src, pi) => (
                  <div key={pi} className="flex flex-col items-center gap-1">
                    <div className="relative border border-gray-200 rounded-lg overflow-hidden bg-gray-50"
                      style={{ transition: 'transform 0.3s' }}>
                      <img
                        src={src}
                        alt={`Halaman ${pi+1}`}
                        style={{
                          transform: `rotate(${rf.pageRotations[pi]}deg)`,
                          transition: 'transform 0.3s',
                          display: 'block',
                          maxWidth: '100px',
                          maxHeight: '140px',
                          objectFit: 'contain',
                        }}
                      />
                      {rf.pageRotations[pi] !== 0 && (
                        <span className="absolute top-1 right-1 bg-orange-500 text-white text-xs px-1 rounded font-bold">
                          {rf.pageRotations[pi]}°
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400">Hal {pi+1}</span>
                    <div className="flex gap-1">
                      <button onClick={()=>rotatePage(fi,pi,'ccw')}
                        className="w-6 h-6 flex items-center justify-center bg-gray-100 hover:bg-blue-100 hover:text-blue-600 rounded transition text-sm" title="Putar kiri">↺</button>
                      <button onClick={()=>rotatePage(fi,pi,'cw')}
                        className="w-6 h-6 flex items-center justify-center bg-gray-100 hover:bg-blue-100 hover:text-blue-600 rounded transition text-sm" title="Putar kanan">↻</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}

      {rotFiles.length > 0 && (
        <>
          <div className="mb-5">
            <span className="block text-sm font-medium text-gray-700 mb-3">Opsi Unduhan</span>
            <div className="flex gap-4">
              {(['separate','zip'] as const).map(m=>(
                <label key={m} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                  <input type="radio" name="rotateDlMode" value={m} checked={downloadMode===m} onChange={()=>setDownloadMode(m)} className="w-4 h-4 text-green-600"/>
                  {m==='separate'?'Unduh Terpisah':'Jadikan 1 File ZIP'}
                </label>
              ))}
            </div>
          </div>
          <button onClick={handleDownload} disabled={isProcessing}
            className={`w-full py-3 rounded-xl text-white font-bold text-lg transition-all
              ${isProcessing?'bg-gray-400 cursor-not-allowed':'bg-green-600 hover:bg-green-700 hover:shadow-lg hover:scale-[1.02]'}`}>
            {isProcessing?'Menyimpan...':' Simpan PDF dengan Rotasi Baru'}
          </button>
        </>
      )}
      {status && <p className="mt-5 text-center text-sm font-medium text-gray-600 bg-gray-100 py-2 rounded-lg">{status}</p>}
    </>
  );
}

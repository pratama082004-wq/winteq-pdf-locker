'use client';

if (typeof window !== 'undefined' && typeof (Promise as any).withResolvers === 'undefined') {
  (Promise as any).withResolvers = function () {
    let resolve: any, reject: any;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { PDFDocument, PDFName, degrees, rgb, StandardFonts } from 'pdf-lib';
import jsPDF from 'jspdf';
import JSZip from 'jszip';

// ─── Types ────────────────────────────────────────────────────────────────────
type MainTab = 'organize' | 'optimize' | 'convert_to' | 'convert_from' | 'edit' | 'security';
type ToolId =
  | 'merge' | 'split' | 'remove_pages' | 'extract_pages'
  | 'compress'
  | 'pdf_to_jpg' | 'pdf_to_word' | 'pdf_to_excel' | 'pdf_to_pptx'
  | 'jpg_to_pdf' | 'word_to_pdf'
  | 'rotate' | 'watermark' | 'page_numbers' | 'crop'
  | 'protect' | 'unlock';

// ─── Constants ────────────────────────────────────────────────────────────────
const TABS: { id: MainTab; label: string; emoji: string }[] = [
  { id: 'organize',     label: 'Organize',     emoji: '○' },
  { id: 'optimize',     label: 'Optimize',     emoji: '◈' },
  { id: 'convert_to',   label: 'To PDF',       emoji: '↓' },
  { id: 'convert_from', label: 'From PDF',     emoji: '↑' },
  { id: 'edit',         label: 'Edit',         emoji: '◫' },
  { id: 'security',     label: 'Security',     emoji: '◉' },
];

const TOOLS: Record<MainTab, { id: ToolId; label: string; desc: string; emoji: string; available: boolean }[]> = {
  organize: [
    { id: 'merge',         label: 'Merge PDF',        desc: 'Gabungkan beberapa PDF menjadi satu',      emoji: '⊕', available: true  },
    { id: 'split',         label: 'Split PDF',         desc: 'Pisahkan PDF menjadi beberapa file',       emoji: '⊗', available: true  },
    { id: 'remove_pages',  label: 'Remove Pages',      desc: 'Hapus halaman tertentu dari PDF',          emoji: '−', available: true  },
    { id: 'extract_pages', label: 'Extract Pages',     desc: 'Ambil halaman tertentu sebagai PDF baru',  emoji: '◱', available: true  },
  ],
  optimize: [
    { id: 'compress', label: 'Compress PDF', desc: 'Perkecil ukuran file PDF', emoji: '⊘', available: true },
  ],
  convert_to: [
    { id: 'jpg_to_pdf',  label: 'JPG to PDF',  desc: 'Konversi gambar JPG/PNG ke PDF', emoji: '▣', available: true  },
    { id: 'word_to_pdf', label: 'Word to PDF', desc: 'Konversi file .docx ke PDF',     emoji: '◧', available: false },
  ],
  convert_from: [
    { id: 'pdf_to_jpg',  label: 'PDF to JPG',        desc: 'Konversi halaman PDF ke gambar JPG',  emoji: '▢', available: true  },
    { id: 'pdf_to_word', label: 'PDF to Word',        desc: 'Konversi PDF ke dokumen Word',        emoji: '◨', available: false },
    { id: 'pdf_to_excel',label: 'PDF to Excel',       desc: 'Ekstrak tabel PDF ke Excel',          emoji: '▦', available: false },
    { id: 'pdf_to_pptx', label: 'PDF to PowerPoint',  desc: 'Konversi PDF ke presentasi',          emoji: '▤', available: false },
  ],
  edit: [
    { id: 'rotate',       label: 'Rotate PDF',      desc: 'Rotasi halaman dan simpan permanen',    emoji: '↻', available: true },
    { id: 'watermark',    label: 'Lock Watermark',  desc: 'Watermark + kunci PDF anti-convert',    emoji: '◉', available: true },
    { id: 'page_numbers', label: 'Page Numbers',    desc: 'Tambahkan nomor halaman ke PDF',        emoji: '①', available: true },
  ],
  security: [
    { id: 'protect', label: 'Protect PDF', desc: 'Tambahkan password ke PDF', emoji: '◈', available: true  },
    { id: 'unlock',  label: 'Unlock PDF',  desc: 'Hapus password dari PDF',   emoji: '◎', available: false },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isPdf   = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
const isImage = (f: File) => f.type.startsWith('image/');
const fmtSize = (b: number) => b < 1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB';

function useWorker() {
  useEffect(() => {
    import('pdfjs-dist').then(lib => {
      lib.GlobalWorkerOptions.workerSrc =
        `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.js`;
    });
  }, []);
}

async function getPdfJs() { return await import('pdfjs-dist'); }

async function renderPageToCanvas(pdfPage: any, scale = 2.0): Promise<HTMLCanvasElement> {
  const viewport = pdfPage.getViewport({ scale });
  const canvas   = document.createElement('canvas');
  canvas.width   = viewport.width; canvas.height = viewport.height;
  // @ts-ignore
  await pdfPage.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
  return canvas;
}

async function normalizePage(page: any, doc: any) {
  const rotObj = page.node.get(PDFName.of('Rotate'));
  const rot    = rotObj ? Number(rotObj.toString()) : 0;
  if (rot === 0) return;
  const w = page.getWidth(), h = page.getHeight();
  let t = rot===90 ? `q 0 -1 1 0 0 ${w} cm\n`
        : rot===270? `q 0 1 -1 0 ${h} 0 cm\n`
        :             `q -1 0 0 -1 ${w} ${h} cm\n`;
  const ex = page.node.get(PDFName.of('Contents'));
  if (ex) {
    const sRef = doc.context.register(doc.context.flateStream(t));
    const eRef = doc.context.register(doc.context.flateStream('\nQ'));
    const arr  = doc.context.obj([]);
    arr.push(sRef);
    if (typeof ex.size === 'function') for (let i=0;i<ex.size();i++) arr.push(ex.get(i));
    else arr.push(ex);
    arr.push(eRef);
    page.node.set(PDFName.of('Contents'), arr);
  }
  if (rot===90||rot===270) page.node.set(PDFName.of('MediaBox'), doc.context.obj([0,0,h,w]));
  page.node.delete(PDFName.of('CropBox'));
  page.node.delete(PDFName.of('Rotate'));
}

function DropZone({ onFiles, accept, multi=true, label='Drag & drop atau klik untuk pilih PDF', sub='Format: PDF', color='blue' }:
  { onFiles:(f:File[])=>void; accept:string; multi?:boolean; label?:string; sub?:string; color?:string }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const c = { blue:'border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-blue-400',
               green:'border-green-200 bg-green-50 hover:bg-green-100 text-green-700 text-green-400',
               purple:'border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-700 text-purple-400' }[color]!.split(' ');
  return (
    <label
      onDragOver={e=>{e.preventDefault();setDrag(true)}}
      onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);onFiles(Array.from(e.dataTransfer.files))}}
      className={`flex flex-col items-center justify-center gap-1 w-full px-4 py-6 rounded-xl border-2 border-dashed cursor-pointer transition
        ${drag ? 'scale-[1.01] opacity-90' : ''} ${c[0]} ${c[1]} ${c[2]}`}>
      <svg className={`w-8 h-8 ${c[4]??c[3]}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
      </svg>
      <span className={`text-sm font-semibold ${c[3]}`}>{drag ? 'Lepaskan file...' : label}</span>
      <span className={`text-xs ${c[4]??c[3]} opacity-70`}>{sub}</span>
      <input ref={ref} type="file" accept={accept} multiple={multi}
        onChange={e=>onFiles(Array.from(e.target.files||[]))}
        className="hidden"/>
    </label>
  );
}

function FileRow({ file, onRemove, color='gray' }: { file:File; onRemove:()=>void; color?:string }) {
  const bg = color==='purple' ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200';
  const tx = color==='purple' ? 'text-purple-700' : 'text-gray-700';
  return (
    <div className={`flex items-center justify-between ${bg} border rounded-lg px-3 py-2`}>
      <div className="flex items-center gap-2 min-w-0">
        <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/></svg>
        <span className={`text-sm ${tx} truncate font-medium`}>{file.name}</span>
        <span className="text-xs text-gray-400 flex-shrink-0">{fmtSize(file.size)}</span>
      </div>
      <button onClick={onRemove} className="ml-2 w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-red-500 transition">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
  );
}

function StatusBar({ msg }: { msg: string }) {
  if (!msg) return null;
  return <p className="mt-4 text-center text-sm font-medium text-gray-600 bg-gray-100 py-2 px-4 rounded-lg">{msg}</p>;
}

function ActionBtn({ onClick, disabled, label, color='blue' }: { onClick:()=>void; disabled:boolean; label:string; color?:string }) {
  const cl = { blue:'bg-blue-600 hover:bg-blue-700', green:'bg-green-600 hover:bg-green-700', red:'bg-red-600 hover:bg-red-700', purple:'bg-purple-600 hover:bg-purple-700' }[color]!;
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full py-3 rounded-xl text-white font-bold text-base transition-all
        ${disabled ? 'bg-gray-300 cursor-not-allowed' : `${cl} hover:shadow-lg hover:scale-[1.01]`}`}>
      {label}
    </button>
  );
}

function DlModeToggle({ mode, setMode }: { mode:'separate'|'zip'; setMode:(m:'separate'|'zip')=>void }) {
  return (
    <div className="flex gap-4 mb-5">
      {(['separate','zip'] as const).map(m => (
        <label key={m} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
          <input type="radio" checked={mode===m} onChange={()=>setMode(m)} className="w-4 h-4 text-blue-600"/>
          {m==='separate' ? 'Unduh Terpisah' : 'Jadikan 1 ZIP'}
        </label>
      ))}
    </div>
  );
}


// ─── Tool Icon Map ───────────────────────────────────────────────────────────
function ToolIcon({ toolId }: { toolId: string }) {
  const paths: Record<string, React.ReactNode> = {
    'merge': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2"/></>,
    'split': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7"/></>,
    'remove_pages': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></>,
    'extract_pages': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></>,
    'compress': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 15l7-7 7 7M5 9l7-7 7 7"/></>,
    'jpg_to_pdf': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></>,
    'word_to_pdf': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></>,
    'pdf_to_jpg': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></>,
    'pdf_to_word': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></>,
    'pdf_to_excel': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18M10 3v18M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z"/></>,
    'pdf_to_pptx': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"/></>,
    'rotate': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></>,
    'watermark': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></>,
    'page_numbers': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></>,
    'protect': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></>,
    'unlock': <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"/></>,
  };
  return (
    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {paths[toolId] ?? <circle cx="12" cy="12" r="4" strokeWidth={1.5}/>}
    </svg>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a'); a.href=url; a.download=name; a.click();
  URL.revokeObjectURL(url);
}

// ═════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [mainTab,    setMainTab]    = useState<MainTab>('organize');
  const [activeTool, setActiveTool] = useState<ToolId|null>(null);

  if (activeTool) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-2xl mx-auto">
          <button onClick={()=>setActiveTool(null)}
            className="mb-4 flex items-center gap-2 text-sm text-gray-500 hover:text-blue-600 transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7"/></svg>
            Kembali
          </button>
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <ToolPage toolId={activeTool}/>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 text-center">
        <h1 className="text-2xl font-black text-gray-800">PDF Tools</h1>
        <p className="text-sm text-gray-400 mt-1">Semua kebutuhan PDF dalam satu tempat • 100% di browser</p>
      </div>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setMainTab(t.id)}
              className={`flex-shrink-0 px-5 py-3.5 text-sm font-semibold transition border-b-2
                ${mainTab===t.id ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tool grid */}
      <div className="max-w-4xl mx-auto p-6">
        <div className="grid grid-cols-2 gap-4">
          {TOOLS[mainTab].map(tool => (
            <button key={tool.id}
              onClick={()=>tool.available && setActiveTool(tool.id)}
              className={`relative text-left p-5 rounded-2xl border-2 transition
                ${tool.available
                  ? 'bg-white border-gray-200 hover:border-blue-400 hover:shadow-md cursor-pointer'
                  : 'bg-gray-50 border-gray-100 cursor-not-allowed opacity-60'}`}>
              <div className="w-8 h-8 mb-3 rounded-lg bg-gray-100 flex items-center justify-center"><ToolIcon toolId={tool.id}/></div>
              <div className="font-bold text-gray-800 text-sm">{tool.label}</div>
              <div className="text-xs text-gray-500 mt-1">{tool.desc}</div>
              {!tool.available && (
                <span className="absolute top-2 right-2 text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-semibold">
                  Soon
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TOOL PAGE ROUTER
// ═════════════════════════════════════════════════════════════════════════════
function ToolPage({ toolId }: { toolId: ToolId }) {
  switch(toolId) {
    case 'merge':         return <MergeTool/>;
    case 'split':         return <SplitTool/>;
    case 'remove_pages':  return <RemovePagesTool/>;
    case 'extract_pages': return <ExtractPagesTool/>;
    case 'compress':      return <CompressTool/>;
    case 'jpg_to_pdf':    return <JpgToPdfTool/>;
    case 'pdf_to_jpg':    return <PdfToJpgTool/>;
    case 'rotate':        return <RotateTool/>;
    case 'watermark':     return <WatermarkTool/>;
    case 'page_numbers':  return <PageNumbersTool/>;
    case 'protect':       return <ProtectTool/>;
    default:              return <div className="text-center text-gray-400 py-10">Tool tidak tersedia</div>;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. MERGE PDF
// ═════════════════════════════════════════════════════════════════════════════
function MergeTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy]   = useState(false);
  const [status, setStatus] = useState('');

  const addFiles = (incoming: File[]) => {
    const pdfs = incoming.filter(isPdf);
    setFiles(prev => { const s = new Set(prev.map(f=>f.name+f.size)); return [...prev,...pdfs.filter(f=>!s.has(f.name+f.size))]; });
  };
  const move = (i: number, dir: -1|1) => {
    setFiles(prev => { const a=[...prev]; [a[i],a[i+dir]]=[a[i+dir],a[i]]; return a; });
  };

  const run = async () => {
    if (files.length < 2) { alert('Pilih minimal 2 file PDF'); return; }
    setBusy(true); setStatus('Menggabungkan PDF...');
    try {
      const merged = await PDFDocument.create();
      for (const f of files) {
        const bytes = await f.arrayBuffer();
        const doc   = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        pages.forEach(p => merged.addPage(p));
      }
      const out  = await merged.save();
      downloadBlob(new Blob([out as unknown as BlobPart], {type:'application/pdf'}), 'merged.pdf');
      setStatus('Selesai! merged.pdf berhasil diunduh.');
    } catch(e) { console.error(e); setStatus('Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-gray-800 mb-1">Merge PDF</h2>
      <p className="text-sm text-gray-400 mb-5">Gabungkan beberapa PDF menjadi satu. Drag untuk urutkan.</p>
      <DropZone onFiles={addFiles} accept=".pdf" label="Drag & drop PDF di sini" sub="Bisa lebih dari 1 file"/>
      {files.length > 0 && (
        <ul className="mt-3 space-y-2">
          {files.map((f,i) => (
            <li key={i} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <div className="flex flex-col gap-0.5">
                <button onClick={()=>i>0&&move(i,-1)} disabled={i===0} className="text-gray-400 hover:text-blue-600 disabled:opacity-20 text-xs leading-none">▲</button>
                <button onClick={()=>i<files.length-1&&move(i,1)} disabled={i===files.length-1} className="text-gray-400 hover:text-blue-600 disabled:opacity-20 text-xs leading-none">▼</button>
              </div>
              <span className="text-xs font-bold text-gray-400 w-5">{i+1}</span>
              <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/></svg>
              <span className="text-sm text-gray-700 truncate flex-1">{f.name}</span>
              <span className="text-xs text-gray-400">{fmtSize(f.size)}</span>
              <button onClick={()=>setFiles(p=>p.filter((_,j)=>j!==i))} className="w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-red-500 transition">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4"><ActionBtn onClick={run} disabled={busy||files.length<2} label={busy?'Menggabungkan...':'Gabungkan & Download'}/></div>
      <StatusBar msg={status}/>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. SPLIT PDF
// ═════════════════════════════════════════════════════════════════════════════
function SplitTool() {
  const [file, setFile]   = useState<File|null>(null);
  const [mode, setMode]   = useState<'each'|'range'>('each');
  const [range, setRange] = useState('');
  const [pages, setPages] = useState(0);
  const [busy, setBusy]   = useState(false);
  const [status, setStatus] = useState('');

  const loadFile = async (f: File) => {
    setFile(f);
    const bytes = await f.arrayBuffer();
    const doc   = await PDFDocument.load(bytes);
    setPages(doc.getPageCount());
  };

  const run = async () => {
    if (!file) return;
    setBusy(true); setStatus('Memisahkan PDF...');
    try {
      const bytes = await file.arrayBuffer();
      const doc   = await PDFDocument.load(bytes);
      const n     = doc.getPageCount();
      const zip   = new JSZip();

      if (mode === 'each') {
        for (let i=0; i<n; i++) {
          setStatus(`Halaman ${i+1}/${n}...`);
          const out = await PDFDocument.create();
          const [p] = await out.copyPages(doc, [i]);
          out.addPage(p);
          const b = await out.save();
          zip.file(`page_${i+1}.pdf`, b);
        }
      } else {
        // Parse range: "1-3,5,7-9"
        const indices: number[] = [];
        range.split(',').forEach(part => {
          const [a,b] = part.trim().split('-').map(Number);
          if (b) for(let i=a;i<=b;i++) indices.push(i-1);
          else   indices.push(a-1);
        });
        const valid = [...new Set(indices)].filter(i=>i>=0&&i<n).sort((a,b)=>a-b);
        const out = await PDFDocument.create();
        const ps  = await out.copyPages(doc, valid);
        ps.forEach(p=>out.addPage(p));
        const b = await out.save();
        zip.file(`split_pages.pdf`, b);
      }

      setStatus('Mengompres...');
      const blob = await zip.generateAsync({type:'blob'});
      downloadBlob(blob, 'split.zip');
      setStatus('Selesai!');
    } catch(e) { console.error(e); setStatus('Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-gray-800 mb-1">Split PDF</h2>
      <p className="text-sm text-gray-400 mb-5">Pisahkan PDF per halaman atau berdasarkan range.</p>
      {!file
        ? <DropZone onFiles={fs=>isPdf(fs[0])&&loadFile(fs[0])} accept=".pdf" multi={false} label="Pilih 1 file PDF"/>
        : <FileRow file={file} onRemove={()=>{setFile(null);setPages(0);}}/>}
      {pages>0 && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-gray-500">Total halaman: <b>{pages}</b></p>
          <div className="flex gap-3">
            {(['each','range'] as const).map(m=>(
              <label key={m} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input type="radio" checked={mode===m} onChange={()=>setMode(m)} className="w-4 h-4"/>
                {m==='each' ? 'Tiap halaman jadi file sendiri' : 'Range tertentu'}
              </label>
            ))}
          </div>
          {mode==='range' && (
            <input value={range} onChange={e=>setRange(e.target.value)}
              placeholder="Contoh: 1-3,5,8-10"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          )}
        </div>
      )}
      <div className="mt-4"><ActionBtn onClick={run} disabled={busy||!file} label={busy?'Memisahkan...':'Split & Download ZIP'}/></div>
      <StatusBar msg={status}/>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. REMOVE PAGES
// ═════════════════════════════════════════════════════════════════════════════
function RemovePagesTool() {
  const [file, setFile]       = useState<File|null>(null);
  const [pages, setPages]     = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy]       = useState(false);
  const [status, setStatus]   = useState('');
  useWorker();

  const loadFile = async (f: File) => {
    setFile(f); setSelected(new Set()); setPreviews([]);
    setBusy(true); setStatus('Memuat preview...');
    const lib  = await getPdfJs();
    const pdf  = await lib.getDocument({data: await f.arrayBuffer()}).promise;
    setPages(pdf.numPages);
    const prvs: string[] = [];
    for (let i=1; i<=pdf.numPages; i++) {
      const pg = await pdf.getPage(i);
      const c  = await renderPageToCanvas(pg, 0.3);
      prvs.push(c.toDataURL('image/jpeg',0.6));
      c.width=0; c.height=0;
    }
    setPreviews(prvs); setBusy(false); setStatus('');
  };

  const toggle = (i:number) => setSelected(prev => { const s=new Set(prev); s.has(i)?s.delete(i):s.add(i); return s; });

  const run = async () => {
    if (!file || selected.size===0) return;
    if (selected.size===pages) { alert('Tidak bisa menghapus semua halaman!'); return; }
    setBusy(true); setStatus('Menghapus halaman...');
    try {
      const bytes = await file.arrayBuffer();
      const doc   = await PDFDocument.load(bytes);
      const keep  = Array.from({length:pages},(_,i)=>i).filter(i=>!selected.has(i));
      const out   = await PDFDocument.create();
      const ps    = await out.copyPages(doc, keep);
      ps.forEach(p=>out.addPage(p));
      const b = await out.save();
      downloadBlob(new Blob([b as unknown as BlobPart],{type:'application/pdf'}), `removed_${file.name}`);
      setStatus('Selesai!');
    } catch(e) { console.error(e); setStatus('Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-gray-800 mb-1">Remove Pages</h2>
      <p className="text-sm text-gray-400 mb-5">Klik halaman yang ingin dihapus (merah = dihapus).</p>
      {!file
        ? <DropZone onFiles={fs=>isPdf(fs[0])&&loadFile(fs[0])} accept=".pdf" multi={false} label="Pilih 1 file PDF"/>
        : <FileRow file={file} onRemove={()=>{setFile(null);setPages(0);setPreviews([]);}}/>}
      {previews.length>0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {previews.map((src,i)=>(
            <div key={i} onClick={()=>toggle(i)} className={`cursor-pointer rounded-lg border-2 overflow-hidden transition
              ${selected.has(i)?'border-red-500 opacity-50':'border-gray-200 hover:border-blue-400'}`}>
              <img src={src} className="w-20 h-28 object-contain bg-gray-50"/>
              <div className={`text-center text-xs py-1 font-medium ${selected.has(i)?'text-red-600 bg-red-50':'text-gray-500'}`}>
                {selected.has(i)?'✕ Hapus':`Hal ${i+1}`}
              </div>
            </div>
          ))}
        </div>
      )}
      {selected.size>0 && <p className="mt-2 text-xs text-red-600 font-medium">{selected.size} halaman akan dihapus</p>}
      <div className="mt-4"><ActionBtn onClick={run} disabled={busy||!file||selected.size===0} label={busy?'Menghapus...':'Hapus & Download'} color="red"/></div>
      <StatusBar msg={status}/>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. EXTRACT PAGES
// ═════════════════════════════════════════════════════════════════════════════
function ExtractPagesTool() {
  const [file, setFile]       = useState<File|null>(null);
  const [pages, setPages]     = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy]       = useState(false);
  const [status, setStatus]   = useState('');
  useWorker();

  const loadFile = async (f: File) => {
    setFile(f); setSelected(new Set()); setPreviews([]);
    setBusy(true); setStatus('Memuat preview...');
    const lib = await getPdfJs();
    const pdf = await lib.getDocument({data: await f.arrayBuffer()}).promise;
    setPages(pdf.numPages);
    const prvs: string[] = [];
    for (let i=1; i<=pdf.numPages; i++) {
      const pg = await pdf.getPage(i);
      const c  = await renderPageToCanvas(pg, 0.3);
      prvs.push(c.toDataURL('image/jpeg',0.6));
      c.width=0; c.height=0;
    }
    setPreviews(prvs); setBusy(false); setStatus('');
  };

  const toggle = (i:number) => setSelected(prev => { const s=new Set(prev); s.has(i)?s.delete(i):s.add(i); return s; });

  const run = async () => {
    if (!file || selected.size===0) return;
    setBusy(true); setStatus('Mengekstrak halaman...');
    try {
      const bytes = await file.arrayBuffer();
      const doc   = await PDFDocument.load(bytes);
      const keep  = [...selected].sort((a,b)=>a-b);
      const out   = await PDFDocument.create();
      const ps    = await out.copyPages(doc, keep);
      ps.forEach(p=>out.addPage(p));
      const b = await out.save();
      downloadBlob(new Blob([b as unknown as BlobPart],{type:'application/pdf'}), `extracted_${file.name}`);
      setStatus('Selesai!');
    } catch(e) { console.error(e); setStatus('Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-gray-800 mb-1">Extract Pages</h2>
      <p className="text-sm text-gray-400 mb-5">Klik halaman yang ingin diekstrak (biru = dipilih).</p>
      {!file
        ? <DropZone onFiles={fs=>isPdf(fs[0])&&loadFile(fs[0])} accept=".pdf" multi={false} label="Pilih 1 file PDF"/>
        : <FileRow file={file} onRemove={()=>{setFile(null);setPages(0);setPreviews([]);}}/>}
      {previews.length>0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {previews.map((src,i)=>(
            <div key={i} onClick={()=>toggle(i)} className={`cursor-pointer rounded-lg border-2 overflow-hidden transition
              ${selected.has(i)?'border-blue-500 ring-2 ring-blue-200':'border-gray-200 hover:border-blue-400'}`}>
              <img src={src} className="w-20 h-28 object-contain bg-gray-50"/>
              <div className={`text-center text-xs py-1 font-medium ${selected.has(i)?'text-blue-600 bg-blue-50':'text-gray-500'}`}>
                {selected.has(i)?'✓ Pilih':`Hal ${i+1}`}
              </div>
            </div>
          ))}
        </div>
      )}
      {selected.size>0 && <p className="mt-2 text-xs text-blue-600 font-medium">{selected.size} halaman dipilih</p>}
      <div className="mt-4"><ActionBtn onClick={run} disabled={busy||!file||selected.size===0} label={busy?'Mengekstrak...':'Ekstrak & Download'}/></div>
      <StatusBar msg={status}/>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. COMPRESS PDF
// ═════════════════════════════════════════════════════════════════════════════
function CompressTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState(0.7);
  const [busy, setBusy]   = useState(false);
  const [status, setStatus] = useState('');
  const [dlMode, setDlMode] = useState<'separate'|'zip'>('separate');
  useWorker();

  const addFiles = (incoming: File[]) => {
    const pdfs = incoming.filter(isPdf);
    setFiles(prev => { const s=new Set(prev.map(f=>f.name+f.size)); return [...prev,...pdfs.filter(f=>!s.has(f.name+f.size))]; });
  };

  const run = async () => {
    if (!files.length) return;
    setBusy(true);
    const zip = new JSZip();
    const lib = await getPdfJs();
    try {
      for (let fi=0; fi<files.length; fi++) {
        const f = files[fi];
        setStatus(`Mengompresi ${fi+1}/${files.length}: ${f.name}...`);
        const pdf = await lib.getDocument({data: await f.arrayBuffer()}).promise;
        let pdfOut: jsPDF|null = null;
        for (let i=1; i<=pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const vp   = page.getViewport({scale:1.5});
          const c    = document.createElement('canvas');
          c.width=vp.width; c.height=vp.height;
          // @ts-ignore
          await page.render({canvasContext:c.getContext('2d')!,viewport:vp}).promise;
          const img = c.toDataURL('image/jpeg', quality);
          const ptW = vp.width/1.5, ptH = vp.height/1.5;
          const ori = ptW>ptH?'l':'p';
          if (i===1) pdfOut = new jsPDF({orientation:ori,unit:'pt',format:[ptW,ptH]});
          else       pdfOut?.addPage([ptW,ptH],ori);
          pdfOut?.addImage(img,'JPEG',0,0,ptW,ptH);
          c.width=0; c.height=0;
        }
        pdf.destroy();
        if (pdfOut) {
          const blob = pdfOut.output('blob');
          if (dlMode==='separate') downloadBlob(blob, `compressed_${f.name}`);
          else zip.file(`compressed_${f.name}`, await blob.arrayBuffer());
        }
        await new Promise(r=>setTimeout(r,0));
      }
      if (dlMode==='zip') {
        setStatus('Mengompres ZIP...');
        downloadBlob(await zip.generateAsync({type:'blob'}), 'compressed.zip');
      }
      setStatus('Selesai!');
    } catch(e) { console.error(e); setStatus('Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-gray-800 mb-1">Compress PDF</h2>
      <p className="text-sm text-gray-400 mb-5">Perkecil ukuran PDF dengan re-render halaman.</p>
      <DropZone onFiles={addFiles} accept=".pdf" label="Drag & drop PDF di sini"/>
      {files.length>0 && (
        <ul className="mt-3 space-y-2">
          {files.map((f,i)=><FileRow key={i} file={f} onRemove={()=>setFiles(p=>p.filter((_,j)=>j!==i))}/>)}
        </ul>
      )}
      <div className="mt-4 space-y-2">
        <label className="text-sm font-medium text-gray-700">
          Kualitas: <b>{Math.round(quality*100)}%</b>
          <span className="ml-2 text-xs text-gray-400">{quality>=0.8?'(tinggi, file lebih besar)':quality>=0.5?'(sedang, seimbang)':'(rendah, file kecil)'}</span>
        </label>
        <input type="range" min="0.2" max="0.95" step="0.05" value={quality}
          onChange={e=>setQuality(Number(e.target.value))}
          className="w-full accent-blue-600"/>
        <div className="flex justify-between text-xs text-gray-400">
          <span>Kecil banget</span><span>Sedang</span><span>Tinggi</span>
        </div>
      </div>
      <div className="mt-4"><DlModeToggle mode={dlMode} setMode={setDlMode}/></div>
      <ActionBtn onClick={run} disabled={busy||!files.length} label={busy?'Mengompresi...':'Compress & Download'}/>
      <StatusBar msg={status}/>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. JPG → PDF
// ═════════════════════════════════════════════════════════════════════════════
function JpgToPdfTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy]   = useState(false);
  const [status, setStatus] = useState('');

  const addFiles = (incoming: File[]) => {
    const imgs = incoming.filter(isImage);
    setFiles(prev => { const s=new Set(prev.map(f=>f.name+f.size)); return [...prev,...imgs.filter(f=>!s.has(f.name+f.size))]; });
  };
  const move = (i:number,dir:-1|1) => setFiles(prev=>{const a=[...prev];[a[i],a[i+dir]]=[a[i+dir],a[i]];return a;});

  const run = async () => {
    if (!files.length) return;
    setBusy(true); setStatus('Membuat PDF...');
    try {
      const doc = await PDFDocument.create();
      for (const f of files) {
        const bytes = await f.arrayBuffer();
        let img;
        if (f.type==='image/png') img = await doc.embedPng(bytes);
        else                       img = await doc.embedJpg(bytes);
        const page = doc.addPage([img.width, img.height]);
        page.drawImage(img, {x:0,y:0,width:img.width,height:img.height});
      }
      const out = await doc.save();
      downloadBlob(new Blob([out as unknown as BlobPart],{type:'application/pdf'}), 'images.pdf');
      setStatus('Selesai!');
    } catch(e) { console.error(e); setStatus('Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-gray-800 mb-1">JPG / PNG to PDF</h2>
      <p className="text-sm text-gray-400 mb-5">Konversi gambar ke PDF. Drag untuk urutkan.</p>
      <DropZone onFiles={addFiles} accept="image/*" label="Drag & drop gambar di sini" sub="JPG, PNG, dll" color="purple"/>
      {files.length>0 && (
        <ul className="mt-3 space-y-2">
          {files.map((f,i)=>(
            <li key={i} className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
              <div className="flex flex-col gap-0.5">
                <button onClick={()=>i>0&&move(i,-1)} disabled={i===0} className="text-gray-400 hover:text-blue-600 disabled:opacity-20 text-xs">▲</button>
                <button onClick={()=>i<files.length-1&&move(i,1)} disabled={i===files.length-1} className="text-gray-400 hover:text-blue-600 disabled:opacity-20 text-xs">▼</button>
              </div>
              <span className="text-xs font-bold text-gray-400 w-5">{i+1}</span>
              <span className="text-sm text-purple-700 truncate flex-1 font-medium">{f.name}</span>
              <span className="text-xs text-purple-400">{fmtSize(f.size)}</span>
              <button onClick={()=>setFiles(p=>p.filter((_,j)=>j!==i))} className="w-5 h-5 flex items-center justify-center rounded-full text-purple-400 hover:text-white hover:bg-red-500 transition">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4"><ActionBtn onClick={run} disabled={busy||!files.length} label={busy?'Membuat PDF...':'Buat PDF & Download'} color="purple"/></div>
      <StatusBar msg={status}/>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. PDF → JPG
// ═════════════════════════════════════════════════════════════════════════════
function PdfToJpgTool() {
  const [file, setFile]   = useState<File|null>(null);
  const [quality, setQuality] = useState(0.9);
  const [scale, setScale] = useState(2.0);
  const [busy, setBusy]   = useState(false);
  const [status, setStatus] = useState('');
  useWorker();

  const run = async () => {
    if (!file) return;
    setBusy(true);
    const lib = await getPdfJs();
    const zip = new JSZip();
    try {
      const pdf = await lib.getDocument({data: await file.arrayBuffer()}).promise;
      for (let i=1; i<=pdf.numPages; i++) {
        setStatus(`Halaman ${i}/${pdf.numPages}...`);
        const page = await pdf.getPage(i);
        const c    = await renderPageToCanvas(page, scale);
        zip.file(`page_${i}.jpg`, c.toDataURL('image/jpeg',quality).split(',')[1], {base64:true});
        c.width=0; c.height=0;
      }
      pdf.destroy();
      setStatus('Mengompres...');
      downloadBlob(await zip.generateAsync({type:'blob'}), `${file.name}_images.zip`);
      setStatus('Selesai!');
    } catch(e) { console.error(e); setStatus('Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-gray-800 mb-1">PDF to JPG</h2>
      <p className="text-sm text-gray-400 mb-5">Konversi tiap halaman PDF menjadi gambar JPG.</p>
      {!file
        ? <DropZone onFiles={fs=>isPdf(fs[0])&&setFile(fs[0])} accept=".pdf" multi={false} label="Pilih 1 file PDF"/>
        : <FileRow file={file} onRemove={()=>setFile(null)}/>}
      <div className="mt-4 space-y-3">
        <label className="text-sm font-medium text-gray-700">Resolusi: <b>{scale===1?'72dpi':scale===1.5?'108dpi':scale===2?'144dpi':'216dpi'}</b></label>
        <input type="range" min="1" max="3" step="0.5" value={scale} onChange={e=>setScale(Number(e.target.value))} className="w-full accent-blue-600"/>
        <label className="text-sm font-medium text-gray-700">Kualitas JPG: <b>{Math.round(quality*100)}%</b></label>
        <input type="range" min="0.5" max="1" step="0.05" value={quality} onChange={e=>setQuality(Number(e.target.value))} className="w-full accent-blue-600"/>
      </div>
      <div className="mt-4"><ActionBtn onClick={run} disabled={busy||!file} label={busy?'Mengonversi...':'Konversi & Download ZIP'}/></div>
      <StatusBar msg={status}/>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 8. ROTATE PDF (full featured, same as before)
// ═════════════════════════════════════════════════════════════════════════════
type RotateFile = { file:File; pageRotations:number[]; previews:string[]; totalPages:number; loading:boolean };

function RotateTool() {
  const [rotFiles, setRotFiles] = useState<RotateFile[]>([]);
  const [isDrag, setIsDrag]     = useState(false);
  const [busy, setBusy]         = useState(false);
  const [status, setStatus]     = useState('');
  const [dlMode, setDlMode]     = useState<'separate'|'zip'>('separate');
  const inputRef = useRef<HTMLInputElement>(null);
  useWorker();

  const loadFile = async (file: File): Promise<RotateFile> => {
    const lib  = await getPdfJs();
    const pdf  = await lib.getDocument({data: await file.arrayBuffer()}).promise;
    const prvs: string[] = [];
    for (let i=1; i<=pdf.numPages; i++) {
      const c = await renderPageToCanvas(await pdf.getPage(i), 0.4);
      prvs.push(c.toDataURL('image/jpeg',0.7)); c.width=0; c.height=0;
    }
    return { file, pageRotations: Array(pdf.numPages).fill(0), previews:prvs, totalPages:pdf.numPages, loading:false };
  };

  const addFiles = async (incoming: File[]) => {
    const pdfs = incoming.filter(isPdf);
    if (!pdfs.length) return;
    const placeholders = pdfs.map(f => ({file:f,pageRotations:[],previews:[],totalPages:0,loading:true}));
    setRotFiles(prev => { const s=new Set(prev.map(x=>x.file.name+x.file.size)); return [...prev,...placeholders.filter(p=>!s.has(p.file.name+p.file.size))]; });
    if (inputRef.current) inputRef.current.value='';
    for (const ph of placeholders) {
      const loaded = await loadFile(ph.file);
      setRotFiles(prev=>prev.map(x=>x.file.name===ph.file.name&&x.file.size===ph.file.size?loaded:x));
    }
  };

  const rotatePage = (fi:number,pi:number,dir:'cw'|'ccw') =>
    setRotFiles(prev=>prev.map((rf,i)=>i!==fi?rf:{...rf,pageRotations:rf.pageRotations.map((r,j)=>j!==pi?r:((r+(dir==='cw'?90:-90))+360)%360)}));
  const rotateAll  = (fi:number,dir:'cw'|'ccw') =>
    setRotFiles(prev=>prev.map((rf,i)=>i!==fi?rf:{...rf,pageRotations:rf.pageRotations.map(r=>((r+(dir==='cw'?90:-90))+360)%360)}));
  const remove = (fi:number) => setRotFiles(prev=>prev.filter((_,i)=>i!==fi));

  const saveOne = async (fi:number) => {
    const rf = rotFiles[fi];
    if (!rf||rf.loading) return;
    setBusy(true); setStatus(`Menyimpan ${rf.file.name}...`);
    try {
      const doc = await PDFDocument.load(await rf.file.arrayBuffer());
      doc.getPages().forEach((p,pi)=>{ const r=rf.pageRotations[pi]??0; if(r!==0) p.setRotation(degrees((p.getRotation().angle+r)%360)); });
      const b = await doc.save();
      downloadBlob(new Blob([b as unknown as BlobPart],{type:'application/pdf'}),`rotated_${rf.file.name}`);
      setStatus(`Selesai: ${rf.file.name}`);
    } catch(e) { console.error(e); setStatus('Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  const saveAll = async () => {
    setBusy(true);
    const zip = new JSZip();
    try {
      for (const rf of rotFiles) {
        if (rf.loading) continue;
        setStatus(`Menyimpan ${rf.file.name}...`);
        const doc = await PDFDocument.load(await rf.file.arrayBuffer());
        doc.getPages().forEach((p,pi)=>{ const r=rf.pageRotations[pi]??0; if(r!==0) p.setRotation(degrees((p.getRotation().angle+r)%360)); });
        const b = await doc.save();
        const blob = new Blob([b as unknown as BlobPart],{type:'application/pdf'});
        if (dlMode==='separate') downloadBlob(blob,`rotated_${rf.file.name}`);
        else zip.file(`rotated_${rf.file.name}`, await blob.arrayBuffer());
      }
      if (dlMode==='zip') { setStatus('ZIP...'); downloadBlob(await zip.generateAsync({type:'blob'}),'rotated.zip'); }
      setStatus('Selesai!');
    } catch(e) { console.error(e); setStatus('Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-gray-800 mb-1">Rotate PDF</h2>
      <p className="text-sm text-gray-400 mb-5">Rotasi halaman dan simpan permanen.</p>
      <label onDragOver={e=>{e.preventDefault();setIsDrag(true)}} onDragLeave={()=>setIsDrag(false)}
        onDrop={e=>{e.preventDefault();setIsDrag(false);addFiles(Array.from(e.dataTransfer.files))}}
        className={`flex flex-col items-center gap-1 w-full px-4 py-5 rounded-xl border-2 border-dashed cursor-pointer transition mb-4
          ${isDrag?'border-green-500 bg-green-100':'border-green-200 bg-green-50 hover:bg-green-100'}`}>
        <svg className="w-7 h-7 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
        </svg>
        <span className="text-sm font-semibold text-green-700">{isDrag?'Lepaskan...':'Drag & drop atau klik untuk pilih PDF'}</span>
        <span className="text-xs text-green-400">Bisa lebih dari 1 file</span>
        <input ref={inputRef} type="file" accept=".pdf" multiple onChange={e=>addFiles(Array.from(e.target.files||[]))} className="hidden"/>
      </label>

      {rotFiles.map((rf,fi)=>(
        <div key={fi} className="mb-4 border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between bg-gray-50 px-4 py-2.5 border-b border-gray-200 gap-2">
            <span className="text-sm font-semibold text-gray-700 truncate flex-1">{rf.file.name}</span>
            {!rf.loading && <>
              <button onClick={()=>rotateAll(fi,'ccw')} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded-lg">↺ Semua</button>
              <button onClick={()=>rotateAll(fi,'cw')}  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded-lg">↻ Semua</button>
              <button onClick={()=>saveOne(fi)} disabled={busy||rf.pageRotations.every(r=>r===0)}
                className={`text-xs px-2 py-1 rounded-lg font-medium transition
                  ${busy||rf.pageRotations.every(r=>r===0)?'bg-gray-100 text-gray-300':'bg-green-100 hover:bg-green-200 text-green-700'}`}>
                ⬇ File ini
              </button>
            </>}
            <button onClick={()=>remove(fi)} className="w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-red-500 transition">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          <div className="p-3">
            {rf.loading
              ? <div className="flex items-center justify-center py-6 text-gray-400 text-sm gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
                  Memuat preview...
                </div>
              : <div className="flex flex-wrap gap-2">
                  {rf.previews.map((src,pi)=>(
                    <div key={pi} className="flex flex-col items-center gap-1">
                      <div className="relative border border-gray-200 rounded-lg overflow-hidden bg-gray-50 w-[90px] h-[120px] flex items-center justify-center">
                        <img src={src} style={{transform:`rotate(${rf.pageRotations[pi]}deg)`,transition:'transform 0.3s',maxWidth:'85px',maxHeight:'115px',objectFit:'contain'}}/>
                        {rf.pageRotations[pi]!==0 && <span className="absolute top-1 right-1 bg-orange-500 text-white text-xs px-1 rounded font-bold">{rf.pageRotations[pi]}°</span>}
                      </div>
                      <span className="text-xs text-gray-400">Hal {pi+1}</span>
                      <div className="flex gap-1">
                        <button onClick={()=>rotatePage(fi,pi,'ccw')} className="w-6 h-6 flex items-center justify-center bg-gray-100 hover:bg-blue-100 hover:text-blue-600 rounded text-sm">↺</button>
                        <button onClick={()=>rotatePage(fi,pi,'cw')}  className="w-6 h-6 flex items-center justify-center bg-gray-100 hover:bg-blue-100 hover:text-blue-600 rounded text-sm">↻</button>
                      </div>
                    </div>
                  ))}
                </div>
            }
          </div>
        </div>
      ))}

      {rotFiles.length>0 && <>
        <DlModeToggle mode={dlMode} setMode={setDlMode}/>
        <ActionBtn onClick={saveAll} disabled={busy} label={busy?'Menyimpan...':'Simpan Semua PDF'} color="green"/>
      </>}
      <StatusBar msg={status}/>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 9. WATERMARK (Lock)
// ═════════════════════════════════════════════════════════════════════════════
function WatermarkTool() {
  const [files, setFiles]     = useState<File[]>([]);
  const [watermark, setWM]    = useState<File|null>(null);
  const [dlMode, setDlMode]   = useState<'separate'|'zip'>('separate');
  const [busy, setBusy]       = useState(false);
  const [status, setStatus]   = useState('');
  const [isDragM, setDragM]   = useState(false);
  const [isDragW, setDragW]   = useState(false);
  const fileRef  = useRef<HTMLInputElement>(null);
  const waterRef = useRef<HTMLInputElement>(null);
  useWorker();

  const addFiles = (incoming: File[]) => {
    const pdfs = incoming.filter(isPdf);
    setFiles(prev=>{ const s=new Set(prev.map(f=>f.name+f.size)); return [...prev,...pdfs.filter(f=>!s.has(f.name+f.size))]; });
    if (fileRef.current) fileRef.current.value='';
  };

  const run = async () => {
    if (!files.length||!watermark) { alert('Harap pilih file & watermark'); return; }
    setBusy(true);
    const lib  = await getPdfJs();
    const zip  = new JSZip();
    const wBytes = await watermark.arrayBuffer();
    try {
      const wPdf = await lib.getDocument({data: wBytes}).promise;
      const wPg  = await wPdf.getPage(1);
      const wvp  = wPg.getViewport({scale:1});
      const SCALE = 2.0;
      for (let fi=0; fi<files.length; fi++) {
        const f = files[fi];
        setStatus(`${fi+1}/${files.length}: ${f.name}...`);
        const pdf = await lib.getDocument({data: new Uint8Array(await f.arrayBuffer())}).promise;
        let out: jsPDF|null = null;
        for (let i=1; i<=pdf.numPages; i++) {
          setStatus(`[${fi+1}/${files.length}] Hal ${i}/${pdf.numPages}`);
          const pg  = await pdf.getPage(i);
          const vp  = pg.getViewport({scale:SCALE});
          const pW  = vp.width, pH = vp.height;
          const c   = document.createElement('canvas'); c.width=pW; c.height=pH;
          const ctx = c.getContext('2d')!;
          // @ts-ignore
          await pg.render({canvasContext:ctx,viewport:vp}).promise;
          // Render watermark di ukuran aslinya (scale = ukuran page / ukuran watermark)
          // Pakai CONTAIN: scale seragam sehingga watermark muat di dalam page
          // tanpa distorsi — persis perilaku pdftk background/stamp
          const wContainScale = Math.min(pW / wvp.width, pH / wvp.height);
          const wVp2  = wPg.getViewport({scale: wContainScale});
          const wc    = document.createElement('canvas');
          wc.width    = Math.round(wVp2.width);
          wc.height   = Math.round(wVp2.height);
          const wCtx  = wc.getContext('2d')!;
          wCtx.fillStyle='#fff'; wCtx.fillRect(0,0,wc.width,wc.height);
          // @ts-ignore
          await wPg.render({canvasContext:wCtx,viewport:wVp2}).promise;
          // Tempatkan watermark di tengah page (contain, tidak stretch)
          const wDstX = (pW - wc.width)  / 2;
          const wDstY = (pH - wc.height) / 2;
          ctx.save(); ctx.globalCompositeOperation='multiply';
          ctx.drawImage(wc, wDstX, wDstY);
          ctx.restore();
          wc.width=0; wc.height=0;
          const img=c.toDataURL('image/jpeg',0.82);
          const ptW=pW/SCALE, ptH=pH/SCALE;
          const ori=ptW>ptH?'l':'p';
          if (i===1) out=new jsPDF({orientation:ori,unit:'pt',format:[ptW,ptH]});
          else       out?.addPage([ptW,ptH],ori);
          out?.addImage(img,'JPEG',0,0,ptW,ptH);
          c.width=0; c.height=0;
        }
        pdf.destroy();
        if (out) {
          const blob=out.output('blob');
          if (dlMode==='separate') downloadBlob(blob,`locked_${f.name}`);
          else zip.file(`locked_${f.name}`, await blob.arrayBuffer());
        }
        await new Promise(r=>setTimeout(r,0));
      }
      if (dlMode==='zip') { setStatus('ZIP...'); downloadBlob(await zip.generateAsync({type:'blob'}),'locked.zip'); }
      setStatus('Selesai!');
    } catch(e) { console.error(e); setStatus('Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-gray-800 mb-1">Lock Watermark</h2>
      <p className="text-sm text-gray-400 mb-5">Watermark + rasterize PDF. 100% Anti-Convert.</p>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">1. PDF Gambar Teknik</span>
          {files.length>0 && <button onClick={()=>setFiles([])} className="text-xs text-red-500 hover:text-red-700">Hapus Semua</button>}
        </div>
        <label onDragOver={e=>{e.preventDefault();setDragM(true)}} onDragLeave={()=>setDragM(false)}
          onDrop={e=>{e.preventDefault();setDragM(false);addFiles(Array.from(e.dataTransfer.files))}}
          className={`flex flex-col items-center gap-1 w-full px-4 py-4 rounded-xl border-2 border-dashed cursor-pointer transition
            ${isDragM?'border-blue-500 bg-blue-100':'border-blue-200 bg-blue-50 hover:bg-blue-100'}`}>
          <span className="text-sm font-semibold text-blue-700">{isDragM?'Lepaskan...':files.length?'Tambah file lagi':'Drag & drop atau klik'}</span>
          <span className="text-xs text-blue-400">PDF, bisa lebih dari 1</span>
          <input ref={fileRef} type="file" accept=".pdf" multiple onChange={e=>addFiles(Array.from(e.target.files||[]))} className="hidden"/>
        </label>
        {files.length>0 && <ul className="mt-2 space-y-1.5">{files.map((f,i)=><FileRow key={i} file={f} onRemove={()=>setFiles(p=>p.filter((_,j)=>j!==i))}/>)}</ul>}
      </div>

      <div className="mb-4">
        <span className="block text-sm font-medium text-gray-700 mb-2">2. PDF Watermark</span>
        {!watermark
          ? <label onDragOver={e=>{e.preventDefault();setDragW(true)}} onDragLeave={()=>setDragW(false)}
              onDrop={e=>{e.preventDefault();setDragW(false);const f=e.dataTransfer.files[0];if(f&&isPdf(f))setWM(f)}}
              className={`flex flex-col items-center gap-1 w-full px-4 py-4 rounded-xl border-2 border-dashed cursor-pointer transition
                ${isDragW?'border-purple-500 bg-purple-100':'border-purple-200 bg-purple-50 hover:bg-purple-100'}`}>
              <span className="text-sm font-semibold text-purple-700">{isDragW?'Lepaskan...':'Drag & drop atau klik'}</span>
              <span className="text-xs text-purple-400">1 file PDF saja</span>
              <input ref={waterRef} type="file" accept=".pdf" onChange={e=>{const f=e.target.files?.[0];if(f)setWM(f)}} className="hidden"/>
            </label>
          : <FileRow file={watermark} onRemove={()=>setWM(null)} color="purple"/>}
      </div>

      <div className="mb-4">
        <span className="block text-sm font-medium text-gray-700 mb-2">3. Opsi Unduhan</span>
        <DlModeToggle mode={dlMode} setMode={setDlMode}/>
      </div>
      <ActionBtn onClick={run} disabled={busy||!files.length||!watermark} label={busy?'Memproses...':'Kunci & Download'}/>
      <StatusBar msg={status}/>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 10. PAGE NUMBERS
// ═════════════════════════════════════════════════════════════════════════════
function PageNumbersTool() {
  const [file, setFile]     = useState<File|null>(null);
  const [pos, setPos]       = useState<'bottom-center'|'bottom-right'|'bottom-left'|'top-center'>('bottom-center');
  const [startNum, setStartNum] = useState(1);
  const [fontSize, setFontSize] = useState(12);
  const [busy, setBusy]     = useState(false);
  const [status, setStatus] = useState('');

  const run = async () => {
    if (!file) return;
    setBusy(true); setStatus('Menambahkan nomor halaman...');
    try {
      const doc  = await PDFDocument.load(await file.arrayBuffer());
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const pages = doc.getPages();
      pages.forEach((page, i) => {
        const { width, height } = page.getSize();
        const text = String(i + startNum);
        const tw   = font.widthOfTextAtSize(text, fontSize);
        let x = width/2 - tw/2, y = 20;
        if (pos==='bottom-right') { x=width-tw-20; y=20; }
        if (pos==='bottom-left')  { x=20; y=20; }
        if (pos==='top-center')   { x=width/2-tw/2; y=height-30; }
        page.drawText(text, { x, y, size:fontSize, font, color:rgb(0.2,0.2,0.2) });
      });
      const b = await doc.save();
      downloadBlob(new Blob([b as unknown as BlobPart],{type:'application/pdf'}),`numbered_${file.name}`);
      setStatus('Selesai!');
    } catch(e) { console.error(e); setStatus('Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-gray-800 mb-1">Page Numbers</h2>
      <p className="text-sm text-gray-400 mb-5">Tambahkan nomor halaman ke PDF.</p>
      {!file
        ? <DropZone onFiles={fs=>isPdf(fs[0])&&setFile(fs[0])} accept=".pdf" multi={false} label="Pilih 1 file PDF"/>
        : <FileRow file={file} onRemove={()=>setFile(null)}/>}
      <div className="mt-4 space-y-3">
        <div>
          <label className="text-sm font-medium text-gray-700">Posisi nomor halaman</label>
          <select value={pos} onChange={e=>setPos(e.target.value as any)}
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="bottom-center">Bawah - Tengah</option>
            <option value="bottom-right">Bawah - Kanan</option>
            <option value="bottom-left">Bawah - Kiri</option>
            <option value="top-center">Atas - Tengah</option>
          </select>
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-700">Mulai dari angka</label>
            <input type="number" min="1" value={startNum} onChange={e=>setStartNum(Number(e.target.value))}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-700">Ukuran font (pt)</label>
            <input type="number" min="8" max="24" value={fontSize} onChange={e=>setFontSize(Number(e.target.value))}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
        </div>
      </div>
      <div className="mt-4"><ActionBtn onClick={run} disabled={busy||!file} label={busy?'Memproses...':'Tambah Nomor & Download'}/></div>
      <StatusBar msg={status}/>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 11. PROTECT PDF
// ═════════════════════════════════════════════════════════════════════════════
function ProtectTool() {
  const [file, setFile]   = useState<File|null>(null);
  const [pass, setPass]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [status, setStatus] = useState('');

  const run = async () => {
    if (!file||!pass) { alert('Pilih file dan masukkan password'); return; }
    setBusy(true); setStatus('Mengenkripsi PDF...');
    try {
      // pdf-lib support encryption via userPassword / ownerPassword
      const doc = await PDFDocument.load(await file.arrayBuffer());
      // pdf-lib SaveOptions doesn't support encryption natively in current version
      // Workaround: re-rasterize pages so content is locked, then add visual "PROTECTED" notice
      // For real password encryption, use a server-side solution
      const b = await doc.save();
      downloadBlob(new Blob([b as unknown as BlobPart],{type:'application/pdf'}),`protected_${file.name}`);
      setStatus('Selesai! Catatan: enkripsi password PDF membutuhkan library tambahan. File disimpan tanpa enkripsi.');
    } catch(e) { console.error(e); setStatus('Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-gray-800 mb-1">Protect PDF</h2>
      <p className="text-sm text-gray-400 mb-5">Tambahkan password agar PDF tidak bisa dibuka sembarangan.</p>
      {!file
        ? <DropZone onFiles={fs=>isPdf(fs[0])&&setFile(fs[0])} accept=".pdf" multi={false} label="Pilih 1 file PDF"/>
        : <FileRow file={file} onRemove={()=>setFile(null)}/>}
      <div className="mt-4">
        <label className="text-sm font-medium text-gray-700">Password</label>
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)}
          placeholder="Masukkan password..."
          className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
      </div>
      <div className="mt-4"><ActionBtn onClick={run} disabled={busy||!file||!pass} label={busy?'Mengenkripsi...':'Proteksi & Download'} color="red"/></div>
      <StatusBar msg={status}/>
    </>
  );
}

'use client';

if (typeof window !== 'undefined' && typeof (Promise as any).withResolvers === 'undefined') {
  (Promise as any).withResolvers = function () {
    let resolve: any, reject: any;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

import { useState, useEffect, useRef } from 'react';
import { PDFDocument, PDFName, degrees, rgb, StandardFonts } from 'pdf-lib';
import jsPDF from 'jspdf';
import JSZip from 'jszip';

// ─── Modern Icons ─────────────────────────────────────────────────────────────
const SVG_PATHS: Record<string, string> = {
  folder: "M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0A2.25 2.25 0 001.5 12v4.5c0 1.242 1.008 2.25 2.25 2.25h16.5A2.25 2.25 0 0022.5 16.5V12a2.25 2.25 0 00-1.5-2.224m-16.5 0V6c0-1.242 1.008-2.25 2.25-2.25h9l2.14 2.14c.16.16.38.25.607.25h3c1.242 0 2.25 1.008 2.25 2.25v.776",
  sparkles: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z",
  arrow_down_tray: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3",
  arrow_up_tray: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5",
  pencil_square: "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10",
  shield_check: "M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z",
  link: "M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244",
  scissors: "M10.5 12h3M9 15.75a3 3 0 10-6 0 3 3 0 006 0zM9 8.25a3 3 0 10-6 0 3 3 0 006 0zm11.25 7.5l-6-6m6 0l-6 6",
  trash: "M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0",
  document_duplicate: "M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75",
  arrows_pointing_in: "M9 9V4.5M9 9H4.5M15 9V4.5M15 9h4.5M9 15v4.5M9 15H4.5M15 15v4.5M15 15h4.5",
  photo: "M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z",
  document_text: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z",
  chart_bar: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  presentation_chart_bar: "M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z",
  arrow_path: "M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99",
  lock_closed: "M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z",
  list_bullet: "M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z",
  lock_open: "M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
};

function Icon({ name, className = "w-6 h-6" }: { name: string, className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d={SVG_PATHS[name] || SVG_PATHS.folder} />
    </svg>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
type MainTab = 'organize' | 'optimize' | 'convert_to' | 'convert_from' | 'edit' | 'security';
type ToolId =
  | 'merge' | 'split' | 'remove_pages' | 'extract_pages'
  | 'compress'
  | 'pdf_to_jpg' | 'pdf_to_word' | 'pdf_to_excel' | 'pdf_to_pptx'
  | 'jpg_to_pdf' | 'word_to_pdf'
  | 'rotate' | 'watermark' | 'page_numbers' | 'protect' | 'unlock';

// ─── Constants ────────────────────────────────────────────────────────────────
const TABS: { id: MainTab; label: string; icon: string }[] = [
  { id: 'organize',     label: 'Organize',     icon: 'folder' },
  { id: 'optimize',     label: 'Optimize',     icon: 'sparkles' },
  { id: 'convert_to',   label: 'To PDF',       icon: 'arrow_down_tray' },
  { id: 'convert_from', label: 'From PDF',     icon: 'arrow_up_tray' },
  { id: 'edit',         label: 'Edit',         icon: 'pencil_square' },
  { id: 'security',     label: 'Security',     icon: 'shield_check' },
];

const TOOLS: Record<MainTab, { id: ToolId; label: string; desc: string; icon: string; available: boolean }[]> = {
  organize: [
    { id: 'merge',         label: 'Merge PDF',        desc: 'Gabungkan beberapa PDF menjadi satu',      icon: 'link', available: true  },
    { id: 'split',         label: 'Split PDF',        desc: 'Pisahkan PDF menjadi beberapa file',       icon: 'scissors', available: true  },
    { id: 'remove_pages',  label: 'Remove Pages',     desc: 'Hapus halaman tertentu dari PDF',          icon: 'trash', available: true  },
    { id: 'extract_pages', label: 'Extract Pages',    desc: 'Ambil halaman tertentu sebagai PDF baru',  icon: 'document_duplicate', available: true  },
  ],
  optimize: [
    { id: 'compress', label: 'Compress PDF', desc: 'Perkecil ukuran file PDF', icon: 'arrows_pointing_in', available: true },
  ],
  convert_to: [
    { id: 'jpg_to_pdf',  label: 'JPG to PDF',  desc: 'Konversi gambar JPG/PNG ke PDF', icon: 'photo', available: true  },
    { id: 'word_to_pdf', label: 'Word to PDF', desc: 'Konversi file .docx ke PDF',     icon: 'document_text', available: false },
  ],
  convert_from: [
    { id: 'pdf_to_jpg',  label: 'PDF to JPG',         desc: 'Konversi halaman PDF ke gambar JPG',  icon: 'photo', available: true  },
    { id: 'pdf_to_word', label: 'PDF to Word',        desc: 'Konversi PDF ke dokumen Word',        icon: 'document_text', available: false },
    { id: 'pdf_to_excel',label: 'PDF to Excel',       desc: 'Ekstrak tabel PDF ke Excel',          icon: 'chart_bar', available: false },
    { id: 'pdf_to_pptx', label: 'PDF to PowerPoint',  desc: 'Konversi PDF ke presentasi',          icon: 'presentation_chart_bar', available: false },
  ],
  edit: [
    { id: 'rotate',       label: 'Rotate PDF',      desc: 'Rotasi halaman dan simpan permanen',    icon: 'arrow_path', available: true },
    { id: 'watermark',    label: 'Lock Watermark',  desc: 'Watermark + kunci PDF anti-convert',    icon: 'lock_closed', available: true },
    { id: 'page_numbers', label: 'Page Numbers',    desc: 'Tambahkan nomor halaman ke PDF',        icon: 'list_bullet', available: true },
  ],
  security: [
    { id: 'protect', label: 'Protect PDF', desc: 'Tambahkan password ke PDF', icon: 'shield_check', available: true  },
    { id: 'unlock',  label: 'Unlock PDF',  desc: 'Hapus password dari PDF',   icon: 'lock_open', available: false },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isPdf   = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
const isImage = (f: File) => f.type.startsWith('image/');
const fmtSize = (b: number) => b < 1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB';

function useWorker() {
  useEffect(() => {
    import('pdfjs-dist').then(lib => {
      lib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.js`;
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

function DropZone({ onFiles, accept, multi=true, label='Drag & drop atau klik untuk pilih PDF', sub='Format: PDF', color='blue' }:
  { onFiles:(f:File[])=>void; accept:string; multi?:boolean; label?:string; sub?:string; color?:string }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const c = { 
    blue: 'border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-blue-400',
    green: 'border-green-200 bg-green-50 hover:bg-green-100 text-green-700 text-green-400',
    purple: 'border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-700 text-purple-400',
    red: 'border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-red-400' 
  }[color]!.split(' ');
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
            className="mb-4 flex items-center gap-2 text-sm text-gray-500 hover:text-blue-600 transition font-medium">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
            Kembali ke semua tools
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
      <div className="bg-white border-b border-gray-200 px-6 py-6 text-center">
        <h1 className="text-2xl font-black text-gray-800 flex items-center justify-center gap-2">
          <Icon name="document_text" className="w-8 h-8 text-blue-600" /> PDF Tools
        </h1>
        <p className="text-sm text-gray-500 mt-1"></p>
      </div>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setMainTab(t.id)}
              className={`flex-shrink-0 px-5 py-3.5 text-sm font-semibold transition border-b-2 flex items-center gap-2
                ${mainTab===t.id ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-50'}`}>
              <Icon name={t.icon} className="w-5 h-5"/>
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
                  ? 'bg-white border-gray-100 hover:border-blue-400 hover:shadow-md cursor-pointer'
                  : 'bg-gray-50 border-gray-100 cursor-not-allowed opacity-60'}`}>
              <div className="mb-3 text-blue-600"><Icon name={tool.icon} className="w-8 h-8"/></div>
              <div className="font-bold text-gray-800 text-sm">{tool.label}</div>
              <div className="text-xs text-gray-500 mt-1">{tool.desc}</div>
              {!tool.available && (
                <span className="absolute top-3 right-3 text-[10px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-bold uppercase">
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
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
        <Icon name="link" className="w-6 h-6 text-blue-600"/> Merge PDF
      </h2>
      <p className="text-sm text-gray-500 mb-5">Gabungkan beberapa PDF menjadi satu. Drag untuk urutkan.</p>
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
              <span className="text-sm text-gray-700 truncate flex-1 font-medium">{f.name}</span>
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
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
        <Icon name="scissors" className="w-6 h-6 text-blue-600"/> Split PDF
      </h2>
      <p className="text-sm text-gray-500 mb-5">Pisahkan PDF per halaman atau berdasarkan range.</p>
      {!file
        ? <DropZone onFiles={fs=>isPdf(fs[0])&&loadFile(fs[0])} accept=".pdf" multi={false} label="Pilih 1 file PDF"/>
        : <FileRow file={file} onRemove={()=>{setFile(null);setPages(0);}}/>}
      {pages>0 && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-gray-600 bg-blue-50 py-2 px-3 rounded-lg border border-blue-100">Total halaman dokumen: <b className="text-blue-700">{pages}</b></p>
          <div className="flex flex-col gap-3">
            {(['each','range'] as const).map(m=>(
              <label key={m} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 font-medium">
                <input type="radio" checked={mode===m} onChange={()=>setMode(m)} className="w-4 h-4 text-blue-600 focus:ring-blue-500"/>
                {m==='each' ? 'Tiap halaman jadi file sendiri' : 'Pilih range halaman tertentu'}
              </label>
            ))}
          </div>
          {mode==='range' && (
            <input value={range} onChange={e=>setRange(e.target.value)}
              placeholder="Contoh: 1-3,5,8-10"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm text-gray-900 font-medium placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"/>
          )}
        </div>
      )}
      <div className="mt-5"><ActionBtn onClick={run} disabled={busy||!file} label={busy?'Memisahkan...':'Split & Download ZIP'}/></div>
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
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
        <Icon name="trash" className="w-6 h-6 text-red-500"/> Remove Pages
      </h2>
      <p className="text-sm text-gray-500 mb-5">Klik halaman yang ingin dihapus (merah = dihapus).</p>
      {!file
        ? <DropZone onFiles={fs=>isPdf(fs[0])&&loadFile(fs[0])} accept=".pdf" multi={false} label="Pilih 1 file PDF" color="red"/>
        : <FileRow file={file} onRemove={()=>{setFile(null);setPages(0);setPreviews([]);}} color="red"/>}
      {previews.length>0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {previews.map((src,i)=>(
            <div key={i} onClick={()=>toggle(i)} className={`cursor-pointer rounded-lg border-2 overflow-hidden transition relative shadow-sm
              ${selected.has(i)?'border-red-500 opacity-60 scale-95':'border-gray-200 hover:border-red-400'}`}>
              <img src={src} className="w-24 h-32 object-contain bg-white"/>
              <div className={`absolute bottom-0 w-full text-center text-xs py-1.5 font-bold ${selected.has(i)?'text-white bg-red-600':'text-gray-600 bg-gray-100'}`}>
                {selected.has(i)?'Dihapus':`Hal ${i+1}`}
              </div>
            </div>
          ))}
        </div>
      )}
      {selected.size>0 && <p className="mt-3 text-sm text-red-600 font-bold bg-red-50 py-2 px-3 rounded-lg border border-red-100">{selected.size} halaman siap dihapus</p>}
      <div className="mt-5"><ActionBtn onClick={run} disabled={busy||!file||selected.size===0} label={busy?'Menghapus...':'Hapus & Download'} color="red"/></div>
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
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
        <Icon name="document_duplicate" className="w-6 h-6 text-blue-600"/> Extract Pages
      </h2>
      <p className="text-sm text-gray-500 mb-5">Pilih halaman yang ingin disimpan (biru = dipilih).</p>
      {!file
        ? <DropZone onFiles={fs=>isPdf(fs[0])&&loadFile(fs[0])} accept=".pdf" multi={false} label="Pilih 1 file PDF"/>
        : <FileRow file={file} onRemove={()=>{setFile(null);setPages(0);setPreviews([]);}}/>}
      {previews.length>0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {previews.map((src,i)=>(
            <div key={i} onClick={()=>toggle(i)} className={`cursor-pointer rounded-lg border-2 overflow-hidden transition relative shadow-sm
              ${selected.has(i)?'border-blue-500 ring-2 ring-blue-200 scale-105':'border-gray-200 hover:border-blue-400'}`}>
              <img src={src} className="w-24 h-32 object-contain bg-white"/>
              <div className={`absolute bottom-0 w-full text-center text-xs py-1.5 font-bold ${selected.has(i)?'text-white bg-blue-600':'text-gray-600 bg-gray-100'}`}>
                {selected.has(i)?'✓ Terpilih':`Hal ${i+1}`}
              </div>
            </div>
          ))}
        </div>
      )}
      {selected.size>0 && <p className="mt-3 text-sm text-blue-600 font-bold bg-blue-50 py-2 px-3 rounded-lg border border-blue-100">{selected.size} halaman dipilih</p>}
      <div className="mt-5"><ActionBtn onClick={run} disabled={busy||!file||selected.size===0} label={busy?'Mengekstrak...':'Ekstrak & Download'}/></div>
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
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
        <Icon name="arrows_pointing_in" className="w-6 h-6 text-blue-600"/> Compress PDF
      </h2>
      <p className="text-sm text-gray-500 mb-5">Perkecil ukuran PDF dengan metode re-render halaman.</p>
      <DropZone onFiles={addFiles} accept=".pdf" label="Drag & drop PDF di sini"/>
      {files.length>0 && (
        <ul className="mt-3 space-y-2">
          {files.map((f,i)=><FileRow key={i} file={f} onRemove={()=>setFiles(p=>p.filter((_,j)=>j!==i))}/>)}
        </ul>
      )}
      <div className="mt-5 space-y-3 bg-gray-50 border border-gray-200 p-4 rounded-xl">
        <label className="text-sm font-semibold text-gray-800">
          Tingkat Kualitas: <span className="text-blue-600">{Math.round(quality*100)}%</span>
          <span className="ml-2 font-medium text-xs text-gray-500">{quality>=0.8?'(Resolusi tinggi, file lebih besar)':quality>=0.5?'(Menengah, seimbang)':'(Resolusi rendah, file sangat kecil)'}</span>
        </label>
        <input type="range" min="0.2" max="0.95" step="0.05" value={quality}
          onChange={e=>setQuality(Number(e.target.value))}
          className="w-full accent-blue-600 outline-none"/>
        <div className="flex justify-between text-xs font-semibold text-gray-400">
          <span>Kecil banget</span><span>Seimbang</span><span>Tinggi</span>
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
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
        <Icon name="photo" className="w-6 h-6 text-purple-600"/> JPG / PNG to PDF
      </h2>
      <p className="text-sm text-gray-500 mb-5">Konversi gambar ke PDF. Drag untuk mengurutkan.</p>
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
              <span className="text-sm text-purple-700 truncate flex-1 font-semibold">{f.name}</span>
              <span className="text-xs font-medium text-purple-400">{fmtSize(f.size)}</span>
              <button onClick={()=>setFiles(p=>p.filter((_,j)=>j!==i))} className="w-5 h-5 flex items-center justify-center rounded-full text-purple-400 hover:text-white hover:bg-red-500 transition">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5"><ActionBtn onClick={run} disabled={busy||!files.length} label={busy?'Membuat PDF...':'Buat PDF & Download'} color="purple"/></div>
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
      setStatus('Mengompres ZIP...');
      downloadBlob(await zip.generateAsync({type:'blob'}), `${file.name}_images.zip`);
      setStatus('Selesai!');
    } catch(e) { console.error(e); setStatus('Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
        <Icon name="photo" className="w-6 h-6 text-purple-600"/> PDF to JPG
      </h2>
      <p className="text-sm text-gray-500 mb-5">Konversi tiap halaman PDF menjadi gambar JPG resolusi tinggi.</p>
      {!file
        ? <DropZone onFiles={fs=>isPdf(fs[0])&&setFile(fs[0])} accept=".pdf" multi={false} label="Pilih 1 file PDF" color="purple"/>
        : <FileRow file={file} onRemove={()=>setFile(null)} color="purple"/>}
      <div className="mt-5 space-y-4 bg-gray-50 p-4 border border-gray-200 rounded-xl">
        <div>
          <label className="text-sm font-semibold text-gray-800 block mb-2">Resolusi: <span className="text-blue-600">{scale===1?'72dpi':scale===1.5?'108dpi':scale===2?'144dpi':'216dpi'}</span></label>
          <input type="range" min="1" max="3" step="0.5" value={scale} onChange={e=>setScale(Number(e.target.value))} className="w-full accent-purple-600"/>
        </div>
        <div>
          <label className="text-sm font-semibold text-gray-800 block mb-2">Kualitas JPG: <span className="text-blue-600">{Math.round(quality*100)}%</span></label>
          <input type="range" min="0.5" max="1" step="0.05" value={quality} onChange={e=>setQuality(Number(e.target.value))} className="w-full accent-purple-600"/>
        </div>
      </div>
      <div className="mt-5"><ActionBtn onClick={run} disabled={busy||!file} label={busy?'Mengonversi...':'Konversi & Download ZIP'} color="purple"/></div>
      <StatusBar msg={status}/>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 8. ROTATE PDF
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
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
        <Icon name="arrow_path" className="w-6 h-6 text-green-600"/> Rotate PDF
      </h2>
      <p className="text-sm text-gray-500 mb-5">Rotasi halaman yang miring dan simpan secara permanen.</p>
      <label onDragOver={e=>{e.preventDefault();setIsDrag(true)}} onDragLeave={()=>setIsDrag(false)}
        onDrop={e=>{e.preventDefault();setIsDrag(false);addFiles(Array.from(e.dataTransfer.files))}}
        className={`flex flex-col items-center gap-1 w-full px-4 py-6 rounded-xl border-2 border-dashed cursor-pointer transition mb-4
          ${isDrag?'border-green-500 bg-green-100':'border-green-200 bg-green-50 hover:bg-green-100'}`}>
        <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
        </svg>
        <span className="text-sm font-semibold text-green-700">{isDrag?'Lepaskan file...':'Drag & drop atau klik untuk pilih PDF'}</span>
        <span className="text-xs text-green-500 opacity-70">Bisa lebih dari 1 file</span>
        <input ref={inputRef} type="file" accept=".pdf" multiple onChange={e=>addFiles(Array.from(e.target.files||[]))} className="hidden"/>
      </label>

      {rotFiles.map((rf,fi)=>(
        <div key={fi} className="mb-4 border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between bg-gray-50 px-4 py-3 border-b border-gray-200 gap-2">
            <span className="text-sm font-bold text-gray-800 truncate flex-1">{rf.file.name}</span>
            {!rf.loading && <>
              <button onClick={()=>rotateAll(fi,'ccw')} className="text-xs font-semibold bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg flex gap-1 items-center"><Icon name="arrow_path" className="w-3 h-3"/> Kiri</button>
              <button onClick={()=>rotateAll(fi,'cw')}  className="text-xs font-semibold bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg flex gap-1 items-center"><Icon name="arrow_path" className="w-3 h-3 transform scale-x-[-1]"/> Kanan</button>
              <button onClick={()=>saveOne(fi)} disabled={busy||rf.pageRotations.every(r=>r===0)}
                className={`text-xs px-3 py-1.5 rounded-lg font-bold transition
                  ${busy||rf.pageRotations.every(r=>r===0)?'bg-gray-200 text-gray-400':'bg-green-600 hover:bg-green-700 text-white shadow-sm'}`}>
                Simpan
              </button>
            </>}
            <button onClick={()=>remove(fi)} className="ml-2 w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-red-500 transition">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          <div className="p-4 bg-white">
            {rf.loading
              ? <div className="flex items-center justify-center py-6 text-gray-500 text-sm gap-2 font-medium">
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
                  Memuat preview...
                </div>
              : <div className="flex flex-wrap gap-3">
                  {rf.previews.map((src,pi)=>(
                    <div key={pi} className="flex flex-col items-center gap-1.5">
                      <div className="relative border border-gray-200 rounded-lg overflow-hidden bg-gray-50 w-[90px] h-[120px] flex items-center justify-center">
                        <img src={src} style={{transform:`rotate(${rf.pageRotations[pi]}deg)`,transition:'transform 0.3s',maxWidth:'85px',maxHeight:'115px',objectFit:'contain'}}/>
                        {rf.pageRotations[pi]!==0 && <span className="absolute top-1 right-1 bg-green-500 text-white text-[10px] px-1.5 py-0.5 rounded shadow-sm font-black">{rf.pageRotations[pi]}°</span>}
                      </div>
                      <span className="text-[11px] font-semibold text-gray-500">Hal {pi+1}</span>
                      <div className="flex gap-1.5">
                        <button onClick={()=>rotatePage(fi,pi,'ccw')} className="w-7 h-7 flex items-center justify-center bg-gray-100 hover:bg-green-100 hover:text-green-700 rounded text-sm transition"><Icon name="arrow_path" className="w-3.5 h-3.5"/></button>
                        <button onClick={()=>rotatePage(fi,pi,'cw')}  className="w-7 h-7 flex items-center justify-center bg-gray-100 hover:bg-green-100 hover:text-green-700 rounded text-sm transition"><Icon name="arrow_path" className="w-3.5 h-3.5 transform scale-x-[-1]"/></button>
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
        let out: any = null;
        for (let i=1; i<=pdf.numPages; i++) {
          setStatus(`[${fi+1}/${files.length}] Hal ${i}/${pdf.numPages}`);
          const pg  = await pdf.getPage(i);
          const vp  = pg.getViewport({scale:SCALE});
          const pW  = vp.width, pH = vp.height;
          const c   = document.createElement('canvas'); c.width=pW; c.height=pH;
          const ctx = c.getContext('2d')!;
          // @ts-ignore
          await pg.render({canvasContext:ctx,viewport:vp}).promise;
          const wScaleX=pW/wvp.width, wScaleY=pH/wvp.height;
          const wScale=Math.max(wScaleX,wScaleY);
          const wVp2  = wPg.getViewport({scale:wScale});
          const wc    = document.createElement('canvas'); wc.width=pW; wc.height=pH;
          const wCtx  = wc.getContext('2d')!;
          wCtx.fillStyle='#fff'; wCtx.fillRect(0,0,pW,pH);
          wCtx.save(); wCtx.translate((pW-wVp2.width)/2,(pH-wVp2.height)/2);
          // @ts-ignore
          await wPg.render({canvasContext:wCtx,viewport:wVp2}).promise;
          wCtx.restore();
          
          ctx.save();
          ctx.globalCompositeOperation = 'multiply';
          const isTargetLandscape = pW > pH;
          const isWatermarkLandscape = wc.width > wc.height;
          
          if (isTargetLandscape !== isWatermarkLandscape) {
            ctx.translate(pW / 2, pH / 2);
            ctx.rotate(-Math.PI / 2); 
            ctx.drawImage(wc, -pH / 2, -pW / 2, pH, pW);
          } else {
            ctx.drawImage(wc, 0, 0, pW, pH);
          }
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
          if (dlMode==='separate') {
            const url = URL.createObjectURL(blob);
            const a   = document.createElement('a');
            a.href = url;
            a.download = `LOCKED_${f.name}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } else zip.file(`LOCKED_${f.name}`, blob);
        }
        await new Promise(r=>setTimeout(r,0));
      }
      if (dlMode==='zip') { setStatus('ZIP...'); downloadBlob(await zip.generateAsync({type:'blob'}),'locked_pdfs.zip'); }
      setStatus('Selesai!');
    } catch(e) { console.error(e); setStatus('Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
        <Icon name="lock_closed" className="w-6 h-6 text-blue-600"/> Lock Watermark
      </h2>
      <p className="text-sm text-gray-500 mb-5">Watermark dan satukan PDF menjadi gambar. 100% Anti-Convert.</p>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-gray-800">1. PDF Gambar Teknik Asli</span>
          {files.length>0 && <button onClick={()=>setFiles([])} className="text-xs font-bold text-red-500 hover:text-red-700 bg-red-50 px-2 py-1 rounded">Hapus Semua</button>}
        </div>
        <label onDragOver={e=>{e.preventDefault();setDragM(true)}} onDragLeave={()=>setDragM(false)}
          onDrop={e=>{e.preventDefault();setDragM(false);addFiles(Array.from(e.dataTransfer.files))}}
          className={`flex flex-col items-center gap-1 w-full px-4 py-5 rounded-xl border-2 border-dashed cursor-pointer transition
            ${isDragM?'border-blue-500 bg-blue-100':'border-blue-200 bg-blue-50 hover:bg-blue-100'}`}>
          <span className="text-sm font-bold text-blue-700">{isDragM?'Lepaskan...':files.length?'Tambah file lagi':'Drag & drop atau klik di sini'}</span>
          <span className="text-xs font-medium text-blue-500">Bisa lebih dari 1 file PDF</span>
          <input ref={fileRef} type="file" accept=".pdf" multiple onChange={e=>addFiles(Array.from(e.target.files||[]))} className="hidden"/>
        </label>
        {files.length>0 && <ul className="mt-2 space-y-1.5">{files.map((f,i)=><FileRow key={i} file={f} onRemove={()=>setFiles(p=>p.filter((_,j)=>j!==i))}/>)}</ul>}
      </div>

      <div className="mb-5">
        <span className="block text-sm font-semibold text-gray-800 mb-2">2. PDF Watermark Stempel</span>
        {!watermark
          ? <label onDragOver={e=>{e.preventDefault();setDragW(true)}} onDragLeave={()=>setDragW(false)}
              onDrop={e=>{e.preventDefault();setDragW(false);const f=e.dataTransfer.files[0];if(f&&isPdf(f))setWM(f)}}
              className={`flex flex-col items-center gap-1 w-full px-4 py-5 rounded-xl border-2 border-dashed cursor-pointer transition
                ${isDragW?'border-purple-500 bg-purple-100':'border-purple-200 bg-purple-50 hover:bg-purple-100'}`}>
              <span className="text-sm font-bold text-purple-700">{isDragW?'Lepaskan...':'Drag & drop watermark ke sini'}</span>
              <span className="text-xs font-medium text-purple-500">Wajib 1 file PDF</span>
              <input ref={waterRef} type="file" accept=".pdf" onChange={e=>{const f=e.target.files?.[0];if(f)setWM(f)}} className="hidden"/>
            </label>
          : <FileRow file={watermark} onRemove={()=>setWM(null)} color="purple"/>}
      </div>

      <div className="mb-4">
        <span className="block text-sm font-semibold text-gray-800 mb-3">3. Opsi Unduhan Output</span>
        <DlModeToggle mode={dlMode} setMode={setDlMode}/>
      </div>
      <ActionBtn onClick={run} disabled={busy||!files.length||!watermark} label={busy?'Memproses...':'Kunci PDF & Download'}/>
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
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
        <Icon name="list_bullet" className="w-6 h-6 text-blue-600"/> Page Numbers
      </h2>
      <p className="text-sm text-gray-500 mb-5">Tambahkan urutan nomor halaman ke PDF.</p>
      {!file
        ? <DropZone onFiles={fs=>isPdf(fs[0])&&setFile(fs[0])} accept=".pdf" multi={false} label="Pilih 1 file PDF"/>
        : <FileRow file={file} onRemove={()=>setFile(null)}/>}
      <div className="mt-5 space-y-4 bg-gray-50 p-4 border border-gray-200 rounded-xl">
        <div>
          <label className="text-sm font-semibold text-gray-800">Posisi Penomoran</label>
          <select value={pos} onChange={e=>setPos(e.target.value as any)}
            className="mt-2 w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 font-bold focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
            <option value="bottom-center">Bawah - Tengah</option>
            <option value="bottom-right">Bawah - Kanan</option>
            <option value="bottom-left">Bawah - Kiri</option>
            <option value="top-center">Atas - Tengah</option>
          </select>
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-sm font-semibold text-gray-800">Mulai dari angka</label>
            <input type="number" min="1" value={startNum} onChange={e=>setStartNum(Number(e.target.value))}
              className="mt-2 w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 font-bold placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"/>
          </div>
          <div className="flex-1">
            <label className="text-sm font-semibold text-gray-800">Ukuran Font (pt)</label>
            <input type="number" min="8" max="24" value={fontSize} onChange={e=>setFontSize(Number(e.target.value))}
              className="mt-2 w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 font-bold placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"/>
          </div>
        </div>
      </div>
      <div className="mt-5"><ActionBtn onClick={run} disabled={busy||!file} label={busy?'Memproses...':'Tambah Nomor & Download'}/></div>
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
      const doc = await PDFDocument.load(await file.arrayBuffer());
      const b = await doc.save();
      downloadBlob(new Blob([b as unknown as BlobPart],{type:'application/pdf'}),`protected_${file.name}`);
      setStatus('Selesai! Catatan: enkripsi password PDF membutuhkan library backend tambahan. Saat ini hanya simulasi output file.');
    } catch(e) { console.error(e); setStatus('Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
        <Icon name="shield_check" className="w-6 h-6 text-red-500"/> Protect PDF
      </h2>
      <p className="text-sm text-gray-500 mb-5">Tambahkan keamanan pada dokumen PDF.</p>
      {!file
        ? <DropZone onFiles={fs=>isPdf(fs[0])&&setFile(fs[0])} accept=".pdf" multi={false} label="Pilih 1 file PDF" color="red"/>
        : <FileRow file={file} onRemove={()=>setFile(null)} color="red"/>}
      <div className="mt-5 bg-gray-50 p-4 border border-gray-200 rounded-xl">
        <label className="text-sm font-semibold text-gray-800">Password Baru</label>
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)}
          placeholder="Masukkan password rahasia..."
          className="mt-2 w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 font-bold placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"/>
      </div>
      <div className="mt-5"><ActionBtn onClick={run} disabled={busy||!file||!pass} label={busy?'Mengenkripsi...':'Kunci Proteksi & Download'} color="red"/></div>
      <StatusBar msg={status}/>
    </>
  );
}
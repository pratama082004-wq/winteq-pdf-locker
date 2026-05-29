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
import { PDFDocument, PDFName } from 'pdf-lib';
import jsPDF from 'jspdf';
import JSZip from 'jszip';

export default function WatermarkApp() {
  const [files, setFiles] = useState<File[]>([]);
  const [watermark, setWatermark] = useState<File | null>(null);
  const [downloadMode, setDownloadMode] = useState<'separate' | 'zip'>('separate');
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [isDraggingMain, setIsDraggingMain] = useState(false);
  const [isDraggingWater, setIsDraggingWater] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const watermarkInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    import('pdfjs-dist').then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
    });
  }, []);

  // ── File list helpers ──────────────────────────────────────────────
  const addFiles = (incoming: File[]) => {
    const pdfs = incoming.filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (pdfs.length === 0) return;
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      return [...prev, ...pdfs.filter(f => !existing.has(f.name + f.size))];
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => setFiles(prev => prev.filter((_, i) => i !== index));
  const clearAllFiles = () => { setFiles([]); if (fileInputRef.current) fileInputRef.current.value = ''; };

  const setWatermarkFile = (f: File | null) => {
    if (f && !(f.type === 'application/pdf' || f.name.endsWith('.pdf'))) return;
    setWatermark(f);
    if (watermarkInputRef.current) watermarkInputRef.current.value = '';
  };
  const removeWatermark = () => setWatermarkFile(null);

  // ── Drag & drop: main zone ─────────────────────────────────────────
  const onMainDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDraggingMain(true); };
  const onMainDragLeave = () => setIsDraggingMain(false);
  const onMainDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDraggingMain(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  // ── Drag & drop: watermark zone ────────────────────────────────────
  const onWaterDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDraggingWater(true); };
  const onWaterDragLeave = () => setIsDraggingWater(false);
  const onWaterDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDraggingWater(false);
    const f = e.dataTransfer.files[0];
    if (f) setWatermarkFile(f);
  };

  // ── PDF rotation normalizer ────────────────────────────────────────
  const normalizePage = async (page: any, mainDoc: any) => {
    const rotationObj = page.node.get(PDFName.of('Rotate'));
    const rotDeg = rotationObj ? Number(rotationObj.toString()) : 0;
    if (rotDeg === 0) return;
    const rawW = page.getWidth();
    const rawH = page.getHeight();
    let transformStr: string;
    if (rotDeg === 90)       transformStr = `q 0 -1 1 0 0 ${rawW} cm\n`;
    else if (rotDeg === 270) transformStr = `q 0 1 -1 0 ${rawH} 0 cm\n`;
    else                     transformStr = `q -1 0 0 -1 ${rawW} ${rawH} cm\n`;
    const restoreStr = `\nQ`;
    const existingContents = page.node.get(PDFName.of('Contents'));
    if (existingContents) {
      const startRef = mainDoc.context.register(mainDoc.context.flateStream(transformStr));
      const endRef   = mainDoc.context.register(mainDoc.context.flateStream(restoreStr));
      const arr = mainDoc.context.obj([]);
      arr.push(startRef);
      if (typeof existingContents.size === 'function') {
        for (let ci = 0; ci < existingContents.size(); ci++) arr.push(existingContents.get(ci));
      } else { arr.push(existingContents); }
      arr.push(endRef);
      page.node.set(PDFName.of('Contents'), arr);
    }
    if (rotDeg === 90 || rotDeg === 270)
      page.node.set(PDFName.of('MediaBox'), mainDoc.context.obj([0, 0, rawH, rawW]));
    page.node.delete(PDFName.of('CropBox'));
    page.node.delete(PDFName.of('Rotate'));
  };

  // ── Core: fit watermark to page regardless of orientation ─────────
  //
  // Watermark PDF bisa landscape, page bisa portrait (atau sebaliknya).
  // Kita embed watermark apa adanya, lalu hitung transform supaya
  // watermark di-scale + dirotasi agar SELALU memenuhi page dengan benar.
  //
  // Algoritma:
  //   1. Ambil dimensi watermark (wW x wH) dan dimensi page (pW x pH).
  //   2. Tentukan apakah orientasi sama atau beda.
  //   3. Kalau beda → rotasi watermark 90° CW saat drawPage.
  //   4. Scale supaya pas memenuhi page.
  const drawWatermarkOnPage = (page: any, watermarkPage: any) => {
    const pW = page.getWidth();
    const pH = page.getHeight();
    const wW = watermarkPage.width;
    const wH = watermarkPage.height;

    const pageIsLandscape = pW > pH;
    const waterIsLandscape = wW > wH;

    if (pageIsLandscape === waterIsLandscape) {
      // Orientasi sama → langsung scale
      page.drawPage(watermarkPage, { x: 0, y: 0, width: pW, height: pH });
    } else {
      // Orientasi beda → rotasi watermark 90° CW saat menggambar
      // Rotasi 90° CW di PDF: [cos(-90), sin(-90), -sin(-90), cos(-90)]
      //                      = [0, -1, 1, 0]
      // Tapi pdf-lib drawPage tidak mendukung transform langsung,
      // jadi kita pakai pushOperators dengan matriks transformasi.
      //
      // Strategi: gambar watermark ke XObject lalu di-place dengan
      // transform manual menggunakan content stream langsung.
      // Karena pdf-lib tidak expose ini dengan mudah, kita pakai
      // pendekatan: rotate page sementara, drawPage, restore.
      //
      // Cara paling mudah yang tersedia di pdf-lib: gunakan
      // page.drawPage dengan xObjectKey, lalu tambahkan stream
      // transform wrapper sebelum & sesudah.
      //
      // Implementasi: kita sisipkan content stream pembungkus
      // yang merotasi canvas 90° CW sebelum memanggil XObject.
      //
      // Watermark landscape (wW > wH), page portrait (pW < pH):
      //   Rotasi 90° CW: [0, -1, 1, 0, 0, pW]
      //   Setelah rotasi, canvas efektif jadi pH wide x pW tall
      //   Scale watermark: sx = pW/wH, sy = pH/wW (karena sudah dirotasi)
      //   (kita gambar watermark di "pre-rotate" space, lalu rotate hasilnya)
      //
      // Lebih simpel: gambar dulu dengan drawPage, ukuran wW x wH
      // di koordinat rotated, lalu pakai scale.

      // Kita gunakan pendekatan stream manual:
      // q                          - save state
      // 0 -1 1 0 0 {pW} cm         - rotate 90° CCW (= display 90° CW) + translate
      // {sx} 0 0 {sy} 0 0 cm       - scale supaya watermark memenuhi halaman
      // /WM Do                     - (ini yang dikerjakan drawPage)
      // Q                          - restore state
      //
      // Tapi drawPage otomatis append ke content stream. Kita bungkus hasilnya.
      // Lebih mudah: panggil drawPage dulu untuk register XObject, 
      // lalu replace stream-nya.

      // SOLUSI PALING PRAGMATIS di pdf-lib:
      // Putar page sementara ke landscape, drawPage, lalu kembalikan.
      // Ini trick yang reliable tanpa harus manipulasi stream manual.

      // Simpan MediaBox asli
      const origBox = page.node.get(PDFName.of('MediaBox'));

      // Set MediaBox landscape sementara (swap pW <-> pH)
      page.node.set(PDFName.of('MediaBox'), (page as any).doc
        ? (page as any).doc.context.obj([0, 0, pH, pW])
        : page.node.context.obj([0, 0, pH, pW])
      );

      // Gambar watermark di ruang landscape
      page.drawPage(watermarkPage, { x: 0, y: 0, width: pH, height: pW });

      // Kembalikan MediaBox asli
      page.node.set(PDFName.of('MediaBox'), origBox);

      // Tandai halaman dengan rotasi 90° supaya viewer menampilkan landscape → portrait
      // Tidak perlu, karena kita sudah normalisasi sebelumnya dan page memang portrait.
      // Kita hanya perlu tambahkan transform stream pembungkus.
      //
      // Setelah drawPage di atas, watermark ter-embed tapi koordinatnya salah
      // (di ruang landscape 0,0 s/d pH,pW), padahal page-nya portrait (pW x pH).
      // Kita perlu rotasi balik konten stream terakhir.
      //
      // Tambahkan wrapper transform ke content stream yang baru saja di-drawPage.
      const contents = page.node.get(PDFName.of('Contents'));
      if (contents) {
        // Ambil stream terakhir (hasil drawPage)
        const isArray = typeof contents.size === 'function';
        const lastIdx = isArray ? contents.size() - 1 : null;
        const lastRef = isArray ? contents.get(lastIdx) : contents;

        // Bungkus stream terakhir dengan rotate 90° CW
        // q 0 1 -1 0 {pH} 0 cm ... Q
        // Ini merotasi 90° CCW di PDF space = tampil 90° CW di viewer
        const wrapStart = `q 0 1 -1 0 ${pH} 0 cm\n`;
        const wrapEnd   = `\nQ`;
        const sRef = page.node.context.register(page.node.context.flateStream(wrapStart));
        const eRef = page.node.context.register(page.node.context.flateStream(wrapEnd));

        const newArr = page.node.context.obj([]);
        if (isArray) {
          for (let ci = 0; ci < (lastIdx as number); ci++) newArr.push(contents.get(ci));
        }
        newArr.push(sRef);
        newArr.push(lastRef);
        newArr.push(eRef);
        page.node.set(PDFName.of('Contents'), newArr);
      }
    }
  };

  // ── Main process ───────────────────────────────────────────────────
  const handleProcess = async () => {
    if (files.length === 0 || !watermark) {
      alert('Harap masukkan minimal 1 gambar teknik dan 1 file watermark!');
      return;
    }
    setIsProcessing(true);
    const zip = new JSZip();

    try {
      const pdfjsLib = await import('pdfjs-dist');
      const waterPdfBytes = await watermark.arrayBuffer();
      const waterDoc = await PDFDocument.load(waterPdfBytes);

      for (let f = 0; f < files.length; f++) {
        const currentFile = files[f];
        setStatus(`Memproses file ${f + 1} dari ${files.length}: ${currentFile.name}...`);

        const mainPdfBytes = await currentFile.arrayBuffer();
        const mainDoc = await PDFDocument.load(mainPdfBytes);

        // Normalisasi rotasi semua halaman terlebih dahulu
        for (const page of mainDoc.getPages()) {
          await normalizePage(page, mainDoc);
        }

        // Embed watermark dan gambar ke setiap halaman
        const [watermarkPage] = await mainDoc.embedPdf(waterDoc, [0]);
        for (const page of mainDoc.getPages()) {
          drawWatermarkOnPage(page, watermarkPage);
        }

        const mergedPdfBytes = await mainDoc.save();

        // Rasterize
        const pdf = await pdfjsLib.getDocument({ data: mergedPdfBytes }).promise;
        let pdfOut: jsPDF | null = null;

        for (let i = 1; i <= pdf.numPages; i++) {
          setStatus(`[File ${f + 1}/${files.length}] Mengunci halaman ${i}...`);
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 3.0 });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          // @ts-ignore
          await page.render({ canvasContext: ctx, viewport }).promise;
          const imgData = canvas.toDataURL('image/jpeg', 0.8);
          const pdfWidth = viewport.width / 3.0;
          const pdfHeight = viewport.height / 3.0;
          const orientation = pdfWidth > pdfHeight ? 'l' : 'p';
          if (i === 1) {
            pdfOut = new jsPDF({ orientation, unit: 'pt', format: [pdfWidth, pdfHeight] });
          } else {
            pdfOut?.addPage([pdfWidth, pdfHeight], orientation);
          }
          pdfOut?.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
        }

        if (pdfOut) {
          if (downloadMode === 'separate') {
            pdfOut.save(`locked_${currentFile.name}`);
          } else {
            zip.file(`locked_${currentFile.name}`, pdfOut.output('blob'));
          }
        }
      }

      if (downloadMode === 'zip') {
        setStatus('Mengompres semua file ke dalam ZIP...');
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url; a.download = 'locked_gambar_teknik.zip'; a.click();
        URL.revokeObjectURL(url);
      }

      setStatus('Selesai! Semua PDF berhasil diproses.');
    } catch (error) {
      console.error(error);
      setStatus('Terjadi kesalahan. Cek console (F12) untuk detailnya.');
    } finally {
      setIsProcessing(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // ── UI ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <h1 className="text-3xl font-bold text-gray-800 text-center mb-2">
          Secure PDF Watermark
        </h1>
        <p className="text-gray-500 text-center mb-8 text-sm">
          Bulk proses gambar teknik. 100% Anti-Convert.
        </p>

        {/* ── Section 1: Gambar Teknik ── */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              1. Upload PDF Gambar Teknik
            </label>
            {files.length > 0 && (
              <button onClick={clearAllFiles}
                className="text-xs text-red-500 hover:text-red-700 font-medium transition">
                Hapus Semua
              </button>
            )}
          </div>

          {/* Drop zone */}
          <label
            onDragOver={onMainDragOver}
            onDragLeave={onMainDragLeave}
            onDrop={onMainDrop}
            className={`flex flex-col items-center justify-center gap-1 w-full px-4 py-5 rounded-xl border-2 border-dashed cursor-pointer transition
              ${isDraggingMain
                ? 'border-blue-500 bg-blue-100 scale-[1.01]'
                : 'border-blue-200 bg-blue-50 hover:bg-blue-100'}`}
          >
            <svg className="w-7 h-7 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <span className="text-sm font-semibold text-blue-700">
              {isDraggingMain ? 'Lepaskan file di sini...' : (files.length === 0 ? 'Drag & drop atau klik untuk pilih file' : 'Drag & drop atau klik untuk tambah file')}
            </span>
            <span className="text-xs text-blue-400">Format: PDF, bisa lebih dari 1 file</span>
            <input ref={fileInputRef} type="file" accept=".pdf" multiple
              onChange={(e) => addFiles(Array.from(e.target.files || []))}
              className="hidden" />
          </label>

          {/* File list */}
          {files.length > 0 && (
            <ul className="mt-3 space-y-2">
              {files.map((file, index) => (
                <li key={index}
                  className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" />
                    </svg>
                    <span className="text-sm text-gray-700 truncate">{file.name}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">{formatSize(file.size)}</span>
                  </div>
                  <button onClick={() => removeFile(index)}
                    className="ml-2 flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-red-500 transition"
                    title="Hapus file ini">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {files.length > 0 && (
            <p className="mt-2 text-xs text-blue-600 font-medium">{files.length} file terpilih</p>
          )}
        </div>

        {/* ── Section 2: Watermark ── */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            2. Upload PDF Watermark (1 file saja)
          </label>

          {!watermark ? (
            <label
              onDragOver={onWaterDragOver}
              onDragLeave={onWaterDragLeave}
              onDrop={onWaterDrop}
              className={`flex flex-col items-center justify-center gap-1 w-full px-4 py-5 rounded-xl border-2 border-dashed cursor-pointer transition
                ${isDraggingWater
                  ? 'border-purple-500 bg-purple-100 scale-[1.01]'
                  : 'border-purple-200 bg-purple-50 hover:bg-purple-100'}`}
            >
              <svg className="w-7 h-7 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span className="text-sm font-semibold text-purple-700">
                {isDraggingWater ? 'Lepaskan file di sini...' : 'Drag & drop atau klik untuk pilih watermark'}
              </span>
              <span className="text-xs text-purple-400">Format: PDF, 1 file saja</span>
              <input ref={watermarkInputRef} type="file" accept=".pdf"
                onChange={(e) => setWatermarkFile(e.target.files?.[0] || null)}
                className="hidden" />
            </label>
          ) : (
            <div className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <svg className="w-4 h-4 text-purple-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" />
                </svg>
                <span className="text-sm text-purple-700 truncate font-medium">{watermark.name}</span>
                <span className="text-xs text-purple-400 flex-shrink-0">{formatSize(watermark.size)}</span>
              </div>
              <button onClick={removeWatermark}
                className="ml-2 flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-purple-400 hover:text-white hover:bg-red-500 transition"
                title="Hapus watermark">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* ── Section 3: Opsi Download ── */}
        <div className="mb-8">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            3. Opsi Unduhan Hasil
          </label>
          <div className="flex gap-4">
            {(['separate', 'zip'] as const).map(mode => (
              <label key={mode} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input type="radio" name="downloadMode" value={mode}
                  checked={downloadMode === mode}
                  onChange={() => setDownloadMode(mode)}
                  className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500" />
                {mode === 'separate' ? 'Unduh Terpisah' : 'Jadikan 1 File ZIP'}
              </label>
            ))}
          </div>
        </div>

        {/* ── Action ── */}
        <button onClick={handleProcess} disabled={isProcessing}
          className={`w-full py-3 px-4 rounded-xl text-white font-bold text-lg transition-all ${
            isProcessing
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 hover:shadow-lg hover:scale-[1.02]'
          }`}>
          {isProcessing ? 'Memproses...' : 'Kunci & Download File'}
        </button>

        {status && (
          <p className="mt-6 text-center text-sm font-medium text-gray-600 bg-gray-100 py-2 rounded-lg">
            {status}
          </p>
        )}
      </div>
    </div>
  );
}

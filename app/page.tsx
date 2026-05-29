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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const watermarkInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    import('pdfjs-dist').then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
    });
  }, []);

  const handleAddFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = e.target.files ? Array.from(e.target.files) : [];
    if (newFiles.length === 0) return;
    // Tambahkan ke list yang sudah ada, hindari duplikat by name+size
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      const toAdd = newFiles.filter(f => !existing.has(f.name + f.size));
      return [...prev, ...toAdd];
    });
    // Reset input supaya bisa upload file yang sama lagi kalau perlu
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearAllFiles = () => {
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeWatermark = () => {
    setWatermark(null);
    if (watermarkInputRef.current) watermarkInputRef.current.value = '';
  };

  const normalizePage = async (page: any, mainDoc: any) => {
    const rotationObj = page.node.get(PDFName.of('Rotate'));
    const rotDeg = rotationObj ? Number(rotationObj.toString()) : 0;
    if (rotDeg === 0) return;

    const rawW = page.getWidth();
    const rawH = page.getHeight();

    let transformStr: string;
    if (rotDeg === 90) {
      transformStr = `q 0 -1 1 0 0 ${rawW} cm\n`;
    } else if (rotDeg === 270) {
      transformStr = `q 0 1 -1 0 ${rawH} 0 cm\n`;
    } else if (rotDeg === 180) {
      transformStr = `q -1 0 0 -1 ${rawW} ${rawH} cm\n`;
    } else {
      return;
    }
    const restoreStr = `\nQ`;

    const existingContents = page.node.get(PDFName.of('Contents'));
    if (existingContents) {
      const startRef = mainDoc.context.register(mainDoc.context.flateStream(transformStr));
      const endRef = mainDoc.context.register(mainDoc.context.flateStream(restoreStr));
      const newContents = mainDoc.context.obj([]);
      newContents.push(startRef);
      const isArray = typeof existingContents.size === 'function';
      if (isArray) {
        for (let ci = 0; ci < existingContents.size(); ci++) {
          newContents.push(existingContents.get(ci));
        }
      } else {
        newContents.push(existingContents);
      }
      newContents.push(endRef);
      page.node.set(PDFName.of('Contents'), newContents);
    }

    if (rotDeg === 90 || rotDeg === 270) {
      page.node.set(PDFName.of('MediaBox'), mainDoc.context.obj([0, 0, rawH, rawW]));
    }
    page.node.delete(PDFName.of('CropBox'));
    page.node.delete(PDFName.of('Rotate'));
  };

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

        for (const page of mainDoc.getPages()) {
          await normalizePage(page, mainDoc);
        }

        const [watermarkPage] = await mainDoc.embedPdf(waterDoc, [0]);
        for (const page of mainDoc.getPages()) {
          page.drawPage(watermarkPage, {
            x: 0, y: 0,
            width: page.getWidth(),
            height: page.getHeight(),
          });
        }

        const mergedPdfBytes = await mainDoc.save();

        const loadingTask = pdfjsLib.getDocument({ data: mergedPdfBytes });
        const pdf = await loadingTask.promise;
        const numPages = pdf.numPages;
        let pdfOut: jsPDF | null = null;

        for (let i = 1; i <= numPages; i++) {
          setStatus(`[File ${f + 1}/${files.length}] Mengunci halaman ${i}...`);
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 3.0 });

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) continue;
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          // @ts-ignore
          await page.render({ canvasContext: context, viewport: viewport }).promise;
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
            const pdfBlob = pdfOut.output('blob');
            zip.file(`locked_${currentFile.name}`, pdfBlob);
          }
        }
      }

      if (downloadMode === 'zip') {
        setStatus('Mengompres semua file ke dalam ZIP...');
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'locked_gambar_teknik.zip';
        a.click();
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
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <h1 className="text-3xl font-bold text-gray-800 text-center mb-2">
          Secure PDF Watermark
        </h1>
        <p className="text-gray-500 text-center mb-8 text-sm">
          Bulk proses gambar teknik. 100% Anti-Convert.
        </p>

        {/* Input Gambar Teknik */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              1. Upload PDF Gambar Teknik
            </label>
            {files.length > 0 && (
              <button
                onClick={clearAllFiles}
                className="text-xs text-red-500 hover:text-red-700 font-medium transition"
              >
                Hapus Semua
              </button>
            )}
          </div>

          {/* Drop zone / button */}
          <label className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50 hover:bg-blue-100 cursor-pointer transition">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm font-semibold text-blue-700">
              {files.length === 0 ? 'Pilih file PDF' : 'Tambah file PDF lagi'}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              multiple
              onChange={handleAddFiles}
              className="hidden"
            />
          </label>

          {/* File list */}
          {files.length > 0 && (
            <ul className="mt-3 space-y-2">
              {files.map((file, index) => (
                <li
                  key={index}
                  className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" />
                    </svg>
                    <span className="text-sm text-gray-700 truncate">{file.name}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">{formatSize(file.size)}</span>
                  </div>
                  <button
                    onClick={() => removeFile(index)}
                    className="ml-2 flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-red-500 transition"
                    title="Hapus file ini"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {files.length > 0 && (
            <p className="mt-2 text-xs text-blue-600 font-medium">
              {files.length} file terpilih
            </p>
          )}
        </div>

        {/* Input Watermark */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            2. Upload PDF Watermark (1 file saja)
          </label>

          {!watermark ? (
            <label className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl border-2 border-dashed border-purple-200 bg-purple-50 hover:bg-purple-100 cursor-pointer transition">
              <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-sm font-semibold text-purple-700">Pilih file watermark</span>
              <input
                ref={watermarkInputRef}
                type="file"
                accept=".pdf"
                onChange={(e) => setWatermark(e.target.files?.[0] || null)}
                className="hidden"
              />
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
              <button
                onClick={removeWatermark}
                className="ml-2 flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-purple-400 hover:text-white hover:bg-red-500 transition"
                title="Hapus watermark"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Opsi Download */}
        <div className="mb-8">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            3. Opsi Unduhan Hasil
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <input
                type="radio"
                name="downloadMode"
                value="separate"
                checked={downloadMode === 'separate'}
                onChange={() => setDownloadMode('separate')}
                className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              />
              Unduh Terpisah
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <input
                type="radio"
                name="downloadMode"
                value="zip"
                checked={downloadMode === 'zip'}
                onChange={() => setDownloadMode('zip')}
                className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              />
              Jadikan 1 File ZIP
            </label>
          </div>
        </div>

        <button
          onClick={handleProcess}
          disabled={isProcessing}
          className={`w-full py-3 px-4 rounded-xl text-white font-bold text-lg transition-all ${
          isProcessing
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 hover:shadow-lg hover:scale-[1.02]'
        }`}
        >
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

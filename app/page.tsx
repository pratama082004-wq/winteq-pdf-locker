'use client';

// === TAMBALAN (POLYFILL) KHUSUS BROWSER JADUL KANTOR ===
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
// =======================================================

import { useState, useEffect } from 'react';
import { PDFDocument } from 'pdf-lib';
// PERHATIKAN: import pdfjs-dist di bagian atas sudah DIHAPUS.
import jsPDF from 'jspdf';
import JSZip from 'jszip';

export default function WatermarkApp() {
  const [files, setFiles] = useState<File[]>([]);
  const [watermark, setWatermark] = useState<File | null>(null);
  const [downloadMode, setDownloadMode] = useState<'separate' | 'zip'>('separate');
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');

  // Setup Worker secara Dinamis (Menghindari Server-Side Rendering Vercel)
  useEffect(() => {
    import('pdfjs-dist').then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
    });
  }, []);

  const handleProcess = async () => {
    if (files.length === 0 || !watermark) {
      alert('Harap masukkan minimal 1 gambar teknik dan 1 file watermark!');
      return;
    }

    setIsProcessing(true);
    const zip = new JSZip();

    try {
      // Panggil library pdfjs secara dinamis HANYA saat tombol diklik
      const pdfjsLib = await import('pdfjs-dist');

      const waterPdfBytes = await watermark.arrayBuffer();
      const waterDoc = await PDFDocument.load(waterPdfBytes);

      for (let f = 0; f < files.length; f++) {
        const currentFile = files[f];
        setStatus(`Memproses file ${f + 1} dari ${files.length}: ${currentFile.name}...`);

        // === LOGIKA 1: Tempel Watermark ===
        const mainPdfBytes = await currentFile.arrayBuffer();
        const mainDoc = await PDFDocument.load(mainPdfBytes);
        const [watermarkPage] = await mainDoc.embedPdf(waterDoc, [0]);

        const pages = mainDoc.getPages();
        for (const page of pages) {
          page.drawPage(watermarkPage, {
            x: 0,
            y: 0,
            width: page.getWidth(),
            height: page.getHeight(),
          });
        }

        const mergedPdfBytes = await mainDoc.save();

        // === LOGIKA 2: Rasterize (Kunci Layer) ===
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

        // === LOGIKA 3: Simpan Terpisah atau Masukkan ke ZIP ===
        if (pdfOut) {
          if (downloadMode === 'separate') {
            pdfOut.save(`locked_${currentFile.name}`);
          } else {
            const pdfBlob = pdfOut.output('blob');
            zip.file(`locked_${currentFile.name}`, pdfBlob);
          }
        }
      }

      // === LOGIKA 4: Unduh ZIP (Jika Mode ZIP Dipilih) ===
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <h1 className="text-3xl font-bold text-gray-800 text-center mb-2">
          Secure PDF Watermark
        </h1>
        <p className="text-gray-500 text-center mb-8 text-sm">
          Bulk proses gambar teknik. 100% Anti-Convert.
        </p>

        {/* Input Gambar Teknik (Bisa Multiple) */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            1. Upload PDF Gambar Teknik (Bisa lebih dari 1 file)
          </label>
          <input
            type="file"
            accept=".pdf"
            multiple
            onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 transition"
          />
          {files.length > 0 && (
            <p className="mt-2 text-xs text-blue-600 font-medium">
              {files.length} file terpilih.
            </p>
          )}
        </div>

        {/* Input Watermark */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            2. Upload PDF Watermark (1 file saja)
          </label>
          <input
            type="file"
            accept=".pdf"
            onChange={(e) => setWatermark(e.target.files?.[0] || null)}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 transition"
          />
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

        {/* Action Button */}
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

        {/* Status Message */}
        {status && (
          <p className="mt-6 text-center text-sm font-medium text-gray-600 bg-gray-100 py-2 rounded-lg">
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
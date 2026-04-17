// Lazy loader for pdf-parse.
//
// pdf-parse v2 pulls in pdfjs-dist, which references browser-only globals
// (DOMMatrix, Path2D, ImageData) at module-evaluation time. On Vercel's
// Node serverless runtime those globals don't exist, so a top-level import
// crashes the function during cold start — taking down /api/health and
// every other endpoint even though most have nothing to do with PDFs.
// Load it lazily the first time a PDF actually needs parsing. Railway's
// long-lived Node also tolerates this fine.
//
// Shared by api/server.js (federal bill text) and api/billSync.js (state
// bill text backfill). Kept in its own module so the ci-duplicate-scan
// doesn't flag cross-file duplication.

let _PDFParsePromise = null

export function loadPDFParse() {
  if (!_PDFParsePromise) {
    _PDFParsePromise = import('pdf-parse').then(m => m.PDFParse)
  }
  return _PDFParsePromise
}

import type { PdfItem } from '@/core/pdfStatement'

/** Texte positionné d'un PDF (pdf.js, worker servi par l'app). */
export async function pdfItems(buf: ArrayBuffer): Promise<PdfItem[]> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
  const out: PdfItem[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent()
    for (const it of content.items) if ('str' in it) out.push({ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number, page: p })
  }
  return out
}

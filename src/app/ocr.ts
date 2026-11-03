/** OCR local (Tesseract.js) : fichiers servis par l'app (public/ocr), chargés seulement au premier usage. */
export async function ocrImage(data: Uint8Array): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const base = new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href
  const worker = await createWorker('fra', 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: base, gzip: true, workerBlobURL: false })
  try { return (await worker.recognize(new Blob([data as BlobPart]))).data.text }
  finally { await worker.terminate() }
}

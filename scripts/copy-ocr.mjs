// Copie les fichiers de l'OCR (Tesseract) dans public/ocr pour qu'ils soient servis par l'app elle-même :
// aucune requête vers un CDN, aucune image envoyée ailleurs.
import { cpSync, mkdirSync } from 'node:fs'
const out = 'public/ocr'
mkdirSync(out, { recursive: true })
cpSync('node_modules/tesseract.js/dist/worker.min.js', `${out}/worker.min.js`)
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'])
  cpSync(`node_modules/tesseract.js-core/${f}`, `${out}/${f}`)
cpSync('node_modules/@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz', `${out}/fra.traineddata.gz`)
console.log('OCR copié dans public/ocr')

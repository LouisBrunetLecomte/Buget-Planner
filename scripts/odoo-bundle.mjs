// Rassemble dist-odoo/ en un seul fichier (dist-odoo/buget.html) : scripts et styles en ligne, pour l'héberger sur Odoo.
import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const dir = 'dist-odoo'
let html = readFileSync(join(dir, 'index.html'), 'utf8')
const read = (src) => readFileSync(join(dir, src.replace(/^\.\//, '')), 'utf8')
// </script> dans le code casserait la balise : on l'échappe
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) => `<script type="module">${read(src).replaceAll('</script', '<\\/script')}</script>`)
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, href) => `<style>${read(href)}</style>`)
html = html.replace(/<link rel="(icon|apple-touch-icon|manifest)"[^>]*>\n?/g, '')
if (/src="\.\/assets|href="\.\/assets/.test(html)) throw new Error('Un fichier n’a pas été mis en ligne')
writeFileSync(join(dir, 'buget.html'), html)
// Odoo refuse les pièces jointes HTML : on envoie le fichier compressé, la page Odoo le décompresse dans le navigateur
const gz = gzipSync(html, { level: 9 })
writeFileSync(join(dir, 'buget.html.gz'), gz)
console.log(`dist-odoo/buget.html.gz : ${(gz.length / 1024 / 1024).toFixed(2)} Mo`)

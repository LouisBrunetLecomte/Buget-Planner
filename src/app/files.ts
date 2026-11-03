/** Réduit une photo (ticket) à 1600 px de large max en JPEG : quelques centaines de Ko au lieu de plusieurs Mo. */
export async function prepareFile(file: File): Promise<{ name: string; mime: string; data: Uint8Array }> {
  if (!file.type.startsWith('image/')) return { name: file.name, mime: file.type, data: new Uint8Array(await file.arrayBuffer()) }
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Image illisible'))), 'image/jpeg', 0.82))
  return { name: file.name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg', data: new Uint8Array(await blob.arrayBuffer()) }
}

export function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

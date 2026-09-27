/** 浏览器侧图片 I/O：File / dataURL / canvas ↔ RgbaImage，以及下载与剪贴板 */

import type { RgbaImage } from './types'

export async function fileToRgbaImage(file: File): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('无法创建 2D 上下文')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(bitmap, 0, 0)
    return canvasToRgba(canvas)
  } finally {
    bitmap.close()
  }
}

export function rgbaToCanvas(image: RgbaImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 2D 上下文')
  const imageData = new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height,
  )
  ctx.putImageData(imageData, 0, 0)
  return canvas
}

export function canvasToRgba(canvas: HTMLCanvasElement): RgbaImage {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建 2D 上下文')
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { width: canvas.width, height: canvas.height, data: imageData.data }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('导出 PNG 失败'))
    }, type)
  })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export async function downloadCanvas(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  downloadBlob(await canvasToBlob(canvas), filename)
}

export async function copyCanvasToClipboard(canvas: HTMLCanvasElement): Promise<void> {
  const blob = await canvasToBlob(canvas)
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('当前浏览器不支持复制图片，请使用下载按钮')
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

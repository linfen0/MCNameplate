/**
 * 像素级位图原语。
 * 与 DOM / Canvas 完全无关，因此可以在 Node 环境中直接单元测试。
 */

import type { Rgba } from './color'
import { TRANSPARENT } from './color'
import type { Rect, RgbaImage } from './types'

export function createImage(width: number, height: number, fill: Rgba = TRANSPARENT): RgbaImage {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const data = new Uint8ClampedArray(w * h * 4)
  if (fill[3] !== 0 || fill[0] !== 0 || fill[1] !== 0 || fill[2] !== 0) {
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = fill[0]
      data[i * 4 + 1] = fill[1]
      data[i * 4 + 2] = fill[2]
      data[i * 4 + 3] = fill[3]
    }
  }
  return { width: w, height: h, data }
}

export function cloneImage(img: RgbaImage): RgbaImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }
}

export function getPixel(img: RgbaImage, x: number, y: number): Rgba {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return TRANSPARENT
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
}

export function setPixel(img: RgbaImage, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
  const i = (y * img.width + x) * 4
  img.data[i] = color[0]
  img.data[i + 1] = color[1]
  img.data[i + 2] = color[2]
  img.data[i + 3] = color[3]
}

/** 用纯色填充矩形（越界部分自动裁剪） */
export function fillRect(dst: RgbaImage, rect: Rect, color: Rgba): void {
  const x0 = Math.max(0, rect.x)
  const y0 = Math.max(0, rect.y)
  const x1 = Math.min(dst.width, rect.x + rect.width)
  const y1 = Math.min(dst.height, rect.y + rect.height)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * dst.width + x) * 4
      dst.data[i] = color[0]
      dst.data[i + 1] = color[1]
      dst.data[i + 2] = color[2]
      dst.data[i + 3] = color[3]
    }
  }
}

/** source-over alpha 混合写入 */
export function blitOver(dst: RgbaImage, src: RgbaImage, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y
    if (ty < 0 || ty >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x
      if (tx < 0 || tx >= dst.width) continue
      const si = (y * src.width + x) * 4
      const sa = src.data[si + 3] / 255
      if (sa === 0) continue
      const ti = (ty * dst.width + tx) * 4
      const da = dst.data[ti + 3] / 255
      const outA = sa + da * (1 - sa)
      if (outA === 0) {
        dst.data[ti] = 0
        dst.data[ti + 1] = 0
        dst.data[ti + 2] = 0
        dst.data[ti + 3] = 0
        continue
      }
      for (let c = 0; c < 3; c++) {
        const sc = src.data[si + c]
        const dc = dst.data[ti + c]
        dst.data[ti + c] = (sc * sa + dc * da * (1 - sa)) / outA
      }
      dst.data[ti + 3] = outA * 255
    }
  }
}

/** 把上层的 alpha 直接覆盖到下层（保留上层透明度，不做混合）——用于合成帽子图层 */
export function compositeOverlay(base: RgbaImage, overlay: RgbaImage): RgbaImage {
  const out = cloneImage(base)
  blitOver(out, overlay, 0, 0)
  return out
}

export function cropRect(img: RgbaImage, rect: Rect): RgbaImage {
  const out = createImage(rect.width, rect.height)
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const sx = rect.x + x
      const sy = rect.y + y
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue
      const si = (sy * img.width + sx) * 4
      const ti = (y * rect.width + x) * 4
      out.data[ti] = img.data[si]
      out.data[ti + 1] = img.data[si + 1]
      out.data[ti + 2] = img.data[si + 2]
      out.data[ti + 3] = img.data[si + 3]
    }
  }
  return out
}

export function isRectTransparent(img: RgbaImage, rect: Rect): boolean {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
      if (img.data[(y * img.width + x) * 4 + 3] !== 0) return false
    }
  }
  return true
}

export function countOpaquePixels(img: RgbaImage, rect: Rect): number {
  let count = 0
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
      if (img.data[(y * img.width + x) * 4 + 3] > 0) count++
    }
  }
  return count
}

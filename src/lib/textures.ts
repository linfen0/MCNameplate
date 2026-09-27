/**
 * 程序化底色纹理。
 *
 * 关键点：**按名牌面板的实际尺寸生成一整块贴图**，而不是把 16×16 方块贴图平铺，
 * 所以不会出现重复的横向条纹；顶部草皮也只有一条，像“一块被切开的方块”。
 * 全部由确定性 PRNG 生成，同一 seed 结果完全一致。
 */

import { hexToRgba } from './color'
import { createImage, setPixel } from './raster'
import type { RgbaImage } from './types'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Palette {
  base: string
  light: string
  dark: string
}

export type PanelTexture =
  | { kind: 'solid'; color: string }
  /** 颗粒石/土底；带 grassTop 时顶部生成一条起伏草皮 */
  | { kind: 'noise'; palette: Palette; grassTop?: Palette }


/** 面板贴图的像素粒度：每个纹理像素占 unit 个画布像素 */
const MIN_TEXELS = 8

function paintNoise(colors: [number[], number[], number[]], value: number): number[] {
  if (value < 0.16) return colors[1]
  if (value < 0.38) return colors[2]
  return colors[0]
}

/**
 * 生成 width × height 个纹理像素的面板贴图（已经是“面包板尺寸”的贴图）。
 */
export function renderPanelTexture(
  texture: PanelTexture,
  width: number,
  height: number,
  seed: number,
): RgbaImage {
  const w = Math.max(MIN_TEXELS, Math.floor(width))
  const h = Math.max(MIN_TEXELS, Math.floor(height))

  if (texture.kind === 'solid') {
    return createImage(w, h, hexToRgba(texture.color))
  }

  const image = createImage(w, h)
  const rng = mulberry32(seed)
  const field = new Float32Array(w * h)
  for (let i = 0; i < field.length; i++) field[i] = rng()

  const base = hexToRgba(texture.palette.base)
  const light = hexToRgba(texture.palette.light)
  const dark = hexToRgba(texture.palette.dark)
  const rock: [number[], number[], number[]] = [
    [base[0], base[1], base[2]],
    [light[0], light[1], light[2]],
    [dark[0], dark[1], dark[2]],
  ]

  let grass: [number[], number[], number[]] | null = null
  const edge: number[] = new Array(w).fill(0)
  if (texture.grassTop) {
    const g = texture.grassTop
    const gb = hexToRgba(g.base)
    const gl = hexToRgba(g.light)
    const gd = hexToRgba(g.dark)
    grass = [
      [gb[0], gb[1], gb[2]],
      [gl[0], gl[1], gl[2]],
      [gd[0], gd[1], gd[2]],
    ]
    for (let x = 0; x < w; x++) {
      // 草皮厚度 2-4 个纹理像素，边缘起伏
      edge[x] = 2 + (rng() < 0.45 ? 0 : 1) + (rng() < 0.2 ? 1 : 0)
    }
  }

  for (let y = 0; y < h; y++) {
    // 自下而上的柔和压暗，给铭牌一点体积感
    const depth = 1 - 0.22 * (y / Math.max(1, h - 1))
    for (let x = 0; x < w; x++) {
      const value = field[y * w + x]
      const grassHere = grass !== null && y < edge[x] ? grass : null
      const isGrassEdge = grass !== null && y === edge[x]
      const color = paintNoise(grassHere ?? rock, value)
      let factor = depth
      if (isGrassEdge) factor *= 0.82
      // 靠近左右边缘轻微压暗，视觉上收边
      const edgeDistance = Math.min(x, w - 1 - x) / Math.max(1, w * 0.5)
      factor *= 0.94 + 0.06 * Math.min(1, edgeDistance)
      setPixel(image, x, y, [color[0] * factor, color[1] * factor, color[2] * factor, 255])
    }
  }
  return image
}

const cache = new Map<string, RgbaImage>()

/** 带缓存：连续重绘时不必重复生成整块底纹 */
export function getPanelTexture(
  texture: PanelTexture,
  width: number,
  height: number,
  seed: number,
): RgbaImage {
  const key = `${JSON.stringify(texture)}|${width}x${height}|${seed}`
  const hit = cache.get(key)
  if (hit) return hit
  const value = renderPanelTexture(texture, width, height, seed)
  if (cache.size > 8) cache.clear()
  cache.set(key, value)
  return value
}

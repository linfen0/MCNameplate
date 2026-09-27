/**
 * 像素文字渲染（不依赖任何字体文件）。
 *
 * 字形来自 bitmapFontData.ts（由 scripts/build-bitmap-font.mjs 从 Silkscreen / Press Start 2P 烘出）。
 * 为什么不用 ctx.fillText：
 *   webfont 一旦被 CSP / iframe / 隐私设置拦掉，canvas 会静默回退到系统字体，
 *   名牌上的 ID 立刻变成模糊的抗锯齿文字，而且不报任何错。
 *   自己按位合成点阵后，输出只可能是 0 / 255 两种 alpha —— 硬边是构造保证，不是事后阈值化。
 */

import { hexToRgba } from './color'
import { createImage, setPixel } from './raster'
import { BITMAP_FONTS, type BitmapFontData, type BitmapGlyph } from './bitmapFontData'
import type { RgbaImage } from './types'

export interface PixelFontSpec {
  id: string
  name: string
  description: string
  /** UI 预览用（网页文字仍用 webfont），canvas 渲染完全不使用 */
  cssFamily: string
  nativeSize: number
  /** 网页文字是否有对应 webfont；Mojangles 只有点阵数据 */
  hasWebFont: boolean
  data: BitmapFontData
}

export const PIXEL_FONTS: PixelFontSpec[] = [
  {
    id: 'mojangles',
    name: 'Mojangles',
    description: 'Minecraft 原版字体（官方 ascii.png 字模，比例字体）',
    cssFamily: '"Minecraft", Silkscreen, monospace',
    nativeSize: 8,
    hasWebFont: false,
    data: BITMAP_FONTS[0],
  },
  {
    id: 'silkscreen',
    name: 'Silkscreen',
    description: '5×5 点阵，工整克制',
    cssFamily: 'Silkscreen',
    nativeSize: 8,
    hasWebFont: true,
    data: BITMAP_FONTS[1],
  },
  {
    id: 'press-start-2p',
    name: 'Press Start 2P',
    description: '经典 8 位街机字体，字重更粗',
    cssFamily: '"Press Start 2P"',
    nativeSize: 8,
    hasWebFont: true,
    data: BITMAP_FONTS[2],
  },
]

export const DEFAULT_FONT_ID = 'mojangles'

export function getPixelFont(id: string): PixelFontSpec {
  return PIXEL_FONTS.find((font) => font.id === id) ?? PIXEL_FONTS[0]
}

const GLYPH_SAMPLE =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-.!?#@ '

/** 字库里没有的字符用一个空心方块占位（Minecraft 的 tofu 行为） */
export const TOFU_ADVANCE = 6

export function glyphOf(font: PixelFontSpec, char: string): BitmapGlyph | null {
  return font.data.glyphs[char.charCodeAt(0)] ?? null
}

/** 点阵字库是否覆盖了全部字符 */
export function isTextSupported(font: PixelFontSpec, text: string): boolean {
  for (const char of text) {
    if (char === '\n') continue
    if (!glyphOf(font, char)) return false
  }
  return true
}

export interface FontMetrics {
  /** 基线到字形顶部（正数） */
  ascent: number
  /** 基线到字形底部（正数，含下伸部分） */
  descent: number
  /** 单行高度 = ascent + descent */
  lineHeight: number
}

export function fontMetrics(font: PixelFontSpec): FontMetrics {
  const { ascent, descent } = font.data
  return { ascent, descent, lineHeight: Math.max(1, ascent + descent) }
}

export interface InkMetrics {
  /** 墨迹顶部相对基线的偏移（负值） */
  top: number
  /** 墨迹底部相对基线的偏移（多数为 0，'_' 之类为 1） */
  bottom: number
  /** 真实墨迹高度 = bottom - top */
  height: number
}

/**
 * 一段文字在本字库下的真实墨迹上下界。
 * 必须按具体文字算：只有 '_' 会落到基线行，只有 j/q/y 会下伸，
 * 而个别标点比字母更高 —— 用字体全局量会把字号算小或把字裁掉。
 */
export function textInkMetrics(font: PixelFontSpec, text: string): InkMetrics {
  let top = 0
  let bottom = 0
  let found = false
  for (const char of text) {
    if (char === '\n') continue
    const glyph = glyphOf(font, char)
    if (!glyph || glyph.h === 0) continue
    found = true
    top = Math.min(top, glyph.y)
    bottom = Math.max(bottom, glyph.y + glyph.h)
  }
  if (!found) {
    const fallback = Math.max(1, font.data.ascent)
    return { top: -fallback, bottom: 0, height: fallback }
  }
  return { top, bottom, height: Math.max(1, bottom - top) }
}

export interface TextMeasurement {
  /** 落笔推进宽度（原生像素） */
  advance: number
  /** 实际墨迹宽度（原生像素） */
  inkWidth: number
}

/** 纯函数：按点阵字库计算一行文字的宽度 */
export function measureText(font: PixelFontSpec, text: string, letterSpacing = 0): TextMeasurement {
  let pen = 0
  let inkWidth = 0
  for (const char of text) {
    const glyph = glyphOf(font, char)
    if (!glyph) {
      pen += TOFU_ADVANCE + letterSpacing
      inkWidth = pen
      continue
    }
    if (glyph.w > 0) inkWidth = Math.max(inkWidth, pen + glyph.x + glyph.w)
    pen += glyph.advance + letterSpacing
  }
  return { advance: pen, inkWidth }
}

/** 生成一个测量函数（纯计算，不需要 canvas） */
export function createMeasure(font: PixelFontSpec, letterSpacing = 0): (text: string) => number {
  return (text: string) => measureText(font, text, letterSpacing).advance
}

export interface FitScaleOptions {
  maxWidth: number
  maxHeight: number
  /** 单行高度（原生像素） */
  lineHeight: number
  /** 文字块四周的对称留白（原生像素） */
  padding: number
  maxScale?: number
  minScale?: number
}

/** 计算最大可用的整数放大倍率（纯函数） */
export function fitTextScale(
  measure: (text: string) => number,
  text: string,
  options: FitScaleOptions,
): number {
  const lines = text.split('\n')
  const contentWidth = Math.max(1, ...lines.map((line) => measure(line)))
  const contentHeight = Math.max(1, lines.length * options.lineHeight)
  const paddedWidth = contentWidth + options.padding * 2
  const paddedHeight = contentHeight + options.padding * 2
  const raw = Math.min(
    Math.floor(options.maxWidth / paddedWidth),
    Math.floor(options.maxHeight / paddedHeight),
  )
  const min = options.minScale ?? 1
  const max = options.maxScale ?? 96
  if (!Number.isFinite(raw) || raw < min) return min
  return Math.min(max, Math.max(min, raw))
}

export interface TextBlockOptions {
  text: string
  font: PixelFontSpec
  fill: string
  shadow?: { color: string; offset: number } | null
  outline?: string | null
  letterSpacing?: number
  /** 0-1，用于占位提示文字 */
  opacity?: number
  lineHeight?: number
}

export interface TextBlock {
  /** 原生点阵图，alpha 只可能是 0 / 255 */
  image: RgbaImage
  /** 四周对称留白（原生像素） */
  padding: number
  lineHeight: number
  /** 字库是否覆盖了全部字符 */
  supported: boolean
}

const OUTLINE_OFFSETS: Array<[number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]

/**
 * 在原生点阵尺寸下合成文字块（纯函数，可在 Node 中直接测试）。
 * 输出像素的 alpha 只可能是 0 或 255。
 */
export function renderTextBlock(options: TextBlockOptions): TextBlock {
  const {
    text,
    font,
    fill,
    shadow = null,
    outline = null,
    letterSpacing = 0,
    opacity = 1,
    lineHeight = textInkMetrics(font, text).height,
  } = options

  const lines = text.length > 0 ? text.split('\n') : ['']
  const width = Math.max(1, ...lines.map((line) => measureText(font, line, letterSpacing).advance))
  const padding = (outline ? 1 : 0) + (shadow ? Math.max(0, shadow.offset) : 0)
  const ink = textInkMetrics(font, lines.join(''))
  const image = createImage(
    width + padding * 2,
    lines.length * lineHeight + padding * 2,
  )
  // 让第一行的墨迹顶边正好落在 padding 处
  const firstBaseline = padding - ink.top
  const ascent = -ink.top
  let supported = true

  const paint = (color: string, dx: number, dy: number): void => {
    const rgba = hexToRgba(color)
    const alpha = Math.max(0, Math.min(255, Math.round(rgba[3] * opacity)))
    if (alpha === 0) return
    const tint = [rgba[0], rgba[1], rgba[2], alpha] as const
    for (let index = 0; index < lines.length; index++) {
      const baseline = firstBaseline + index * lineHeight
      let pen = padding
      for (const char of lines[index]) {
        const glyph = glyphOf(font, char)
        if (!glyph) {
          supported = false
          // 缺字：画一个空心方块，明确表示不受支持
          const size = Math.max(3, ascent - 1)
          for (let x = 0; x < size; x++) {
            setPixel(image, pen + x + dx, baseline - size + dy, tint)
            setPixel(image, pen + x + dx, baseline - 1 + dy, tint)
          }
          for (let y = 0; y < size; y++) {
            setPixel(image, pen + dx, baseline - size + y + dy, tint)
            setPixel(image, pen + size - 1 + dx, baseline - size + y + dy, tint)
          }
          pen += TOFU_ADVANCE + letterSpacing
          continue
        }
        for (let row = 0; row < glyph.rows.length; row++) {
          for (let col = 0; col < glyph.w; col++) {
            if (((glyph.rows[row] >> col) & 1) === 0) continue
            setPixel(image, pen + glyph.x + col + dx, baseline + glyph.y + row + dy, tint)
          }
        }
        pen += glyph.advance + letterSpacing
      }
    }
  }

  if (outline) {
    for (const [dx, dy] of OUTLINE_OFFSETS) paint(outline, dx, dy)
  }
  if (shadow) paint(shadow.color, shadow.offset, shadow.offset)
  paint(fill, 0, 0)

  return { image, padding, lineHeight, supported }
}

export function blockSize(block: TextBlock, scale: number): { width: number; height: number } {
  const k = Math.max(1, Math.floor(scale))
  return { width: block.image.width * k, height: block.image.height * k }
}

export interface TextPlacement {
  x: number
  y: number
  scale: number
  width: number
  height: number
}

const canvasCache = new WeakMap<TextBlock, HTMLCanvasElement>()

function toCanvas(block: TextBlock): HTMLCanvasElement {
  const cached = canvasCache.get(block)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = block.image.width
  canvas.height = block.image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 2D 上下文')
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(block.image.data), block.image.width, block.image.height),
    0,
    0,
  )
  canvasCache.set(block, canvas)
  return canvas
}

/** 纯函数：算出文字块最终落在画布上的位置与尺寸（画布与 SVG 导出共用同一套对位逻辑） */
export function placeTextBlock(
  block: TextBlock,
  target: { x: number; y: number; width: number; height: number },
  scale: number,
  align: 'left' | 'center' = 'center',
  vAlign: 'top' | 'middle' = 'middle',
): TextPlacement {
  const k = Math.max(1, Math.floor(scale))
  const size = blockSize(block, k)
  const x = align === 'center' ? target.x + Math.floor((target.width - size.width) / 2) : target.x
  const y = vAlign === 'middle' ? target.y + Math.floor((target.height - size.height) / 2) : target.y
  return { x, y, scale: k, width: size.width, height: size.height }
}

/** 把文字块以整数倍最近邻放大绘制到目标上下文 */
export function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  block: TextBlock,
  target: { x: number; y: number; width: number; height: number },
  scale: number,
  align: 'left' | 'center' = 'center',
  vAlign: 'top' | 'middle' = 'middle',
): TextPlacement {
  const placement = placeTextBlock(block, target, scale, align, vAlign)
  const { x, y } = placement
  const size = { width: placement.width, height: placement.height }
  const previous = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(
    toCanvas(block),
    0,
    0,
    block.image.width,
    block.image.height,
    x,
    y,
    size.width,
    size.height,
  )
  ctx.imageSmoothingEnabled = previous
  return placement
}

/**
 * 只给网页文字（HTML，不是 canvas）用：等 webfont 就绪。
 * 失败也不影响名牌输出，返回 false 供界面提示。
 */
let webFontPromise: Promise<boolean> | null = null

export function ensureWebFonts(): Promise<boolean> {
  if (webFontPromise) return webFontPromise
  webFontPromise = (async () => {
    if (typeof document === 'undefined' || !document.fonts) return false
    try {
      const webFonts = PIXEL_FONTS.filter((font) => font.hasWebFont)
      await Promise.all(
        webFonts.map((font) =>
          document.fonts.load(`${font.nativeSize}px ${font.cssFamily}`, GLYPH_SAMPLE),
        ),
      )
      await document.fonts.ready
      return webFonts.every((font) =>
        document.fonts.check(`${font.nativeSize}px ${font.cssFamily}`),
      )
    } catch {
      return false
    }
  })()
  return webFontPromise
}

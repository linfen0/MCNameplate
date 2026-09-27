/** 颜色工具：统一使用 #RRGGBB / #RGB / #RRGGBBAA 十六进制字符串作为对外表示 */

export type Rgba = readonly [number, number, number, number]

export const TRANSPARENT: Rgba = [0, 0, 0, 0]

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

export function hexToRgba(hex: string, alpha = 255): [number, number, number, number] {
  const match = HEX_RE.exec(hex.trim())
  if (!match) return [0, 0, 0, alpha]
  let body = match[1]
  if (body.length === 3) {
    body = body
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const r = Number.parseInt(body.slice(0, 2), 16)
  const g = Number.parseInt(body.slice(2, 4), 16)
  const b = Number.parseInt(body.slice(4, 6), 16)
  const a = body.length === 8 ? Number.parseInt(body.slice(6, 8), 16) : alpha
  return [r, g, b, a]
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

export function rgbaToHex(color: Rgba): string {
  const [r, g, b, a] = color
  const base = `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`
  return a >= 255 ? base : `${base}${clamp255(a).toString(16).padStart(2, '0')}`
}

/** 以 0 为中心向黑（amount<0）或向白（amount>0）线性插值，amount ∈ [-1, 1] */
export function shadeHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRgba(hex)
  const t = Math.max(-1, Math.min(1, amount))
  const target = t >= 0 ? 255 : 0
  const k = Math.abs(t)
  return rgbaToHex([r + (target - r) * k, g + (target - g) * k, b + (target - b) * k, 255])
}

/** 相对亮度（WCAG），用于配色提取与文字对比度判定 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgba(hex)
  const lin = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG 对比度（1:1 ~ 21:1） */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function isLightColor(hex: string): boolean {
  return relativeLuminance(hex) > 0.45
}

export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgba(a)
  const cb = hexToRgba(b)
  const k = Math.max(0, Math.min(1, t))
  return rgbaToHex([
    ca[0] + (cb[0] - ca[0]) * k,
    ca[1] + (cb[1] - ca[1]) * k,
    ca[2] + (cb[2] - ca[2]) * k,
    255,
  ])
}

export interface Hsl {
  /** 色相 0-360 */
  h: number
  /** 饱和度 0-1 */
  s: number
  /** 明度 0-1 */
  l: number
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** RGB → HSL（h ∈ [0,360)，s/l ∈ [0,1]） */
export function hexToHsl(hex: string): Hsl {
  const [r255, g255, b255] = hexToRgba(hex)
  const r = r255 / 255
  const g = g255 / 255
  const b = b255 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const delta = max - min
  if (delta === 0) return { h: 0, s: 0, l }
  const s = delta / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = 60 * (((g - b) / delta) % 6)
  else if (max === g) h = 60 * ((b - r) / delta + 2)
  else h = 60 * ((r - g) / delta + 4)
  return { h: (h + 360) % 360, s, l }
}

/** HSL → #RRGGBB */
export function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360
  const sat = clamp01(s)
  const light = clamp01(l)
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = light - c / 2
  const sector = Math.floor(hue / 60) % 6
  const rgb: Array<[number, number, number]> = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ]
  const [r, g, b] = rgb[sector]
  return rgbaToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255, 255])
}

/** 沿色环最短路径把 hue 往 target 旋转 amount（0-1） */
export function rotateHueToward(hue: number, target: number, amount: number): number {
  const from = ((hue % 360) + 360) % 360
  const delta = ((((target - from) % 360) + 540) % 360) - 180
  return (from + delta * clamp01(amount) + 360) % 360
}

export type ToneDirection = 'light' | 'dark'

/** 亮部偏暖、暗部偏冷：像素画的 hue shifting 惯例 */
const WARM_HUE = 45
const COOL_HUE = 220

export interface ToneOptions {
  /** 目标明度（HSL 的 L，0-1） */
  lightness: number
  /** 彩度上限：中性色不是无彩色，而是低彩度、带底色倾向 */
  maxChroma?: number
  /** 色相偏移强度 0-1：亮部往暖色偏、暗部往冷色偏 */
  hueShift?: number
}

/**
 * 生成与源色同族的中性色（tone）：保留色相、压低彩度、把明度推到指定档位。
 *
 * 这是 Material Design 3 tonal palette 的做法 —— 文字用的 on-surface 取 neutral 色阶的
 * tone 90 / tone 10（#E6E0E9 / #1D1B20 这类），而不是 #FFFFFF / #000000；
 * Ant Design 的 rgba(255,255,255,.85) / rgba(0,0,0,.88) 是同一思路的另一种写法。
 * 亮部偏暖、暗部偏冷则是像素画里 hue shifting 的惯例，避免画面变成"灰糊糊"。
 */
export function toneOf(source: string, direction: ToneDirection, options: ToneOptions): string {
  const { h, s } = hexToHsl(source)
  const hue = rotateHueToward(h, direction === 'light' ? WARM_HUE : COOL_HUE, options.hueShift ?? 0)
  return hslToHex({
    h: hue,
    s: Math.min(s, options.maxChroma ?? 0.12),
    l: options.lightness,
  })
}

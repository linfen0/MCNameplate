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

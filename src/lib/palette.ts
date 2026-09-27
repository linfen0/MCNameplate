/**
 * 从任意方块贴图里程序化提取配色，并推导出一整套名牌主题。
 *
 * 用途：用户可以直接拖入 Minecraft 原版或 Mod 的方块贴图（16×16 或任意尺寸），
 * 由程序算出底色、明暗、强调色、文字色，而不是只能在几个写死的主题里选。
 *
 * 纯函数，不依赖 DOM，可直接单测。
 */

import { hexToRgba, relativeLuminance, rgbaToHex, shadeHex } from './color'
import type { RgbaImage } from './types'
import type { Palette, PanelTexture } from './textures'
import type { Theme, ThemeColorSet } from './themes'

export interface ExtractedPalette {
  /** 占比最高的主色 */
  base: string
  /** 偏亮色（按亮度 85 分位） */
  light: string
  /** 偏暗色（按亮度 15 分位） */
  dark: string
  /** 最饱和的颜色，用作强调 / 辅助线 */
  accent: string
  /** 平均色 */
  average: string
  /** 平均相对亮度 0-1 */
  luminance: number
  /** 按占比排序的主色（界面展示用） */
  dominant: string[]
}

interface Sample {
  r: number
  g: number
  b: number
  count: number
  luminance: number
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

/**
 * 提取配色。
 * 思路：4bit/通道量化统计主色 + 按亮度分位取明暗 + 按饱和度挑强调色，
 * 比单纯取平均色稳定得多（平均会把对比强烈的像素糊成一片灰）。
 */
export function extractPalette(image: RgbaImage): ExtractedPalette {
  const buckets = new Map<number, Sample>()
  let total = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0
  const luminances: Array<{ luminance: number; r: number; g: number; b: number }> = []

  for (let i = 0; i < image.data.length; i += 4) {
    const a = image.data[i + 3]
    if (a < 32) continue
    const r = image.data[i]
    const g = image.data[i + 1]
    const b = image.data[i + 2]
    total++
    sumR += r
    sumG += g
    sumB += b
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const existing = buckets.get(key)
    if (existing) {
      existing.count++
      existing.r += r
      existing.g += g
      existing.b += b
    } else {
      const luminance = relativeLuminance(rgbaToHex([r, g, b, 255]))
      buckets.set(key, { r, g, b, count: 1, luminance })
    }
    luminances.push({
      luminance: relativeLuminance(rgbaToHex([r, g, b, 255])),
      r,
      g,
      b,
    })
  }

  if (total === 0) {
    return {
      base: '#808080',
      light: '#a0a0a0',
      dark: '#5a5a5a',
      accent: '#c0c0c0',
      average: '#808080',
      luminance: 0.25,
      dominant: ['#808080'],
    }
  }

  const samples = [...buckets.values()]
    .map((sample) => ({
      r: sample.r / sample.count,
      g: sample.g / sample.count,
      b: sample.b / sample.count,
      count: sample.count,
      luminance: sample.luminance,
    }))
    .sort((a, b) => b.count - a.count)

  const base = rgbaToHex([clamp255(samples[0].r), clamp255(samples[0].g), clamp255(samples[0].b), 255])

  luminances.sort((a, b) => a.luminance - b.luminance)
  const pick = (ratio: number) => {
    const item = luminances[Math.min(luminances.length - 1, Math.floor(luminances.length * ratio))]
    return rgbaToHex([item.r, item.g, item.b, 255])
  }

  // 明暗优先从“有足够占比的主色簇”里挑最亮/最暗：
  // 直接用亮度分位会被贴图的色彩分布带偏（例如 80% 是中间调时 85 分位仍然是中间调）
  const significant = samples
    .slice(0, 12)
    .filter((sample) => sample.count >= total * 0.05)
    .sort((a, b) => a.luminance - b.luminance)
  const toHex = (sample: { r: number; g: number; b: number }) =>
    rgbaToHex([clamp255(sample.r), clamp255(sample.g), clamp255(sample.b), 255])
  const dark = significant.length > 0 ? toHex(significant[0]) : pick(0.15)
  const light = significant.length > 0 ? toHex(significant[significant.length - 1]) : pick(0.85)

  const saturation = (sample: { r: number; g: number; b: number }): number => {
    const max = Math.max(sample.r, sample.g, sample.b)
    const min = Math.min(sample.r, sample.g, sample.b)
    return max === 0 ? 0 : (max - min) / max
  }
  const accentSample = samples
    .slice(0, Math.min(12, samples.length))
    .sort((a, b) => saturation(b) * Math.sqrt(b.count) - saturation(a) * Math.sqrt(a.count))[0]

  const average = rgbaToHex([clamp255(sumR / total), clamp255(sumG / total), clamp255(sumB / total), 255])

  return {
    base,
    light,
    dark,
    accent: saturation(accentSample) > 0.08
      ? rgbaToHex([clamp255(accentSample.r), clamp255(accentSample.g), clamp255(accentSample.b), 255])
      : pick(0.92),
    average,
    luminance: relativeLuminance(average),
    dominant: samples.slice(0, 6).map((sample) =>
      rgbaToHex([clamp255(sample.r), clamp255(sample.g), clamp255(sample.b), 255]),
    ),
  }
}

export interface TextureThemeOptions {
  /** 主题名（界面展示） */
  name?: string
  /** 主题描述（界面展示） */
  description?: string
}

/**
 * 由贴图**提取配色**并生成主题。
 *
 * 注意：贴图只作为“取色源”，底纹是用提取出的 base/light/dark 现场程序化生成的颗粒面，
 * **不会**把贴图本身平铺上去——平铺会让画面变成一块重复的花布，也压不住文字。
 */
export function buildThemeFromTexture(image: RgbaImage, options: TextureThemeOptions = {}): Theme {
  const palette = extractPalette(image)
  const lightBackground = palette.luminance > 0.32

  // 底色偏亮时用深色字 + 浅色描边，反之亦然
  const textFill = lightBackground ? '#1b1b1b' : '#ffffff'
  const textShadow = lightBackground
    ? lighten(palette.light, 0.55)
    : darken(palette.dark, 0.55)

  const frame: ThemeColorSet = {
    fill: darken(palette.dark, 0.62),
    light: lighten(palette.light, 0.28),
    dark: darken(palette.dark, 0.72),
  }
  const slot: ThemeColorSet = {
    fill: darken(palette.base, 0.5),
    light: darken(palette.base, 0.34),
    dark: darken(palette.base, 0.72),
  }

  // 用提取出的三层色生成颗粒底纹（与内置主题同一套生成器），而不是平铺原贴图
  const texture: PanelTexture = {
    kind: 'noise',
    palette: { base: palette.base, light: palette.light, dark: palette.dark },
  }

  return {
    id: 'custom',
    name: options.name ?? '自定义纹理',
    description:
      options.description ?? `由「${options.name ?? '自定义纹理'}」提取：主色 ${palette.base}`,
    swatch: [palette.base, palette.light, palette.dark, palette.accent],
    texture,
    slot,
    frame,
    text: { fill: textFill, shadow: textShadow },
    divider: frame.dark,
    guide: hasContrast(palette.accent, palette.base) ? palette.accent : '#ff4fd8',
    textured: true,
    palette,
  }
}

function hasContrast(color: string, background: string): boolean {
  return Math.abs(relativeLuminance(color) - relativeLuminance(background)) > 0.18
}

function lighten(color: string, amount: number): string {
  return shadeHex(color, Math.abs(amount))
}

function darken(color: string, amount: number): string {
  return shadeHex(color, -Math.abs(amount))
}

/** 用提取出的主色生成一个紧凑的“配色条”，供界面展示 */
export function paletteToCssGradient(palette: ExtractedPalette): string {
  const colors = palette.dominant.length > 0 ? palette.dominant : [palette.base]
  const step = 100 / colors.length
  const stops = colors.map((color, index) => `${color} ${index * step}% ${(index + 1) * step}%`)
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

export type { Palette }
export { hexToRgba }

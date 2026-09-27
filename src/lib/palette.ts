/**
 * 从任意方块贴图里程序化提取配色，并推导出一整套名牌主题。
 *
 * 用途：用户可以直接拖入 Minecraft 原版或 Mod 的方块贴图（16×16 或任意尺寸），
 * 由程序算出底色、明暗、强调色、文字色，而不是只能在几个写死的主题里选。
 *
 * 纯函数，不依赖 DOM，可直接单测。
 */

import {
  contrastRatio,
  hexToHsl,
  hexToRgba,
  mixHex,
  relativeLuminance,
  rgbaToHex,
  shadeHex,
  toneOf,
  type ToneDirection,
} from './color'
import type { RgbaImage } from './types'
import type { Palette, PanelTexture } from './textures'
import type { Theme, ThemeColorSet } from './themes'

/** WCAG AA 对正文文字的最低对比度 */
export const MIN_TEXT_CONTRAST = 4.5

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

export type TextureFillMode = 'nine-slice' | 'stretch' | 'tile' | 'palette'

export interface TextureThemeOptions {
  /** 底纹怎么用这张贴图：直接拉伸 / 平铺 / 只取配色 */
  fillMode?: TextureFillMode
  /** 平铺模式下每个纹理像素占几格 */
  texelScale?: number
  /** 九宫格模式的边框像素数（默认按贴图尺寸的 1/8 估一个） */
  slice?: number
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

  // 文字色优先从“提取出的色卡”里挑对比度最高的那张；对比度不够时才退回纯黑/纯白。
  // 这样名牌的每个组件（底纹、外框、凹槽、文字）都来自同一张色卡。
  // 文字与描边都严格取自这张色卡（不引入卡外颜色）
  const swatches = uniq([palette.light, palette.accent, palette.dark, palette.base])
  const textFill = pickTextColor(palette.base, swatches, lightBackground)
  const textShadow = pickShadowColor(textFill, swatches)

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

  // 底纹怎么来由用户选：
  //   stretch —— 整张贴图拉伸铺满（默认，直接沿用用户纹理，不重复）
  //   tile    —— 按方块尺寸平铺成方块墙
  //   palette —— 只取配色，用主色派生一块平静的程序化表面
  //     （注意：不要拿提取出的亮/暗色卡当噪声三色，深底 + 金色点缀的机器贴图会撒满金点）
  const mode: TextureFillMode = options.fillMode ?? 'nine-slice'
  const texture: PanelTexture =
    mode === 'palette'
      ? {
          kind: 'noise',
          palette: {
            base: palette.base,
            light: shadeHex(palette.base, 0.1),
            dark: shadeHex(palette.base, -0.14),
          },
        }
      : {
          kind: 'image',
          image,
          mode,
          texelScale: Math.max(1, Math.round(options.texelScale ?? 1)),
          // 方块贴图通常有一圈 1-2px 的边框；默认按尺寸的 1/8 估，用户可再调
          slice: Math.max(0, Math.round(options.slice ?? Math.floor(Math.min(image.width, image.height) / 8))),
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
    // 贴图铺满整块名牌时，边框由贴图自带（九宫格正是为此而生）
    borderFromTexture: mode === 'nine-slice' || mode === 'stretch',
  }
}

function uniq(colors: string[]): string[] {
  return [...new Set(colors)]
}

/**
 * 描边色也只在色卡里挑：取与文字色对比度最高的一张（至少要能看出投影）。
 * 不再用 shadeHex 现场推导颜色，保证名牌上出现的颜色全部来自用户贴图。
 */
/** 文字色候选：记录它离“用户色卡”有多远，越远越不优先（distance 0 = 就是色卡本身） */
export interface TextCandidate {
  color: string
  /** 0 = 色卡原色，越大表示被改动得越多（提亮/压暗的档位） */
  distance: number
}

/** 中性色的彩度上限：保留底色的色相倾向，又不跟底纹抢戏 */
export const NEUTRAL_MAX_CHROMA = 0.12

/**
 * 「够用就停」的对比度目标：WCAG AAA。
 * 超过这个值不再加分 —— 否则排序会把文字一路推向纯白/纯黑
 * （深底上的纯白会炫光发毛，浅底上的纯黑会像挖了个洞）。
 */
export const TEXT_CONTRAST_TARGET = 7

/** 最柔和的一档中性色（对应 M3 的 neutral tone 90 / tone 10） */
const SOFT_TONE: Record<ToneDirection, number> = { light: 0.94, dark: 0.1 }

/** AA 兜底档位：只有柔和档仍达不到 4.5:1 时才继续往两端推 */
const RESCUE_TONES: Record<ToneDirection, number[]> = { light: [0.98], dark: [0.06, 0.03] }

/** 中性色的色相偏移强度：亮部偏暖、暗部偏冷 */
const TONE_HUE_SHIFT = 0.22

/** 彩度最高的那张色卡：用来给中性色“定调”（保持和底色同一族） */
function tintSource(swatches: string[]): string {
  if (swatches.length === 0) return '#808080'
  return swatches.reduce((best, color) => (hexToHsl(color).s > hexToHsl(best).s ? color : best))
}

function neutralTone(source: string, direction: ToneDirection, lightness: number): string {
  return toneOf(source, direction, {
    lightness,
    maxChroma: NEUTRAL_MAX_CHROMA,
    hueShift: TONE_HUE_SHIFT,
  })
}

/**
 * 生成文字候选色。分四档，越往后改动越大：
 *   0   用户色卡原色（最优先，完整保留贴图色相）
 *   1-2 往“同族中性色”推 40% / 75%：提亮或压暗，目标是带底色的近似色，而不是纯白纯黑
 *   3   同族中性色本身：色相来自底色、彩度压低、明度取柔和档（M3 的 on-surface 做法）
 *   4   AA 兜底档：柔和档在中灰底上不够用时，才继续往两端推
 *
 * “先提亮文字、最后才动底”的取舍不变，但画面里不会再出现 #FFFFFF / #000000。
 */
export function buildTextCandidates(swatches: string[], lightBackground: boolean): TextCandidate[] {
  // 底亮 → 文字往暗处走；底暗 → 文字往亮处走（M3 里 on-surface 的极性）
  const primary: ToneDirection = lightBackground ? 'dark' : 'light'
  const secondary: ToneDirection = lightBackground ? 'light' : 'dark'
  const source = tintSource(swatches)
  const candidates: TextCandidate[] = []
  for (const color of swatches) {
    const soft = neutralTone(color, primary, SOFT_TONE[primary])
    candidates.push({ color, distance: 0 })
    candidates.push({ color: mixHex(color, soft, 0.4), distance: 1 })
    candidates.push({ color: mixHex(color, soft, 0.75), distance: 2 })
  }
  // 两个极性都留一张柔和档：中灰底上"往亮推"和"往暗推"谁够用谁上
  for (const direction of [primary, secondary]) {
    candidates.push({ color: neutralTone(source, direction, SOFT_TONE[direction]), distance: 3 })
    for (const lightness of RESCUE_TONES[direction]) {
      candidates.push({ color: neutralTone(source, direction, lightness), distance: 4 })
    }
  }
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.color)) return false
    seen.add(candidate.color)
    return true
  })
}

function contrastWithLuminance(color: string, luminance: number): number {
  const l = relativeLuminance(color)
  return (Math.max(l, luminance) + 0.05) / (Math.min(l, luminance) + 0.05)
}

/** 达到 AAA 之后不再奖励更高对比度：避免“越白越安全”把画面推向炫光 */
function clarity(contrast: number): number {
  return Math.min(contrast, TEXT_CONTRAST_TARGET)
}

export interface TextChoice {
  color: string
  contrast: number
  distance: number
  meetsStandard: boolean
}

/**
 * 从候选里挑文字色：
 *   1. 先要“最坏情况下”对比度达标（亮部和暗部都要过关，因为底纹是花的）；
 *   2. 达标者里挑改动最小的一档（distance 最小）；
 *   3. 同一档里挑最接近 AAA 的那张 —— 够读就停，不追求 21:1 的炫光；
 *   4. 都不达标就返回对比度最高的那张，交给上层决定要不要垫一层同色系柔化底。
 */
export function chooseTextColor(
  candidates: TextCandidate[],
  range: { low: number; high: number },
  minContrast: number,
): TextChoice {
  const scored = candidates.map((candidate) => ({
    ...candidate,
    contrast: Math.min(
      contrastWithLuminance(candidate.color, range.high),
      contrastWithLuminance(candidate.color, range.low),
    ),
  }))
  const passing = scored.filter((item) => item.contrast >= minContrast)
  const best = [...(passing.length > 0 ? passing : scored)].sort((a, b) =>
    passing.length > 0
      ? a.distance - b.distance || clarity(b.contrast) - clarity(a.contrast)
      : b.contrast - a.contrast || a.distance - b.distance,
  )[0]
  return {
    color: best.color,
    contrast: best.contrast,
    distance: best.distance,
    meetsStandard: best.contrast >= minContrast,
  }
}

export function pickShadowColor(fill: string, swatches: string[]): string {
  const usable = swatches.filter((color) => color !== fill)
  if (usable.length === 0) return fill
  return usable.sort((a, b) => contrastRatio(b, fill) - contrastRatio(a, fill))[0]
}

/**
 * 主题级文字色（没有画布可以采样时用）：把色卡交给同一套候选逻辑在单色底上挑一张。
 * 色卡够用就用色卡，不够用才退到“同族中性色”—— 依旧不出纯白/纯黑。
 */
export function pickTextColor(
  background: string,
  swatches: string[],
  lightBackground: boolean,
): string {
  const luminance = relativeLuminance(background)
  return chooseTextColor(
    buildTextCandidates(swatches, lightBackground),
    { low: luminance, high: luminance },
    MIN_TEXT_CONTRAST,
  ).color
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

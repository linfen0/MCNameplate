/**
 * 文字底衬（scrim / text protection）。
 *
 * 什么时候用：底纹太花 —— 字后面同时有很亮和很暗的像素，任何单一文字色都满足不了 WCAG AA。
 * 业界做法不是把文字硬推到纯白/纯黑，而是在文字后面垫一层柔化层：
 *   - Material Design 的 scrim、iOS 的 vibrancy、Google Maps 的 text protection scrim；
 *   - 垫层颜色取**底色自己的**暗部 / 亮部（同族色），看起来像材质本身加深，
 *     而不是在别人的贴图上贴一块黑补丁；
 *   - 顺着底色的主调走（暗底再压暗、亮底再提亮），不做色彩反转。
 *
 * 这里一律**整块均匀铺**、不做点阵：点阵只盖住一半像素，文字落在没盖住的那半上时
 * 对比度会悄悄失效，WCAG 就只是“纸面达标”。用户手动打开的那层压暗底是装饰性的，
 * 保留 1 像素棋盘格（像素画的 dither 惯例），由这里的自适应垫层负责兜底。
 *
 * 纯函数，不依赖 DOM，可直接单测。
 */

import { contrastRatio, mixHex, relativeLuminance, toneOf, type ToneDirection } from './color'
import type { TextCandidate } from './palette'
import type { Theme } from './themes'

/** 垫层明度：暗底再压暗、亮底再提亮 */
const SCRIM_LIGHTNESS: Record<ToneDirection, number> = { dark: 0.08, light: 0.95 }

/** 垫层彩度上限：比文字中性色略高一点，让“材质本身变深/变浅”的感觉成立 */
const SCRIM_MAX_CHROMA = 0.16

const SCRIM_HUE_SHIFT = 0.22

/**
 * 强度阶梯：从最轻开始试，够用就停。
 * 最高只到 0.86 —— 再往上就等于把用户贴图整块盖掉了，
 * 那时候宁可退到「同族暗色文字」（见 textPlan），也不会用一块实心板糊住底纹。
 */
const SCRIM_ALPHAS = [0.3, 0.44, 0.58, 0.72, 0.86]

/** 用户手动打开的“压暗底”（装饰性棋盘格）默认强度与覆盖率 */
export const BACKDROP_ALPHA = 0.42
export const BACKDROP_COVERAGE = 0.5

/** 底色偏亮还是偏暗：决定垫层顺着哪一端走 */
export function scrimDirection(base: string): ToneDirection {
  return relativeLuminance(base) > 0.35 ? 'light' : 'dark'
}

/** 垫层颜色：取自底色本身的同族中性色，而不是纯黑 / 纯白 */
export function scrimTone(tint: string, direction: ToneDirection): string {
  return toneOf(tint, direction, {
    lightness: SCRIM_LIGHTNESS[direction],
    maxChroma: SCRIM_MAX_CHROMA,
    hueShift: SCRIM_HUE_SHIFT,
  })
}

/** 主题用哪张色卡给垫层“定调” */
export function scrimTintOf(theme: Theme): string {
  return theme.palette?.base ?? theme.swatch[0] ?? theme.text.fill
}

/** 文字区背后的实采结果 */
export interface BackgroundSample {
  /** 采样到的最暗像素（#RRGGBB） */
  dark: string
  /** 采样到的最亮像素（#RRGGBB） */
  light: string
  /** 均值偏亮（决定文字极性） */
  lightBackground: boolean
}

export interface ScrimPlan {
  /** 垫层颜色（底色同族中性色） */
  color: string
  direction: ToneDirection
  /** 整块铺的强度 0-1 */
  alpha: number
  /** 垫层之后最坏情况下的对比度 */
  contrast: number
  /** 垫层之后应当使用的文字色 */
  text: string
  /** 该文字色离用户色卡有多远 */
  textDistance: number
  /** 垫层之后是否真的达标（不达标就如实报告，不假装） */
  meetsStandard: boolean
}

export interface ScrimInput {
  /** 定调用色（自定义主题取贴图主色，内置主题取色板第一张） */
  tint: string
  background: BackgroundSample
  /** 与文字色共用同一份候选，保证垫层之后仍优先用色卡里的颜色 */
  candidates: TextCandidate[]
  minContrast: number
  /** 允许的最重强度：先用轻的试，轻的救不了就交给上层换别的办法（默认 0.86） */
  maxAlpha?: number
  /**
   * 垫层方向。默认顺着底纹主调（暗底更暗、亮底更亮）；
   * 但"给亮字垫底"必须用**暗**垫层 —— 亮垫层只会让亮字更读不清。
   */
  direction?: ToneDirection
}

/**
 * 文字色在"垫过底"的背景上最坏情况的对比度。
 * 叠加在 sRGB 空间做（与 canvas 的 globalAlpha 一致，不做线性化）。
 */
function worstContrast(color: string, background: BackgroundSample, scrim: string, alpha: number): number {
  return Math.min(
    contrastRatio(color, mixHex(background.dark, scrim, alpha)),
    contrastRatio(color, mixHex(background.light, scrim, alpha)),
  )
}

/**
 * 挑一层“够用就停”的柔化底。
 *
 * 打分顺序是**先看文字色改动了多少，再看垫层多重**：
 * 宁可把垫层垫到 44%，也不把文字一路推成"接近白的灰"——
 * 用户看到的应该是自己材质的颜色（色卡附近那几档），而不是一块白。
 */
export function chooseScrim(input: ScrimInput): ScrimPlan {
  const { tint, background, minContrast, maxAlpha = 0.86 } = input
  const direction: ToneDirection = input.direction ?? (background.lightBackground ? 'light' : 'dark')
  const color = scrimTone(tint, direction)
  const alphas = SCRIM_ALPHAS.filter((step) => step <= maxAlpha)
  const ordered = [...input.candidates].sort(
    (a, b) => a.distance - b.distance || relativeLuminance(b.color) - relativeLuminance(a.color),
  )
  let best: ScrimPlan | null = null
  for (const candidate of ordered) {
    for (const alpha of alphas) {
      const contrast = worstContrast(candidate.color, background, color, alpha)
      const plan: ScrimPlan = {
        color,
        direction,
        alpha,
        contrast,
        text: candidate.color,
        textDistance: candidate.distance,
        meetsStandard: contrast >= minContrast,
      }
      if (plan.meetsStandard) return plan
      if (!best || plan.contrast > best.contrast) best = plan
    }
  }
  // 最重的一档也救不回来：如实返回（上层会改用同族暗色文字）
  return best as ScrimPlan
}
/** sRGB 空间按 alpha 叠加（与 canvas 的 globalAlpha 行为一致，不做线性化） */
function over(background: string, color: string, alpha: number): number {
  return relativeLuminance(mixHex(background, color, alpha))
}

/**
 * 挑一层“够用就停”的柔化底：从最轻的强度往上试，只要最坏情况（最暗 / 最亮像素）
 * 下的文字对比度达标就停 —— 尽量少盖住用户贴图。
 */

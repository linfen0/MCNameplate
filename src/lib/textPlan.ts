/**
 * 文字配色的最终方案：**亮字优先 → 同族投影 → （可选）同族描边 → 同色系柔化底**。
 *
 * 画布渲染、SVG / 3D 导出都走这一份，保证三处颜色一模一样。
 * 纯函数，不依赖 DOM，可直接单测。
 */

import { relativeLuminance } from './color'
import { chooseTextColor, MIN_TEXT_CONTRAST, sideCandidates } from './palette'
import { chooseHalo, chooseShadowColor } from './textColor'
import { chooseScrim, type BackgroundSample, type ScrimPlan } from './scrim'

export { MIN_TEXT_CONTRAST }

/**
 * WCAG 1.4.3 的**大字**阈值：正文 4.5:1，≥24px（或 ≥18.66px 粗体）的字 3:1。
 * 名牌 ID 的墨迹高在所有档位下都远超 24px（256px 高的名牌就有 ~98px），
 * 所以按大字标准判定 —— 这不是放水，是标准本来就为大字准备的另一档。
 */
export const LARGE_TEXT_PX = 24
export const LARGE_TEXT_CONTRAST = 3

/** 先用多轻的柔化底试：再重就宁可换成同族暗色文字，也别把底纹糊住 */
export const LIGHT_SCRIM_MAX = 0.58

/** 达标走的哪条路，界面据此解释 */
export type TextRoute = 'palette' | 'halo' | 'scrim' | 'dark'

export interface TextStyle {
  /** 文字色 */
  fill: string
  /** 同族描边色（可选路线）；null 表示没描边 */
  outline: string | null
  /** 同族投影色；null 表示这段文字不投影（用户关了阴影或用了描边） */
  shadow: string | null
  /** 文字与紧挨着它的那一层（描边，或直接就是底纹）的对比度 */
  contrast: number
  /** 本次采用的 WCAG 阈值（大字 3:1 / 正文 4.5:1） */
  threshold: number
  /** 是否按大字判定 */
  largeText: boolean
  /** 有描边时：描边相对最不利底纹的对比度（需要 ≥ 3） */
  outlineContrast: number | null
  /** 文字色离用户色卡有多远（0 = 色卡原色） */
  distance: number
  /** 为达标额外垫的同色系柔化底（最后手段） */
  scrim: ScrimPlan | null
  route: TextRoute
}

export interface TextPlanInput {
  /** 用户色卡（自定义贴图主题为提取结果，内置主题为主题文字色） */
  swatches: string[]
  background: BackgroundSample
  /** 柔化底的定调色 */
  tint: string
  /** 用户是否选择「同族描边」；默认 false —— 优先 Minecraft 式的投影 */
  outline?: boolean
  /** 文字墨迹高度（画布像素），用来判定大字阈值；不传按大字处理 */
  textHeightPx?: number
  minContrast?: number
}

/**
 * 决定文字怎么画：
 *   1. 亮字直接压在底纹上就达标（深色底纹走这条）→ 最干净，配 1 像素同族投影；
 *   2. 用户开了「同族描边」→ 亮字 + 描边，底纹一点不动；
 *   3. 浅色 / 花底纹 → 亮字 + 同族投影，再垫**最小强度**的同色系柔化底补足阈值；
 *   4. 连柔化底都救不回来（几乎不会发生）→ 退到同族暗色文字 + 亮投影，同样不动底纹。
 * 全程不会出现纯白 / 纯黑，也不会为了达标把 ID 推成近黑。
 */
export function planText(input: TextPlanInput): TextStyle {
  const { swatches, background, tint } = input
  const largeText = (input.textHeightPx ?? Number.POSITIVE_INFINITY) >= LARGE_TEXT_PX
  const threshold = input.minContrast ?? (largeText ? LARGE_TEXT_CONTRAST : MIN_TEXT_CONTRAST)
  const range = { low: relativeLuminance(background.dark), high: relativeLuminance(background.light) }
  const bright = sideCandidates(swatches, 'light')
  const dark = sideCandidates(swatches, 'dark')
  // 投影取"反侧"：文字比底纹亮 → 用暗侧；文字比底纹暗（白纸底那种）→ 用亮侧
  const midLuminance = (range.low + range.high) / 2
  const shadowFor = (fill: string) => {
    const fillLum = relativeLuminance(fill)
    const [first, second] = fillLum > midLuminance ? [dark, bright] : [bright, dark]
    return chooseShadowColor(fill, first)?.color ?? chooseShadowColor(fill, second)?.color ?? null
  }

  const direct = chooseTextColor(bright, range, threshold)
  if (direct.meetsStandard) {
    return {
      fill: direct.color,
      outline: null,
      shadow: shadowFor(direct.color),
      contrast: direct.contrast,
      threshold,
      largeText,
      outlineContrast: null,
      distance: direct.distance,
      scrim: null,
      route: 'palette',
    }
  }

  if (input.outline) {
    const halo = chooseHalo({ fills: bright, halos: dark, range, minContrast: threshold })
    if (halo) {
      return {
        fill: halo.fill,
        outline: halo.outline,
        shadow: null,
        contrast: halo.contrast,
        threshold,
        largeText,
        outlineContrast: halo.plateContrast,
        distance: halo.fillDistance,
        scrim: null,
        route: 'halo',
      }
    }
  }

  // 3) 亮字 + 同族投影，再用**最轻**的一档同色系柔化底把阈值补上（仍然保持亮字）
  const lightScrim = chooseScrim({ tint, background, candidates: bright, minContrast: threshold, maxAlpha: LIGHT_SCRIM_MAX })
  if (lightScrim.meetsStandard) {
    return {
      fill: lightScrim.text,
      outline: null,
      shadow: shadowFor(lightScrim.text),
      contrast: lightScrim.contrast,
      threshold,
      largeText,
      outlineContrast: null,
      distance: lightScrim.textDistance,
      scrim: lightScrim,
      route: 'scrim',
    }
  }

  // 4) 底纹太浅（白纸一样）：这时候同族暗色文字 + 亮投影才是正解，而且底纹一点不用动
  const darkText = chooseTextColor(dark, range, threshold)
  if (darkText.meetsStandard) {
    return {
      fill: darkText.color,
      outline: null,
      shadow: shadowFor(darkText.color),
      contrast: darkText.contrast,
      threshold,
      largeText,
      outlineContrast: null,
      distance: darkText.distance,
      scrim: null,
      route: 'dark',
    }
  }

  // 5) 两样都不行：宁可垫重一点，也不把 ID 压成读不清的颜色
  const heavyScrim = chooseScrim({ tint, background, candidates: bright, minContrast: threshold })
  if (heavyScrim.meetsStandard) {
    return {
      fill: heavyScrim.text,
      outline: null,
      shadow: shadowFor(heavyScrim.text),
      contrast: heavyScrim.contrast,
      threshold,
      largeText,
      outlineContrast: null,
      distance: heavyScrim.textDistance,
      scrim: heavyScrim,
      route: 'scrim',
    }
  }

  // 6) 如实报告：选一条对比度最高的组合，不假装达标
  const best = darkText.contrast >= lightScrim.contrast ? darkText : lightScrim
  return {
    fill: best.color,
    outline: null,
    shadow: shadowFor(best.color),
    contrast: best.contrast,
    threshold,
    largeText,
    outlineContrast: null,
    distance: 'distance' in best ? best.distance : best.textDistance,
    scrim: null,
    route: 'dark',
  }
}

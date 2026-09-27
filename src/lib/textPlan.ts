/**
 * 文字配色的最终方案：**亮字优先 → 不够就加同族描边 → 最后才垫柔化底**。
 *
 * 画布渲染、SVG / 3D 导出都走这一份，保证三处颜色一模一样。
 * 纯函数，不依赖 DOM，可直接单测。
 */

import { relativeLuminance } from './color'
import {
  buildTextCandidates,
  chooseTextColor,
  MIN_TEXT_CONTRAST,
  sideCandidates,
} from './palette'
import { chooseHalo } from './textColor'
import { chooseScrim, type BackgroundSample, type ScrimPlan } from './scrim'

export { MIN_TEXT_CONTRAST }

/** 达标走的哪条路，界面据此解释 */
export type TextRoute = 'palette' | 'halo' | 'scrim'

export interface TextStyle {
  /** 文字色 */
  fill: string
  /** 描边色；null 表示不需要描边 */
  outline: string | null
  /** 文字与紧挨着它的那一层（描边，或直接就是底纹）的对比度 */
  contrast: number
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
  minContrast?: number
}

/**
 * 决定文字怎么画：
 *   1. 亮字直接压在底纹上就达标（深色底纹走这条）→ 最干净；
 *   2. 浅色 / 花底纹 → 亮字 + 同族描边，底纹一点不动；
 *   3. 同时有很亮和很暗像素的花底 → 最后才垫一层同色系柔化底。
 * 全程不会出现纯白 / 纯黑，也不会为了达标把 ID 压黑。
 */
export function planText(input: TextPlanInput): TextStyle {
  const { swatches, background, tint } = input
  const minContrast = input.minContrast ?? MIN_TEXT_CONTRAST
  const range = { low: relativeLuminance(background.dark), high: relativeLuminance(background.light) }

  const bright = chooseTextColor(sideCandidates(swatches, 'light'), range, minContrast)
  if (bright.meetsStandard) {
    return {
      fill: bright.color,
      outline: null,
      contrast: bright.contrast,
      outlineContrast: null,
      distance: bright.distance,
      scrim: null,
      route: 'palette',
    }
  }

  const halo = chooseHalo({
    fills: sideCandidates(swatches, 'light'),
    halos: sideCandidates(swatches, 'dark'),
    range,
    minContrast,
  })
  if (halo) {
    return {
      fill: halo.fill,
      outline: halo.outline,
      contrast: halo.contrast,
      outlineContrast: halo.plateContrast,
      distance: halo.fillDistance,
      scrim: null,
      route: 'halo',
    }
  }

  const scrim = chooseScrim({
    tint,
    background,
    candidates: buildTextCandidates(swatches, false),
    minContrast,
  })
  return {
    fill: scrim.text,
    outline: null,
    contrast: scrim.contrast,
    outlineContrast: null,
    distance: scrim.textDistance,
    scrim,
    route: 'scrim',
  }
}

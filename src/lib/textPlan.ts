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

/** 先用多轻的柔化底试：再重就宁可换成同族暗色文字（不动底纹），也别把底纹糊住 */
export const LIGHT_SCRIM_MAX = 0.58

/**
 * 底纹**所有**采样像素都比这个亮度亮（也就是一块均匀的浅色材质，例如纯白方块）时，
 * 同族暗字天然够对比、零改动、也不用垫底 —— 这时才优先暗字。
 * 注意判据是"最暗的像素也亮"，而不是"最亮的像素很亮"：
 * 浅色花底的最亮像素同样很亮，但它的暗部需要亮字，不能因此把 ID 压黑。
 */
export const LIGHT_SURFACE_LUMINANCE = 0.6

/**
 * 直接压在底纹上的文字，最多允许从色卡偏移几档。
 * 再往上推就会变成"凭空造出来的近白"（用户看到的就是"文字又变纯白了"），
 * 所以宁可让底纹垫一层最轻的同色系柔化底，也要把文字色留在用户的材质里。
 */
export const MAX_DIRECT_DISTANCE = 2


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

  // 只允许"色卡原色 + 两档轻微色偏"参与：再白就不是用户的材质了
  const nearSwatch = bright.filter((candidate) => candidate.distance <= MAX_DIRECT_DISTANCE)
  const direct = chooseTextColor(nearSwatch, range, threshold)
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
    const halo = chooseHalo({ fills: nearSwatch, halos: dark, range, minContrast: threshold })
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

  // 3) 两条"轻干预"的路都算出来，再按底纹亮端的亮度决定谁优先：
  //    · 亮字 + 同族投影 + 最轻的一档同色系柔化底（仍然保持亮字）
  //    · 不动底纹的同族暗字 + 亮投影（底纹本身够亮时，暗字天然够对比）
  const lightScrim = chooseScrim({
    tint,
    background,
    candidates: nearSwatch,
    minContrast: threshold,
    maxAlpha: LIGHT_SCRIM_MAX,
    direction: 'dark',
  })
  const scrimPlan: TextStyle | null = lightScrim.meetsStandard
    ? {
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
    : null

  const darkText = chooseTextColor(
    dark.filter((candidate) => candidate.distance <= MAX_DIRECT_DISTANCE),
    range,
    threshold,
  )
  const darkPlan: TextStyle | null = darkText.meetsStandard
    ? {
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
    : null

  // 均匀浅色材质（最暗的像素也亮）→ 同族暗字零改动，优先它；
  // 其余情况一律优先「亮字 + 最轻的同色系柔化底」，只有它不行才退回暗字。
  const uniformLightSurface = range.low >= LIGHT_SURFACE_LUMINANCE
  const preferred = (uniformLightSurface ? [darkPlan, scrimPlan] : [scrimPlan, darkPlan]).find(
    (plan): plan is TextStyle => plan !== null,
  )
  if (preferred) return preferred

  // 5) 两样都不行：宁可垫重一点，也不把 ID 压成读不清的颜色
  const heavyScrim = chooseScrim({ tint, background, candidates: nearSwatch, minContrast: threshold, direction: 'dark' })
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

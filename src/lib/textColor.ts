/**
 * 文字描边（halo）的取舍。
 *
 * 问题：亮字压在浅色底纹上时（用户上传的浅色方块贴图），要么把文字压暗、要么把底压暗。
 * 业界在游戏 UI / 像素画里的标准解法是第三条路 —— **给亮字加一圈同色系的描边**：
 * 字形紧挨着的是描边而不是花底，局部对比度稳定，底纹一点都没动。
 *
 * WCAG 上也站得住：1.4.3 看的是文字与"紧挨着它的那一层"，所以要求
 *   文字 ↔ 描边 ≥ 4.5:1（正文标准），
 *   描边 ↔ 底纹 ≥ 3:1（1.4.11 非文本对比度，保证轮廓看得见）。
 * 两边都从同一张色卡里取，所以描边不会变成"黑边贴纸"。
 *
 * 纯函数，不依赖 DOM，可直接单测。
 */

import { relativeLuminance } from './color'
import { TEXT_CONTRAST_TARGET, type TextCandidate } from './palette'

/** WCAG 1.4.11 非文本对比度：描边相对底纹至少到这个值才算看得见 */
export const MIN_GRAPHIC_CONTRAST = 3

function ratio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

export interface HaloPlan {
  /** 文字色（亮侧，来自色卡） */
  fill: string
  /** 描边色（暗侧，来自色卡） */
  outline: string
  /** 文字 ↔ 描边 */
  haloContrast: number
  /** 描边 ↔ 底纹最不利的一侧；null 表示这些像素本来就直接读得清 */
  plateContrast: number | null
  /** 最坏像素处真正可读的对比度 */
  contrast: number
  /** 文字色离色卡有多远 */
  fillDistance: number
}

export interface HaloInput {
  /** 亮侧候选（当文字） */
  fills: TextCandidate[]
  /** 暗侧候选（当描边） */
  halos: TextCandidate[]
  /** 采样到的亮 / 暗两端亮度 */
  range: { low: number; high: number }
  minContrast: number
  minGraphicContrast?: number
}

/**
 * 某个底纹像素处“实际能读到的对比度”：
 *   · 文字直接压在底纹上就够 → 用它；
 *   · 不够 → 只有当描边在这个像素上看得见（≥ 3:1）时，才算描边兜住了。
 */
function readable(
  fillLum: number,
  haloLum: number,
  plateLum: number,
  minContrast: number,
  minGraphic: number,
): number {
  const direct = ratio(fillLum, plateLum)
  if (direct >= minContrast) return direct
  if (ratio(haloLum, plateLum) < minGraphic) return direct
  return ratio(fillLum, haloLum)
}

function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i]
  }
  return false
}

/**
 * 在“亮字 + 暗描边”的组合里挑一对：
 *   1. 文字 ↔ 描边必须 ≥ AA；
 *   2. 亮 / 暗两端的底纹像素都要读得清（要么直接够，要么描边看得见）；
 *   3. 达标组合里挑改动最小的（distance 之和最小），再挑描边"够用就停"的那一档
 *      —— 不把描边一路推到最黑，最后比谁和底纹分得更开。
 */
export function chooseHalo(input: HaloInput): HaloPlan | null {
  const { fills, halos, range, minContrast, minGraphicContrast = MIN_GRAPHIC_CONTRAST } = input
  let best: { plan: HaloPlan; score: number[] } | null = null
  for (const fill of fills) {
    const fillLum = relativeLuminance(fill.color)
    for (const halo of halos) {
      if (halo.color === fill.color) continue
      const haloLum = relativeLuminance(halo.color)
      const haloContrast = ratio(fillLum, haloLum)
      if (haloContrast < minContrast) continue
      const needed: number[] = []
      for (const plateLum of [range.low, range.high]) {
        if (ratio(fillLum, plateLum) < minContrast) needed.push(ratio(haloLum, plateLum))
      }
      const contrast = Math.min(
        readable(fillLum, haloLum, range.low, minContrast, minGraphicContrast),
        readable(fillLum, haloLum, range.high, minContrast, minGraphicContrast),
      )
      if (contrast < minContrast) continue
      const plateContrast = needed.length > 0 ? Math.min(...needed) : null
      const plan: HaloPlan = {
        fill: fill.color,
        outline: halo.color,
        haloContrast,
        plateContrast,
        contrast,
        fillDistance: fill.distance,
      }
      const score = [
        fill.distance + halo.distance,
        Math.abs(haloContrast - TEXT_CONTRAST_TARGET),
        -(plateContrast ?? 0),
      ]
      if (!best || better(score, best.score)) best = { plan, score }
    }
  }
  return best ? best.plan : null
}

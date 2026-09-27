/** ID 文本绘制：像素点阵渲染 + 整数倍最近邻放大 */

import {
  blockSize,
  createMeasure,
  drawTextBlock,
  fitTextScale,
  renderTextBlock,
  type PixelFontSpec,
} from '../../../lib/pixelFont'
import type { Theme } from '../../../lib/themes'
import type { NameplateConfig } from '../config'
import { relativeLuminance } from '../../../lib/color'
import type { LayoutPlan } from '../layout'
import { idDisplayText } from '../resolve'

/** WCAG AA 对正文的最低对比度 */
export const MIN_TEXT_CONTRAST = 4.5

interface BackgroundStats {
  /** 采样到的像素亮度区间 */
  low: number
  high: number
  mean: number
  /** 均值偏向亮还是暗，决定压暗还是提亮 */
  light: boolean
}

/** 实地采样文字区背后的像素亮度，而不是只看主题的主色 */
function sampleBackground(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
): BackgroundStats {
  const step = Math.max(1, Math.floor(Math.min(rect.width, rect.height) / 48))
  const data = ctx.getImageData(rect.x, rect.y, rect.width, rect.height).data
  const width = rect.width
  let low = 1
  let high = 0
  let sum = 0
  let count = 0
  for (let y = 0; y < rect.height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      const luminance = relativeLuminance(
        `#${[0, 1, 2].map((c) => data[i + c].toString(16).padStart(2, '0')).join('')}`,
      )
      if (luminance < low) low = luminance
      if (luminance > high) high = luminance
      sum += luminance
      count++
    }
  }
  const mean = count > 0 ? sum / count : 0.1
  return { low, high, mean, light: mean > 0.35 }
}

/** 在候选文字色里挑“最坏情况下对比度最高”的那个 */
function pickReadableFill(
  candidates: string[],
  stats: BackgroundStats,
): { fill: string; contrast: number } {
  let best = { fill: candidates[0] ?? '#ffffff', contrast: 0 }
  for (const color of new Set(candidates)) {
    // 与最不利的局部背景比：亮区用白字会失败、暗区用黑字会失败，取两者较小值
    const againstLight = contrastOf(color, stats.high)
    const againstDark = contrastOf(color, stats.low)
    const worst = Math.min(againstLight, againstDark)
    if (worst > best.contrast) best = { fill: color, contrast: worst }
  }
  return best
}

/** 在文字区上叠一层棋盘格压暗/提亮底，把对比度拉到 WCAG AA */
function drawContrastPlate(
  ctx: CanvasRenderingContext2D,
  plan: LayoutPlan,
  theme: Theme,
  direction: 'dark' | 'light',
  alpha: number,
): void {
  const box = plan.idBox
  const cell = Math.max(1, plan.unit)
  const patternCanvas = document.createElement('canvas')
  patternCanvas.width = cell * 2
  patternCanvas.height = cell * 2
  const patternCtx = patternCanvas.getContext('2d')
  if (!patternCtx) return
  const color =
    direction === 'dark'
      ? `rgba(0, 0, 0, ${alpha})`
      : `rgba(255, 255, 255, ${alpha})`
  patternCtx.fillStyle = color
  patternCtx.fillRect(0, 0, cell, cell)
  patternCtx.fillRect(cell, cell, cell, cell)
  const pattern = ctx.createPattern(patternCanvas, 'repeat')
  if (!pattern) return
  const originX = plan.inner.x + Math.floor((box.x - plan.inner.x) / cell) * cell
  const originY = plan.inner.y + Math.floor((box.y - plan.inner.y) / cell) * cell
  ctx.save()
  ctx.translate(originX, originY)
  ctx.fillStyle = pattern
  ctx.fillRect(0, 0, box.x + box.width - originX, box.y + box.height - originY)
  ctx.restore()
  void theme
}

/** 用亮度值算对比度（避免反复拼 hex） */
function contrastOf(color: string, luminance: number): number {
  const l = relativeLuminance(color)
  return (Math.max(l, luminance) + 0.05) / (Math.min(l, luminance) + 0.05)
}

/**
 * 压暗/提亮后的背景亮度：在 sRGB 空间按 alpha 与底色混合（与 canvas 的绘制一致）。
 * 只需近似，用于决定压暗强度。
 */
function afterBackdrop(luminance: number, backdrop: 'dark' | 'light', alpha: number): number {
  const base = backdrop === 'dark' ? 0 : 1
  const mixed = luminance * (1 - alpha) + base * alpha
  return mixed <= 0.0031308 ? mixed * 12.92 : 1.055 * mixed ** (1 / 2.4) - 0.055
}

export interface IdTextResult {
  /** 实际绘制到名牌上的文字 */
  text: string
  /** 最终放大倍率（1 字体像素 = scale 个画布像素） */
  scale: number
  placeholder: boolean
  /** 实际使用的文字色 */
  fill: string
  /** 实际使用的描边色 */
  shadow: string | null
  /** 实测达到的 WCAG 对比度（1:1 ~ 21:1） */
  contrast: number
  /** 为了达标而额外加的压暗 / 提亮强度，0 表示没加 */
  backdropAlpha: number
}

export function drawIdText(
  ctx: CanvasRenderingContext2D,
  plan: LayoutPlan,
  theme: Theme,
  font: PixelFontSpec,
  config: NameplateConfig,
): IdTextResult {
  const placeholder = config.id.trim().length === 0
  const text = idDisplayText(config)

  // 1) 实地采样文字区背后的像素（而不是只看主题主色）——
  //    文字压在贴图纹理上，局部可能比主色亮/暗得多，导致“纸面达标、画面不达标”
  const stats = sampleBackground(ctx, plan.idBox)

  // 2) 候选文字色：主题给的色 + 色卡里的全部色 + 黑白兜底，取最坏情况下对比度最高的
  const swatches = theme.palette
    ? [theme.palette.base, theme.palette.light, theme.palette.dark, theme.palette.accent]
    : [theme.text.fill]
  const candidates = [theme.text.fill, ...swatches, '#ffffff', '#151515']
  let choice = pickReadableFill(candidates, stats)

  // 3) 还不达 WCAG AA 就先加强压暗/提亮底（用色卡里的暗色或亮色），再复算
  let backdropAlpha = 0
  const direction: 'dark' | 'light' = stats.light ? 'dark' : 'light'
  if (choice.contrast < MIN_TEXT_CONTRAST) {
    for (const alpha of [0.45, 0.62, 0.78]) {
      const low = afterBackdrop(stats.low, direction, alpha)
      const high = afterBackdrop(stats.high, direction, alpha)
      const probe = pickReadableFill(candidates, { ...stats, low, high })
      if (probe.contrast >= MIN_TEXT_CONTRAST) {
        choice = probe
        backdropAlpha = alpha
        break
      }
    }
  }

  // 4) 画这层额外的底（棋盘格，保持像素风）
  if (backdropAlpha > 0) {
    drawContrastPlate(ctx, plan, theme, direction, backdropAlpha)
  }

  const fill = choice.fill
  const shadow = config.shadow && theme.text.shadow && theme.text.shadow !== fill ? theme.text.shadow : null
  const block = renderTextBlock({
    text,
    font,
    fill,
    shadow: shadow ? { color: shadow, offset: 1 } : null,
    opacity: placeholder ? 0.4 : 1,
  })
  const scale = fitTextScale(createMeasure(font), text, {
    maxWidth: plan.idBox.width,
    maxHeight: plan.idBox.height,
    lineHeight: block.lineHeight,
    padding: block.padding,
    maxScale: 256,
  })

  drawTextBlock(ctx, block, plan.idBox, scale, 'center', 'middle')
  return { text, scale, placeholder, fill, shadow, contrast: choice.contrast, backdropAlpha }
}

/** 在指定锚点绘制一小段像素文字（用于辅助线标注），返回实际占位 */
export function drawPixelLabel(
  ctx: CanvasRenderingContext2D,
  font: PixelFontSpec,
  text: string,
  anchor: { x: number; y: number },
  scale: number,
  color: string,
  align: 'left' | 'right' = 'left',
): { x: number; y: number; width: number; height: number } {
  const block = renderTextBlock({ text, font, fill: color })
  const size = blockSize(block, scale)
  const x = align === 'right' ? anchor.x - size.width : anchor.x
  drawTextBlock(
    ctx,
    block,
    { x, y: anchor.y, width: size.width, height: size.height },
    scale,
    'left',
    'top',
  )
  return { x, y: anchor.y, width: size.width, height: size.height }
}

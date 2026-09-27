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
import { buildTextCandidates, chooseTextColor } from '../../../lib/palette'
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

/**
 * 在文字区上叠一层棋盘格压暗/提亮底。
 * 这是**最后手段**：能给文字补光就绝不动用户的贴图。
 */
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
  patternCtx.fillStyle =
    direction === 'dark' ? `rgba(0, 0, 0, ${alpha})` : `rgba(255, 255, 255, ${alpha})`
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

  // 2) 先在“文字这一侧”解决对比度：色卡原色 → 往白/黑推的档位 → 纯白/纯黑。
  //    达标者里挑改动最小的，尽量保留用户贴图的色相。
  const swatches = theme.palette
    ? [theme.palette.light, theme.palette.accent, theme.palette.dark, theme.palette.base]
    : [theme.text.fill]
  const candidates = buildTextCandidates(swatches, stats.light)
  let choice = chooseTextColor(candidates, { low: stats.low, high: stats.high }, MIN_TEXT_CONTRAST)
  let fill = choice.color

  // 3) 只有连纯白/纯黑都够不着 4.5:1（例如中灰底）才动底：
  //    这一步是最后手段，因为它会改动用户贴图的观感。
  let backdropAlpha = 0
  if (!choice.meetsStandard) {
    const direction: 'dark' | 'light' = stats.light ? 'dark' : 'light'
    for (const alpha of [0.45, 0.62, 0.78]) {
      const low = afterBackdrop(stats.low, direction, alpha)
      const high = afterBackdrop(stats.high, direction, alpha)
      const probe = chooseTextColor(candidates, { low, high }, MIN_TEXT_CONTRAST)
      if (probe.meetsStandard) {
        choice = probe
        fill = probe.color
        backdropAlpha = alpha
        break
      }
    }
    // 连纯白/纯黑都够不着（例如中灰底）——最后手段才动底
    const fallbackDirection: 'dark' | 'light' = stats.light ? 'dark' : 'light'
    if (backdropAlpha === 0) backdropAlpha = 0.62
    drawContrastPlate(ctx, plan, theme, fallbackDirection, backdropAlpha)
  }

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

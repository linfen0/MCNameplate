/** ID 文本绘制：像素点阵渲染 + 整数倍最近邻放大 + WCAG 对比度取舍 */

import {
  blockSize,
  drawTextBlock,
  renderTextBlock,
  type PixelFontSpec,
} from '../../../lib/pixelFont'
import type { Theme } from '../../../lib/themes'
import type { NameplateConfig } from '../config'
import { relativeLuminance, rgbaToHex } from '../../../lib/color'
import { planText, type TextStyle } from '../../../lib/textPlan'
import { scrimTintOf, type BackgroundSample, type ScrimPlan } from '../../../lib/scrim'
import { scrimSteps, type LayoutPlan } from '../layout'
import { layoutIdText } from '../textLayout'

export { MIN_TEXT_CONTRAST } from '../../../lib/textPlan'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 实地采样文字背后的像素（而不是只看主题主色）——
 * 文字是压在贴图纹理上的，局部可能比主色亮 / 暗得多，否则会“纸面达标、画面不达标”。
 * 同时记下最暗 / 最亮的**具体颜色**，垫层要按真实颜色做叠加预测。
 */
function sampleBackground(ctx: CanvasRenderingContext2D, rect: Rect): BackgroundSample & { mean: number } {
  const width = Math.max(1, Math.floor(rect.width))
  const height = Math.max(1, Math.floor(rect.height))
  const data = ctx.getImageData(Math.floor(rect.x), Math.floor(rect.y), width, height).data
  const step = Math.max(1, Math.floor(Math.min(width, height) / 48))
  let low = 1
  let high = 0
  let sum = 0
  let count = 0
  let dark = '#000000'
  let light = '#ffffff'
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      const color = rgbaToHex([data[i], data[i + 1], data[i + 2], 255])
      const luminance = relativeLuminance(color)
      if (luminance < low) {
        low = luminance
        dark = color
      }
      if (luminance > high) {
        high = luminance
        light = color
      }
      sum += luminance
      count++
    }
  }
  const mean = count > 0 ? sum / count : 0.1
  return { dark, light, mean, lightBackground: mean > 0.35 }
}

/**
 * 垫一层同色系的柔化底（scrim）：只在“亮字 + 投影都达不到阈值”时才用。
 * 几何来自 layout.scrimSteps —— 画布 / SVG / 3D 三处共用同一份，导出不会走样。
 */
function drawScrim(ctx: CanvasRenderingContext2D, plan: LayoutPlan, scrim: ScrimPlan, text: Rect): void {
  const steps = scrimSteps(plan, text, scrim.alpha)
  if (steps.length === 0) return
  ctx.save()
  ctx.fillStyle = scrim.color
  for (const step of steps) {
    ctx.globalAlpha = step.alpha
    ctx.fillRect(step.rect.x, step.rect.y, step.rect.width, step.rect.height)
  }
  ctx.restore()
}

export interface IdTextResult {
  /** 实际绘制到名牌上的文字（多行用 \n 连接） */
  text: string
  /** 折出来的每一行 */
  lines: string[]
  /** 最终放大倍率（1 字体像素 = scale 个画布像素） */
  scale: number
  placeholder: boolean
  /** 实际使用的描边色；null 表示没描边 */
  shadow: string | null
  /** 完整的文字配色方案（亮字 / 描边 / 柔化底） */
  style: TextStyle
}

export function drawIdText(
  ctx: CanvasRenderingContext2D,
  plan: LayoutPlan,
  theme: Theme,
  font: PixelFontSpec,
  config: NameplateConfig,
): IdTextResult {
  // 1) 先排版：折行 + 缩放（与 SVG / 3D 导出共用同一份，见 textLayout.ts）。
  //    排版只取决于字体 / 文本 / 描边，与颜色无关，所以可以先排好再决定用什么颜色。
  const id = layoutIdText(font, theme, config, plan.idBox)
  const { text, scale, placement } = id

  // 2) 采样文字背后的真实像素
  const background = sampleBackground(ctx, placement)

  // 3) 亮字优先 → 同族投影 →（可选）同族描边 → 同色系柔化底（见 lib/textPlan）
  const swatches = theme.palette
    ? [theme.palette.light, theme.palette.accent, theme.palette.dark, theme.palette.base]
    : [theme.text.fill]
  const style = planText({
    swatches,
    background,
    tint: scrimTintOf(theme),
    outline: config.textOutline,
    textHeightPx: id.lineHeight * scale,
  })
  if (style.scrim) drawScrim(ctx, plan, style.scrim, placement)

  // 有描边时不再叠投影：描边已经给了轮廓，再来个投影只会糊成一团
  const usedShadow =
    !style.outline && config.shadow && style.shadow && style.shadow !== style.fill
      ? { color: style.shadow, offset: 1 }
      : null
  const block = renderTextBlock({
    text,
    font,
    fill: style.fill,
    outline: style.outline,
    shadow: usedShadow,
    opacity: id.placeholder ? 0.4 : 1,
    lineHeight: id.lineHeight,
  })
  drawTextBlock(ctx, block, plan.idBox, scale, 'center', 'middle')
  return {
    text,
    lines: id.lines,
    scale,
    placeholder: id.placeholder,
    shadow: style.outline ?? (usedShadow ? usedShadow.color : null),
    style,
  }
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

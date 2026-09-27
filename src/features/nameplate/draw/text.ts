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
import type { LayoutPlan } from '../layout'
import { idDisplayText } from '../resolve'

export interface IdTextResult {
  /** 实际绘制到名牌上的文字 */
  text: string
  /** 最终放大倍率（1 字体像素 = scale 个画布像素） */
  scale: number
  placeholder: boolean
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

  const block = renderTextBlock({
    text,
    font,
    fill: theme.text.fill,
    shadow:
      config.shadow && theme.text.shadow ? { color: theme.text.shadow, offset: 1 } : null,
    opacity: placeholder ? 0.4 : 1,
  })

  // 行高用字库的真实墨迹高度（不是 em），这样“字高占铭牌高度 1/φ²”才精确
  const scale = fitTextScale(createMeasure(font), text, {
    maxWidth: plan.idBox.width,
    maxHeight: plan.idBox.height,
    lineHeight: block.lineHeight,
    padding: block.padding,
    maxScale: 256,
  })

  drawTextBlock(ctx, block, plan.idBox, scale, 'center', 'middle')
  return { text, scale, placeholder }
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

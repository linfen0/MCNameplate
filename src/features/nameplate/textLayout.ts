/**
 * ID 文字的排版：渲染点阵块 + 计算整数倍率 + 算落点。
 * 画布渲染、SVG 导出、3D 导出共用这一份，保证三处完全一致。
 */

import {
  createMeasure,
  fitTextScale,
  placeTextBlock,
  renderTextBlock,
  type PixelFontSpec,
  type TextBlock,
  type TextPlacement,
} from '../../lib/pixelFont'
import type { Theme } from '../../lib/themes'
import type { Rect } from '../../lib/types'
import type { NameplateConfig } from './config'
import { idDisplayText } from './resolve'

export interface IdTextLayout {
  text: string
  placeholder: boolean
  block: TextBlock
  scale: number
  placement: TextPlacement
}

export function layoutIdText(
  font: PixelFontSpec,
  theme: Theme,
  config: NameplateConfig,
  idBox: Rect,
): IdTextLayout {
  const placeholder = config.id.trim().length === 0
  const text = idDisplayText(config)
  const block = renderTextBlock({
    text,
    font,
    fill: theme.text.fill,
    shadow: config.shadow && theme.text.shadow ? { color: theme.text.shadow, offset: 1 } : null,
    opacity: placeholder ? 0.4 : 1,
  })
  const scale = fitTextScale(createMeasure(font), text, {
    maxWidth: idBox.width,
    maxHeight: idBox.height,
    lineHeight: block.lineHeight,
    padding: block.padding,
    maxScale: 256,
  })
  const placement = placeTextBlock(block, idBox, scale, 'center', 'middle')
  return { text, placeholder, block, scale, placement }
}

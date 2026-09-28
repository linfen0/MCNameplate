/**
 * ID 文字的排版：折行 + 缩放 + 落点。
 * 画布渲染、SVG 导出、3D 导出共用这一份，保证三处完全一致。
 *
 * 比例是固定的标准比，文字负责适配矩形：先试一行，放不下就折成两行、三行，
 * 取"能放多大就放多大"的那组（point 字号尽量大，同样大时行数少的优先）。
 */

import {
  fitWrappedText,
  measureText,
  placeTextBlock,
  renderTextBlock,
  textInkMetrics,
  type PixelFontSpec,
  type TextBlock,
  type TextPlacement,
} from '../../lib/pixelFont'
import type { Theme } from '../../lib/themes'
import type { Rect } from '../../lib/types'
import { AUTO_TEXT_INK_RATIO, type NameplateConfig } from './config'
import { idDisplayText } from './resolve'

export interface IdTextLayoutOptions {
  /** 最多折几行；不传就用配置里的 maxIdLines */
  maxLines?: number
}

export interface IdTextLayout {
  /** 最终文本（多行用 \n 连接） */
  text: string
  /** 折出来的每一行 */
  lines: string[]
  placeholder: boolean
  /** 按主题色渲染的点阵块（画布会用自己算出来的文字色重画一份同样尺寸的） */
  block: TextBlock
  scale: number
  lineHeight: number
  padding: number
  placement: TextPlacement
  /** 同族描边色；null 表示没描边 */
  outline: string | null
}

export function layoutIdText(
  font: PixelFontSpec,
  theme: Theme,
  config: NameplateConfig,
  idBox: Rect,
  options: IdTextLayoutOptions = {},
): IdTextLayout {
  const placeholder = config.id.trim().length === 0
  const text = idDisplayText(config)
  const outline = theme.text.outline ?? null
  const shadow =
    !outline && config.shadow && theme.text.shadow ? { color: theme.text.shadow, offset: 1 } : null
  const padding = (outline ? 1 : 0) + (shadow ? Math.max(0, shadow.offset) : 0)

  // 设计目标：字形墨迹高度 = 铭牌高度 × 1/φ²（黄金分割用在纵向）
  const lineHeight = Math.max(1, textInkMetrics(font, text.replace(/\n/g, '')).height)
  const targetScale = Math.max(1, Math.floor((config.height * AUTO_TEXT_INK_RATIO) / lineHeight))
  const fit = fitWrappedText(font, text, idBox, {
    maxLines: options.maxLines ?? config.maxIdLines,
    padding,
    lineHeight,
    targetScale,
    maxScale: 256,
  })
  const block = renderTextBlock({
    text: fit.text,
    font,
    fill: theme.text.fill,
    outline,
    shadow,
    opacity: placeholder ? 0.4 : 1,
    lineHeight: fit.lineHeight,
  })
  const placement = placeTextBlock(block, idBox, fit.scale, 'center', 'middle')
  return {
    text: fit.text,
    lines: fit.lines,
    placeholder,
    block,
    scale: fit.scale,
    lineHeight: fit.lineHeight,
    padding,
    placement,
    outline,
  }
}

/** 一行的推进宽度（原生像素）—— 导出拆分字符图层时要用 */
export function glyphAdvance(font: PixelFontSpec, char: string): number {
  return measureText(font, char).advance
}

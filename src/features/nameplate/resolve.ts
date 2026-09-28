/**
 * 配置解析：把「自适应」这类语义化设置换算成具体数值。
 * 这里需要测量字体宽度，因此是浏览器侧代码（纯几何逻辑仍在 layout.ts）。
 */

import { getPixelFont, measureText, textInkMetrics } from '../../lib/pixelFont'
import {
  AUTO_TEXT_INK_RATIO,
  ID_PLACEHOLDER,
  sizeFrom,
  STANDARD_ASPECTS,
  type NameplateConfig,
} from './config'

/** 真正画到名牌上的文字（占位文字走同样流程，保证预览所见即所得） */
export function idDisplayText(config: NameplateConfig): string {
  const trimmed = config.id.trim()
  if (trimmed.length === 0) return ID_PLACEHOLDER
  return config.uppercase ? trimmed.toUpperCase() : trimmed
}

/** 一行 ID 在点阵字库下的推进宽度（原生像素） */
export function nativeIdWidth(config: NameplateConfig): number {
  const font = getPixelFont(config.fontId)
  return Math.max(1, measureText(font, idDisplayText(config)).advance)
}

/**
 * “理想比值”：ID 一行、字形墨迹高度 = 铭牌高度 × 1/φ² 时需要的宽度。
 * 它**只用来选标准比**，不会直接变成名牌的宽高比 —— 铭牌是有规格的物件，
 * 不该跟着文字长度连续变形（那是聊天框的行为）。
 */
function idealAspect(config: NameplateConfig): number {
  const font = getPixelFont(config.fontId)
  const nativeWidth = nativeIdWidth(config)
  const height = Math.max(96, config.height)
  const targetInk = AUTO_TEXT_INK_RATIO * height
  const scale = targetInk / textInkMetrics(font, idDisplayText(config)).height
  const nameWidth = nativeWidth * scale
  const portraitWidth =
    config.splitMode === 'tight'
      ? height * 0.97
      : height * (config.ratioLeft / Math.max(0.15, 1 - config.ratioLeft))
  const totalWidth = portraitWidth + nameWidth * 1.03 + height * 0.05
  return Math.max(1.2, Math.min(9, totalWidth / height))
}

/**
 * 解析宽高比：
 *   · 固定值 → 直接用（UI 只会给出标准比，但仍做一次合理性夹取）；
 *   · 'auto' → 算出理想比值后**吸附到最近的标准比**（按对数距离，比值空间里对称）。
 */
export function resolveAspect(config: NameplateConfig): number {
  if (typeof config.aspect === 'number') {
    return Math.max(1, Math.min(8, config.aspect))
  }
  const ideal = idealAspect(config)
  const target = Math.log(ideal)
  return STANDARD_ASPECTS.reduce((best, value) =>
    Math.abs(Math.log(value) - target) < Math.abs(Math.log(best) - target) ? value : best,
  )
}

export function resolveOutputSize(config: NameplateConfig): { width: number; height: number } {
  return sizeFrom(config.height, resolveAspect(config))
}

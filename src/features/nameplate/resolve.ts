/**
 * 配置解析：把「自适应」这类语义化设置换算成具体数值。
 * 这里需要测量字体宽度，因此是浏览器侧代码（纯几何逻辑仍在 layout.ts）。
 */

import { getPixelFont, measureText, textInkMetrics } from '../../lib/pixelFont'
import {
  AUTO_TEXT_INK_RATIO,
  ID_PLACEHOLDER,
  sizeFrom,
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
 * 解析宽高比。'auto' 时按“ID 字形墨迹高度 = 铭牌高度 × 1/φ²”反推总宽度：
 *   肖像块 ≈ 内容区高度，ID 块 = 文字原生宽度 × 目标倍率
 * 这样短 ID 不空旷、长 ID 也不会把字挤小。
 */
export function resolveAspect(config: NameplateConfig): number {
  if (typeof config.aspect === 'number') {
    return Math.max(1, Math.min(8, config.aspect))
  }
  const font = getPixelFont(config.fontId)
  const nativeWidth = nativeIdWidth(config)
  const height = Math.max(96, config.height)
  // 目标：字形的墨迹高度 = 铭牌高度 × 1/φ²
  const targetInk = AUTO_TEXT_INK_RATIO * height
  const scale = targetInk / textInkMetrics(font, idDisplayText(config)).height
  const nameWidth = nativeWidth * scale
  const portraitWidth =
    config.splitMode === 'tight'
      ? height * 0.97
      : height * (config.ratioLeft / Math.max(0.15, 1 - config.ratioLeft))
  const totalWidth = portraitWidth + nameWidth * 1.03 + height * 0.05
  return Math.max(2.2, Math.min(8, totalWidth / height))
}

export function resolveOutputSize(config: NameplateConfig): { width: number; height: number } {
  return sizeFrom(config.height, resolveAspect(config))
}

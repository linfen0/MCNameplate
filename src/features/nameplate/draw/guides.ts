/**
 * 黄金分割辅助线：把 61.8% / 38.2% 的切分可视化出来，
 * 方便用户确认两块比例，导出成图前建议关闭。
 */

import { GOLDEN_MAJOR } from '../../../lib/golden'
import type { PixelFontSpec } from '../../../lib/pixelFont'
import type { Theme } from '../../../lib/themes'
import type { LayoutPlan } from '../layout'
import { drawPixelLabel } from './text'

/** 手绘虚线：像素风不用 canvas 的 setLineDash，避免出现半像素 */
function dashedLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  thickness: number,
  unit: number,
  vertical: boolean,
): void {
  const on = unit * 4
  const off = unit * 3
  for (let offset = 0; offset < length; offset += on + off) {
    const segment = Math.min(on, length - offset)
    if (vertical) ctx.fillRect(x, y + offset, thickness, segment)
    else ctx.fillRect(x + offset, y, segment, thickness)
  }
}

export function drawGoldenGuides(
  ctx: CanvasRenderingContext2D,
  plan: LayoutPlan,
  theme: Theme,
  font: PixelFontSpec,
  ratioLeft: number,
): void {
  const { inner, unit } = plan
  const thickness = Math.max(1, unit)
  const splitX = inner.x + Math.floor(inner.width * ratioLeft)
  const splitY = inner.y + Math.floor(inner.height * GOLDEN_MAJOR)

  ctx.save()
  ctx.globalAlpha = 0.85
  ctx.fillStyle = theme.guide

  // 垂直分割（宽度方向 = 两块大小的比例）
  dashedLine(ctx, splitX - Math.floor(thickness / 2), inner.y, inner.height, thickness, unit, true)
  // 水平分割（高度方向的黄金线，用于对照比例美感）
  dashedLine(ctx, inner.x, splitY - Math.floor(thickness / 2), inner.width, thickness, unit, false)

  // 分割点标记
  const marker = Math.max(2, unit * 2)
  ctx.fillRect(splitX - marker / 2, splitY - marker / 2, marker, marker)
  ctx.restore()

  const leftPercent = ((splitX - inner.x) / inner.width) * 100
  const rightPercent = 100 - leftPercent
  const labelScale = Math.max(1, Math.min(unit, Math.floor(plan.height / 96)))
  const labelY = inner.y + unit * 2
  const gap = unit * 2

  drawPixelLabel(ctx, font, `${leftPercent.toFixed(2)}%`, { x: splitX - gap, y: labelY }, labelScale, theme.guide, 'right')
  drawPixelLabel(ctx, font, `${rightPercent.toFixed(2)}%`, { x: splitX + gap, y: labelY }, labelScale, theme.guide, 'left')
}

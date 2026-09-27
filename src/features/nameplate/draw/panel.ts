/** 名牌底板：背景纹理、外框倒角、分割线、头像肖像位、文字压暗底 */

import { rgbaToCanvas } from '../../../lib/imageIo'
import { getPanelTexture } from '../../../lib/textures'
import type { Theme } from '../../../lib/themes'
import type { Rect } from '../../../lib/types'
import type { LayoutPlan } from '../layout'

/**
 * 背景：外框底色 + 一整块按面板尺寸生成的纹理（不平铺，所以不会出现重复条纹）。
 * 一个纹理像素 = unit 个画布像素。
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  plan: LayoutPlan,
  theme: Theme,
  seed: number,
  options: { coverCanvas?: boolean } = {},
): void {
  const { width, height, frame, unit } = plan
  ctx.fillStyle = theme.frame.fill
  ctx.fillRect(0, 0, width, height)

  // 贴图自带边框时：铺满整块画布，不给自己再留一圈外框
  const panel: Rect = options.coverCanvas
    ? { x: 0, y: 0, width, height }
    : { x: frame, y: frame, width: width - frame * 2, height: height - frame * 2 }
  if (theme.texture.kind === 'solid') {
    ctx.fillStyle = theme.texture.color
    ctx.fillRect(panel.x, panel.y, panel.width, panel.height)
    return
  }

  const texelsW = Math.ceil(panel.width / unit)
  const texelsH = Math.ceil(panel.height / unit)
  const texture = rgbaToCanvas(getPanelTexture(theme.texture, texelsW, texelsH, seed))

  ctx.save()
  ctx.beginPath()
  ctx.rect(panel.x, panel.y, panel.width, panel.height)
  ctx.clip()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(texture, 0, 0, texelsW, texelsH, panel.x, panel.y, texelsW * unit, texelsH * unit)
  ctx.restore()
}

/** 外框内侧的高光 / 阴影倒角 */
export function drawBevel(ctx: CanvasRenderingContext2D, plan: LayoutPlan, theme: Theme): void {
  const { frame, bevel, width, height } = plan
  const spanX = width - frame * 2
  const spanY = height - frame * 2

  ctx.fillStyle = theme.frame.light
  ctx.fillRect(frame, frame, spanX, bevel)
  ctx.fillRect(frame, frame, bevel, spanY)

  ctx.fillStyle = theme.frame.dark
  ctx.fillRect(frame + bevel, height - frame - bevel, spanX - bevel, bevel)
  ctx.fillRect(width - frame - bevel, frame + bevel, bevel, spanY - bevel)
}

/** 黄金分割处的分割线：左暗右亮的两条细线 */
export function drawDivider(ctx: CanvasRenderingContext2D, plan: LayoutPlan, theme: Theme): void {
  if (plan.dividerWidth <= 0) return
  const { dividerX, dividerWidth, inner } = plan
  const half = Math.max(1, Math.floor(dividerWidth / 2))

  ctx.fillStyle = theme.divider
  ctx.fillRect(dividerX, inner.y, half, inner.height)
  ctx.fillStyle = theme.frame.light
  ctx.fillRect(dividerX + half, inner.y, dividerWidth - half, inner.height)
}

/** 头像肖像位：内凹方框（上/左暗、下/右亮） */
export function drawAvatarSlot(ctx: CanvasRenderingContext2D, plan: LayoutPlan, theme: Theme): void {
  if (!theme.slot) return
  const slot = plan.slot
  const t = Math.max(1, Math.round(plan.unit * 0.75))

  ctx.fillStyle = theme.slot.fill
  ctx.fillRect(slot.x, slot.y, slot.width, slot.height)

  ctx.fillStyle = theme.slot.dark
  ctx.fillRect(slot.x, slot.y, slot.width, t)
  ctx.fillRect(slot.x, slot.y, t, slot.height)

  ctx.fillStyle = theme.slot.light
  ctx.fillRect(slot.x + t, slot.y + slot.height - t, slot.width - t, t)
  ctx.fillRect(slot.x + slot.width - t, slot.y + t, t, slot.height - t)
}

/** 纹理底色上给 ID 加一层 50% 棋盘格压暗，保证文字可读 */
export function drawTextBackdrop(
  ctx: CanvasRenderingContext2D,
  plan: LayoutPlan,
  theme: Theme,
  enabled: boolean,
): void {
  if (!enabled || !theme.textured) return
  const box = plan.idBox
  const cell = Math.max(1, plan.unit)

  const patternCanvas = document.createElement('canvas')
  patternCanvas.width = cell * 2
  patternCanvas.height = cell * 2
  const patternCtx = patternCanvas.getContext('2d')
  if (!patternCtx) return
  patternCtx.fillStyle = 'rgba(0, 0, 0, 0.42)'
  patternCtx.fillRect(0, 0, cell, cell)
  patternCtx.fillRect(cell, cell, cell, cell)

  const pattern = ctx.createPattern(patternCanvas, 'repeat')
  if (!pattern) return

  // 对齐到基准网格，避免压暗底与纹理错位
  const originX = plan.inner.x + Math.floor((box.x - plan.inner.x) / cell) * cell
  const originY = plan.inner.y + Math.floor((box.y - plan.inner.y) / cell) * cell

  ctx.save()
  ctx.translate(originX, originY)
  ctx.fillStyle = pattern
  ctx.fillRect(0, 0, box.x + box.width - originX, box.y + box.height - originY)
  ctx.restore()
}

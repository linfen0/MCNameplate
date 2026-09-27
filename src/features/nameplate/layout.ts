/**
 * 名牌几何布局（纯函数，可在 Node 中直接测试）。
 *
 * 名牌是一块横版矩形铭牌：
 *   外框 frame(3u) → 背景纹理 + 倒角 bevel(1u) → 内容区 inner
 *   内容区沿宽度方向按黄金分割切成两块：一侧方形肖像位（头像），一侧宽条（像素 ID）
 *
 * 所有装饰尺寸都是 u = height / 256 的整数倍，保证任何分辨率都对齐像素网格。
 */

import { GOLDEN_MINOR, goldenSplit } from '../../lib/golden'
import { HEAD_FACE_SIZE } from '../../lib/types'
import type { Rect } from '../../lib/types'
import { HEAD3D_PROJECTION } from './headGeometry'

export type HeadStyle = 'flat' | 'iso'
export type AvatarSide = 'left' | 'right'
/** tight：头像块按头像实际大小收紧；ratio：严格按比例切 */
export type SplitMode = 'tight' | 'ratio'

/** 基准网格：高度划分为 256 格 */
export const GRID_DIVISIONS = 256

export interface LayoutInput {
  /** 名牌高度（px） */
  height: number
  /** 宽高比 = width / height */
  aspect: number
  splitMode: SplitMode
  /** ratio 模式下的左侧区域宽度占比 */
  ratioLeft: number
  avatarSide: AvatarSide
  /** 头像风格：flat = 2D 正面；iso = three.js 立体方块 */
  headStyle: HeadStyle
  /** 头部贴图边长（皮肤像素），标准皮肤为 8 */
  faceSize?: number
  /** 头像在肖像位中的填充比例，0.3 - 1 */
  avatarFill: number
  showDivider: boolean
}

export interface LayoutPlan {
  width: number
  height: number
  aspect: number
  /** 基础像素单位 u = height / 256 */
  unit: number
  frame: number
  bevel: number
  canvas: Rect
  /** 内容区（去掉外框与倒角） */
  inner: Rect
  leftRect: Rect
  rightRect: Rect
  avatarRect: Rect
  nameRect: Rect
  avatarSide: AvatarSide
  dividerX: number
  dividerWidth: number
  /** 方形头像肖像位（内凹面板），始终是正方形并紧贴头像 */
  slot: Rect
  /** 头像外框 */
  headBox: Rect
  /** 1 皮肤像素约等于多少画布像素（界面展示用） */
  headScale: number
  /** ID 文本可用区域 */
  idBox: Rect
  /** 内容留白 */
  padding: number
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function insetRect(rect: Rect, amount: number): Rect {
  const dx = Math.min(Math.floor(rect.width / 2) - 1, Math.max(0, Math.round(amount)))
  const dy = Math.min(Math.floor(rect.height / 2) - 1, Math.max(0, Math.round(amount)))
  return {
    x: rect.x + dx,
    y: rect.y + dy,
    width: Math.max(1, rect.width - dx * 2),
    height: Math.max(1, rect.height - dy * 2),
  }
}

export function centerRect(container: Rect, width: number, height: number): Rect {
  return {
    x: container.x + Math.floor((container.width - width) / 2),
    y: container.y + Math.floor((container.height - height) / 2),
    width,
    height,
  }
}

export function computeNameplateLayout(input: LayoutInput): LayoutPlan {
  const height = clampInt(input.height, 96, 4096)
  const aspect = Math.max(1, Math.min(8, Number.isFinite(input.aspect) ? input.aspect : 3))
  const unit = Math.max(1, Math.round(height / GRID_DIVISIONS))
  const frame = unit * 3
  const bevel = unit
  const inset = frame + bevel

  const width = Math.max(inset * 2 + unit * 8, Math.round(height * aspect))
  const canvas: Rect = { x: 0, y: 0, width, height }
  const inner: Rect = {
    x: inset,
    y: inset,
    width: width - inset * 2,
    height: height - inset * 2,
  }

  // ---- 两块切分：肖像区 + ID 区 ----
  // tight 模式下肖像块宽度正好等于内容区高度（头像能占满的高度），其余宽度全部给 ID，
  // 这样 ID 字号才能做到铭牌高度的 1/φ²；黄金分割仍可用 ratio 模式严格切。
  const avatarWidth =
    input.splitMode === 'tight'
      ? Math.max(unit * 8, Math.min(inner.height, Math.floor(inner.width * 0.5)))
      : goldenSplit(inner.width, input.ratioLeft).left
  const firstRect: Rect = { x: inner.x, y: inner.y, width: avatarWidth, height: inner.height }
  const secondRect: Rect = {
    x: inner.x + avatarWidth,
    y: inner.y,
    width: inner.width - avatarWidth,
    height: inner.height,
  }
  const avatarRect = input.avatarSide === 'left' ? firstRect : secondRect
  const nameRect = input.avatarSide === 'left' ? secondRect : firstRect
  // leftRect / rightRect 始终按物理左右位置，avatarRect / nameRect 按 avatarSide 指定
  const leftRect = firstRect
  const rightRect = secondRect

  const dividerWidth = input.showDivider ? unit * 2 : 0
  const dividerX = inner.x + avatarWidth - Math.floor(dividerWidth / 2)

  const padding = Math.max(unit * 3, Math.round(height * 0.03))
  // 肖像位固定为正方形并居中：头像块再宽也不会出现一大片空底板
  const slotSide = Math.max(unit * 4, Math.min(avatarRect.width, avatarRect.height) - padding * 2)
  const slot = centerRect(avatarRect, slotSide, slotSide)

  // ---- 头像：填满肖像位 ----
  const faceSize = input.faceSize ?? HEAD_FACE_SIZE
  const fill = Math.max(0.3, Math.min(1, input.avatarFill))
  const available = Math.max(1, slotSide - unit * 2)
  let headBox: Rect

  if (input.headStyle === 'iso') {
    // 立体头像的轮廓不是正方形，按投影宽高比取最大内接矩形
    const headAspect = HEAD3D_PROJECTION.aspect
    const boxWidth = Math.max(unit * 4, Math.floor(Math.min(available, available * headAspect) * fill))
    const boxHeight = Math.max(1, Math.round(boxWidth / headAspect))
    headBox = centerRect(slot, boxWidth, boxHeight)
  } else {
    // 2D 正面像必须是贴图的整数倍，保证逐像素硬边
    const scale = Math.max(1, Math.floor((available / faceSize) * fill))
    const side = faceSize * scale
    headBox = centerRect(slot, side, side)
  }

  const headScale = Math.max(
    1,
    Math.round(
      input.headStyle === 'iso'
        ? (headBox.width * HEAD3D_PROJECTION.frontFaceRatio) / faceSize
        : headBox.width / faceSize,
    ),
  )

  // ---- ID 文本区：横向几乎占满，垂直居中 ----
  const textPadding = Math.max(unit * 2, Math.round(height * 0.02))
  const textArea = insetRect(nameRect, textPadding)
  const idBox = centerRect(textArea, textArea.width, Math.round(textArea.height * 0.9))

  return {
    width,
    height,
    aspect,
    unit,
    frame,
    bevel,
    canvas,
    inner,
    leftRect,
    rightRect,
    avatarRect,
    nameRect,
    avatarSide: input.avatarSide,
    dividerX,
    dividerWidth,
    slot,
    headBox,
    headScale,
    idBox,
    padding,
  }
}

/* ------------------------------------------------------------------ */
/* 文字柔化底（scrim）的几何：画布 / SVG / 3D 三处共用同一份             */
/* ------------------------------------------------------------------ */

export interface ScrimStep {
  rect: Rect
  alpha: number
}

/**
 * 柔化底分两级铺：文字区整块铺满（保证每个字形像素都吃到），
 * 外圈再铺半强度的一圈淡出。两级都对齐面板像素网格，三处导出对得上。
 */
export function scrimSteps(layout: LayoutPlan, text: Rect, alpha: number): ScrimStep[] {
  const cell = Math.max(1, layout.unit)
  const { inner } = layout
  const clampX = (value: number) => Math.max(inner.x, Math.min(inner.x + inner.width, value))
  const clampY = (value: number) => Math.max(inner.y, Math.min(inner.y + inner.height, value))
  const snapX = (value: number, mode: 'floor' | 'ceil') =>
    clampX(inner.x + (mode === 'floor' ? Math.floor : Math.ceil)((value - inner.x) / cell) * cell)
  const snapY = (value: number, mode: 'floor' | 'ceil') =>
    clampY(inner.y + (mode === 'floor' ? Math.floor : Math.ceil)((value - inner.y) / cell) * cell)

  const coreX0 = snapX(text.x - cell, 'floor')
  const coreY0 = snapY(text.y - cell, 'floor')
  const coreX1 = snapX(text.x + text.width + cell, 'ceil')
  const coreY1 = snapY(text.y + text.height + cell, 'ceil')
  const ringX0 = snapX(coreX0 - cell * 2, 'floor')
  const ringY0 = snapY(coreY0 - cell * 2, 'floor')
  const ringX1 = snapX(coreX1 + cell * 2, 'ceil')
  const ringY1 = snapY(coreY1 + cell * 2, 'ceil')

  const steps: ScrimStep[] = []
  const ring = { half: alpha * 0.5 }
  if (coreY0 > ringY0) {
    steps.push({ rect: { x: ringX0, y: ringY0, width: ringX1 - ringX0, height: coreY0 - ringY0 }, alpha: ring.half })
  }
  if (ringY1 > coreY1) {
    steps.push({ rect: { x: ringX0, y: coreY1, width: ringX1 - ringX0, height: ringY1 - coreY1 }, alpha: ring.half })
  }
  if (coreX0 > ringX0) {
    steps.push({ rect: { x: ringX0, y: coreY0, width: coreX0 - ringX0, height: coreY1 - coreY0 }, alpha: ring.half })
  }
  if (ringX1 > coreX1) {
    steps.push({ rect: { x: coreX1, y: coreY0, width: ringX1 - coreX1, height: coreY1 - coreY0 }, alpha: ring.half })
  }
  if (coreX1 > coreX0 && coreY1 > coreY0) {
    steps.push({ rect: { x: coreX0, y: coreY0, width: coreX1 - coreX0, height: coreY1 - coreY0 }, alpha })
  }
  return steps
}

export { GOLDEN_MINOR }

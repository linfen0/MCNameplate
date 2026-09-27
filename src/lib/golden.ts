/**
 * 黄金分割布局计算。
 *
 *   φ = (1 + √5) / 2 ≈ 1.6180339887
 *   长边占比 = 1 / φ       ≈ 0.6180339887  (61.8034%)
 *   短边占比 = 1 - 1 / φ   ≈ 0.3819660113  (38.1966%)
 *
 * 名牌为正方形，因此“两块的比例”只沿宽度方向切分：
 * 左区域宽度 : 右区域宽度 = 0.6180 : 0.3820（或镜像）。
 */

export const PHI = (1 + Math.sqrt(5)) / 2

/** 长边占比 1/φ ≈ 0.6180339887498949 */
export const GOLDEN_MAJOR = 1 / PHI

/** 短边占比 1/φ² ≈ 0.3819660112501051 */
export const GOLDEN_MINOR = 1 - GOLDEN_MAJOR

/** 允许的比例区间（避免把某一侧压成 0 宽） */
export const MIN_RATIO = 0.2
export const MAX_RATIO = 0.8

/** 判定“是否等于黄金分割”的容差（严格相等语义，滑杆请配合 snapToGolden 使用） */
export const GOLDEN_EPSILON = 1e-9

/** 连续输入（滑杆）吸附半径：靠近黄金取值时直接取精确值 */
export const GOLDEN_SNAP = 3e-4

export interface RatioPreset {
  id: string
  label: string
  hint: string
  /** 左侧区域宽度占比 */
  ratioLeft: number
  avatarSide: 'left' | 'right'
}

export const RATIO_PRESETS: RatioPreset[] = [
  {
    id: 'golden-avatar-minor',
    label: '黄金分割 · 头像小',
    hint: '头像 38.2% : ID 61.8%',
    ratioLeft: GOLDEN_MINOR,
    avatarSide: 'left',
  },
  {
    id: 'golden-avatar-major',
    label: '黄金分割 · 头像大',
    hint: '头像 61.8% : ID 38.2%',
    ratioLeft: GOLDEN_MAJOR,
    avatarSide: 'left',
  },
  {
    id: 'golden-avatar-right',
    label: '黄金分割 · 头像在右',
    hint: 'ID 61.8% : 头像 38.2%',
    ratioLeft: GOLDEN_MAJOR,
    avatarSide: 'right',
  },
  {
    id: 'even',
    label: '均分对照',
    hint: '50% : 50%（非黄金分割）',
    ratioLeft: 0.5,
    avatarSide: 'left',
  },
]

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return GOLDEN_MINOR
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
}

export function isGoldenRatio(ratio: number, epsilon = GOLDEN_EPSILON): boolean {
  return Math.abs(ratio - GOLDEN_MAJOR) <= epsilon || Math.abs(ratio - GOLDEN_MINOR) <= epsilon
}

/**
 * 滑杆是连续输入，很难正好落在 0.6180339887…，
 * 因此在黄金取值附近直接吸附，保证界面上显示的“黄金分割”是精确值。
 */
export function snapToGolden(ratio: number, tolerance = GOLDEN_SNAP): number {
  if (Math.abs(ratio - GOLDEN_MAJOR) <= tolerance) return GOLDEN_MAJOR
  if (Math.abs(ratio - GOLDEN_MINOR) <= tolerance) return GOLDEN_MINOR
  return ratio
}

/**
 * 把总宽度按比例切成整数像素的两块。
 * 使用 floor 保证两块之和恒等于 total（不会出现 1px 缝隙或溢出）。
 */
export function goldenSplit(total: number, ratioLeft: number): { left: number; right: number } {
  const safeTotal = Math.max(2, Math.floor(total))
  const ratio = clampRatio(ratioLeft)
  const left = Math.min(safeTotal - 1, Math.max(1, Math.floor(safeTotal * ratio)))
  return { left, right: safeTotal - left }
}

export interface RatioSummary {
  avatarSide: 'left' | 'right'
  avatarPercent: number
  idPercent: number
  /** 是否严格按黄金分割切两块 */
  golden: boolean
  majorSide: 'avatar' | 'id'
  /** 例如 "38.197% : 61.803%"（左 : 右） */
  leftRightText: string
}

/** 按布局算出的真实块宽汇总占比（整数取整后的实际值） */
export function summarizeBlocks(
  innerWidth: number,
  leftWidth: number,
  avatarSide: 'left' | 'right',
  golden: boolean,
): RatioSummary {
  const total = Math.max(1, innerWidth)
  const leftPct = (leftWidth / total) * 100
  const rightPct = 100 - leftPct
  const avatarPercent = avatarSide === 'left' ? leftPct : rightPct
  const idPercent = 100 - avatarPercent
  return {
    avatarSide,
    avatarPercent,
    idPercent,
    golden,
    majorSide: avatarPercent >= idPercent ? 'avatar' : 'id',
    leftRightText: `${leftPct.toFixed(3)}% : ${rightPct.toFixed(3)}%`,
  }
}

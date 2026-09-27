/** 名牌配置：只保留“皮肤 + ID → 矩形名牌”真正需要的选项 */

import { GOLDEN_MAJOR, GOLDEN_MINOR, PHI } from '../../lib/golden'
import { DEFAULT_FONT_ID } from '../../lib/pixelFont'
import { DEFAULT_THEME_ID } from '../../lib/themes'
import type { AvatarSide, HeadStyle, SplitMode } from './layout'

/** 宽高比可以是一个固定值，也可以交给布局根据 ID 长度自适应 */
export type AspectSetting = number | 'auto'

export interface NameplateConfig {
  /** 玩家 ID（显示在名牌右侧） */
  id: string
  /** 名牌高度（px），宽度由宽高比决定 */
  height: number
  aspect: AspectSetting
  /**
   * 两块怎么切：
   *   tight —— 头像块按头像实际大小收紧，宽度让给 ID（默认，字号最大）
   *   ratio —— 严格按 ratioLeft 切（黄金分割预设走这里）
   */
  splitMode: SplitMode
  /** ratio 模式下的左侧区域宽度占比（黄金分割 = 0.381966 / 0.618034） */
  ratioLeft: number
  avatarSide: AvatarSide
  /** 头像风格：iso = three.js 立体方块；flat = 2D 正面 */
  headStyle: HeadStyle
  /** 头像在肖像位中的填充比例 */
  avatarFill: number
  themeId: string
  fontId: string
  uppercase: boolean
  shadow: boolean
  showDivider: boolean
  /** 文字下方加棋盘格压暗，提升纹理底色上的可读性 */
  textBackdrop: boolean
  /** 显示黄金分割辅助线（预览校核用） */
  showGuides: boolean
}

export interface AspectPreset {
  id: string
  label: string
  hint: string
  value: AspectSetting
}

export const ASPECT_PRESETS: AspectPreset[] = [
  { id: 'auto', label: '自适应', hint: '按 ID 长度自动定宽，字号始终饱满不发空', value: 'auto' },
  { id: '4-1', label: '4 : 1', hint: '常见胸牌比例', value: 4 },
  { id: '3-1', label: '3 : 1', hint: '经典长条名牌', value: 3 },
  { id: '2-1', label: '2 : 1', hint: '更方的铭牌', value: 2 },
  { id: 'phi', label: 'φ : 1', hint: '黄金比 1.618 : 1', value: PHI },
]

export const HEIGHT_OPTIONS = [256, 384, 512, 768, 1024] as const
export const DEFAULT_HEIGHT = 512
export const DEFAULT_ASPECT: AspectSetting = 'auto'

/**
 * ID 字形墨迹高度占铭牌高度的比例，取 1/φ² = 0.381966。
 * 现在字号是按点阵字库的真实墨迹高度算的（不再估 em 比例），
 * 所以“字高 = 铭牌高度 × 38.2%”是精确成立的 —— 黄金分割用在纵向；
 * 横向的头像块按头像实际大小收紧，把宽度全留给 ID。
 */
export const AUTO_TEXT_INK_RATIO = GOLDEN_MINOR
/** @deprecated 旧名，保留以免外部引用断裂 */
export const AUTO_TEXT_HEIGHT_RATIO = AUTO_TEXT_INK_RATIO

export interface SplitPreset {
  id: string
  label: string
  hint: string
  mode: SplitMode
  ratioLeft: number
  avatarSide: AvatarSide
}

export const SPLIT_PRESETS: SplitPreset[] = [
  {
    id: 'tight',
    label: '贴合头像',
    hint: '头像块按头像实际大小收紧，宽度让给 ID，字号最大（默认）',
    mode: 'tight',
    ratioLeft: GOLDEN_MINOR,
    avatarSide: 'left',
  },
  {
    id: 'golden-minor',
    label: '黄金分割 38.2 : 61.8',
    hint: '严格黄金分割，头像占短边',
    mode: 'ratio',
    ratioLeft: GOLDEN_MINOR,
    avatarSide: 'left',
  },
  {
    id: 'golden-major',
    label: '黄金分割 61.8 : 38.2',
    hint: '严格黄金分割，头像占长边',
    mode: 'ratio',
    ratioLeft: GOLDEN_MAJOR,
    avatarSide: 'left',
  },
  {
    id: 'even',
    label: '均分 50 : 50',
    hint: '平分宽度，用于对照',
    mode: 'ratio',
    ratioLeft: 0.5,
    avatarSide: 'left',
  },
]

/** ID 为空时显示的占位文字 */
export const ID_PLACEHOLDER = 'YOUR_ID'

/** 纹理随机种子固定，保证同一配置每次渲染结果完全一致 */
export const TEXTURE_SEED = 20240927

export const DEFAULT_CONFIG: NameplateConfig = {
  id: '',
  height: DEFAULT_HEIGHT,
  aspect: DEFAULT_ASPECT,
  splitMode: 'tight',
  ratioLeft: GOLDEN_MINOR,
  avatarSide: 'left',
  headStyle: 'iso',
  avatarFill: 0.92,
  themeId: DEFAULT_THEME_ID,
  fontId: DEFAULT_FONT_ID,
  uppercase: true,
  shadow: true,
  showDivider: true,
  textBackdrop: true,
  showGuides: false,
}

export function normalizeConfig(patch: Partial<NameplateConfig>): NameplateConfig {
  return { ...DEFAULT_CONFIG, ...patch }
}

/** 由高度与数值宽高比推算输出尺寸（纯函数） */
export function sizeFrom(height: number, aspect: number): { width: number; height: number } {
  const h = Math.max(96, Math.min(4096, Math.round(height)))
  const a = Math.max(1, Math.min(8, Number.isFinite(aspect) ? aspect : 3))
  return { width: Math.round(h * a), height: h }
}

/** 导出文件名：<id>_<宽>x<高>.png */
export function nameplateFileName(id: string, width: number, height: number): string {
  const safe = id.trim().replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 32) || 'nameplate'
  return `${safe}_${width}x${height}.png`
}

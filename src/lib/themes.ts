/** 名牌底色主题：少量真正有辨识度的 Minecraft 配色，整体偏暗以保证 ID 可读 */

import type { Palette, PanelTexture } from './textures'

export interface ThemeColorSet {
  fill: string
  light: string
  dark: string
}

export interface Theme {
  id: string
  name: string
  description: string
  /** UI 色板 */
  swatch: string[]
  texture: PanelTexture
  /** 头像肖像位（内凹方框）；null 表示不画 */
  slot: ThemeColorSet | null
  /** 外框三层配色 */
  frame: ThemeColorSet
  /** 文字配色 */
  text: { fill: string; shadow: string | null }
  divider: string
  /** 黄金分割辅助线颜色 */
  guide: string
  /** 是否纹理底（决定是否需要给文字加压暗） */
  textured: boolean
}

const soil: Palette = { base: '#6b4a2a', light: '#7d5a34', dark: '#4f3620' }
const grassTop: Palette = { base: '#5d8f3f', light: '#74a851', dark: '#436c2b' }
const stone: Palette = { base: '#6e6e6e', light: '#808080', dark: '#585858' }
const nether: Palette = { base: '#5c2b29', light: '#6f3634', dark: '#411d1c' }

export const THEMES: Theme[] = [
  {
    id: 'grass',
    name: '草方块',
    description: '顶部一条草皮 + 泥土底，经典但不刺眼',
    swatch: ['#5d8f3f', '#6b4a2a', '#436c2b'],
    texture: { kind: 'noise', palette: soil, grassTop },
    slot: { fill: '#2a1d0f', light: '#4a3520', dark: '#150e06' },
    frame: { fill: '#1c1c1c', light: '#8a8a8a', dark: '#0d0d0d' },
    text: { fill: '#ffffff', shadow: '#20160a' },
    divider: '#0d0d0d',
    guide: '#ff4fd8',
    textured: true,
  },
  {
    id: 'deepslate',
    name: '深板岩',
    description: '冷灰岩底，最干净的一块“铭牌铁片”',
    swatch: ['#3f4145', '#4c4f54', '#313337'],
    texture: { kind: 'noise', palette: { base: '#3f4145', light: '#4c4f54', dark: '#313337' } },
    slot: { fill: '#1c1e21', light: '#3a3d42', dark: '#0f1012' },
    frame: { fill: '#101113', light: '#7d838c', dark: '#08090a' },
    text: { fill: '#f2f5f7', shadow: '#15171a' },
    divider: '#08090a',
    guide: '#ff4fd8',
    textured: true,
  },
  {
    id: 'gui',
    name: '经典界面',
    description: '物品栏灰底 + 高光倒角，干净利落',
    swatch: ['#c6c6c6', '#ffffff', '#555555'],
    texture: { kind: 'solid', color: '#bdbdbd' },
    slot: { fill: '#8b8b8b', light: '#6f6f6f', dark: '#373737' },
    frame: { fill: '#000000', light: '#ffffff', dark: '#555555' },
    text: { fill: '#2f2f2f', shadow: '#e8e8e8' },
    divider: '#373737',
    guide: '#c026d3',
    textured: false,
  },
  {
    id: 'tooltip',
    name: '提示框',
    description: '深紫边框 + 近黑底，物品悬浮提示配色',
    swatch: ['#12081c', '#8a4bff', '#3a0f7a'],
    texture: { kind: 'solid', color: '#12081c' },
    slot: { fill: '#1c0f2e', light: '#33195a', dark: '#0a0413' },
    frame: { fill: '#0d0518', light: '#8a4bff', dark: '#3a0f7a' },
    text: { fill: '#ffffff', shadow: '#3f3f5f' },
    divider: '#4a1a8f',
    guide: '#38f8ff',
    textured: false,
  },
  {
    id: 'nether',
    name: '下界岩',
    description: '暗红岩壁，配金色 ID 很有地狱感',
    swatch: ['#5c2b29', '#ffd479', '#411d1c'],
    texture: { kind: 'noise', palette: nether },
    slot: { fill: '#2a1110', light: '#4a1f1e', dark: '#150707' },
    frame: { fill: '#170707', light: '#7d3f3d', dark: '#0b0303' },
    text: { fill: '#ffd479', shadow: '#1c0808' },
    divider: '#0b0303',
    guide: '#5ce1ff',
    textured: true,
  },
  {
    id: 'stone',
    name: '石头',
    description: '中性灰岩，什么皮肤都不挑',
    swatch: ['#6e6e6e', '#808080', '#585858'],
    texture: { kind: 'noise', palette: stone },
    slot: { fill: '#2e2e2e', light: '#4d4d4d', dark: '#171717' },
    frame: { fill: '#141414', light: '#a8a8a8', dark: '#0a0a0a' },
    text: { fill: '#ffffff', shadow: '#232323' },
    divider: '#0a0a0a',
    guide: '#ff4fd8',
    textured: true,
  },
]

export const DEFAULT_THEME_ID = 'deepslate'

export function getTheme(id: string): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]
}

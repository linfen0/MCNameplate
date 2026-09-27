/**
 * 主题解析：内置主题直接用，`custom` 则从用户上传的方块贴图现场推导一整套配色。
 * 结果按贴图引用缓存，避免每次重绘都重新做一遍配色提取。
 */

import { buildThemeFromTexture, type ExtractedPalette } from '../../lib/palette'
import { DEFAULT_THEME_ID, getTheme, type Theme } from '../../lib/themes'
import type { RgbaImage } from '../../lib/types'
import type { NameplateConfig } from './config'

/** 用户上传的一张方块贴图 */
export interface CustomTexture {
  id: string
  name: string
  image: RgbaImage
  /** 上传时就算好的配色，供界面展示与主题复现 */
  palette: ExtractedPalette
}

export const CUSTOM_THEME_ID = 'custom'

const cache = new WeakMap<RgbaImage, Theme>()

export function resolveTheme(config: NameplateConfig): Theme {
  const custom = config.customTexture
  if (config.themeId !== CUSTOM_THEME_ID) return getTheme(config.themeId)
  // 选了自定义但还没上传贴图 → 回退到默认主题，而不是拿到一个随机的内置主题
  if (!custom) return getTheme(DEFAULT_THEME_ID)

  const hit = cache.get(custom.image)
  if (hit) return hit

  const theme = buildThemeFromTexture(custom.image, {
    name: custom.name,
    description: `由「${custom.name}」提取配色：主色 ${custom.palette.base} · 亮 ${custom.palette.light} · 暗 ${custom.palette.dark}`,
  })
  cache.set(custom.image, theme)
  return theme
}

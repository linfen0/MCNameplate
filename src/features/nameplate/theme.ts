/**
 * 主题解析：内置主题直接用，`custom` 则从用户上传的方块贴图现场推导一整套配色。
 * 结果按贴图引用缓存，避免每次重绘都重新做一遍配色提取。
 */

import { buildThemeFromTexture, type ExtractedPalette } from '../../lib/palette'
import { getTheme, type Theme } from '../../lib/themes'
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

const cache = new WeakMap<RgbaImage, Map<number, Theme>>()

export function resolveTheme(config: NameplateConfig): Theme {
  const custom = config.customTexture
  if (config.themeId !== CUSTOM_THEME_ID || !custom) return getTheme(config.themeId)

  const scale = Math.max(1, Math.round(config.textureTexelScale))
  let perImage = cache.get(custom.image)
  if (!perImage) {
    perImage = new Map()
    cache.set(custom.image, perImage)
  }
  const hit = perImage.get(scale)
  if (hit) return hit

  const theme = buildThemeFromTexture(custom.image, {
    texelScale: scale,
    name: custom.name,
    description: `由「${custom.name}」提取：主色 ${custom.palette.base} · 亮 ${custom.palette.light} · 暗 ${custom.palette.dark}`,
  })
  perImage.set(scale, theme)
  return theme
}

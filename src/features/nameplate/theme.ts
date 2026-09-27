/**
 * 主题解析：内置主题直接用，`custom` 则从用户上传的方块贴图现场推导一整套配色。
 * 结果按贴图引用缓存，避免每次重绘都重新做一遍配色提取。
 */

import { buildThemeFromTexture, type ExtractedPalette } from '../../lib/palette'
import { planText } from '../../lib/textPlan'
import { DEFAULT_THEME_ID, getTheme, type Theme } from '../../lib/themes'
import type { TextStyle } from '../../lib/textPlan'
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

/**
 * 把预览里算好的文字配色套到主题上（SVG / 3D 导出用），
 * 保证导出的文字颜色与画布上看到的一模一样。
 */
export function withTextStyle(theme: Theme, style?: TextStyle | null): Theme {
  if (!style) return theme
  return {
    ...theme,
    text: { fill: style.fill, outline: style.outline, shadow: style.shadow ?? theme.text.shadow },
  }
}

const cache = new WeakMap<RgbaImage, Map<string, Theme>>()

export function resolveTheme(config: NameplateConfig): Theme {
  const custom = config.customTexture
  if (config.themeId !== CUSTOM_THEME_ID) return getTheme(config.themeId)
  // 选了自定义但还没上传贴图 → 回退到默认主题，而不是拿到一个随机的内置主题
  if (!custom) return getTheme(DEFAULT_THEME_ID)

  const key = `${config.textureFillMode}|${config.textureTexelScale}|${config.textureSlice}`
  const cached = cache.get(custom.image)
  const hit = cached?.get(key)
  if (hit) return hit

  const base = buildThemeFromTexture(custom.image, {
    fillMode: config.textureFillMode,
    texelScale: config.textureTexelScale,
    slice: config.textureSlice,
    name: custom.name,
    description: `「${custom.name}」配色：主色 ${custom.palette.base} · 亮 ${custom.palette.light} · 暗 ${custom.palette.dark}`,
  })
  // 文字配色和画布走同一套决策（亮字 → 同族描边 → 柔化底），
  // 这样 SVG / 3D 导出与预览里的颜色完全一致
  const palette = base.palette!
  const style = planText({
    swatches: [palette.light, palette.accent, palette.dark, palette.base],
    background: { dark: palette.dark, light: palette.light, lightBackground: palette.luminance > 0.32 },
    tint: palette.base,
    outline: config.textOutline,
  })
  const theme: Theme = {
    ...base,
    text: { fill: style.fill, outline: style.outline, shadow: style.shadow ?? base.text.shadow },
  }
  if (cached) cached.set(key, theme)
  else cache.set(custom.image, new Map([[key, theme]]))
  return theme
}

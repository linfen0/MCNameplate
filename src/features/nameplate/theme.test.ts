import { describe, expect, it } from 'vitest'
import { createImage, setPixel } from '../../lib/raster'
import { relativeLuminance } from '../../lib/color'
import { DEFAULT_CONFIG } from './config'
import { CUSTOM_THEME_ID, resolveTheme, type CustomTexture } from './theme'

function texture(color: [number, number, number, number]): CustomTexture {
  const image = createImage(16, 16)
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) setPixel(image, x, y, color)
  return {
    id: 'test',
    name: '测试方块',
    image,
    palette: {
      base: '#000000',
      light: '#000000',
      dark: '#000000',
      accent: '#000000',
      average: '#000000',
      luminance: 0,
      dominant: [],
    },
  }
}

describe('resolveTheme', () => {
  it('内置主题直接用内置定义', () => {
    const theme = resolveTheme({ ...DEFAULT_CONFIG, themeId: 'grass' })
    expect(theme.id).toBe('grass')
  })

  it('选了自定义主题但没上传贴图时回退到内置主题，而不是崩掉', () => {
    const theme = resolveTheme({ ...DEFAULT_CONFIG, themeId: CUSTOM_THEME_ID, customTexture: null })
    expect(theme.id).toBe('deepslate')
  })

  it('上传贴图后按贴图现场推导主题', () => {
    const config = {
      ...DEFAULT_CONFIG,
      themeId: CUSTOM_THEME_ID,
      customTexture: texture([30, 30, 40, 255]),
    }
    const theme = resolveTheme(config)
    expect(theme.id).toBe(CUSTOM_THEME_ID)
    // 默认九宫格拉伸：直接沿用上传的贴图（边框不变形）
    expect(theme.texture.kind).toBe('image')
    expect(theme.palette).toBeTruthy()
    // 深色底 → 白字
    expect(relativeLuminance(theme.text.fill)).toBeGreaterThan(0.5)
  })

  it('同一张贴图会命中缓存（不重复提取配色）', () => {
    const custom = texture([200, 200, 190, 255])
    const config = { ...DEFAULT_CONFIG, themeId: CUSTOM_THEME_ID, customTexture: custom }
    expect(resolveTheme(config)).toBe(resolveTheme(config))
  })

  it('换一张贴图会重新提取', () => {
    const first = texture([80, 90, 100, 255])
    const second = texture([200, 120, 60, 255])
    const a = resolveTheme({ ...DEFAULT_CONFIG, themeId: CUSTOM_THEME_ID, customTexture: first })
    const b = resolveTheme({ ...DEFAULT_CONFIG, themeId: CUSTOM_THEME_ID, customTexture: second })
    expect(a).not.toBe(b)
    expect(a.palette!.base).not.toBe(b.palette!.base)
  })
})

import { describe, expect, it } from 'vitest'
import { createImage, setPixel } from './raster'
import { relativeLuminance } from './color'
import { buildThemeFromTexture, extractPalette, paletteToCssGradient } from './palette'
import type { RgbaImage } from './types'

function solid(width: number, height: number, color: [number, number, number, number]): RgbaImage {
  const image = createImage(width, height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) setPixel(image, x, y, color)
  return image
}

/** 模拟一块 MC 方块：大部分深色底 + 少量高光 + 少量阴影 */
function blockTexture(): RgbaImage {
  const image = createImage(16, 16)
  const base: [number, number, number, number] = [110, 110, 110, 255]
  const light: [number, number, number, number] = [170, 170, 170, 255]
  const dark: [number, number, number, number] = [60, 60, 60, 255]
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = (x * 7 + y * 13) % 10
      const color = r === 0 ? light : r === 9 ? dark : base
      setPixel(image, x, y, color)
    }
  }
  return image
}

describe('extractPalette', () => {
  it('取占比最高的颜色作为主色', () => {
    const image = createImage(10, 10)
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        // 7 成红、2 成绿、1 成蓝
        const color: [number, number, number, number] =
          x < 7 ? [200, 40, 40, 255] : x < 9 ? [40, 200, 40, 255] : [40, 40, 200, 255]
        setPixel(image, x, y, color)
      }
    }
    const palette = extractPalette(image)
    expect(palette.base).toBe('#c82828')
    expect(palette.dominant[0]).toBe('#c82828')
  })

  it('按亮度分位给出明暗，而不是把所有像素平均成灰', () => {
    const palette = extractPalette(blockTexture())
    expect(relativeLuminance(palette.light)).toBeGreaterThan(relativeLuminance(palette.base))
    expect(relativeLuminance(palette.dark)).toBeLessThan(relativeLuminance(palette.base))
  })

  it('全透明贴图也有兜底配色', () => {
    const palette = extractPalette(createImage(8, 8))
    expect(palette.base).toMatch(/^#[0-9a-f]{6}$/)
    expect(palette.luminance).toBeGreaterThanOrEqual(0)
  })

  it('忽略透明像素', () => {
    const image = blockTexture()
    for (let x = 0; x < 8; x++) setPixel(image, x, 0, [255, 0, 255, 0])
    expect(extractPalette(image).base).not.toBe('#ff00ff')
  })

  it('主色数量不超过 6 个，且都是合法色值', () => {
    const palette = extractPalette(blockTexture())
    expect(palette.dominant.length).toBeLessThanOrEqual(6)
    for (const color of palette.dominant) expect(color).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('buildThemeFromTexture', () => {
  it('底纹由提取出的配色程序化生成，而不是平铺原贴图', () => {
    const image = blockTexture()
    const theme = buildThemeFromTexture(image)
    expect(theme.texture.kind).toBe('noise')
    const palette = extractPalette(image)
    if (theme.texture.kind === 'noise') {
      // 主色原样使用
      expect(theme.texture.palette.base).toBe(palette.base)
    }
    // 贴图本身不能被塞进主题里当底图
    expect(JSON.stringify(theme.texture)).not.toContain('image')
  })

  it('底纹只由主色派生：深底 + 金色点缀的机器贴图也不会撒满金点', () => {
    // 模拟“深色底 + 少量亮金细节”的机器贴图（radial chassis 那类）
    const image = createImage(16, 16)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const n = (x * 5 + y * 3) % 20
        const color: [number, number, number, number] =
          n === 0 ? [250, 200, 60, 255] : n === 1 ? [255, 240, 200, 255] : [26, 24, 22, 255]
        setPixel(image, x, y, color)
      }
    }
    const extracted = extractPalette(image)
    const theme = buildThemeFromTexture(image)
    expect(theme.texture.kind).toBe('noise')
    if (theme.texture.kind !== 'noise') return
    const surface = theme.texture.palette

    // 底纹三层色必须都贴近主色，且不含被提取出的金色亮部
    expect(surface.base).toBe(extracted.base)
    const baseLuminance = relativeLuminance(surface.base)
    expect(relativeLuminance(surface.light) - baseLuminance).toBeLessThan(0.12)
    expect(baseLuminance - relativeLuminance(surface.dark)).toBeLessThan(0.16)
    for (const tone of [surface.base, surface.light, surface.dark]) {
      // 金色亮部的红绿通道差异很大，底纹里不该出现这种色
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(tone.slice(i, i + 2), 16))
      expect(r - b).toBeLessThan(40)
      expect(g).toBeGreaterThanOrEqual(b - 10)
    }
  })

  it('提取出的亮部/暗部色卡用在外框等组件上，并保持足够对比', () => {
    const theme = buildThemeFromTexture(blockTexture())
    expect(relativeLuminance(theme.frame.light)).toBeGreaterThan(relativeLuminance(theme.frame.dark) * 1.5)
    expect(theme.palette!.light).toBeTruthy()
    expect(theme.palette!.dark).toBeTruthy()
  })

  it('深色贴图用白字，浅色贴图用深字（按对比度自动选）', () => {
    const dark = buildThemeFromTexture(solid(8, 8, [30, 30, 40, 255]))
    const light = buildThemeFromTexture(solid(8, 8, [230, 230, 220, 255]))
    expect(relativeLuminance(dark.text.fill)).toBeGreaterThan(0.5)
    expect(relativeLuminance(light.text.fill)).toBeLessThan(0.5)
  })

  it('外框 / 肖像位都由提取出的配色推导，且明暗关系正确', () => {
    const theme = buildThemeFromTexture(blockTexture())
    for (const color of [
      theme.frame.fill,
      theme.frame.light,
      theme.frame.dark,
      theme.slot!.fill,
      theme.slot!.light,
      theme.slot!.dark,
      theme.divider,
      theme.guide,
    ]) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(relativeLuminance(theme.frame.light)).toBeGreaterThan(relativeLuminance(theme.frame.dark))
    expect(relativeLuminance(theme.slot!.light)).toBeGreaterThan(relativeLuminance(theme.slot!.dark))
  })

  it('把提取出的配色挂在主题上，供界面展示', () => {
    const theme = buildThemeFromTexture(blockTexture())
    expect(theme.palette).toBeTruthy()
    expect(theme.palette!.dominant.length).toBeGreaterThan(0)
    expect(theme.swatch.length).toBeGreaterThanOrEqual(3)
  })

  it('描述里带上主色，方便用户确认用的哪张图', () => {
    const theme = buildThemeFromTexture(blockTexture(), { name: '石头方块' })
    expect(theme.name).toBe('石头方块')
    expect(theme.description).toContain('石头方块')
  })
})

describe('paletteToCssGradient', () => {
  it('输出可直接用于 CSS 的渐变', () => {
    const gradient = paletteToCssGradient(extractPalette(blockTexture()))
    expect(gradient.startsWith('linear-gradient(90deg,')).toBe(true)
    expect(gradient).toContain('#')
  })
})

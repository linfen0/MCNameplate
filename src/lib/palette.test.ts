import { describe, expect, it } from 'vitest'
import { createImage, setPixel } from './raster'
import { relativeLuminance, rgbaToHex } from './color'
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
  it('默认九宫格：四角原样保留，只有中间被拉开', () => {
    const image = blockTexture()
    const theme = buildThemeFromTexture(image)
    expect(theme.texture.kind).toBe('image')
    if (theme.texture.kind === 'image') {
      expect(theme.texture.image).toBe(image)
      expect(theme.texture.mode).toBe('nine-slice')
      // 16×16 的贴图默认估 2 像素边框
      expect(theme.texture.slice).toBe(2)
    }
  })

  it('平铺模式带上方块尺寸', () => {
    const theme = buildThemeFromTexture(blockTexture(), { fillMode: 'tile', texelScale: 6 })
    expect(theme.texture.kind).toBe('image')
    if (theme.texture.kind === 'image') {
      expect(theme.texture.mode).toBe('tile')
      expect(theme.texture.texelScale).toBe(6)
    }
  })

  it('只取配色模式：底纹由主色派生，不塞原贴图', () => {
    const image = blockTexture()
    const theme = buildThemeFromTexture(image, { fillMode: 'palette' })
    expect(theme.texture.kind).toBe('noise')
    if (theme.texture.kind === 'noise') {
      expect(theme.texture.palette.base).toBe(extractPalette(image).base)
    }
    expect(JSON.stringify(theme.texture)).not.toContain('image')
  })

  it('提取出的亮部/暗部色卡用在外框等组件上，并保持足够对比', () => {
    const theme = buildThemeFromTexture(blockTexture())
    expect(relativeLuminance(theme.frame.light)).toBeGreaterThan(relativeLuminance(theme.frame.dark) * 1.5)
    expect(theme.palette!.light).toBeTruthy()
    expect(theme.palette!.dark).toBeTruthy()
  })

  it('文字色优先取自提取出的色卡（不是写死的纯白/纯黑）', () => {
    // 深底 + 大面积亮部：亮部色卡与底色的对比度足够，就应该拿它当文字色
    const image = createImage(16, 16)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        setPixel(image, x, y, x < 10 ? [22, 20, 26, 255] : [236, 232, 220, 255])
      }
    }
    const palette = extractPalette(image)
    const theme = buildThemeFromTexture(image, { fillMode: 'palette' })
    expect([palette.light, palette.accent, palette.dark]).toContain(theme.text.fill)
    expect(theme.text.fill).not.toBe('#ffffff')
  })

  it('色卡里挑不出足够对比度时才退回纯白/纯黑', () => {
    // 全是中间灰：亮部/暗部卡与底色对比不足，必须退回黑或白保证可读
    const image = solid(16, 16, [128, 128, 128, 255])
    const theme = buildThemeFromTexture(image, { fillMode: 'palette' })
    expect(['#ffffff', '#151515']).toContain(theme.text.fill)
  })

  it('无论什么贴图，文字与底色的对比度都达到 WCAG AA（4.5:1）', () => {
    const samples: Array<[number, number, number, number]> = [
      [10, 10, 12, 255],
      [128, 128, 128, 255],
      [240, 240, 235, 255],
      [120, 40, 40, 255],
      [40, 90, 160, 255],
      [250, 200, 60, 255],
    ]
    for (const color of samples) {
      const theme = buildThemeFromTexture(solid(16, 16, color), { fillMode: 'palette' })
      const background = rgbaToHex(color)
      const ratio =
        (Math.max(relativeLuminance(theme.text.fill), relativeLuminance(background)) + 0.05) /
        (Math.min(relativeLuminance(theme.text.fill), relativeLuminance(background)) + 0.05)
      expect(ratio, `底色 ${background} 的文字对比度`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('描边色取自色卡且与文字色有区分', () => {
    const theme = buildThemeFromTexture(blockTexture(), { fillMode: 'palette' })
    expect(theme.text.shadow).toBeTruthy()
    expect(theme.text.shadow).not.toBe(theme.text.fill)
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

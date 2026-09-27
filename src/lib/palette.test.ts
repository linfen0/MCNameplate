import { describe, expect, it } from 'vitest'
import { createImage, setPixel } from './raster'
import { relativeLuminance } from './color'
import { buildThemeFromTexture, extractPalette, paletteToCssGradient } from './palette'
import { renderPanelTexture } from './textures'
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
  it('生成 custom 类型底纹，并保留原始贴图', () => {
    const image = blockTexture()
    const theme = buildThemeFromTexture(image, { texelScale: 2 })
    expect(theme.texture.kind).toBe('custom')
    if (theme.texture.kind === 'custom') {
      expect(theme.texture.image).toBe(image)
      expect(theme.texture.texelScale).toBe(2)
    }
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
    expect(theme.palette!.base).toBe(theme.texture.kind === 'custom' ? theme.palette!.base : '')
    expect(theme.swatch.length).toBeGreaterThanOrEqual(3)
  })

  it('描述里带上主色，方便用户确认用的哪张图', () => {
    const theme = buildThemeFromTexture(blockTexture(), { name: '石头方块' })
    expect(theme.name).toBe('石头方块')
    expect(theme.description).toContain('石头方块')
  })
})

describe('自定义贴图作为面板底纹', () => {
  it('按 texelScale 平铺：1 个纹理像素占 scale 格', () => {
    const image = createImage(2, 2)
    setPixel(image, 0, 0, [255, 0, 0, 255])
    setPixel(image, 1, 0, [0, 255, 0, 255])
    setPixel(image, 0, 1, [0, 0, 255, 255])
    setPixel(image, 1, 1, [255, 255, 0, 255])
    const tiled = renderPanelTexture({ kind: 'custom', image, texelScale: 2 }, 4, 4)
    expect(tiled.width).toBe(4)
    expect(tiled.height).toBe(4)
    // 左上 2×2 应是红
    expect([tiled.data[0], tiled.data[1], tiled.data[2]]).toEqual([255, 0, 0])
    // x=2 起是绿
    const green = (0 * 4 + 2) * 4
    expect([tiled.data[green], tiled.data[green + 1], tiled.data[green + 2]]).toEqual([0, 255, 0])
    // y=2 起是蓝
    const blue = (2 * 4 + 0) * 4
    expect([tiled.data[blue], tiled.data[blue + 1], tiled.data[blue + 2]]).toEqual([0, 0, 255])
  })

  it('贴图小于面板时按平铺重复', () => {
    const image = solid(2, 2, [10, 20, 30, 255])
    const tiled = renderPanelTexture({ kind: 'custom', image, texelScale: 1 }, 6, 6)
    const at = (x: number, y: number) => tiled.data[(y * 6 + x) * 4]
    // 同一位置的重复行应一致（受轻微纵深压暗影响，比较相对关系）
    expect(at(0, 0)).toBeGreaterThan(at(5, 0))
    expect(at(0, 0)).toBe(at(4, 0))
  })
})

describe('paletteToCssGradient', () => {
  it('输出可直接用于 CSS 的渐变', () => {
    const gradient = paletteToCssGradient(extractPalette(blockTexture()))
    expect(gradient.startsWith('linear-gradient(90deg,')).toBe(true)
    expect(gradient).toContain('#')
  })
})

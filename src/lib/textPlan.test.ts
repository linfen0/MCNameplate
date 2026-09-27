import { describe, expect, it } from 'vitest'
import { createImage, setPixel } from './raster'
import { relativeLuminance } from './color'
import { extractPalette } from './palette'
import { planText } from './textPlan'
import type { RgbaImage } from './types'

function stripes(light: [number, number, number], dark: [number, number, number]): RgbaImage {
  const image = createImage(16, 16)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const color = x % 2 === 0 ? light : dark
      setPixel(image, x, y, [color[0], color[1], color[2], 255])
    }
  }
  return image
}

/**
 * 用户实测的“丑图”场景：浅金色竖条花底 + 亮字被压成黑字。
 * 期望：不给文字压黑，改用「亮字 + 同族描边」。
 */
function planFor(image: RgbaImage) {
  const palette = extractPalette(image)
  return {
    palette,
    style: planText({
      swatches: [palette.light, palette.accent, palette.dark, palette.base],
      background: { dark: palette.dark, light: palette.light, lightBackground: palette.luminance > 0.32 },
      tint: palette.base,
    }),
  }
}

describe('planText：亮字优先，绝不给 ID 压黑', () => {
  it('浅金色花底 → 亮字 + 同族描边，文字比底纹更亮', () => {
    const { palette, style } = planFor(stripes([216, 180, 92], [240, 217, 138]))
    expect(style.route).toBe('halo')
    expect(style.outline).toBeTruthy()
    expect(style.contrast).toBeGreaterThanOrEqual(4.5)
    expect(relativeLuminance(style.fill)).toBeGreaterThan(relativeLuminance(palette.light))
    expect(style.fill).not.toBe('#ffffff')
    expect(style.outline).not.toBe('#000000')
    // 描边要看得见轮廓：1.4.11 的 3:1
    expect(style.outlineContrast).not.toBeNull()
    expect(style.outlineContrast!).toBeGreaterThanOrEqual(3)
  })

  it('浅纯色底（白色方块）→ 亮字 + 描边，而不是黑字', () => {
    const image = createImage(8, 8)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) setPixel(image, x, y, [242, 242, 242, 255])
    const { style } = planFor(image)
    expect(style.route).toBe('halo')
    expect(relativeLuminance(style.fill)).toBeGreaterThan(0.5)
  })

  it('深色底 → 亮字直接压在底纹上（不需要描边，底纹一点不动）', () => {
    const image = createImage(8, 8)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) setPixel(image, x, y, [30, 30, 40, 255])
    const { style } = planFor(image)
    expect(style.route).toBe('palette')
    expect(style.outline).toBeNull()
    expect(style.contrast).toBeGreaterThanOrEqual(4.5)
  })

  it('中灰底也走亮字 + 描边，不再退回近黑字', () => {
    const image = createImage(8, 8)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) setPixel(image, x, y, [128, 128, 128, 255])
    const { style } = planFor(image)
    expect(style.route).toBe('halo')
    expect(relativeLuminance(style.fill)).toBeGreaterThan(0.5)
  })

  it('同一张贴图反复取色结果稳定', () => {
    const image = stripes([216, 180, 92], [240, 217, 138])
    expect(planFor(image).style).toEqual(planFor(image).style)
  })
})

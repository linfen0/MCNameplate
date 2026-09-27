import { describe, expect, it } from 'vitest'
import { createImage, setPixel } from './raster'
import { relativeLuminance } from './color'
import { extractPalette } from './palette'
import { planText } from './textPlan'
import type { RgbaImage } from './types'

function solid(size: number, color: [number, number, number]): RgbaImage {
  const image = createImage(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) setPixel(image, x, y, [color[0], color[1], color[2], 255])
  }
  return image
}

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

/** 用户实测的“丑图”场景：浅金色竖条花底 */
function planFor(image: RgbaImage, outline = false) {
  const palette = extractPalette(image)
  return {
    palette,
    style: planText({
      swatches: [palette.light, palette.accent, palette.dark, palette.base],
      background: { dark: palette.dark, light: palette.light, lightBackground: palette.luminance > 0.32 },
      tint: palette.base,
      outline,
      // 名牌 ID 实际是几百像素高的大字
      textHeightPx: 200,
    }),
  }
}

describe('planText：亮字优先，绝不给 ID 压黑', () => {
  it('深色底 → 亮字直接压在底纹上（底纹一点不动）', () => {
    const { style } = planFor(solid(8, [30, 30, 40]))
    expect(style.route).toBe('palette')
    expect(style.outline).toBeNull()
    expect(style.scrim).toBeNull()
    expect(style.contrast).toBeGreaterThanOrEqual(style.threshold)
    expect(style.shadow).toBeTruthy()
  })

  it('中灰底：文字留在色卡附近，靠最轻的一档柔化底达标（不推成近白 / 近黑）', () => {
    const { style } = planFor(solid(8, [128, 128, 128]))
    expect(style.threshold).toBe(3)
    expect(style.largeText).toBe(true)
    expect(style.route).toBe('scrim')
    expect(style.scrim!.alpha).toBeLessThanOrEqual(0.58)
    expect(style.contrast).toBeGreaterThanOrEqual(style.threshold)
    expect(relativeLuminance(style.fill)).toBeGreaterThan(0.35)
    expect(style.fill).not.toBe('#ffffff')
  })

  it('棕金色材质（用户实测那张）：文字不再是近白，而是色卡附近的暖金 + 最轻柔化底', () => {
    // 60% #926e3f / 20% #9a7442 / 20% #452d14
    const image = createImage(16, 16)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const color: [number, number, number] =
          x < 10 ? [146, 110, 63] : x < 13 ? [154, 116, 66] : [69, 45, 20]
        setPixel(image, x, y, [color[0], color[1], color[2], 255])
      }
    }
    const palette = extractPalette(image)
    const style = planText({
      swatches: [palette.light, palette.accent, palette.dark, palette.base],
      background: { dark: palette.dark, light: palette.light, lightBackground: palette.luminance > 0.32 },
      tint: palette.base,
      textHeightPx: 200,
    })
    expect(style.contrast).toBeGreaterThanOrEqual(style.threshold)
    // 关键：不再一路推到近白，而是停在材质里那档暖棕
    expect(relativeLuminance(style.fill)).toBeLessThanOrEqual(0.6)
    expect(relativeLuminance(style.fill)).toBeGreaterThan(0.25)
    expect(style.fill).not.toBe('#ffffff')
    // 而且文字色是色卡附近的那几档
    expect(style.distance).toBeLessThanOrEqual(2)
  })

  it('浅金色花底 → 亮字 + 同族投影 + 最轻的一档柔化底，文字仍然比底纹亮', () => {
    const { palette, style } = planFor(stripes([216, 180, 92], [193, 155, 71]))
    expect(style.route).toBe('scrim')
    expect(style.outline).toBeNull()
    expect(style.shadow).toBeTruthy()
    expect(style.contrast).toBeGreaterThanOrEqual(style.threshold)
    expect(style.scrim!.alpha).toBeLessThanOrEqual(0.58)
    expect(relativeLuminance(style.fill)).toBeGreaterThan(relativeLuminance(palette.dark))
    expect(style.fill).not.toBe('#ffffff')
    expect(style.shadow).not.toBe('#000000')
  })

  it('白纸一样的底 → 同族暗色文字 + 亮投影（此时暗字才是正解，底纹依旧不动）', () => {
    const { style } = planFor(solid(8, [244, 244, 244]))
    expect(style.route).toBe('dark')
    expect(style.scrim).toBeNull()
    expect(style.contrast).toBeGreaterThanOrEqual(style.threshold)
    expect(style.fill).not.toBe('#000000')
  })

  it('开了「同族描边」就走描边路线，并且不再叠投影', () => {
    const { style } = planFor(stripes([216, 180, 92], [193, 155, 71]), true)
    expect(style.route).toBe('halo')
    expect(style.outline).toBeTruthy()
    expect(style.shadow).toBeNull()
    expect(style.contrast).toBeGreaterThanOrEqual(style.threshold)
  })

  it('同一张贴图反复取色结果稳定', () => {
    const image = stripes([216, 180, 92], [193, 155, 71])
    expect(planFor(image).style).toEqual(planFor(image).style)
  })
})

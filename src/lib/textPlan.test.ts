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

  it('中灰底按大字阈值直接达标，不再退回近黑字', () => {
    const { style } = planFor(solid(8, [128, 128, 128]))
    expect(style.threshold).toBe(3)
    expect(style.largeText).toBe(true)
    expect(style.route).toBe('palette')
    expect(relativeLuminance(style.fill)).toBeGreaterThan(0.5)
  })

  it('浅金色花底 → 亮字 + 同族投影 + 最轻的一档柔化底，文字仍然比底纹亮', () => {
    const { palette, style } = planFor(stripes([216, 180, 92], [193, 155, 71]))
    expect(style.route).toBe('scrim')
    expect(style.outline).toBeNull()
    expect(style.shadow).toBeTruthy()
    expect(style.contrast).toBeGreaterThanOrEqual(style.threshold)
    expect(style.scrim!.alpha).toBeLessThanOrEqual(0.44)
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

import { describe, expect, it } from 'vitest'
import {
  hexToHsl,
  hexToRgba,
  hslToHex,
  mixHex,
  relativeLuminance,
  rgbaToHex,
  rotateHueToward,
  shadeHex,
  toneOf,
} from './color'

describe('hexToRgba', () => {
  it('解析 3 / 6 / 8 位十六进制', () => {
    expect(hexToRgba('#fff')).toEqual([255, 255, 255, 255])
    expect(hexToRgba('#000000')).toEqual([0, 0, 0, 255])
    expect(hexToRgba('#ff8800')).toEqual([255, 136, 0, 255])
    expect(hexToRgba('#11223344')).toEqual([17, 34, 51, 68])
  })

  it('非法输入返回透明黑而不是抛错', () => {
    expect(hexToRgba('not-a-color')).toEqual([0, 0, 0, 255])
    expect(hexToRgba('#12', 128)).toEqual([0, 0, 0, 128])
  })

  it('round-trip 保持颜色不变', () => {
    expect(rgbaToHex(hexToRgba('#6aa84f'))).toBe('#6aa84f')
    expect(rgbaToHex([1.4, 200.6, 30, 255])).toBe('#01c91e')
  })
})

describe('shadeHex / mixHex', () => {
  it('正向变亮、负向变暗、0 保持原色', () => {
    expect(shadeHex('#808080', 1)).toBe('#ffffff')
    expect(shadeHex('#808080', -1)).toBe('#000000')
    expect(shadeHex('#808080', 0)).toBe('#808080')
    expect(shadeHex('#000000', 0.5)).toBe('#808080')
  })

  it('mixHex 端点与中间值正确', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('HSL 与同族中性色（tonal palette）', () => {
  it('RGB ↔ HSL 往返一致', () => {
    for (const hex of ['#d9a227', '#1e1e28', '#ffffff', '#000000', '#0f6f4a']) {
      expect(hslToHex(hexToHsl(hex))).toBe(hex)
    }
    expect(hexToHsl('#ffffff')).toEqual({ h: 0, s: 0, l: 1 })
    expect(hexToHsl('#000000')).toEqual({ h: 0, s: 0, l: 0 })
    expect(hexToHsl('#ff0000')).toEqual({ h: 0, s: 1, l: 0.5 })
  })

  it('色相沿最短路径旋转', () => {
    expect(rotateHueToward(10, 350, 1)).toBeCloseTo(350, 6)
    expect(rotateHueToward(350, 10, 1)).toBeCloseTo(10, 6)
    expect(rotateHueToward(0, 90, 0.5)).toBeCloseTo(45, 6)
    expect(rotateHueToward(0, 90, 0)).toBeCloseTo(0, 6)
  })

  it('toneOf 保留底色色相、压低彩度、把明度推到指定档位', () => {
    // 高彩度上限时看色相是否原样保留（低彩度下 8bit 量化会让色相抖动，不适合断言）
    const vivid = hexToHsl(toneOf('#d9a227', 'light', { lightness: 0.94, maxChroma: 0.4, hueShift: 0 }))
    expect(vivid.l).toBeCloseTo(0.94, 2)
    expect(vivid.s).toBeGreaterThan(0.3)
    expect(Math.abs(vivid.h - hexToHsl('#d9a227').h)).toBeLessThan(2)

    const tone = toneOf('#d9a227', 'light', { lightness: 0.94, maxChroma: 0.12, hueShift: 0 })
    expect(hexToHsl(tone).s).toBeCloseTo(0.12, 1)
    expect(hexToHsl(tone).s).toBeLessThan(vivid.s)
    // 明度上去了但仍是暖色（红 > 蓝），不是纯白
    expect(tone).not.toBe('#ffffff')
    expect(hexToHsl(tone).h).toBeLessThan(90)
  })

  it('亮部偏暖、暗部偏冷：像素画的 hue shifting', () => {
    const source = hexToHsl('#3f6ea8').h
    const warm = hexToHsl(toneOf('#3f6ea8', 'light', { lightness: 0.94, hueShift: 0.22 })).h
    const cool = hexToHsl(toneOf('#3f6ea8', 'dark', { lightness: 0.1, hueShift: 0.22 })).h
    expect(warm).toBeLessThan(source)
    expect(cool).toBeGreaterThan(source)
    expect(relativeLuminance(toneOf('#3f6ea8', 'dark', { lightness: 0.1 }))).toBeLessThan(0.05)
  })

  it('中性色永远不是纯白 / 纯黑', () => {
    for (const source of ['#d9a227', '#3f6ea8', '#808080', '#000000', '#ffffff']) {
      for (const direction of ['light', 'dark'] as const) {
        const tone = toneOf(source, direction, { lightness: direction === 'light' ? 0.94 : 0.1 })
        expect(['#ffffff', '#000000']).not.toContain(tone)
      }
    }
  })
})

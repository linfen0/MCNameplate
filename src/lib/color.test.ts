import { describe, expect, it } from 'vitest'
import { hexToRgba, mixHex, rgbaToHex, shadeHex } from './color'

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

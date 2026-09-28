import { describe, expect, it } from 'vitest'
import { getPixelFont, fitWrappedText, measureText, wrapText } from './pixelFont'

const font = getPixelFont('mojangles')

describe('wrapText：按 ID 的书写习惯折行', () => {
  it('优先在分隔符（下划线）之后断', () => {
    const lines = wrapText(font, 'NOTCH_2024', 2)
    expect(lines).toEqual(['NOTCH_', '2024'])
  })

  it('没有分隔符时在字母 / 数字交界处断', () => {
    expect(wrapText(font, 'PLAYER2024', 2)).toEqual(['PLAYER', '2024'])
  })

  it('一行放得下就不折', () => {
    expect(wrapText(font, 'AB', 2)).toEqual(['AB'])
  })

  it('折出来的行放回去还是原文（不丢字符、不加字符）', () => {
    for (const id of ['NOTCH_2024', 'PLAYER2024', 'A_B_C_D_E', 'HELLOWORLD']) {
      expect(wrapText(font, id, 3).join('')).toBe(id)
    }
  })

  it('行数不会超过上限', () => {
    expect(wrapText(font, 'NOTCH_2024_EXTRA', 2).length).toBeLessThanOrEqual(2)
    expect(wrapText(font, 'NOTCH_2024_EXTRA', 3).length).toBeLessThanOrEqual(3)
  })

  it('折得均匀：最长的一行不会比短行宽太多', () => {
    const lines = wrapText(font, 'NOTCH_2024', 2)
    const widths = lines.map((line) => measureText(font, line).advance)
    expect(Math.abs(widths[0] - widths[1])).toBeLessThan(Math.max(...widths))
  })
})

describe('fitWrappedText：在固定矩形里把文字放到最大', () => {
  it('一行放得下就用一行，且字号尽量大', () => {
    const fit = fitWrappedText(font, 'NOTCH', { width: 400, height: 200 }, { maxLines: 2 })
    expect(fit.lines).toEqual(['NOTCH'])
    expect(fit.scale).toBeGreaterThan(1)
    const size = measureText(font, 'NOTCH').advance * fit.scale
    expect(size).toBeLessThanOrEqual(400)
  })

  it('一行放不下时折行换字号，仍然不超出矩形', () => {
    const box = { width: 300, height: 200 }
    const one = fitWrappedText(font, 'NOTCH_2024', box, { maxLines: 1 })
    const two = fitWrappedText(font, 'NOTCH_2024', box, { maxLines: 2 })
    expect(two.lines.length).toBe(2)
    // 两行版本用到的面积不会更差
    expect(two.scale * two.lines.length).toBeGreaterThanOrEqual(one.scale)
    for (const line of two.lines) {
      expect(measureText(font, line).advance * two.scale).toBeLessThanOrEqual(box.width)
    }
    expect(two.lines.length * two.lineHeight * two.scale).toBeLessThanOrEqual(box.height)
  })

  it('窄而高的矩形里，折行能换来更大的字', () => {
    const long = 'SUPER_LONG_PLAYER_NAME'
    const box = { width: 260, height: 240 }
    const one = fitWrappedText(font, long, box, { maxLines: 1 })
    const three = fitWrappedText(font, long, box, { maxLines: 3 })
    expect(three.scale).toBeGreaterThan(one.scale)
    expect(three.lines.join('')).toBe(long)
  })

  it('矩形极小时至少给 1 倍（不出现 0 或负数）', () => {
    const fit = fitWrappedText(font, 'NOTCH', { width: 4, height: 4 }, { maxLines: 2 })
    expect(fit.scale).toBeGreaterThanOrEqual(1)
  })
})

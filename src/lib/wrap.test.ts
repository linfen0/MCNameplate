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

  it('要几行就折几行（用几行由 fit 决定，不在这里）', () => {
    expect(wrapText(font, 'AB', 1)).toEqual(['AB'])
    expect(wrapText(font, 'AB', 2)).toEqual(['A', 'B'])
    expect(wrapText(font, 'NOTCH', 2)).toEqual(['NOT', 'CH'])
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

describe('fitWrappedText：在固定矩形里把文字放到设计目标', () => {
  it('一行到得了目标就不折行', () => {
    const fit = fitWrappedText(font, 'NOTCH', { width: 600, height: 200 }, { maxLines: 2, targetScale: 10 })
    expect(fit.lines).toEqual(['NOTCH'])
    expect(fit.scale).toBe(10)
  })

  it('字号不会超过设计目标（短 ID 不会撑满整块名牌）', () => {
    const fit = fitWrappedText(font, 'AB', { width: 2000, height: 400 }, { maxLines: 2, targetScale: 20 })
    expect(fit.scale).toBe(20)
    expect(fit.lines).toEqual(['AB'])
  })

  it('一行太宽到不了目标时折行去够，且不超出矩形', () => {
    const box = { width: 260, height: 200 }
    const one = fitWrappedText(font, 'NOTCH_2024', box, { maxLines: 1, targetScale: 20 })
    const two = fitWrappedText(font, 'NOTCH_2024', box, { maxLines: 2, targetScale: 20 })
    expect(two.lines).toEqual(['NOTCH_', '2024'])
    expect(two.scale).toBeGreaterThan(one.scale)
    for (const line of two.lines) {
      expect(measureText(font, line).advance * two.scale).toBeLessThanOrEqual(box.width)
    }
    expect(two.lines.length * two.lineHeight * two.scale).toBeLessThanOrEqual(box.height)
  })

  it('折到上限也够不到目标时，取能放最大的那一组', () => {
    const long = 'SUPER_LONG_PLAYER_NAME'
    const box = { width: 200, height: 160 }
    const one = fitWrappedText(font, long, box, { maxLines: 1, targetScale: 40 })
    const three = fitWrappedText(font, long, box, { maxLines: 3, targetScale: 40 })
    // 断点只有分隔符：折出来是 2 行（再往下就得把单词劈开，不值得）
    expect(three.lines.length).toBeGreaterThan(1)
    expect(three.scale).toBeGreaterThan(one.scale)
    expect(three.lines.join('')).toBe(long)
  })

  it('折行不丢字符、不加字符', () => {
    const box = { width: 240, height: 200 }
    for (const id of ['NOTCH_2024', 'PLAYER2024', 'A_B_C_D_E_F']) {
      expect(fitWrappedText(font, id, box, { maxLines: 3, targetScale: 30 }).lines.join('')).toBe(id)
    }
  })

  it('矩形极小时至少给 1 倍（不出现 0 或负数）', () => {
    const fit = fitWrappedText(font, 'NOTCH', { width: 4, height: 4 }, { maxLines: 2 })
    expect(fit.scale).toBeGreaterThanOrEqual(1)
  })
})

import { describe, expect, it } from 'vitest'
import type { RgbaImage } from './types'
import { BITMAP_FONTS } from './bitmapFontData'
import {
  DEFAULT_FONT_ID,
  PIXEL_FONTS,
  fitTextScale,
  fontMetrics,
  getPixelFont,
  isTextSupported,
  measureText,
  renderTextBlock,
  textInkMetrics,
} from './pixelFont'

/** 假测量函数：每个字符 5 个原生像素宽 */
const measure = (text: string): number => text.length * 5

describe('字体表', () => {
  it('每个字体都有完整的元数据', () => {
    expect(PIXEL_FONTS.length).toBeGreaterThan(0)
    for (const font of PIXEL_FONTS) {
      expect(font.id).toBeTruthy()
      expect(font.name).toBeTruthy()
      expect(font.nativeSize).toBeGreaterThan(0)
    }
  })

  it('未知字体回退到默认字体', () => {
    expect(getPixelFont('not-exist').id).toBe(PIXEL_FONTS[0].id)
    expect(getPixelFont(DEFAULT_FONT_ID).id).toBe(DEFAULT_FONT_ID)
  })
})

describe('内置点阵字库', () => {
  const PRINTABLE_ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))

  it('两个字体都覆盖全部可打印 ASCII', () => {
    for (const data of BITMAP_FONTS) {
      const missing = PRINTABLE_ASCII.filter((ch) => !data.glyphs[ch.charCodeAt(0)])
      expect(missing, `${data.name} 缺少字形`).toEqual([])
    }
  })

  it('除空格外每个字形都有墨迹，且步进宽度为正', () => {
    for (const data of BITMAP_FONTS) {
      for (const ch of PRINTABLE_ASCII) {
        const glyph = data.glyphs[ch.charCodeAt(0)]
        expect(glyph.advance, `${data.name} "${ch}" 步进宽度`).toBeGreaterThan(0)
        if (ch === ' ') {
          expect(glyph.h, `${data.name} 空格不应有墨迹`).toBe(0)
          continue
        }
        expect(glyph.h, `${data.name} "${ch}" 墨迹高度`).toBeGreaterThan(0)
        expect(glyph.w, `${data.name} "${ch}" 墨迹宽度`).toBeGreaterThan(0)
        // 行掩码必须落在宽度范围内，否则说明烘焙时越界了
        for (const row of glyph.rows) {
          expect(row).toBeLessThan(1 << glyph.w)
          expect(row).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('墨迹行数与字形高度一致', () => {
    for (const data of BITMAP_FONTS) {
      for (const ch of PRINTABLE_ASCII) {
        const glyph = data.glyphs[ch.charCodeAt(0)]
        expect(glyph.rows.length, `${data.name} "${ch}"`).toBe(glyph.h)
      }
    }
  })
})

describe('measureText', () => {
  it('推进宽度等于各字形 advance 之和', () => {
    const font = getPixelFont('silkscreen')
    const text = 'NOTCH_2024'
    const expected = [...text].reduce((sum, ch) => sum + font.data.glyphs[ch.charCodeAt(0)].advance, 0)
    expect(measureText(font, text).advance).toBe(expected)
  })

  it('空字符串宽度为 0', () => {
    expect(measureText(getPixelFont('silkscreen'), '').advance).toBe(0)
  })

  it('墨迹宽度不超过推进宽度', () => {
    for (const font of PIXEL_FONTS) {
      const { advance, inkWidth } = measureText(font, 'Wyoming_42')
      expect(inkWidth).toBeLessThanOrEqual(advance)
      expect(inkWidth).toBeGreaterThan(0)
    }
  })

  it('字库不支持的字符会被标记出来', () => {
    const font = getPixelFont('silkscreen')
    expect(isTextSupported(font, 'Notch_2024')).toBe(true)
    expect(isTextSupported(font, '玩家名')).toBe(false)
  })
})

describe('fontMetrics / textInkMetrics', () => {
  it('字体全局度量 = ascent + descent', () => {
    for (const font of PIXEL_FONTS) {
      const metrics = fontMetrics(font)
      expect(metrics.lineHeight).toBe(metrics.ascent + metrics.descent)
      expect(metrics.ascent).toBeGreaterThan(3)
      expect(metrics.ascent).toBeLessThanOrEqual(10)
    }
  })

  it('按具体文字算墨迹：字母 5 行，带下划线多 1 行', () => {
    const font = getPixelFont('silkscreen')
    const letters = textInkMetrics(font, 'NOTCH')
    expect(letters.top).toBe(-5)
    expect(letters.bottom).toBe(0)
    expect(letters.height).toBe(5)
    // '_' 落在基线行上，块高必须够，否则关掉阴影时会被裁掉
    const withUnderscore = textInkMetrics(font, 'NOTCH_2024')
    expect(withUnderscore.bottom).toBe(1)
    expect(withUnderscore.height).toBe(6)
  })

  it('空字符串回退到字体 ascent，不会算出 0 高', () => {
    const font = getPixelFont('silkscreen')
    expect(textInkMetrics(font, '').height).toBeGreaterThan(0)
  })

  it('任何字形都不会超出块高（防止烘焙度量偏小导致裁切）', () => {
    for (const font of PIXEL_FONTS) {
      for (let code = 32; code <= 126; code++) {
        const ch = String.fromCharCode(code)
        const glyph = font.data.glyphs[code]
        if (!glyph || glyph.h === 0) continue
        const ink = textInkMetrics(font, ch)
        expect(glyph.y, `${font.name} "${ch}" 顶边`).toBeGreaterThanOrEqual(ink.top)
        expect(glyph.y + glyph.h, `${font.name} "${ch}" 底边`).toBeLessThanOrEqual(ink.bottom)
      }
    }
  })
})

describe('fitTextScale', () => {
  const options = { maxWidth: 100, maxHeight: 1000, lineHeight: 8, padding: 0 }

  it('宽度受限时按宽度取倍率', () => {
    expect(fitTextScale(measure, 'ABCD', options)).toBe(5)
  })

  it('高度受限时按高度取倍率', () => {
    expect(fitTextScale(measure, 'ABCD', { ...options, maxWidth: 1000, maxHeight: 32 })).toBe(4)
  })

  it('多行文本按行数计算高度', () => {
    expect(fitTextScale(measure, 'AB\nCD', { ...options, maxWidth: 1000, maxHeight: 32 })).toBe(2)
  })

  it('对称留白计入尺寸', () => {
    expect(fitTextScale(measure, 'ABCD', { ...options, padding: 5 })).toBe(3)
  })

  it('至少返回 minScale，且不超过 maxScale', () => {
    expect(fitTextScale(measure, 'A'.repeat(500), options)).toBe(1)
    expect(fitTextScale(measure, 'A', { ...options, maxWidth: 10000, maxHeight: 10000, maxScale: 12 })).toBe(12)
  })

  it('倍率对任何尺寸都是整数（保证像素硬边）', () => {
    for (const size of [512, 1024, 2048, 4096]) {
      for (const text of ['A', 'Steve', 'Notch_12345', 'A'.repeat(16)]) {
        const scale = fitTextScale(measure, text, {
          maxWidth: size * 0.5,
          maxHeight: size * 0.5,
          lineHeight: 5,
          padding: 1,
        })
        expect(Number.isInteger(scale)).toBe(true)
      }
    }
  })
})

/** 墨迹包围盒（含投影/描边）：用来验证"块内居中" */
function inkBounds(image: RgbaImage) {
  let left = image.width
  let right = -1
  let top = image.height
  let bottom = -1
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] === 0) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return { left, right, top, bottom }
}

describe('renderTextBlock（不依赖任何字体文件）', () => {
  it('输出像素的 alpha 只有 0 或 255 —— 硬边是构造保证', () => {
    for (const font of PIXEL_FONTS) {
      const block = renderTextBlock({
        text: 'Notch_2024',
        font,
        fill: '#ffffff',
        shadow: { color: '#15171a', offset: 1 },
      })
      const alphas = new Set<number>()
      for (let i = 3; i < block.image.data.length; i += 4) alphas.add(block.image.data[i])
      expect([...alphas].sort((a, b) => a - b), `${font.name} alpha 集合`).toEqual([0, 255])
    }
  })

  it('有墨迹，且文字块尺寸与字库度量一致', () => {
    const font = getPixelFont('silkscreen')
    const block = renderTextBlock({ text: 'ABC', font, fill: '#ffffff' })
    expect(block.image.height).toBe(textInkMetrics(font, 'ABC').height)
    // 宽度按墨迹跨度算（不含末尾步进空隙），这样折行后每行才能真正居中
    const measured = measureText(font, 'ABC')
    expect(block.image.width).toBe(measured.inkWidth - measured.inkFrom)
    let opaque = 0
    for (let i = 3; i < block.image.data.length; i += 4) if (block.image.data[i] > 0) opaque++
    expect(opaque).toBeGreaterThan(20)
  })

  it('阴影/描边让块变大，并且墨迹在块里四周留白相等（按块居中＝视觉居中）', () => {
    const font = getPixelFont('silkscreen')
    const plain = renderTextBlock({ text: 'A', font, fill: '#ffffff' })
    const shadowed = renderTextBlock({
      text: 'A',
      font,
      fill: '#ffffff',
      shadow: { color: '#000000', offset: 1 },
    })
    expect(shadowed.padding).toBe(1)
    expect(shadowed.image.width).toBe(plain.image.width + 3)
    expect(shadowed.image.height).toBe(plain.image.height + 3)
    const bounds = inkBounds(shadowed.image)
    expect(bounds.left).toBe(shadowed.image.width - 1 - bounds.right)
    expect(bounds.top).toBe(shadowed.image.height - 1 - bounds.bottom)
  })

  it('折行后每一行各自居中', () => {
    const font = getPixelFont('mojangles')
    const block = renderTextBlock({ text: 'NOTCH_\n2024', font, fill: '#ffffff', lineGap: 1 })
    expect(block.lineOffsets.length).toBe(2)
    // 短的那行（2024）起点更靠右，两行的墨迹中心对齐
    const [first, second] = block.lineOffsets
    expect(second).toBeGreaterThanOrEqual(first)
    const bounds = inkBounds(block.image)
    expect(bounds.left).toBe(block.image.width - 1 - bounds.right)
  })

  it('lineGap 只作用在行与行之间', () => {
    const font = getPixelFont('mojangles')
    const tight = renderTextBlock({ text: 'A\nB', font, fill: '#ffffff' })
    const gap = renderTextBlock({ text: 'A\nB', font, fill: '#ffffff', lineGap: 2 })
    expect(gap.image.height).toBe(tight.image.height + 2)
    expect(gap.lineGap).toBe(2)
  })

  it('描边会把字块四周各扩 1 像素', () => {
    const font = getPixelFont('silkscreen')
    const block = renderTextBlock({ text: 'A', font, fill: '#ffffff', outline: '#000000' })
    expect(block.padding).toBe(1)
  })

  it('不支持的字符会画成占位方块并置 supported=false', () => {
    const font = getPixelFont('silkscreen')
    const block = renderTextBlock({ text: '你好', font, fill: '#ffffff' })
    expect(block.supported).toBe(false)
    let opaque = 0
    for (let i = 3; i < block.image.data.length; i += 4) if (block.image.data[i] > 0) opaque++
    expect(opaque).toBeGreaterThan(0)
  })

  it('占位文字的透明度会真实反映到 alpha 上', () => {
    const font = getPixelFont('silkscreen')
    const block = renderTextBlock({ text: 'YOUR_ID', font, fill: '#ffffff', opacity: 0.4 })
    const alphas = new Set<number>()
    for (let i = 3; i < block.image.data.length; i += 4) alphas.add(block.image.data[i])
    expect([...alphas].sort((a, b) => a - b)).toEqual([0, 102])
  })
})

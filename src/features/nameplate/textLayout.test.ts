import { describe, expect, it } from 'vitest'
import { getPixelFont, measureText } from '../../lib/pixelFont'
import { getTheme } from '../../lib/themes'
import type { RgbaImage } from '../../lib/types'
import type { Rect } from '../../lib/types'
import { DEFAULT_CONFIG } from './config'
import { layoutIdText } from './textLayout'

const font = getPixelFont('mojangles')
const theme = getTheme('deepslate')
const WIDE: Rect = { x: 100, y: 50, width: 1400, height: 400 }
const NARROW: Rect = { x: 100, y: 50, width: 300, height: 400 }

/** 点阵里的墨迹包围盒（原生像素） */
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

describe('layoutIdText：文字在矩形里居中', () => {
  it('单行 ID 的墨迹在 ID 框里水平 + 垂直居中（含投影也算进去）', () => {
    const id = layoutIdText(font, theme, { ...DEFAULT_CONFIG, id: 'NOTCH_2024' }, WIDE)
    expect(id.lines.length).toBe(1)
    const ink = inkBounds(id.block.image)
    const centerX = id.placement.x + ((ink.left + ink.right + 1) / 2) * id.scale
    const centerY = id.placement.y + ((ink.top + ink.bottom + 1) / 2) * id.scale
    const tolerance = id.scale
    expect(Math.abs(centerX - (WIDE.x + WIDE.width / 2))).toBeLessThanOrEqual(tolerance)
    expect(Math.abs(centerY - (WIDE.y + WIDE.height / 2))).toBeLessThanOrEqual(tolerance)
  })

  it('折行后每一行的墨迹中心互相对齐', () => {
    const id = layoutIdText(
      font,
      theme,
      { ...DEFAULT_CONFIG, id: 'NOTCH_2024', maxIdLines: 2 },
      NARROW,
    )
    expect(id.lines.length).toBe(2)
    const centers = id.lines.map(
      (line, index) =>
        id.block.lineOffsets[index] +
        measureText(font, line).inkFrom +
        (measureText(font, line).inkWidth - measureText(font, line).inkFrom) / 2,
    )
    expect(Math.abs(centers[0] - centers[1])).toBeLessThanOrEqual(0.5)
  })

  it('折行不丢字符，且字号不超过设计目标（字高 = 铭牌高 × 1/φ²）', () => {
    const id = layoutIdText(
      font,
      theme,
      { ...DEFAULT_CONFIG, id: 'SUPER_LONG_PLAYER_NAME', maxIdLines: 2 },
      NARROW,
    )
    expect(id.lines.join('')).toBe('SUPER_LONG_PLAYER_NAME')
    const target = Math.floor((DEFAULT_CONFIG.height * (1 - 1 / ((1 + Math.sqrt(5)) / 2))) / id.lineHeight)
    expect(id.scale).toBeLessThanOrEqual(Math.max(1, target))
  })
})

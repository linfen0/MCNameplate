import { describe, expect, it } from 'vitest'
import type { Rgba } from './color'
import { createImage, fillRect, getPixel } from './raster'
import {
  HEAD_FRONT,
  HEAD_FRONT_OVERLAY,
  HEAD_SIDE,
  HEAD_TOP,
  SLIM_PROBE,
  extractHead,
  inferSkinModel,
  parseSkin,
  validateSkinSize,
} from './skin'
import type { RgbaImage } from './types'

const SKIN_COLOR: Rgba = [200, 150, 120, 255]
const HAT_COLOR: Rgba = [255, 0, 0, 255]

/** 造一张最小可用的 64×64 皮肤：头部各面填肤色，帽子层前两行涂红 */
function makeModernSkin(): RgbaImage {
  const image = createImage(64, 64)
  fillRect(image, HEAD_FRONT, SKIN_COLOR)
  fillRect(image, HEAD_SIDE, SKIN_COLOR)
  fillRect(image, HEAD_TOP, SKIN_COLOR)
  fillRect(image, { x: 0, y: 8, width: 8, height: 8 }, SKIN_COLOR)
  fillRect(image, { x: 24, y: 8, width: 8, height: 8 }, SKIN_COLOR)
  fillRect(image, { ...HEAD_FRONT_OVERLAY, height: 2 }, HAT_COLOR)
  return image
}

describe('validateSkinSize', () => {
  it('接受 64×64 现代皮肤', () => {
    const result = validateSkinSize(64, 64)
    expect(result.ok).toBe(true)
    expect(result.format).toBe('modern')
    expect(result.errors).toHaveLength(0)
  })

  it('接受 64×32 旧版皮肤并给出提醒', () => {
    const result = validateSkinSize(64, 32)
    expect(result.ok).toBe(true)
    expect(result.format).toBe('legacy')
    expect(result.warnings.join()).toContain('旧版')
  })

  it('拒绝高清皮肤与任意尺寸', () => {
    for (const [w, h] of [
      [128, 128],
      [256, 256],
      [64, 64 * 3],
      [65, 65],
      [32, 32],
    ]) {
      const result = validateSkinSize(w, h)
      expect(result.ok, `${w}×${h} 不应通过`).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    }
  })
})

describe('inferSkinModel', () => {
  it('纤细手臂区域全透明时判定为 slim', () => {
    const image = makeModernSkin()
    expect(inferSkinModel(image, 'modern')).toBe('slim')
  })

  it('纤细手臂区域有像素时判定为 classic', () => {
    const image = makeModernSkin()
    fillRect(image, SLIM_PROBE, SKIN_COLOR)
    expect(inferSkinModel(image, 'modern')).toBe('classic')
  })

  it('旧版皮肤一律为 classic', () => {
    expect(inferSkinModel(createImage(64, 32), 'legacy')).toBe('classic')
  })
})

describe('parseSkin', () => {
  it('正常皮肤没有问题项', () => {
    const skin = parseSkin(makeModernSkin(), 'steve.png')
    expect(skin.issues.filter((issue) => issue.level === 'error')).toHaveLength(0)
    expect(skin.fileName).toBe('steve.png')
    expect(skin.hasOverlay).toBe(true)
  })

  it('尺寸不合法时给出 error 且标记不可渲染', () => {
    const skin = parseSkin(createImage(100, 100))
    expect(skin.issues.some((issue) => issue.level === 'error')).toBe(true)
    expect(skin.hasOverlay).toBe(false)
  })

  it('头部正面全透明时给出 warning', () => {
    const empty = createImage(64, 64)
    const skin = parseSkin(empty)
    expect(skin.issues.some((issue) => issue.message.includes('头部正面完全透明'))).toBe(true)
  })
})

describe('extractHead', () => {
  it('把帽子层合成到脸上，且不影响未覆盖的像素', () => {
    const faces = extractHead(parseSkin(makeModernSkin()))
    expect(faces.faceSize).toBe(8)
    expect(faces.hasOverlay).toBe(true)
    expect(getPixel(faces.front, 0, 0)).toEqual(HAT_COLOR)
    expect(getPixel(faces.front, 0, 1)).toEqual(HAT_COLOR)
    expect(getPixel(faces.front, 4, 4)).toEqual(SKIN_COLOR)
  })

  it('侧面与顶面取到对应坐标', () => {
    const faces = extractHead(parseSkin(makeModernSkin()))
    expect(getPixel(faces.side, 0, 0)).toEqual(SKIN_COLOR)
    expect(getPixel(faces.top, 7, 7)).toEqual(SKIN_COLOR)
  })

  it('旧版皮肤没有第二层，faceSize 仍为 8', () => {
    const legacy = parseSkin(createImage(64, 32))
    const faces = extractHead(legacy)
    expect(faces.hasOverlay).toBe(false)
    expect(faces.faceSize).toBe(8)
  })
})

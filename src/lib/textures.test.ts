import { describe, expect, it } from 'vitest'
import { createImage, getPixel, setPixel } from './raster'
import { getPanelTexture, type PanelTexture } from './textures'
import type { RgbaImage } from './types'

function solidImage(size: number, color: [number, number, number, number]): RgbaImage {
  const image = createImage(size, size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) setPixel(image, x, y, color)
  return image
}

function imageTexture(image: RgbaImage): PanelTexture {
  return { kind: 'image', image, mode: 'nine-slice', texelScale: 1, slice: 2 }
}

describe('getPanelTexture 缓存', () => {
  it('尺寸相同但内容不同的两张贴图，各自生成各自的底纹', () => {
    const red = imageTexture(solidImage(16, [255, 0, 0, 255]))
    const blue = imageTexture(solidImage(16, [0, 0, 255, 255]))
    const first = getPanelTexture(red, 32, 32, 7)
    const second = getPanelTexture(blue, 32, 32, 7)
    // 九宫格会把边角做轻微明暗处理，所以只断言主色相没串
    const [r1, g1, b1] = getPixel(first, 16, 16).slice(0, 3)
    const [r2, g2, b2] = getPixel(second, 16, 16).slice(0, 3)
    expect(r1).toBeGreaterThan(200)
    expect(g1).toBeLessThan(60)
    expect(b2).toBeGreaterThan(200)
    expect(r2).toBeLessThan(60)
  })

  it('同一张贴图 + 同一组参数会命中缓存（返回同一个对象）', () => {
    const texture = imageTexture(solidImage(16, [10, 200, 30, 255]))
    expect(getPanelTexture(texture, 48, 48, 3)).toBe(getPanelTexture(texture, 48, 48, 3))
  })

  it('换尺寸或换九宫格参数不会拿错旧底纹', () => {
    const texture = imageTexture(solidImage(16, [10, 200, 30, 255]))
    const a = getPanelTexture(texture, 48, 48, 3)
    expect(getPanelTexture(texture, 64, 48, 3)).not.toBe(a)
    const wider = getPanelTexture({ ...texture, slice: 4 }, 48, 48, 3)
    expect(wider).not.toBe(a)
  })
})

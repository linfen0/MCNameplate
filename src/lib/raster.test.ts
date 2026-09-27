import { describe, expect, it } from 'vitest'
import type { Rgba } from './color'
import {
  compositeOverlay,
  countOpaquePixels,
  createImage,
  cropRect,
  getPixel,
  isRectTransparent,
  setPixel,
} from './raster'
import type { Rect } from './types'

const RED: Rgba = [255, 0, 0, 255]
const BLUE: Rgba = [0, 0, 255, 255]
const HALF_WHITE: Rgba = [255, 255, 255, 128]

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height }
}

describe('createImage / setPixel / getPixel', () => {
  it('默认全透明，写入后可读回', () => {
    const image = createImage(4, 4)
    expect(getPixel(image, 0, 0)).toEqual([0, 0, 0, 0])
    setPixel(image, 2, 3, RED)
    expect(getPixel(image, 2, 3)).toEqual(RED)
  })

  it('越界读取返回透明、写入被忽略', () => {
    const image = createImage(2, 2)
    setPixel(image, 5, 5, RED)
    expect(getPixel(image, 5, 5)).toEqual([0, 0, 0, 0])
    expect(getPixel(image, -1, 0)).toEqual([0, 0, 0, 0])
    expect(image.data.every((value) => value === 0)).toBe(true)
  })
})

describe('cropRect', () => {
  it('按矩形裁切出独立副本', () => {
    const image = createImage(8, 8)
    setPixel(image, 3, 2, BLUE)
    const cropped = cropRect(image, rect(2, 1, 4, 4))
    expect(cropped.width).toBe(4)
    expect(getPixel(cropped, 1, 1)).toEqual(BLUE)
    setPixel(image, 3, 2, RED)
    expect(getPixel(cropped, 1, 1)).toEqual(BLUE)
  })
})

describe('compositeOverlay', () => {
  it('半透明覆盖层按 source-over 混合', () => {
    const base = createImage(1, 1, BLUE)
    const overlay = createImage(1, 1, HALF_WHITE)
    const merged = compositeOverlay(base, overlay)
    const [r, g, b, a] = getPixel(merged, 0, 0)
    expect(a).toBe(255)
    // 红/绿通道由 0 被白色覆盖层拉高到约一半，蓝通道两者都是 255
    expect(r).toBeCloseTo(128, 0)
    expect(g).toBeCloseTo(128, 0)
    expect(b).toBe(255)
  })

  it('全透明覆盖层不改变基础层', () => {
    const base = createImage(2, 2, RED)
    const merged = compositeOverlay(base, createImage(2, 2))
    expect(getPixel(merged, 1, 1)).toEqual(RED)
  })
})

describe('透明度统计', () => {
  it('isRectTransparent / countOpaquePixels', () => {
    const image = createImage(4, 4)
    expect(isRectTransparent(image, rect(0, 0, 4, 4))).toBe(true)
    setPixel(image, 1, 1, RED)
    expect(isRectTransparent(image, rect(0, 0, 4, 4))).toBe(false)
    expect(isRectTransparent(image, rect(2, 2, 2, 2))).toBe(true)
    expect(countOpaquePixels(image, rect(0, 0, 4, 4))).toBe(1)
  })
})

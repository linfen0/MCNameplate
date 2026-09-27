import { describe, expect, it } from 'vitest'
import {
  GOLDEN_MAJOR,
  GOLDEN_MINOR,
  PHI,
  clampRatio,
  goldenSplit,
  isGoldenRatio,
  snapToGolden,
  summarizeBlocks,
} from './golden'

describe('黄金分割常量', () => {
  it('φ 与长短边占比互为倒数关系', () => {
    expect(PHI).toBeCloseTo(1.618033988749895, 12)
    expect(GOLDEN_MAJOR).toBeCloseTo(0.6180339887498949, 12)
    expect(GOLDEN_MINOR).toBeCloseTo(0.3819660112501051, 12)
    expect(GOLDEN_MAJOR + GOLDEN_MINOR).toBe(1)
    expect(GOLDEN_MAJOR / GOLDEN_MINOR).toBeCloseTo(PHI, 12)
    expect(1 / PHI).toBeCloseTo(GOLDEN_MAJOR, 15)
  })

  it('isGoldenRatio 只认两个黄金取值', () => {
    expect(isGoldenRatio(GOLDEN_MAJOR)).toBe(true)
    expect(isGoldenRatio(GOLDEN_MINOR)).toBe(true)
    expect(isGoldenRatio(0.5)).toBe(false)
    expect(isGoldenRatio(0.618)).toBe(false)
  })

  it('snapToGolden 把滑杆的近似值吸附成精确值', () => {
    expect(snapToGolden(0.618)).toBe(GOLDEN_MAJOR)
    expect(snapToGolden(0.382)).toBe(GOLDEN_MINOR)
    expect(snapToGolden(0.617)).not.toBe(GOLDEN_MAJOR)
    expect(snapToGolden(0.5)).toBe(0.5)
  })
})

describe('goldenSplit', () => {
  it('两块宽度之和恒等于总宽，且都大于 0', () => {
    const ratios = [0.2, 0.3819660112501051, 0.5, 0.6180339887498949, 0.8]
    for (const total of [2, 3, 100, 999, 1024, 2048, 4096]) {
      for (const ratio of ratios) {
        const { left, right } = goldenSplit(total, ratio)
        expect(left + right).toBe(total)
        expect(left).toBeGreaterThan(0)
        expect(right).toBeGreaterThan(0)
      }
    }
  })

  it('1024 宽的黄金分割切分为 391 : 633', () => {
    const { left, right } = goldenSplit(1024, GOLDEN_MINOR)
    expect(left).toBe(391)
    expect(right).toBe(633)
    expect(left / 1024).toBeCloseTo(GOLDEN_MINOR, 3)
  })

  it('比例超界时被夹紧', () => {
    expect(clampRatio(-1)).toBe(0.2)
    expect(clampRatio(9)).toBe(0.8)
    expect(clampRatio(Number.NaN)).toBe(GOLDEN_MINOR)
  })
})

describe('summarizeBlocks', () => {
  it('头像在左时按左侧块宽分配', () => {
    const summary = summarizeBlocks(1000, 382, 'left', true)
    expect(summary.avatarPercent).toBeCloseTo(38.2, 1)
    expect(summary.idPercent).toBeCloseTo(61.8, 1)
    expect(summary.golden).toBe(true)
    expect(summary.majorSide).toBe('id')
  })

  it('头像在右时百分比互换', () => {
    const summary = summarizeBlocks(1000, 382, 'right', true)
    expect(summary.avatarPercent).toBeCloseTo(61.8, 1)
    expect(summary.majorSide).toBe('avatar')
  })

  it('接近黄金分割的真实取整也判定为黄金分割', () => {
    // 1024 宽黄金切分 = 391 : 633
    const summary = summarizeBlocks(1024, 391, 'left', true)
    expect(Math.abs(summary.avatarPercent - GOLDEN_MINOR * 100)).toBeLessThan(0.05)
    expect(summary.majorSide).toBe('id')
  })

  it('非黄金比例不会误判', () => {
    expect(summarizeBlocks(1000, 500, 'left', false).golden).toBe(false)
  })
})

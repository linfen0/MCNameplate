import { describe, expect, it } from 'vitest'
import { PHI } from '../../lib/golden'
import { DEFAULT_CONFIG, STANDARD_ASPECTS, type NameplateConfig } from './config'
import { resolveAspect } from './resolve'

function config(patch: Partial<NameplateConfig>): NameplateConfig {
  return { ...DEFAULT_CONFIG, ...patch }
}

describe('resolveAspect：只用标准比，不跟着文字长度连续变形', () => {
  it('固定比例原样返回', () => {
    for (const value of STANDARD_ASPECTS) {
      expect(resolveAspect(config({ aspect: value }))).toBe(value)
    }
  })

  it('自动模式只会落在标准比上', () => {
    for (const id of ['A', 'NOTCH', 'NOTCH_2024', 'A_VERY_LONG_PLAYER_NAME_2024']) {
      const aspect = resolveAspect(config({ aspect: 'auto', id }))
      expect(STANDARD_ASPECTS).toContain(aspect)
    }
  })

  it('ID 变长时是「跳到下一个标准比」，而不是连续变宽', () => {
    const short = resolveAspect(config({ aspect: 'auto', id: 'AB' }))
    const long = resolveAspect(config({ aspect: 'auto', id: 'A_VERY_LONG_PLAYER_NAME_2024' }))
    expect(long).toBeGreaterThan(short)
    expect(STANDARD_ASPECTS).toContain(short)
    expect(STANDARD_ASPECTS).toContain(long)
  })

  it('黄金比仍在标准表里（φ 也是标准规格之一）', () => {
    expect(STANDARD_ASPECTS).toContain(PHI)
  })
})

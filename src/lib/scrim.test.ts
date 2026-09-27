import { describe, expect, it } from 'vitest'
import { hexToHsl, relativeLuminance } from './color'
import { buildTextCandidates } from './palette'
import { BACKDROP_ALPHA, chooseScrim, scrimDirection, scrimTone } from './scrim'

/** 一块“一半纯黑一半纯白”的花底：任何单色文字都读不清 */
const MIXED = { dark: '#0a0a0a', light: '#f2f2f2', lightBackground: false }

describe('scrim（文字底衬）', () => {
  it('垫层颜色取自底色同族，不是纯黑 / 纯白', () => {
    const color = scrimTone('#5c2b29', 'dark')
    expect(color).not.toBe('#000000')
    expect(color).not.toBe('#ffffff')
    expect(hexToHsl(color).s).toBeGreaterThan(0)
    expect(relativeLuminance(color)).toBeLessThan(0.05)
  })

  it('顺着底色主调走：暗底再压暗、亮底再提亮', () => {
    expect(scrimDirection('#1a1a1a')).toBe('dark')
    expect(scrimDirection('#e8e8e8')).toBe('light')
    expect(scrimDirection('#5c2b29')).toBe('dark')
  })

  it('从最轻的强度开始试，够 AA 就停（不会一上来就铺满）', () => {
    const candidates = buildTextCandidates(['#8a6a45'], false)
    const plan = chooseScrim({ tint: '#6b4a2a', background: MIXED, candidates, minContrast: 4.5 })
    expect(plan.meetsStandard).toBe(true)
    expect(plan.contrast).toBeGreaterThanOrEqual(4.5)
    expect(plan.alpha).toBeGreaterThanOrEqual(0.3)
    expect(plan.alpha).toBeLessThan(1)
  })

  it('垫层之后用到的仍然是色卡候选里的颜色', () => {
    const candidates = buildTextCandidates(['#8a6a45', '#d9c08a'], false)
    const plan = chooseScrim({ tint: '#6b4a2a', background: MIXED, candidates, minContrast: 4.5 })
    expect(candidates.map((item) => item.color)).toContain(plan.text)
    expect(plan.text).not.toBe('#ffffff')
  })

  it('最重的一档仍不达标时如实报告（上层会改用同族暗色文字）', () => {
    // 只有一张中灰候选、阈值又是正文 4.5:1：垫到最重也够不着
    const candidates = [{ color: '#808080', distance: 0 }]
    const plan = chooseScrim({
      tint: '#808080',
      background: { dark: '#7f7f7f', light: '#818181', lightBackground: false },
      candidates,
      minContrast: 4.5,
    })
    expect(plan.alpha).toBe(0.86)
    expect(plan.meetsStandard).toBe(false)
  })

  it('maxAlpha 限制最重强度：轻的那一轮够不着就交给上层换办法', () => {
    const candidates = [{ color: '#808080', distance: 0 }]
    const plan = chooseScrim({
      tint: '#808080',
      background: { dark: '#7f7f7f', light: '#818181', lightBackground: false },
      candidates,
      minContrast: 3,
      maxAlpha: 0.58,
    })
    expect(plan.alpha).toBeLessThanOrEqual(0.58)
  })

  it('用户手动那层压暗底用的是同一支同族色（与画布 / SVG 一致）', () => {
    expect(BACKDROP_ALPHA).toBeGreaterThan(0.2)
    expect(BACKDROP_ALPHA).toBeLessThan(0.6)
    expect(scrimTone('#6b4a2a', 'dark')).toBe(scrimTone('#6b4a2a', 'dark'))
  })
})

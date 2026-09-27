import { describe, expect, it } from 'vitest'
import { createImage, setPixel } from './raster'
import { contrastRatio, hexToHsl, hexToRgba, relativeLuminance, rgbaToHex } from './color'
import {
  buildTextCandidates,
  buildThemeFromTexture,
  chooseTextColor,
  extractPalette,
  NEUTRAL_MAX_CHROMA,
  paletteToCssGradient,
} from './palette'
import type { RgbaImage } from './types'

function solid(width: number, height: number, color: [number, number, number, number]): RgbaImage {
  const image = createImage(width, height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) setPixel(image, x, y, color)
  return image
}

/** 模拟一块 MC 方块：大部分深色底 + 少量高光 + 少量阴影 */
function blockTexture(): RgbaImage {
  const image = createImage(16, 16)
  const base: [number, number, number, number] = [110, 110, 110, 255]
  const light: [number, number, number, number] = [170, 170, 170, 255]
  const dark: [number, number, number, number] = [60, 60, 60, 255]
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = (x * 7 + y * 13) % 10
      const color = r === 0 ? light : r === 9 ? dark : base
      setPixel(image, x, y, color)
    }
  }
  return image
}

describe('extractPalette', () => {
  it('取占比最高的颜色作为主色', () => {
    const image = createImage(10, 10)
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        // 7 成红、2 成绿、1 成蓝
        const color: [number, number, number, number] =
          x < 7 ? [200, 40, 40, 255] : x < 9 ? [40, 200, 40, 255] : [40, 40, 200, 255]
        setPixel(image, x, y, color)
      }
    }
    const palette = extractPalette(image)
    expect(palette.base).toBe('#c82828')
    expect(palette.dominant[0]).toBe('#c82828')
  })

  it('按亮度分位给出明暗，而不是把所有像素平均成灰', () => {
    const palette = extractPalette(blockTexture())
    expect(relativeLuminance(palette.light)).toBeGreaterThan(relativeLuminance(palette.base))
    expect(relativeLuminance(palette.dark)).toBeLessThan(relativeLuminance(palette.base))
  })

  it('全透明贴图也有兜底配色', () => {
    const palette = extractPalette(createImage(8, 8))
    expect(palette.base).toMatch(/^#[0-9a-f]{6}$/)
    expect(palette.luminance).toBeGreaterThanOrEqual(0)
  })

  it('忽略透明像素', () => {
    const image = blockTexture()
    for (let x = 0; x < 8; x++) setPixel(image, x, 0, [255, 0, 255, 0])
    expect(extractPalette(image).base).not.toBe('#ff00ff')
  })

  it('主色数量不超过 6 个，且都是合法色值', () => {
    const palette = extractPalette(blockTexture())
    expect(palette.dominant.length).toBeLessThanOrEqual(6)
    for (const color of palette.dominant) expect(color).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('buildThemeFromTexture', () => {
  it('默认九宫格：四角原样保留，只有中间被拉开', () => {
    const image = blockTexture()
    const theme = buildThemeFromTexture(image)
    expect(theme.texture.kind).toBe('image')
    if (theme.texture.kind === 'image') {
      expect(theme.texture.image).toBe(image)
      expect(theme.texture.mode).toBe('nine-slice')
      // 16×16 的贴图默认估 2 像素边框
      expect(theme.texture.slice).toBe(2)
    }
  })

  it('平铺模式带上方块尺寸', () => {
    const theme = buildThemeFromTexture(blockTexture(), { fillMode: 'tile', texelScale: 6 })
    expect(theme.texture.kind).toBe('image')
    if (theme.texture.kind === 'image') {
      expect(theme.texture.mode).toBe('tile')
      expect(theme.texture.texelScale).toBe(6)
    }
  })

  it('只取配色模式：底纹由主色派生，不塞原贴图', () => {
    const image = blockTexture()
    const theme = buildThemeFromTexture(image, { fillMode: 'palette' })
    expect(theme.texture.kind).toBe('noise')
    if (theme.texture.kind === 'noise') {
      expect(theme.texture.palette.base).toBe(extractPalette(image).base)
    }
    expect(JSON.stringify(theme.texture)).not.toContain('image')
  })

  it('提取出的亮部/暗部色卡用在外框等组件上，并保持足够对比', () => {
    const theme = buildThemeFromTexture(blockTexture())
    expect(relativeLuminance(theme.frame.light)).toBeGreaterThan(relativeLuminance(theme.frame.dark) * 1.5)
    expect(theme.palette!.light).toBeTruthy()
    expect(theme.palette!.dark).toBeTruthy()
  })

  it('文字色优先取自提取出的色卡（不是写死的纯白/纯黑）', () => {
    // 深底 + 大面积亮部：亮部色卡与底色的对比度足够，就应该拿它当文字色
    const image = createImage(16, 16)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        setPixel(image, x, y, x < 10 ? [22, 20, 26, 255] : [236, 232, 220, 255])
      }
    }
    const palette = extractPalette(image)
    const theme = buildThemeFromTexture(image, { fillMode: 'palette' })
    expect([palette.light, palette.accent, palette.dark]).toContain(theme.text.fill)
    expect(theme.text.fill).not.toBe('#ffffff')
  })

  it('中灰底退到同色系最深的档位，而不是纯黑', () => {
    // 全是中间灰：亮部/暗部卡与底色对比不足，必须往两端推保证可读
    const image = solid(16, 16, [128, 128, 128, 255])
    const theme = buildThemeFromTexture(image, { fillMode: 'palette' })
    expect(contrastRatio(theme.text.fill, '#808080')).toBeGreaterThanOrEqual(4.5)
    expect(relativeLuminance(theme.text.fill)).toBeLessThan(0.05)
    // 纯黑 / 纯白都不出现：推到最深也只是 tone 档位（#0F0F0F 这一级）
    expect(['#000000', '#ffffff']).not.toContain(theme.text.fill)
    expect(theme.text.fill).not.toBe('#080808')
  })

  it('无论什么贴图，文字与底色的对比度都达到 WCAG AA（4.5:1）', () => {
    const samples: Array<[number, number, number, number]> = [
      [10, 10, 12, 255],
      [128, 128, 128, 255],
      [240, 240, 235, 255],
      [120, 40, 40, 255],
      [40, 90, 160, 255],
      [250, 200, 60, 255],
    ]
    for (const color of samples) {
      const theme = buildThemeFromTexture(solid(16, 16, color), { fillMode: 'palette' })
      const background = rgbaToHex(color)
      const ratio =
        (Math.max(relativeLuminance(theme.text.fill), relativeLuminance(background)) + 0.05) /
        (Math.min(relativeLuminance(theme.text.fill), relativeLuminance(background)) + 0.05)
      expect(ratio, `底色 ${background} 的文字对比度`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('描边色严格取自色卡，不用现场推导的颜色', () => {
    const image = blockTexture()
    const theme = buildThemeFromTexture(image, { fillMode: 'palette' })
    const palette = extractPalette(image)
    const swatches = [palette.base, palette.light, palette.dark, palette.accent]
    expect(theme.text.shadow).toBeTruthy()
    expect(swatches).toContain(theme.text.shadow!)
    expect(theme.text.shadow).not.toBe(theme.text.fill)
  })

  it('文字色也优先从色卡里取：够用就用卡内颜色，不够才用同族中性色档位', () => {
    const image = blockTexture()
    const theme = buildThemeFromTexture(image, { fillMode: 'palette' })
    const palette = extractPalette(image)
    const swatches = [palette.base, palette.light, palette.dark, palette.accent]
    expect(contrastRatio(theme.text.fill, palette.base)).toBeGreaterThanOrEqual(4.5)
    if (!swatches.includes(theme.text.fill)) {
      // 卡内颜色不够用 → 派生档必须还跟底色同一族（彩度被压到中性色的上限内）
      expect(hexToHsl(theme.text.fill).s).toBeLessThanOrEqual(NEUTRAL_MAX_CHROMA + 0.02)
    }
  })

  it('深色贴图用亮字，浅色贴图用暗字（按对比度自动选）', () => {
    const dark = buildThemeFromTexture(solid(8, 8, [30, 30, 40, 255]))
    const light = buildThemeFromTexture(solid(8, 8, [230, 230, 220, 255]))
    expect(contrastRatio(dark.text.fill, '#1e1e28')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(light.text.fill, '#e6e6dc')).toBeGreaterThanOrEqual(4.5)
  })

  it('外框 / 肖像位都由提取出的配色推导，且明暗关系正确', () => {
    const theme = buildThemeFromTexture(blockTexture())
    for (const color of [
      theme.frame.fill,
      theme.frame.light,
      theme.frame.dark,
      theme.slot!.fill,
      theme.slot!.light,
      theme.slot!.dark,
      theme.divider,
      theme.guide,
    ]) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(relativeLuminance(theme.frame.light)).toBeGreaterThan(relativeLuminance(theme.frame.dark))
    expect(relativeLuminance(theme.slot!.light)).toBeGreaterThan(relativeLuminance(theme.slot!.dark))
  })

  it('把提取出的配色挂在主题上，供界面展示', () => {
    const theme = buildThemeFromTexture(blockTexture())
    expect(theme.palette).toBeTruthy()
    expect(theme.palette!.dominant.length).toBeGreaterThan(0)
    expect(theme.swatch.length).toBeGreaterThanOrEqual(3)
  })

  it('描述里带上主色，方便用户确认用的哪张图', () => {
    const theme = buildThemeFromTexture(blockTexture(), { name: '石头方块' })
    expect(theme.name).toBe('石头方块')
    expect(theme.description).toContain('石头方块')
  })
})

describe('文字色优先级：先提亮文字，最后才动底', () => {
  const DARK_RANGE = { low: 0.03, high: 0.12 } // 深色贴图（含少量亮部）

  it('色卡原色就达标时，直接用色卡（distance = 0）', () => {
    const chosen = chooseTextColor(buildTextCandidates(['#e8e8e8'], false), DARK_RANGE, 4.5)
    expect(chosen.distance).toBe(0)
    expect(chosen.color).toBe('#e8e8e8')
    expect(chosen.meetsStandard).toBe(true)
  })

  it('色卡原色不够时，先往白推（提亮文字），而不是去动底', () => {
    // #8a8a8a 在深底上对比度不足；系统应当把它往白推，而不是要求压暗背景
    const chosen = chooseTextColor(buildTextCandidates(['#8a8a8a'], false), DARK_RANGE, 4.5)
    expect(chosen.meetsStandard).toBe(true)
    expect(chosen.distance).toBeGreaterThan(0)
    expect(relativeLuminance(chosen.color)).toBeGreaterThan(relativeLuminance('#8a8a8a'))
  })

  it('保留色相：提亮后的颜色仍偏向原色卡色', () => {
    const chosen = chooseTextColor(buildTextCandidates(['#d9a227'], false), DARK_RANGE, 4.5)
    // 金色提亮后仍是暖色（红 > 蓝），不是纯白
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(chosen.color.slice(i, i + 2), 16))
    expect(r).toBeGreaterThan(b)
    expect(g).toBeGreaterThan(b)
  })

  it('浅色贴图往黑推（同样是改文字，不是改底）', () => {
    const chosen = chooseTextColor(buildTextCandidates(['#9a9a9a'], true), { low: 0.7, high: 0.95 }, 4.5)
    expect(chosen.meetsStandard).toBe(true)
    expect(relativeLuminance(chosen.color)).toBeLessThan(relativeLuminance('#9a9a9a'))
  })

  it('连纯白/纯黑都够不着时如实报告未达标（交给上层决定要不要动底）', () => {
    // 亮度区间跨越太大：亮区要黑字、暗区要白字，任何单色都无法同时满足
    const chosen = chooseTextColor(buildTextCandidates(['#808080'], false), { low: 0.02, high: 0.7 }, 4.5)
    expect(chosen.meetsStandard).toBe(false)
    expect(chosen.contrast).toBeGreaterThan(1)
  })

  it('候选里不会有重复色', () => {
    const list = buildTextCandidates(['#ffffff', '#ffffff'], false)
    expect(new Set(list.map((item) => item.color)).size).toBe(list.length)
  })
})

describe('和谐取色：不靠纯白 / 纯黑解决对比度', () => {
  it('候选色里不会凭空出现纯白或纯黑', () => {
    for (const lightBackground of [true, false]) {
      const colors = buildTextCandidates(['#d9a227', '#5c2b29'], lightBackground).map((c) => c.color)
      expect(colors).not.toContain('#ffffff')
      expect(colors).not.toContain('#000000')
    }
  })

  it('柔和档 / 兜底档都是“同族中性色”：带一点底色倾向，但不跟底纹抢戏', () => {
    // 8bit 量化会让 HSL 的饱和度在小明度下漂移，所以按 RGB 通道差判断“有没有色倾向”
    const spread = (hex: string) => {
      const [r, g, b] = hexToRgba(hex)
      return Math.max(r, g, b) - Math.min(r, g, b)
    }
    const neutrals = buildTextCandidates(['#d9a227'], false).filter((c) => c.distance >= 3)
    expect(neutrals.length).toBeGreaterThan(0)
    for (const candidate of neutrals) {
      expect(spread(candidate.color), `${candidate.color} 应当带一点底色倾向`).toBeGreaterThan(0)
      expect(spread(candidate.color), `${candidate.color} 的色倾向应当很轻`).toBeLessThanOrEqual(16)
    }
  })

  it('达标者里挑改动最小的一档，而不是对比度最高的那一张', () => {
    // 色卡原色已经够 AA（5.4:1），就不该再往更亮/更暗的档位跑
    const candidates = buildTextCandidates(['#e8e8e8'], false)
    const chosen = chooseTextColor(candidates, { low: 0.03, high: 0.1 }, 4.5)
    expect(chosen.distance).toBe(0)
    expect(chosen.color).toBe('#e8e8e8')
  })

  it('中灰底上停在“最软的达标档”，不会一路黑到底', () => {
    const candidates = buildTextCandidates(['#808080'], false)
    const chosen = chooseTextColor(candidates, { low: 0.216, high: 0.216 }, 4.5)
    expect(chosen.meetsStandard).toBe(true)
    expect(chosen.contrast).toBeLessThan(6)
    // 兜底档里先停在最软的一级，而不是更深的 #0F0F0F / #080808
    expect(relativeLuminance(chosen.color)).toBeGreaterThan(relativeLuminance('#0f0f0f'))
  })
})

describe('paletteToCssGradient', () => {
  it('输出可直接用于 CSS 的渐变', () => {
    const gradient = paletteToCssGradient(extractPalette(blockTexture()))
    expect(gradient.startsWith('linear-gradient(90deg,')).toBe(true)
    expect(gradient).toContain('#')
  })
})

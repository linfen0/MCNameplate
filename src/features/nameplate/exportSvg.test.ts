import { describe, expect, it } from 'vitest'
import { createImage, setPixel } from '../../lib/raster'
import { getPixelFont, measureText, placeTextBlock, renderTextBlock } from '../../lib/pixelFont'
import { getTheme } from '../../lib/themes'
import type { RgbaImage } from '../../lib/types'
import { computeNameplateLayout } from './layout'
import { DEFAULT_CONFIG } from './config'
import { composeNameplateSvg, pixelRuns, svgTextGroup, type ComposeSvgInput } from './exportSvg'

const FONT = getPixelFont('mojangles')

function makeLayout(overrides: Partial<Parameters<typeof computeNameplateLayout>[0]> = {}) {
  return computeNameplateLayout({
    height: 512,
    aspect: 4,
    splitMode: 'tight',
    ratioLeft: 0.3819660112501051,
    avatarSide: 'left',
    headStyle: 'iso',
    avatarFill: 0.92,
    showDivider: true,
    ...overrides,
  })
}

function makeHeadImage(): RgbaImage {
  const image = createImage(8, 8)
  setPixel(image, 0, 0, [255, 0, 0, 255])
  setPixel(image, 1, 0, [255, 0, 0, 255])
  setPixel(image, 2, 0, [0, 0, 255, 255])
  setPixel(image, 0, 1, [0, 0, 255, 255])
  return image
}

function buildText(config = DEFAULT_CONFIG, text = 'NOTCH_2024') {
  const theme = getTheme(config.themeId)
  const layout = makeLayout()
  const block = renderTextBlock({
    text,
    font: FONT,
    fill: theme.text.fill,
    shadow: theme.text.shadow ? { color: theme.text.shadow, offset: 1 } : null,
  })
  const width = measureText(FONT, text).advance
  const scale = Math.max(4, Math.floor(layout.idBox.width / Math.max(1, width)))
  const placement = placeTextBlock(block, layout.idBox, scale, 'center', 'middle')
  return { layout, theme, block, scale, placement, text }
}

describe('pixelRuns', () => {
  it('把同行同色连续像素合并成段', () => {
    const runs = pixelRuns(makeHeadImage(), 0, 8)
    expect(runs).toHaveLength(3)
    expect(runs[0]).toMatchObject({ x: 0, y: 0, w: 2, color: '#ff0000' })
    expect(runs[1]).toMatchObject({ x: 2, y: 0, w: 1, color: '#0000ff' })
    expect(runs[2]).toMatchObject({ x: 0, y: 1, w: 1, color: '#0000ff' })
  })

  it('可以只取列区间', () => {
    const runs = pixelRuns(makeHeadImage(), 2, 3)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ x: 2, w: 1 })
  })
})

describe('svgTextGroup', () => {
  it('每个非空字符一个分组，空格不产生图层', () => {
    const { block, scale, placement } = buildText(DEFAULT_CONFIG, 'AB C')
    const svg = svgTextGroup(FONT, { text: 'AB C', block, scale, placement })
    const groups = svg.match(/<g id="ID文字-/g) ?? []
    expect(groups).toHaveLength(3)
    expect(svg).toContain('ID文字-01-A')
    expect(svg).toContain('ID文字-02-B')
    expect(svg).toContain('ID文字-04-C')
  })

  it('每个字符都产出可用的矢量路径，且颜色只有填充色与阴影色', () => {
    const theme = getTheme(DEFAULT_CONFIG.themeId)
    const { block, scale, placement } = buildText()
    const svg = svgTextGroup(FONT, { text: 'NOTCH_2024', block, scale, placement })
    expect(svg).toContain('<path')
    expect(svg).toContain(theme.text.fill)
    const colors = new Set([...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]))
    for (const color of colors) {
      expect([theme.text.fill, theme.text.shadow]).toContain(color)
    }
  })
})

describe('composeNameplateSvg', () => {
  const base = (): ComposeSvgInput => {
    const { layout, theme, block, scale, placement, text } = buildText()
    return {
      layout,
      theme,
      font: FONT,
      config: DEFAULT_CONFIG,
      text: { text, block, scale, placement },
      background: { dataUrl: 'data:image/png;base64,AAAA', width: 500, height: 124 },
      avatar: { kind: 'pixels' as const, image: makeHeadImage() },
    }
  }

  it('输出合法的 SVG 根节点', () => {
    const svg = composeNameplateSvg(base())
    expect(svg.startsWith('<?xml')).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('xmlns:xlink=')
    expect(svg).toMatch(/<svg[^>]*width="2048" height="512"/)
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
  })

  it('每个构件都是独立命名的图层（Figma 里可逐个选中）', () => {
    const svg = composeNameplateSvg(base())
    for (const id of [
      '底板',
      '背景纹理',
      '外框倒角',
      '分割线',
      '头像肖像位',
      '文字压暗',
      '头像',
      'ID文字',
    ]) {
      expect(svg, `缺少图层 ${id}`).toContain(`<g id="${id}">`)
    }
  })

  it('纯色主题用 rect 而不是内嵌图', () => {
    const input = base()
    input.config = { ...DEFAULT_CONFIG, themeId: 'gui' }
    input.theme = getTheme('gui')
    input.background = null
    const svg = composeNameplateSvg(input)
    expect(svg).toContain('<g id="背景-纯色">')
    expect(svg).not.toContain('<g id="背景纹理">')
  })

  it('3D 头像走内嵌 PNG，2D 头像走矢量色块', () => {
    const imageInput = base()
    imageInput.avatar = { kind: 'image' as const, dataUrl: 'data:image/png;base64,BBBB' }
    expect(composeNameplateSvg(imageInput)).toContain('xlink:href="data:image/png;base64,BBBB"')

    const pixelsInput = base()
    expect(composeNameplateSvg(pixelsInput)).toContain('id="头像-色块-ff0000"')
  })

  it('标签成对闭合，没有非法字符', () => {
    const svg = composeNameplateSvg(base())
    const opens = (svg.match(/<g[ >]/g) ?? []).length
    const closes = (svg.match(/<\/g>/g) ?? []).length
    expect(opens).toBe(closes)
    const rectOpens = (svg.match(/<rect[ >]/g) ?? []).length
    expect(rectOpens).toBeGreaterThan(10)
    expect(svg).not.toContain('undefined')
    expect(svg).not.toContain('NaN')
  })

  it('打开辅助线时多出一个命名图层', () => {
    const input = base()
    input.config = { ...DEFAULT_CONFIG, showGuides: true }
    const svg = composeNameplateSvg(input)
    expect(svg).toContain('<g id="黄金辅助线">')
  })

  it('没有头像时不会生成空图层', () => {
    const input = base()
    input.avatar = null
    const svg = composeNameplateSvg(input)
    expect(svg).not.toContain('<g id="头像">')
  })
})

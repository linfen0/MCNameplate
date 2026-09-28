/**
 * 导出可在 Figma / Illustrator 里编辑的分层 SVG。
 *
 * 设计原则：**每个可见构件都是独立命名的图层**，而不是一整张位图：
 *   底板 / 背景纹理 / 外框倒角 / 分割线 / 头像肖像位 / 文字压暗 / 头像 / ID 文字 / 辅助线
 *
 * 其中：
 *   · ID 文字 = 每个字符一个 <g>，内部按颜色拆成 <path>（矢量，可缩放、可换色）
 *   · 2D 头像 = 按像素色块矢量化的 <path>
 *   · 3D 头像 = 内嵌 PNG（WebGL 渲染结果，本质是栅格）
 *   · 背景纹理 = 内嵌 PNG；纯色主题则是一个 <rect>
 *
 * composeNameplateSvg 是纯函数（不碰 DOM），便于单测；buildNameplateSvg 负责取素材。
 */

import { rgbaToCanvas, rgbaToDataUrl } from '../../lib/imageIo'
import {
  getPixelFont,
  measureText,
  type PixelFontSpec,
  type TextBlock,
  type TextPlacement,
} from '../../lib/pixelFont'
import { extractHead, extractHeadCube } from '../../lib/skin'
import { BACKDROP_ALPHA, scrimDirection, scrimTintOf, scrimTone } from '../../lib/scrim'
import { getPanelTexture } from '../../lib/textures'
import type { Theme } from '../../lib/themes'
import type { ParsedSkin, RgbaImage } from '../../lib/types'
import { TEXTURE_SEED, type NameplateConfig } from './config'
import { renderHead3D } from './draw/head3d'
import { shadeFaceTexture } from './export3d'
import {
  CUBE_FACE_LABEL,
  CUBE_FACE_ORDER,
  HEAD3D_PROJECTION,
  projectCubeFaces,
  type CubeFaceName,
} from './headGeometry'
import { computeNameplateLayout, scrimSteps, type LayoutPlan } from './layout'
import { resolveAspect } from './resolve'
import type { TextStyle } from '../../lib/textPlan'
import { layoutIdText } from './textLayout'
import { resolveTheme, withTextStyle } from './theme'

/* ------------------------------------------------------------------ */
/* 纯几何 → SVG 片段                                                    */
/* ------------------------------------------------------------------ */

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function rect(x: number, y: number, w: number, h: number, fill: string, id?: string): string {
  if (w <= 0 || h <= 0) return ''
  return `<rect${id ? ` id="${id}"` : ''} x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="${fill}" />`
}

interface Run {
  x: number
  y: number
  w: number
  color: string
}

/** 把位图指定列区间内的不透明像素按“同行同色连续段”合并成矩形段 */
export function pixelRuns(
  image: RgbaImage,
  xFrom: number,
  xTo: number,
  limit?: { top: number; bottom: number },
): Run[] {
  const runs: Run[] = []
  const y0 = Math.max(0, limit ? limit.top : 0)
  const y1 = Math.min(image.height, limit ? limit.bottom : image.height)
  const from = Math.max(0, Math.floor(xFrom))
  const to = Math.min(image.width, Math.ceil(xTo))
  for (let y = y0; y < y1; y++) {
    let start = -1
    let color = ''
    for (let x = from; x <= to; x++) {
      let current = ''
      if (x < to) {
        const i = (y * image.width + x) * 4
        const a = image.data[i + 3]
        if (a > 0) {
          current = `#${[0, 1, 2]
            .map((c) => image.data[i + c].toString(16).padStart(2, '0'))
            .join('')}`
        }
      }
      if (current !== color) {
        if (start >= 0) runs.push({ x: start, y, w: x - start, color })
        start = current ? x : -1
        color = current
      }
    }
  }
  return runs
}

/** 一组矩形段 → 单个 <path>（Figma 里会是一个矢量节点） */
function runsToPath(runs: Run[], scale: number, originX: number, originY: number): Array<{ color: string; d: string }> {
  const byColor = new Map<string, string[]>()
  for (const run of runs) {
    const x = originX + run.x * scale
    const y = originY + run.y * scale
    const w = run.w * scale
    const h = scale
    const segment = `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}z`
    const list = byColor.get(run.color)
    if (list) list.push(segment)
    else byColor.set(run.color, [segment])
  }
  return [...byColor.entries()].map(([color, segments]) => ({ color, d: segments.join('') }))
}

function pathsFromRuns(runs: Run[], scale: number, originX: number, originY: number, prefix: string): string {
  return runsToPath(runs, scale, originX, originY)
    .map(({ color, d }) => `<path id="${prefix}-${color.slice(1)}" d="${d}" fill="${color}" />`)
    .join('\n      ')
}

/** 头像整体（2D 位图）矢量化 */
function svgAvatarPixels(image: RgbaImage, scale: number, originX: number, originY: number): string {
  const runs = pixelRuns(image, 0, image.width)
  return pathsFromRuns(runs, scale, originX, originY, '头像-色块')
}

/* ------------------------------------------------------------------ */
/* 文字                                                                */
/* ------------------------------------------------------------------ */

export interface SvgTextInput {
  text: string
  /** 折行后的每一行（与画布同一份排版） */
  lines?: string[]
  block: TextBlock
  scale: number
  placement: TextPlacement
  /** 是否带同族描边：切分字符图层时要多留出描边的那一列 */
  outline?: boolean
  /** 同色系柔化底（亮字压浅底时才用），导出要和画布一致 */
  scrim?: { color: string; alpha: number } | null
}

/**
 * ID 文字：每个字符一个 <g>，内部按颜色拆分矢量路径。
 * 通过“按字符切片文字块位图”实现，阴影/描边都保留在同一字符分组里；
 * 折行后每个字符只在本行那一带里找墨迹，不会把下一行的像素算进来。
 */
export function svgTextGroup(font: PixelFontSpec, input: SvgTextInput): string {
  const { text, block, scale, placement, outline = false } = input
  const lines = input.lines && input.lines.length > 0 ? input.lines : text.length > 0 ? text.split('\n') : ['']
  const groups: string[] = []
  let index = 0

  lines.forEach((line, lineIndex) => {
    const rowTop = Math.max(0, block.padding + lineIndex * block.lineHeight - 1)
    const rowBottom = Math.min(
      block.image.height,
      block.padding + (lineIndex + 1) * block.lineHeight + 1,
    )
    let pen = 0
    for (const char of line) {
      const advance = measureText(font, char).advance
      if (/\s/.test(char)) {
        // 空格没有自己的墨迹；不能靠“切片里有没有像素”判断，
        // 否则会把相邻字符的阴影算进来，凭空多出一个图层
        pen += advance
        index++
        continue
      }
      // 每一行是按墨迹居中的，切片要加上该行的起始偏移
      const offset = block.lineOffsets?.[lineIndex] ?? block.padding
      // 向右多取 1 列，把 1 像素的阴影带进本字符的图层；
      // 有描边时左右各多出 1 列，也要带进来
      const lead = outline ? 1 : 0
      const from = offset + pen - lead
      const to = outline ? from + advance + 2 : offset + pen + advance + 1
      const runs = pixelRuns(block.image, from, to, { top: rowTop, bottom: rowBottom })
      pen += advance
      index++
      if (runs.length === 0) continue
      const paths = runsToPath(runs, scale, placement.x, placement.y)
        .map(({ color, d }) => `<path id="字形-${color.slice(1)}" d="${d}" fill="${color}" />`)
        .join('')
      const label = char === '<' ? 'lt' : char === '>' ? 'gt' : char === '&' ? 'amp' : char === ' ' ? 'space' : char
      groups.push(`    <g id="ID文字-${String(index).padStart(2, '0')}-${label}">${paths}</g>`)
    }
  })

  return groups.join('\n')
}

/* ------------------------------------------------------------------ */
/* 组装                                                                */
/* ------------------------------------------------------------------ */

export interface SvgAvatarImage {
  kind: 'image'
  dataUrl: string
}
export interface SvgAvatarPixels {
  kind: 'pixels'
  image: RgbaImage
}
/** 立体头像：立方体每个面一个图层（仿射变换 + 蒙皮贴图），Figma 里可单独选中/替换 */
export interface SvgCubeFaceLayer {
  /** 图层名，例如 头像-基础层-正面 */
  id: string
  /** 贴图空间(0..faceSize) → 画布 的仿射矩阵 */
  matrix: [number, number, number, number, number, number]
  dataUrl: string
  /** 画家算法排序用：越大越靠近相机 */
  depth: number
  faceSize: number
}
export interface SvgAvatarCube {
  kind: 'cube'
  faces: SvgCubeFaceLayer[]
}
export interface SvgBackgroundImage {
  dataUrl: string
  width: number
  height: number
}

export interface ComposeSvgInput {
  layout: LayoutPlan
  theme: Theme
  font: PixelFontSpec
  config: NameplateConfig
  text: SvgTextInput | null
  /** 背景纹理位图（纯色主题传 null） */
  background: SvgBackgroundImage | null
  /** 头像：3D 是带几何的立方体面图层，2D 是位图色块 */
  avatar: SvgAvatarImage | SvgAvatarPixels | SvgAvatarCube | null
}

export function composeNameplateSvg(input: ComposeSvgInput): string {
  const { layout, theme, font, config, text, background, avatar } = input
  const parts: string[] = []
  const defs: string[] = []

  const borderFromTexture = theme.borderFromTexture === true

  // 1) 底板：外框底色
  parts.push(`  <g id="底板">`)
  parts.push(`    ${rect(0, 0, layout.width, layout.height, theme.frame.fill)}`)
  parts.push('  </g>')

  // 2) 背景纹理（面板尺寸，一个纹理像素 = unit）
  const panel = borderFromTexture
    ? { x: 0, y: 0, width: layout.width, height: layout.height }
    : {
        x: layout.frame,
        y: layout.frame,
        width: layout.width - layout.frame * 2,
        height: layout.height - layout.frame * 2,
      }
  if (theme.texture.kind === 'solid') {
    parts.push(`  <g id="背景-纯色">`)
    parts.push(`    ${rect(panel.x, panel.y, panel.width, panel.height, theme.texture.color)}`)
    parts.push('  </g>')
  } else if (background) {
    parts.push(`  <g id="背景纹理">`)
    parts.push(
      `    <image x="${panel.x}" y="${panel.y}" width="${panel.width}" height="${panel.height}" ` +
        `preserveAspectRatio="none" image-rendering="pixelated" xlink:href="${background.dataUrl}" />`,
    )
    parts.push('  </g>')
  }

  // 3) 外框倒角（高光上/左，阴影下/右）；贴图自带边框时跳过
  const { frame, bevel, width, height } = layout
  if (!borderFromTexture) {
  parts.push(`  <g id="外框倒角">`)
  parts.push(`    ${rect(frame, frame, width - frame * 2, bevel, theme.frame.light)}`)
  parts.push(`    ${rect(frame, frame, bevel, height - frame * 2, theme.frame.light)}`)
  parts.push(`    ${rect(frame + bevel, height - frame - bevel, width - frame * 2 - bevel, bevel, theme.frame.dark)}`)
  parts.push(`    ${rect(width - frame - bevel, frame + bevel, bevel, height - frame * 2 - bevel, theme.frame.dark)}`)
  parts.push('  </g>')
  }

  // 4) 分割线
  if (layout.dividerWidth > 0) {
    const half = Math.max(1, Math.floor(layout.dividerWidth / 2))
    parts.push(`  <g id="分割线">`)
    parts.push(`    ${rect(layout.dividerX, layout.inner.y, half, layout.inner.height, theme.divider)}`)
    parts.push(
      `    ${rect(layout.dividerX + half, layout.inner.y, layout.dividerWidth - half, layout.inner.height, theme.frame.light)}`,
    )
    parts.push('  </g>')
  }

  // 5) 头像肖像位（内凹）
  if (theme.slot) {
    const slot = layout.slot
    const t = Math.max(1, Math.round(layout.unit * 0.75))
    parts.push(`  <g id="头像肖像位">`)
    parts.push(`    ${rect(slot.x, slot.y, slot.width, slot.height, theme.slot.fill)}`)
    parts.push(`    ${rect(slot.x, slot.y, slot.width, t, theme.slot.dark)}`)
    parts.push(`    ${rect(slot.x, slot.y, t, slot.height, theme.slot.dark)}`)
    parts.push(`    ${rect(slot.x + t, slot.y + slot.height - t, slot.width - t, t, theme.slot.light)}`)
    parts.push(`    ${rect(slot.x + slot.width - t, slot.y + t, t, slot.height - t, theme.slot.light)}`)
    parts.push('  </g>')
  }

  // 6) 文字压暗（棋盘格 pattern，保持矢量）；颜色与画布一致：底色同族的中性色，不是纯黑
  if (config.textBackdrop && theme.textured) {
    const cell = Math.max(1, layout.unit)
    const originX = layout.inner.x + Math.floor((layout.idBox.x - layout.inner.x) / cell) * cell
    const originY = layout.inner.y + Math.floor((layout.idBox.y - layout.inner.y) / cell) * cell
    const tint = scrimTintOf(theme)
    const backdrop = scrimTone(tint, scrimDirection(tint))
    defs.push(
      `    <pattern id="文字压暗-棋盘格" x="${originX}" y="${originY}" width="${cell * 2}" height="${cell * 2}" patternUnits="userSpaceOnUse">`,
    )
    defs.push(
      `      <rect width="${cell}" height="${cell}" fill="${backdrop}" fill-opacity="${BACKDROP_ALPHA}" />`,
    )
    defs.push(
      `      <rect x="${cell}" y="${cell}" width="${cell}" height="${cell}" fill="${backdrop}" fill-opacity="${BACKDROP_ALPHA}" />`,
    )
    defs.push('    </pattern>')
    parts.push(`  <g id="文字压暗">`)
    parts.push(
      `    <rect x="${originX}" y="${originY}" width="${layout.idBox.x + layout.idBox.width - originX}" height="${layout.idBox.y + layout.idBox.height - originY}" fill="url(#文字压暗-棋盘格)" />`,
    )
    parts.push('  </g>')
  }

  // 7) 头像
  if (avatar) {
    parts.push(`  <g id="头像">`)
    if (avatar.kind === 'image') {
      parts.push(
        `    <image x="${layout.headBox.x}" y="${layout.headBox.y}" width="${layout.headBox.width}" height="${layout.headBox.height}" ` +
          `preserveAspectRatio="none" image-rendering="pixelated" xlink:href="${avatar.dataUrl}" />`,
      )
    } else if (avatar.kind === 'cube') {
      // 每个面一个图层：仿射变换 + 蒙皮贴图，几何在 Figma 里是真实可编辑的
      const ordered = [...avatar.faces].sort((a, b) => a.depth - b.depth)
      for (const face of ordered) {
        const [a, b, c, d, e, f] = face.matrix
        parts.push(`    <g id="${face.id}">`)
        parts.push(
          `      <image x="0" y="0" width="${face.faceSize}" height="${face.faceSize}" ` +
            `transform="matrix(${[a, b, c, d, e, f].map(num).join(' ')})" ` +
            `preserveAspectRatio="none" image-rendering="pixelated" xlink:href="${face.dataUrl}" />`,
        )
        parts.push('    </g>')
      }
    } else {
      const scale = layout.headBox.width / avatar.image.width
      parts.push(
        `    ${svgAvatarPixels(avatar.image, scale, layout.headBox.x, layout.headBox.y)}`,
      )
    }
    parts.push('  </g>')
  }

  // 8) 文字柔化底（同色系铺底，画布上那一层在 SVG 里是矢量矩形）
  if (text?.scrim) {
    parts.push(`  <g id="文字柔化底">`)
    for (const step of scrimSteps(layout, text.placement, text.scrim.alpha)) {
      parts.push(
        `    <rect x="${num(step.rect.x)}" y="${num(step.rect.y)}" width="${num(step.rect.width)}" height="${num(
          step.rect.height,
        )}" fill="${text.scrim.color}" fill-opacity="${num(step.alpha)}" />`,
      )
    }
    parts.push('  </g>')
  }

  // 9) ID 文字（每字符一个分组）
  if (text) {
    const group = svgTextGroup(font, text)
    if (group) parts.push(`  <g id="ID文字">\n${group}\n  </g>`)
  }

  // 10) 黄金辅助线
  if (config.showGuides) {
    const thickness = Math.max(1, layout.unit)
    const splitX = layout.inner.x + Math.floor(layout.inner.width * config.ratioLeft)
    const splitY = layout.inner.y + Math.floor(layout.inner.height * (1 / ((1 + Math.sqrt(5)) / 2)))
    const marker = Math.max(2, layout.unit * 2)
    const dashes: string[] = []
    const on = layout.unit * 4
    const off = layout.unit * 3
    for (let offset = 0; offset < layout.inner.height; offset += on + off) {
      dashes.push(
        rect(splitX - Math.floor(thickness / 2), layout.inner.y + offset, thickness, Math.min(on, layout.inner.height - offset), theme.guide),
      )
    }
    for (let offset = 0; offset < layout.inner.width; offset += on + off) {
      dashes.push(
        rect(layout.inner.x + offset, splitY - Math.floor(thickness / 2), Math.min(on, layout.inner.width - offset), thickness, theme.guide),
      )
    }
    dashes.push(rect(splitX - marker / 2, splitY - marker / 2, marker, marker, theme.guide))
    parts.push(`  <g id="黄金辅助线">`)
    parts.push(`    ${dashes.filter(Boolean).join('\n    ')}`)
    parts.push('  </g>')
  }

  const defsBlock = defs.length > 0 ? `  <defs>\n${defs.join('\n')}\n  </defs>\n` : ''

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" shape-rendering="crispEdges">`,
    `  <title>${escapeXml(text ? `Minecraft 名牌 · ${text.text}` : 'Minecraft 名牌')}</title>`,
    defsBlock + parts.join('\n'),
    '</svg>',
    '',
  ].join('\n')
}

/** Minecraft 原版的逐面亮度（与 WebGL 渲染保持一致） */
const FACE_BRIGHTNESS: Record<CubeFaceName, number> = {
  top: 1,
  bottom: 0.5,
  front: 0.8,
  back: 0.8,
  left: 0.6,
  right: 0.6,
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* ------------------------------------------------------------------ */
/* 浏览器侧：取素材并组装                                               */
/* ------------------------------------------------------------------ */

export function buildNameplateSvg(
  skin: ParsedSkin | null,
  config: NameplateConfig,
  style?: TextStyle | null,
): string {
  const layout = computeNameplateLayout({
    height: config.height,
    aspect: resolveAspect(config),
    splitMode: config.splitMode,
    ratioLeft: config.ratioLeft,
    avatarSide: config.avatarSide,
    headStyle: config.headStyle,
    avatarFill: config.avatarFill,
    showDivider: config.showDivider,
  })
  // 文字配色优先用预览里已经算好的那一份，保证「看到的 = 导出的」
  const theme = withTextStyle(resolveTheme(config), style)
  const font = getPixelFont(config.fontId)

  // 文字（与画布渲染、3D 导出共用同一份排版）
  const { text, lines, block, scale, placement, outline } = layoutIdText(font, theme, config, layout.idBox)

  // 背景纹理
  let background: SvgBackgroundImage | null = null
  if (theme.texture.kind !== 'solid') {
    const panelWidth = Math.ceil((layout.width - layout.frame * 2) / layout.unit)
    const panelHeight = Math.ceil((layout.height - layout.frame * 2) / layout.unit)
    const texture = getPanelTexture(theme.texture, panelWidth, panelHeight, TEXTURE_SEED)
    background = {
      dataUrl: rgbaToCanvas(texture).toDataURL('image/png'),
      width: texture.width,
      height: texture.height,
    }
  }

  // 头像
  let avatar: SvgAvatarImage | SvgAvatarPixels | SvgAvatarCube | null = null
  if (skin && !skin.issues.some((issue) => issue.level === 'error')) {
    if (config.headStyle === 'iso') {
      const cube = extractHeadCube(skin)
      const layers: Array<{ key: 'base' | 'hat'; halfSize: number; faces: Record<CubeFaceName, typeof cube.base.front> }> = [
        { key: 'base', halfSize: 0.5, faces: cube.base },
      ]
      if (cube.hat) layers.push({ key: 'hat', halfSize: 0.5 * (9 / 8), faces: cube.hat })

      const faces: SvgCubeFaceLayer[] = []
      for (const layer of layers) {
        const projections = projectCubeFaces(layout.headBox, layer.halfSize, cube.faceSize)
        for (const face of CUBE_FACE_ORDER) {
          const projection = projections.find((item) => item.name === face)
          if (!projection) continue
          faces.push({
            id: `头像-${layer.key === 'hat' ? '帽子层' : '基础层'}-${CUBE_FACE_LABEL[face]}`,
            matrix: projection.matrix,
            dataUrl: rgbaToDataUrl(shadeFaceTexture(layer.faces[face], FACE_BRIGHTNESS[face])),
            depth: projection.depth,
            faceSize: cube.faceSize,
          })
        }
      }
      avatar = { kind: 'cube', faces }
      void renderHead3D
      void HEAD3D_PROJECTION
    } else {
      avatar = { kind: 'pixels', image: extractHead(skin).front }
    }
  }

  return composeNameplateSvg({
    layout,
    theme,
    font,
    config,
    text: {
      text,
      lines,
      block,
      scale,
      placement,
      outline: outline !== null,
      scrim: style?.scrim ? { color: style.scrim.color, alpha: style.scrim.alpha } : null,
    },
    background,
    avatar,
  })
}

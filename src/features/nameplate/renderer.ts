/**
 * 名牌渲染主流程：皮肤 + ID → 一张矩形像素名牌。
 *
 * 头像有两种画法：
 *   iso  —— three.js 渲染真正的 3D 方块（逐面光照 + 帽子外壳），WebGL 不可用时回退 2D
 *   flat —— 纯 2D 正面像，整数倍最近邻放大，逐像素硬边
 */

import { isGoldenRatio, summarizeBlocks, type RatioSummary } from '../../lib/golden'
import type { TextStyle } from '../../lib/textPlan'
import { getPixelFont } from '../../lib/pixelFont'
import { extractHead, extractHeadCube } from '../../lib/skin'
import { resolveTheme } from './theme'
import type { ParsedSkin } from '../../lib/types'
import { TEXTURE_SEED, type NameplateConfig } from './config'
import { drawFlatHead } from './draw/head'
import { renderHead3D } from './draw/head3d'
import { drawGoldenGuides } from './draw/guides'
import { drawAvatarSlot, drawBackground, drawBevel, drawDivider, drawTextBackdrop } from './draw/panel'
import { drawIdText } from './draw/text'
import { computeNameplateLayout, type LayoutPlan } from './layout'
import { resolveAspect } from './resolve'

export interface RenderResult {
  layout: LayoutPlan
  width: number
  height: number
  /** 1 皮肤像素约等于多少画布像素 */
  headScale: number
  /** ID 放大倍率 */
  textScale: number
  /** 文字配色方案（亮字 / 同族描边 / 柔化底），导出时与画布保持一致 */
  textStyle: TextStyle
  /** ID 为空，画布上是占位文字 */
  placeholderId: boolean
  /** 是否成功绘制了皮肤头像 */
  hasSkin: boolean
  /** 头像是否用了真正的 3D 渲染（否则是 2D 回退） */
  head3d: boolean
  /** 实际两块占比 */
  ratio: RatioSummary
}

export function canRenderSkin(skin: ParsedSkin | null): skin is ParsedSkin {
  return skin !== null && !skin.issues.some((issue) => issue.level === 'error')
}

export function renderNameplate(
  canvas: HTMLCanvasElement,
  skin: ParsedSkin | null,
  config: NameplateConfig,
): RenderResult {
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
  const theme = resolveTheme(config)
  const font = getPixelFont(config.fontId)

  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 2D 上下文')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.globalAlpha = 1

  // 贴图自带边框时铺满整块名牌，并且不再画名牌外框/倒角（否则会盖掉用户的边框）
  const borderFromTexture = theme.borderFromTexture === true
  drawBackground(ctx, layout, theme, TEXTURE_SEED, { coverCanvas: borderFromTexture })
  if (!borderFromTexture) drawBevel(ctx, layout, theme)
  drawDivider(ctx, layout, theme)
  drawAvatarSlot(ctx, layout, theme)
  drawTextBackdrop(ctx, layout, theme, config.textBackdrop)

  const hasSkin = canRenderSkin(skin)
  let head3d = false
  if (hasSkin) {
    head3d = drawHead(ctx, layout, skin, config.headStyle === 'iso')
  }

  const idResult = drawIdText(ctx, layout, theme, font, config)

  const ratio = summarizeBlocks(
    layout.inner.width,
    layout.leftRect.width,
    config.avatarSide,
    config.splitMode === 'ratio' && isGoldenRatio(config.ratioLeft),
  )
  if (config.showGuides) {
    drawGoldenGuides(ctx, layout, theme, font, config.ratioLeft)
  }

  return {
    layout,
    width: layout.width,
    height: layout.height,
    headScale: layout.headScale,
    textScale: idResult.scale,
    textStyle: idResult.style,
    placeholderId: idResult.placeholder,
    hasSkin,
    head3d,
    ratio,
  }
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  layout: LayoutPlan,
  skin: ParsedSkin,
  use3d: boolean,
): boolean {
  const box = layout.headBox
  if (use3d) {
    const rendered = renderHead3D(skin, extractHeadCube(skin), box.width, box.height)
    if (rendered) {
      // 渲染尺寸与头像框一致，直接 1:1 贴上去，纹理保持最近邻硬边
      ctx.save()
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(
        rendered.canvas,
        0,
        0,
        rendered.width,
        rendered.height,
        box.x,
        box.y,
        box.width,
        box.height,
      )
      ctx.restore()
      return true
    }
  }
  drawFlatHead(ctx, layout, extractHead(skin))
  return false
}

/**
 * 皮肤头部六个面的抽取。
 * 2D 只需要 正面/侧面/顶面（extractHead），3D 需要完整六面 + 独立的第二层（帽子）。
 */

import type { HeadFaces, ParsedSkin, Rect, RgbaImage, SkinFormat, SkinIssue, SkinModel } from './types'
import { HEAD_FACE_SIZE } from './types'
import { compositeOverlay, countOpaquePixels, cropRect, isRectTransparent } from './raster'

/** 头部正面（脸） */
export const HEAD_FRONT: Rect = { x: 8, y: 8, width: 8, height: 8 }
/** 观察者看到的右侧面 = 角色左脸 */
export const HEAD_SIDE: Rect = { x: 16, y: 8, width: 8, height: 8 }
/** 头顶 */
export const HEAD_TOP: Rect = { x: 8, y: 0, width: 8, height: 8 }
/** 角色的右侧脸 */
export const HEAD_RIGHT: Rect = { x: 0, y: 8, width: 8, height: 8 }
/** 后脑 */
export const HEAD_BACK: Rect = { x: 24, y: 8, width: 8, height: 8 }
/** 下巴 */
export const HEAD_BOTTOM: Rect = { x: 16, y: 0, width: 8, height: 8 }

/** 第二层（帽子 / 头发）：上述坐标整体右移 32 列 */
const HAT_OFFSET = 32
function hatOf(rect: Rect): Rect {
  return { ...rect, x: rect.x + HAT_OFFSET }
}
export const HEAD_FRONT_OVERLAY = hatOf(HEAD_FRONT)
export const HEAD_SIDE_OVERLAY = hatOf(HEAD_SIDE)
export const HEAD_TOP_OVERLAY = hatOf(HEAD_TOP)
export const HEAD_RIGHT_OVERLAY = hatOf(HEAD_RIGHT)
export const HEAD_BACK_OVERLAY = hatOf(HEAD_BACK)
export const HEAD_BOTTOM_OVERLAY = hatOf(HEAD_BOTTOM)

/** 判定纤细（Alex）手臂的采样区：经典模型有像素，纤细模型全透明 */
export const SLIM_PROBE: Rect = { x: 52, y: 20, width: 4, height: 12 }

export const SKIN_SIZE = 64
export const LEGACY_HEIGHT = 32
const FULL_FACE: Rect = { x: 0, y: 0, width: 8, height: 8 }

export interface SkinValidation {
  ok: boolean
  format: SkinFormat
  errors: string[]
  warnings: string[]
}

/** 校验上传的皮肤尺寸 */
export function validateSkinSize(width: number, height: number): SkinValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (width === SKIN_SIZE && height === SKIN_SIZE) {
    return { ok: true, format: 'modern', errors, warnings }
  }
  if (width === SKIN_SIZE && height === LEGACY_HEIGHT) {
    warnings.push('这是旧版 64×32 皮肤，没有第二层（帽子 / 头发）贴图，名牌只使用基础头部。')
    return { ok: true, format: 'legacy', errors, warnings }
  }

  errors.push(
    `皮肤尺寸必须是 64×64（现代皮肤）或 64×32（旧版皮肤），当前图片为 ${width}×${height}。` +
      ' 请确认上传的是皮肤本体 PNG，而不是头像截图或披风。',
  )
  return { ok: false, format: 'modern', errors, warnings }
}

/** 通过手臂区域是否透明推断模型（纤细 Alex / 经典 Steve） */
export function inferSkinModel(image: RgbaImage, format: SkinFormat): SkinModel {
  if (format === 'legacy') return 'classic'
  if (image.width < SKIN_SIZE || image.height < SKIN_SIZE) return 'classic'
  return isRectTransparent(image, SLIM_PROBE) ? 'slim' : 'classic'
}

/** 解析皮肤：校验 + 推断模型 + 汇总提示信息 */
export function parseSkin(image: RgbaImage, fileName?: string): ParsedSkin {
  const validation = validateSkinSize(image.width, image.height)
  const issues: SkinIssue[] = [
    ...validation.errors.map<SkinIssue>((message) => ({ level: 'error', message })),
    ...validation.warnings.map<SkinIssue>((message) => ({ level: 'warning', message })),
  ]

  if (!validation.ok) {
    return {
      image,
      width: image.width,
      height: image.height,
      format: 'modern',
      model: 'classic',
      hasOverlay: false,
      issues,
      fileName,
    }
  }

  const opaque = countOpaquePixels(image, HEAD_FRONT)
  if (opaque === 0) {
    issues.push({ level: 'warning', message: '头部正面完全透明，名牌上可能看不到脸。' })
  } else if (opaque < HEAD_FRONT.width * HEAD_FRONT.height * 0.1) {
    issues.push({ level: 'info', message: '头部正面大部分为透明像素，渲染结果可能不完整。' })
  }

  return {
    image,
    width: image.width,
    height: image.height,
    format: validation.format,
    model: inferSkinModel(image, validation.format),
    hasOverlay: validation.format === 'modern',
    issues,
    fileName,
  }
}

function faceWithOverlay(image: RgbaImage, base: Rect, overlay: Rect, useOverlay: boolean): {
  face: RgbaImage
  usedOverlay: boolean
} {
  const baseFace = cropRect(image, base)
  if (!useOverlay) return { face: baseFace, usedOverlay: false }
  const hat = cropRect(image, overlay)
  if (isRectTransparent(hat, FULL_FACE)) return { face: baseFace, usedOverlay: false }
  return { face: compositeOverlay(baseFace, hat), usedOverlay: true }
}

/**
 * 2D 头像所需的三面，并把第二层（帽子 / 头发）合成到基础层上。
 */
export function extractHead(skin: ParsedSkin): HeadFaces {
  const useOverlay = skin.hasOverlay
  const front = faceWithOverlay(skin.image, HEAD_FRONT, HEAD_FRONT_OVERLAY, useOverlay)
  const side = faceWithOverlay(skin.image, HEAD_SIDE, HEAD_SIDE_OVERLAY, useOverlay)
  const top = faceWithOverlay(skin.image, HEAD_TOP, HEAD_TOP_OVERLAY, useOverlay)

  return {
    faceSize: HEAD_FACE_SIZE,
    front: front.face,
    side: side.face,
    top: top.face,
    hasOverlay: front.usedOverlay || side.usedOverlay || top.usedOverlay,
  }
}

export type HeadFaceName = 'front' | 'right' | 'left' | 'back' | 'top' | 'bottom'

export interface HeadCube {
  faceSize: number
  /** 基础头层（六个面，各自独立） */
  base: Record<HeadFaceName, RgbaImage>
  /** 第二层（帽子 / 头发），旧版皮肤为 null */
  hat: Record<HeadFaceName, RgbaImage> | null
}

const FACE_RECTS: Record<HeadFaceName, Rect> = {
  front: HEAD_FRONT,
  right: HEAD_RIGHT,
  left: HEAD_SIDE,
  back: HEAD_BACK,
  top: HEAD_TOP,
  bottom: HEAD_BOTTOM,
}

/**
 * 3D 立体头像所需的六面。第二层保持独立（在 3D 里它是一个略微放大的外壳），
 * 这样才能渲染出 Minecraft 真正的那种“帽子浮在头上”的效果。
 */
export function extractHeadCube(skin: ParsedSkin): HeadCube {
  const base = {} as Record<HeadFaceName, RgbaImage>
  const hat = {} as Record<HeadFaceName, RgbaImage>
  let hatHasPixels = false

  for (const name of Object.keys(FACE_RECTS) as HeadFaceName[]) {
    const rect = FACE_RECTS[name]
    base[name] = cropRect(skin.image, rect)
    const hatFace = cropRect(skin.image, hatOf(rect))
    hat[name] = hatFace
    if (!isRectTransparent(hatFace, FULL_FACE)) hatHasPixels = true
  }

  return {
    faceSize: HEAD_FACE_SIZE,
    base,
    hat: skin.hasOverlay && hatHasPixels ? hat : null,
  }
}

/** 界面展示用的格式说明 */
export function skinFormatLabel(skin: ParsedSkin): string {
  if (skin.format === 'legacy') return `旧版 ${skin.width}×${skin.height}`
  return `现代 ${skin.width}×${skin.height}`
}

/** 界面展示用的模型说明 */
export function skinModelLabel(skin: ParsedSkin): string {
  if (skin.format === 'legacy') return '经典模型（旧版皮肤无纤细变体）'
  return skin.model === 'slim' ? '纤细模型（Alex，3px 手臂）' : '经典模型（Steve，4px 手臂）'
}

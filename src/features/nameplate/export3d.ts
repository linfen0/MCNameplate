/**
 * 整块名牌的 3D 场景导出（按分层策略拆成可单独编辑的对象）。
 *
 * 分层与 2D/SVG 导出一一对应：
 *   名牌
 *    ├─ 底板            厚板（box）
 *    ├─ 背景            面板贴图（纯色主题为纯色面）
 *    ├─ 外框倒角        上/左高光、下/右阴影
 *    ├─ 分割线          暗条 + 高光条
 *    ├─ 头像肖像位      内凹方槽（背面 + 四壁）
 *    ├─ 头像
 *    │   ├─ 基础层      6 个面对象
 *    │   └─ 帽子层      6 个面对象（1.125 倍外壳）
 *    └─ ID文字          每个字符一个对象（点阵逐段挤出）
 *
 * 世界坐标：把名牌正面放在“正对相机”的平面上，名牌高度 = 1 个单位；
 * x 向右、y 向上、z 向屏幕内。头像立方体按世界轴对齐，因此相机看过去
 * 与 2D 导出的 2.5D 视角完全一致，但它是货真价实的三维体。
 *
 * 三个导出器共用同一份场景数据：
 *   · Blender 建场脚本（.py）—— 在 Blender 里运行即得原生场景
 *   · glTF 2.0（贴图内嵌）—— Blender / Spline / Three.js 直接导入
 *   · OBJ + MTL —— 通用交换格式
 */

import { zipSync, strToU8 } from 'fflate'
import { rgbaToDataUrl } from '../../lib/imageIo'
import { getPixelFont, measureText } from '../../lib/pixelFont'
import { hexToRgba } from '../../lib/color'
import { cloneImage, getPixel, setPixel } from '../../lib/raster'
import { extractHeadCube, type HeadCube } from '../../lib/skin'
import { getPanelTexture } from '../../lib/textures'
import type { Theme } from '../../lib/themes'
import type { ParsedSkin, Rect, RgbaImage } from '../../lib/types'
import { TEXTURE_SEED, type NameplateConfig } from './config'
import {
  CUBE_FACE_LABEL,
  CUBE_FACE_ORDER,
  HEAD3D_PROJECTION,
  HEAD3D_MARGIN,
  cubeFaceGeometry,
  type CubeFaceName,
} from './headGeometry'
import { resolveAspect } from './resolve'
import { layoutIdText } from './textLayout'
import type { TextStyle } from '../../lib/textPlan'
import { resolveTheme, withTextStyle } from './theme'
import { computeNameplateLayout, scrimSteps, type LayoutPlan } from './layout'

/* ------------------------------------------------------------------ */
/* 场景数据结构                                                        */
/* ------------------------------------------------------------------ */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface SceneQuad {
  verts: [Vec3, Vec3, Vec3, Vec3]
  material: string
}

export interface ScenePart {
  /** 图层名（Blender 对象名 / OBJ 的 o） */
  name: string
  /** 归入哪个集合 */
  group: string
  quads: SceneQuad[]
}

export interface SceneMaterial {
  name: string
  /** 纯色材质的颜色 */
  color: string
  /** 贴图文件名（相对 textures/），有贴图时忽略 color */
  textureFile?: string
  /** 是否使用贴图透明度做镂空（帽子层） */
  alphaMask?: boolean
}

export interface Nameplate3DScene {
  parts: ScenePart[]
  materials: SceneMaterial[]
  /** 贴图文件 → 像素数据 */
  textures: Record<string, RgbaImage>
  /** 场景尺寸（单位：名牌高度） */
  size: { width: number; height: number; thickness: number }
  stats: { parts: number; quads: number; materials: number; textures: number }
}

const FACE_SLUG: Record<CubeFaceName, string> = {
  front: 'front',
  back: 'back',
  left: 'left',
  right: 'right',
  top: 'top',
  bottom: 'bottom',
}

/** Minecraft 原版逐面亮度 */
const FACE_BRIGHTNESS: Record<CubeFaceName, number> = {
  top: 1,
  bottom: 0.5,
  front: 0.8,
  back: 0.8,
  left: 0.6,
  right: 0.6,
}

function toLinear(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function toSrgb(value: number): number {
  const c = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(c * 255)))
}

/** 把逐面亮度烘进贴图（与 WebGL 渲染、glTF 导出保持同一条颜色管线） */
export function shadeFaceTexture(image: RgbaImage, brightness: number): RgbaImage {
  if (brightness === 1) return cloneImage(image)
  const out = cloneImage(image)
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = toSrgb(toLinear(out.data[i]) * brightness)
    out.data[i + 1] = toSrgb(toLinear(out.data[i + 1]) * brightness)
    out.data[i + 2] = toSrgb(toLinear(out.data[i + 2]) * brightness)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 世界坐标映射                                                        */
/* ------------------------------------------------------------------ */

export interface SceneProjection {
  /** 2D 画布坐标 + 深度（单位：名牌高度，正数 = 朝向观察者）→ 世界坐标 */
  to3d: (px: number, py: number, depth: number) => Vec3
  /** 世界坐标 → 2D 画布坐标（忽略深度），用于回验几何是否落在名牌范围内 */
  canvasOf: (point: Vec3) => { x: number; y: number }
  /**
   * 头像立方体的局部坐标 → 世界坐标的旋转。
   * 底板是轴对齐的（法线 +Z），2.5D 视角被烘进立方体自身的旋转里，
   * 所以从 +Z 正交看过去，构图与 2D 导出完全一致，而在 3D 里它就是个正常的立体头像。
   */
  rotateHead: (point: Vec3) => Vec3
  /** 头像立方体的半边长度（世界单位） */
  headHalfSize: number
  /** 头像中心的世界坐标 */
  headCenter: Vec3
}

/**
 * 世界约定：X 向右、Y 向上、Z 朝向观察者；名牌高度 = 1 个单位。
 * 名牌正面（底板）落在 Z = 0 平面上。
 */
export function createSceneProjection(layout: LayoutPlan): SceneProjection {
  const { right, up, direction, halfV } = HEAD3D_PROJECTION
  const halfHeight = halfV / HEAD3D_MARGIN
  // 2D 视图里 1 相机单位 = ppu 像素（见 headGeometry 的取景约定）
  const ppu = layout.headBox.height / (2 * halfHeight)
  const norm = ppu / layout.height // 1 相机单位 = norm 个“名牌高度”
  const halfWidth = layout.width / layout.height / 2

  const to3d = (px: number, py: number, depth: number): Vec3 => ({
    x: px / layout.height - halfWidth,
    y: 0.5 - py / layout.height,
    z: depth,
  })

  const canvasOf = (point: Vec3): { x: number; y: number } => ({
    x: (point.x + halfWidth) * layout.height,
    y: (0.5 - point.y) * layout.height,
  })

  // 立方体局部坐标 → 世界：右乘旋转矩阵 R（行向量为 right / up / direction）。
  // 注意是“基向量点乘点”(R·p)，不是把点投到基上(p·R)——写成转置会导致投影形状整体错位。
  const rotateHead = (point: Vec3): Vec3 => ({
    x: point.x * right.x + point.y * right.y + point.z * right.z,
    y: point.x * up.x + point.y * up.y + point.z * up.z,
    z: point.x * direction.x + point.y * direction.y + point.z * direction.z,
  })

  const headHalfSize = 0.5 * norm
  const centre = to3d(
    layout.headBox.x + layout.headBox.width / 2,
    layout.headBox.y + layout.headBox.height / 2,
    0,
  )
  // 旋转后立方体在 z 上的半跨度 = h * (|dx| + |dy| + |dz|)；
  // 让它的背面刚好嵌进肖像位凹槽，而不是穿透整块底板
  const sum = Math.abs(direction.x) + Math.abs(direction.y) + Math.abs(direction.z)
  const zExtent = headHalfSize * sum
  const headCenter: Vec3 = { x: centre.x, y: centre.y, z: zExtent - 0.012 }

  return { to3d, canvasOf, rotateHead, headHalfSize, headCenter }
}

/* ------------------------------------------------------------------ */
/* 几何原语                                                            */
/* ------------------------------------------------------------------ */

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

/** 矩形（2D 画布坐标）→ 深度 d 处的一个四边形 */
function quadAt(
  to3d: SceneProjection['to3d'],
  rect: Rect,
  depth: number,
  material: string,
): SceneQuad {
  return {
    material,
    verts: [
      to3d(rect.x, rect.y, depth),
      to3d(rect.x + rect.width, rect.y, depth),
      to3d(rect.x + rect.width, rect.y + rect.height, depth),
      to3d(rect.x, rect.y + rect.height, depth),
    ],
  }
}

/** 由正反两个矩形围成一个盒子（6 个面） */
function boxQuads(
  to3d: SceneProjection['to3d'],
  rect: Rect,
  front: number,
  back: number,
  material: string,
): SceneQuad[] {
  const f = quadAt(to3d, rect, front, material)
  const b = quadAt(to3d, rect, back, material)
  const [f0, f1, f2, f3] = f.verts
  const [b0, b1, b2, b3] = b.verts
  return [
    f,
    { material, verts: [b3, b2, b1, b0] },
    { material, verts: [f0, b0, b1, f1] },
    { material, verts: [f1, b1, b2, f2] },
    { material, verts: [f2, b2, b3, f3] },
    { material, verts: [f3, b3, b0, f0] },
  ]
}

/* ------------------------------------------------------------------ */
/* 场景构建                                                            */
/* ------------------------------------------------------------------ */

export interface Build3DInput {
  layout: LayoutPlan
  theme: Theme
  skin: ParsedSkin | null
  cube: HeadCube | null
  /** 文字位图与其在画布上的落点/倍率（用于把点阵挤出成几何体） */
  text: {
    text: string
    image: RgbaImage
    scale: number
    placement: { x: number; y: number; width: number; height: number }
    font: { measure: (char: string) => number; padding: number }
    fill: string
    shadow: string | null
    /** 同族描边色；有描边时文字会多出一圈几何体 */
    outline?: string | null
    /** 同色系柔化底：烘进背景贴图，导出结果和画布一致 */
    scrim?: { color: string; alpha: number } | null
  } | null
}

const PLATE_THICKNESS = 0.08
const RAISED = 0.006
const RECESS = 0.03
const TEXT_HEIGHT = 0.012
const HAT_SCALE = 9 / 8

export function buildNameplate3DScene(input: Build3DInput): Nameplate3DScene {
  const { layout, theme, cube, text } = input
  const projection = createSceneProjection(layout)
  const { to3d } = projection
  const parts: ScenePart[] = []
  const materials: SceneMaterial[] = []
  const textures: Record<string, RgbaImage> = {}

  const addMaterial = (material: SceneMaterial): string => {
    if (!materials.some((item) => item.name === material.name)) materials.push(material)
    return material.name
  }

  const canvasRect: Rect = { x: 0, y: 0, width: layout.width, height: layout.height }
  const panel: Rect = theme.borderFromTexture
    ? { x: 0, y: 0, width: layout.width, height: layout.height }
    : {
        x: layout.frame,
        y: layout.frame,
        width: layout.width - layout.frame * 2,
        height: layout.height - layout.frame * 2,
      }

  // ---- 底板（轴对齐，正面在 Z = 0，向后延伸出厚度）----
  addMaterial({ name: '底板', color: theme.frame.fill })
  parts.push({
    name: '底板',
    group: '名牌',
    quads: boxQuads(to3d, canvasRect, 0, -PLATE_THICKNESS, '底板'),
  })

  // ---- 背景 ----
  if (theme.texture.kind === 'solid') {
    addMaterial({ name: '背景', color: theme.texture.color })
    parts.push({ name: '背景', group: '名牌', quads: [quadAt(to3d, panel, RAISED, '背景')] })
  } else {
    const texelsW = Math.ceil(panel.width / layout.unit)
    const texelsH = Math.ceil(panel.height / layout.unit)
    const base = getPanelTexture(theme.texture, texelsW, texelsH, TEXTURE_SEED)
    // 有柔化底时把它烘进背景贴图（缓存里的图不能改，先克隆）：3D 导出的底纹观感与画布一致
    const image = text?.scrim ? bakeScrim(base, layout, text.placement, text.scrim) : base
    const file = 'background.png'
    textures[file] = image
    addMaterial({ name: '背景纹理', color: '#ffffff', textureFile: file })
    parts.push({ name: '背景', group: '名牌', quads: [quadAt(to3d, panel, RAISED, '背景纹理')] })
  }

  // ---- 外框倒角（贴图自带边框时不做，避免盖住用户自己的边框）----
  const bevelParts: Array<{ name: string; rect: Rect; material: string; color: string }> =
    theme.borderFromTexture
      ? []
      : [
          {
            name: '外框-上',
            rect: {
              x: layout.frame,
              y: layout.frame,
              width: layout.width - layout.frame * 2,
              height: layout.bevel,
            },
            material: '外框-高光',
            color: theme.frame.light,
          },
          {
            name: '外框-左',
            rect: {
              x: layout.frame,
              y: layout.frame,
              width: layout.bevel,
              height: layout.height - layout.frame * 2,
            },
            material: '外框-高光',
            color: theme.frame.light,
          },
          {
            name: '外框-下',
            rect: {
              x: layout.frame + layout.bevel,
              y: layout.height - layout.frame - layout.bevel,
              width: layout.width - layout.frame * 2 - layout.bevel,
              height: layout.bevel,
            },
            material: '外框-阴影',
            color: theme.frame.dark,
          },
          {
            name: '外框-右',
            rect: {
              x: layout.width - layout.frame - layout.bevel,
              y: layout.frame + layout.bevel,
              width: layout.bevel,
              height: layout.height - layout.frame * 2 - layout.bevel,
            },
            material: '外框-阴影',
            color: theme.frame.dark,
          },
        ]
  for (const item of bevelParts) {
    addMaterial({ name: item.material, color: item.color })
    parts.push({ name: item.name, group: '外框倒角', quads: [quadAt(to3d, item.rect, RAISED * 1.5, item.material)] })
  }

  // ---- 分割线 ----
  if (layout.dividerWidth > 0) {
    const half = Math.max(1, Math.floor(layout.dividerWidth / 2))
    addMaterial({ name: '分割线-暗', color: theme.divider })
    addMaterial({ name: '分割线-亮', color: theme.frame.light })
    parts.push({
      name: '分割线-暗',
      group: '分割线',
      quads: [
        quadAt(
          to3d,
          { x: layout.dividerX, y: layout.inner.y, width: half, height: layout.inner.height },
          RAISED * 1.5,
          '分割线-暗',
        ),
      ],
    })
    parts.push({
      name: '分割线-亮',
      group: '分割线',
      quads: [
        quadAt(
          to3d,
          {
            x: layout.dividerX + half,
            y: layout.inner.y,
            width: layout.dividerWidth - half,
            height: layout.inner.height,
          },
          RAISED * 1.5,
          '分割线-亮',
        ),
      ],
    })
  }

  // ---- 头像肖像位（内凹方槽：背面 + 四壁）----
  if (theme.slot) {
    addMaterial({ name: '肖像位-底', color: theme.slot.fill })
    addMaterial({ name: '肖像位-暗', color: theme.slot.dark })
    addMaterial({ name: '肖像位-亮', color: theme.slot.light })
    const slot = layout.slot
    const t = Math.max(1, Math.round(layout.unit * 0.75))
    parts.push({
      name: '肖像位-底',
      group: '头像肖像位',
      quads: [quadAt(to3d, slot, -RECESS, '肖像位-底')],
    })
    const bevels: Array<{ name: string; rect: Rect; material: string }> = [
      {
        name: '肖像位-上',
        rect: { x: slot.x, y: slot.y, width: slot.width, height: t },
        material: '肖像位-暗',
      },
      {
        name: '肖像位-左',
        rect: { x: slot.x, y: slot.y, width: t, height: slot.height },
        material: '肖像位-暗',
      },
      {
        name: '肖像位-下',
        rect: { x: slot.x + t, y: slot.y + slot.height - t, width: slot.width - t, height: t },
        material: '肖像位-亮',
      },
      {
        name: '肖像位-右',
        rect: { x: slot.x + slot.width - t, y: slot.y + t, width: t, height: slot.height - t },
        material: '肖像位-亮',
      },
    ]
    for (const bevel of bevels) {
      parts.push({
        name: bevel.name,
        group: '头像肖像位',
        quads: boxQuads(to3d, bevel.rect, -RECESS + RAISED, -RECESS, bevel.material),
      })
    }
  }

  // ---- 头像立方体（基础层 + 帽子层，共 12 个面对象）----
  if (cube) {
    const layers: Array<{ slug: string; label: string; halfSize: number; faces: Record<CubeFaceName, RgbaImage> }> = [
      { slug: 'base', label: '基础层', halfSize: projection.headHalfSize, faces: cube.base },
    ]
    if (cube.hat) {
      layers.push({
        slug: 'hat',
        label: '帽子层',
        halfSize: projection.headHalfSize * HAT_SCALE,
        faces: cube.hat,
      })
    }
    for (const layer of layers) {
      for (const face of CUBE_FACE_ORDER) {
        const file = `avatar_${layer.slug}_${FACE_SLUG[face]}.png`
        textures[file] = shadeFaceTexture(layer.faces[face], FACE_BRIGHTNESS[face])
        const material = `头像-${layer.label}-${CUBE_FACE_LABEL[face]}`
        addMaterial({ name: material, color: '#ffffff', textureFile: file, alphaMask: layer.slug === 'hat' })
        const geometry = cubeFaceGeometry(face, layer.halfSize, cube.faceSize)
        const part: ScenePart = {
          name: `${layer.label}-${CUBE_FACE_LABEL[face]}`,
          group: `头像/${layer.label}`,
          quads: [
            {
              material,
              verts: geometry.corners.map((corner) =>
                add(projection.headCenter, projection.rotateHead(corner)),
              ) as [Vec3, Vec3, Vec3, Vec3],
            },
          ],
        }
        parts.push(part)
      }
    }
  }

  // ---- ID 文字（逐字符挤出）----
  if (text) {
    addMaterial({ name: '文字-填充', color: text.fill })
    if (text.shadow) addMaterial({ name: '文字-阴影', color: text.shadow })
    if (text.outline) addMaterial({ name: '文字-描边', color: text.outline })
    const chars = [...text.text]
    const textImage = text.image
    const scale = text.scale
    const originX = text.placement.x
    const originY = text.placement.y
    let pen = 0
    chars.forEach((char, index) => {
      const advance = text.font.measure(char)
      if (!/\s/.test(char)) {
        // 有描边时左右各多出 1 列，切分字符几何体时要带进来
        const lead = text.outline ? 1 : 0
        const from = Math.trunc(pen + text.font.padding - lead)
        const to = text.outline ? from + advance + 2 : Math.trunc(pen + advance + 1)
        const quads: SceneQuad[] = []
        for (let y = 0; y < textImage.height; y++) {
          let runStart = -1
          let runColor: string | null = null
          for (let x = from; x <= to; x++) {
            let color: string | null = null
            if (x < to) {
              const i = (y * textImage.width + x) * 4
              if (textImage.data[i + 3] > 0) {
                const rgb = `#${[0, 1, 2]
                  .map((c) => textImage.data[i + c].toString(16).padStart(2, '0'))
                  .join('')}`
                // 用颜色判定填充 / 描边 / 阴影层
                if (text.outline) {
                  color = rgb === text.outline.slice(0, 7).toLowerCase() ? '文字-描边' : '文字-填充'
                } else {
                  color = text.shadow && isShadowPixel(rgb, text.fill, text.shadow) ? '文字-阴影' : '文字-填充'
                }
              }
            }
            if (color !== runColor) {
              if (runStart >= 0 && runColor) {
                quads.push(
                  ...textRunQuads(
                    to3d,
                    // runStart 是整块点阵里的绝对 x（from = pen + padding），
                    // 这里再乘一次 pen 会让每个字符依次右移，最后跑出底板
                    originX + runStart * scale,
                    originY + y * scale,
                    (x - runStart) * scale,
                    scale,
                    runColor,
                  ),
                )
              }
              runStart = color ? x : -1
              runColor = color
            }
          }
        }
        if (quads.length > 0) {
          parts.push({
            name: `字符-${String(index + 1).padStart(2, '0')}-${char}`,
            group: 'ID文字',
            quads,
          })
        }
      }
      pen += advance
    })
  }

  return {
    parts,
    materials,
    textures,
    size: { width: layout.width / layout.height, height: 1, thickness: PLATE_THICKNESS },
    stats: {
      parts: parts.length,
      quads: parts.reduce((sum, part) => sum + part.quads.length, 0),
      materials: materials.length,
      textures: Object.keys(textures).length,
    },
  }
}

/**
 * 把同色系柔化底烘进背景贴图（贴图一个像素 = layout.unit 个画布像素）。
 * 几何来自 layout.scrimSteps，和画布 / SVG 用的是同一份。
 */
function bakeScrim(
  base: RgbaImage,
  layout: LayoutPlan,
  text: Rect,
  scrim: { color: string; alpha: number },
): RgbaImage {
  const out = cloneImage(base)
  const tint = hexToRgba(scrim.color)
  const unit = Math.max(1, layout.unit)
  for (const step of scrimSteps(layout, text, scrim.alpha)) {
    const x0 = Math.max(0, Math.floor(step.rect.x / unit))
    const y0 = Math.max(0, Math.floor(step.rect.y / unit))
    const x1 = Math.min(out.width, Math.ceil((step.rect.x + step.rect.width) / unit))
    const y1 = Math.min(out.height, Math.ceil((step.rect.y + step.rect.height) / unit))
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const [r, g, b, a] = getPixel(out, x, y)
        setPixel(out, x, y, [
          r + (tint[0] - r) * step.alpha,
          g + (tint[1] - g) * step.alpha,
          b + (tint[2] - b) * step.alpha,
          a,
        ])
      }
    }
  }
  return out
}

function isShadowPixel(rgb: string, fill: string, shadow: string): boolean {
  const value = rgb.toLowerCase()
  return value !== fill.toLowerCase().slice(0, 7) && value === shadow.toLowerCase().slice(0, 7)
}

/** 一段文字像素 → 一个有厚度的小方块（正面 + 四个侧壁） */
function textRunQuads(
  to3d: SceneProjection['to3d'],
  px: number,
  py: number,
  width: number,
  height: number,
  material: string,
): SceneQuad[] {
  const rect: Rect = { x: px, y: py, width: Math.max(1, width), height: Math.max(1, height) }
  return boxQuads(to3d, rect, TEXT_HEIGHT, 0, material)
}

/* ------------------------------------------------------------------ */
/* 导出器 1：Blender 建场脚本                                          */
/* ------------------------------------------------------------------ */

function pyVec(v: Vec3): string {
  const f = (n: number) => Number(n.toFixed(6)).toString()
  return `(${f(v.x)}, ${f(v.y)}, ${f(v.z)})`
}

export function sceneToBlenderScript(scene: Nameplate3DScene): string {
  const partsLiteral = scene.parts
    .map((part) => {
      const quads = part.quads
        .map((quad) => `            (${quad.verts.map(pyVec).join(', ')}, "${quad.material}"),`)
        .join('\n')
      return `    {
        "name": ${JSON.stringify(part.name)},
        "group": ${JSON.stringify(part.group)},
        "quads": [
${quads}
        ],
    },`
    })
    .join('\n')

  const materialsLiteral = scene.materials
    .map((material) => {
      const color = material.color.replace('#', '')
      const rgb = [0, 2, 4].map((i) => Number.parseInt(color.slice(i, i + 2), 16) / 255)
      return `    {
        "name": ${JSON.stringify(material.name)},
        "color": (${rgb.map((v) => v.toFixed(4)).join(', ')}),
        "texture": ${material.textureFile ? JSON.stringify(material.textureFile) : 'None'},
        "alpha_mask": ${material.alphaMask ? 'True' : 'False'},
    },`
    })
    .join('\n')

  return `# -*- coding: utf-8 -*-
"""
Minecraft 名牌工坊 · 名牌 3D 建场脚本
=====================================

用法（二选一）
  A. Blender：脚本工作区 → 打开 → 选中本文件 → 运行
  B. 命令行：blender --python build_nameplate_3d.py

运行后会自动把视口切到 Material Preview —— Solid 模式永远不显示贴图，
如果你手动切回 Solid 就只会看到一片灰，那不是贴图丢了。

生成的场景是**整块名牌的三维体**，按与 2D 导出一致的分层拆成独立对象：
  集合「名牌」      底板 / 背景 / 外框倒角（上左下右）/ 分割线 / 头像肖像位
  集合「头像」      基础层 6 面 + 帽子层 6 面
  集合「ID文字」    每个字符一个对象（点阵逐段挤出，带厚度）

世界坐标：名牌高度 = 1 个单位；x 向右、y 向上、z 朝向观察者，底板在 z = 0 平面。
2.5D 视角烘在头像立方体自身的旋转里 —— 从 +Z 正交看过去与 2D 预览完全一致，
但底板、文字、外框都是轴对齐的，在 Blender 里就是一个正常的立体名牌。
相机与灯光已经按导出时的 2.5D 视角摆好，运行后直接 F12 渲染即可。
贴图会自动 pack 进 .blend，另存后不丢资源。
"""

import math
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
SEARCH_DIRS = [
    os.path.join(os.path.dirname(HERE), "textures"),
    os.path.join(HERE, "textures"),
    os.path.dirname(HERE),
    HERE,
]

ROOT_COLLECTION = "名牌"
PARTS = [
${partsLiteral}
]

MATERIALS = [
${materialsLiteral}
]

# 底板轴对齐在 XY 平面，所以相机直接放在 +Z 正上方对着看，
# 一打开就是和 2D 预览一致的构图；2.5D 视角已经烘进头像立方体的旋转里。
CAMERA_DISTANCE = 2.2
CAMERA_ORTHO_SCALE = max(${scene.size.width.toFixed(6)}, 1.0) * 1.15


def find_texture(name):
    if not name:
        return None
    for base in SEARCH_DIRS:
        candidate = os.path.normpath(os.path.join(base, name))
        if os.path.exists(candidate):
            return candidate
    return None


def make_material(spec):
    material = bpy.data.materials.get(spec["name"]) or bpy.data.materials.new(spec["name"])
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    for node in list(nodes):
        nodes.remove(node)

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (420, 0)
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.location = (120, 0)
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    path = find_texture(spec["texture"])
    if path:
        image = bpy.data.images.load(path, check_existing=True)
        image.alpha_mode = "CHANNEL_PACKED"
        texture = nodes.new("ShaderNodeTexImage")
        texture.location = (-240, 0)
        texture.image = image
        texture.interpolation = "Closest"
        links.new(texture.outputs["Color"], shader.inputs["Base Color"])
        links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
    else:
        shader.inputs["Base Color"].default_value = (
            spec["color"][0], spec["color"][1], spec["color"][2], 1.0
        )

    if spec["alpha_mask"]:
        for attr, value in (
            ("blend_method", "CLIP"),
            ("alpha_threshold", 0.5),
            ("surface_render_method", "DITHERED"),
        ):
            try:
                setattr(material, attr, value)
            except Exception:
                pass

    return material


def ensure_collection(path):
    parent = bpy.context.scene.collection
    name = path
    if name.startswith(ROOT_COLLECTION):
        existing = bpy.data.collections.get(ROOT_COLLECTION)
        if existing is None:
            existing = bpy.data.collections.new(ROOT_COLLECTION)
            parent.children.link(existing)
        parent = existing
        name = path[len(ROOT_COLLECTION):].strip("/")
    if not name:
        return parent
    for segment in name.split("/"):
        child = bpy.data.collections.get(segment)
        if child is None:
            child = bpy.data.collections.new(segment)
            parent.children.link(child)
        parent = child
    return parent


def build_part(part, material_by_name):
    mesh = bpy.data.meshes.new(part["name"])
    vertices = []
    faces = []
    face_materials = []
    for quad in part["quads"]:
        verts, material_name = quad
        base = len(vertices)
        vertices.extend(verts)
        faces.append((base, base + 1, base + 2, base + 3))
        face_materials.append(material_name)

    mesh.from_pydata(vertices, [], faces)
    mesh.update()

    order = []
    for material_name in face_materials:
        if material_name not in order:
            order.append(material_name)
    for material_name in order:
        mesh.materials.append(material_by_name[material_name])
    for polygon, material_name in zip(mesh.polygons, face_materials):
        polygon.material_index = order.index(material_name)

    # UV：给每个面铺满 0..1，贴图是逐面独立的
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for index, _ in enumerate(mesh.loops):
        loop_index = index % 4
        uv_layer.data[index].uv = ((0, 0), (1, 0), (1, 1), (0, 1))[loop_index]

    obj = bpy.data.objects.new(part["name"], mesh)
    ensure_collection(part["group"]).objects.link(obj)
    return obj


def setup_viewport():
    """让 Blender 一运行就能看到贴图。
    注意：Solid 模式永远不显示 image texture，必须切到 Material Preview。"""
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != "VIEW_3D":
                continue
            for space in area.spaces:
                if space.type == "VIEW_3D":
                    try:
                        space.shading.type = "MATERIAL"
                    except Exception:
                        pass
    scene = bpy.context.scene
    # 像素风不要被 AgX / Filmic 冲淡颜色
    for transform in ("Standard",):
        try:
            scene.view_settings.view_transform = transform
        except Exception:
            pass
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = engine
            break
        except Exception:
            continue


def build_camera_and_light():
    camera_data = bpy.data.cameras.new("名牌相机")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = CAMERA_ORTHO_SCALE
    camera = bpy.data.objects.new("名牌相机", camera_data)
    camera.location = (0.0, 0.0, CAMERA_DISTANCE)
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = (0.0, 0.0, 0.0, 1.0)  # 正对 -Z 看
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    light_data = bpy.data.lights.new("主光", type="SUN")
    light_data.energy = 3.0
    light = bpy.data.objects.new("主光", light_data)
    light.location = (1.5, 2.5, 2.0)
    light.rotation_euler = (math.radians(52), 0.0, math.radians(32))
    bpy.context.scene.collection.objects.link(light)


def main():
    # 清掉上一次运行的结果，保证可重复执行
    for collection in list(bpy.data.collections):
        if collection.name == ROOT_COLLECTION or collection.name.startswith(ROOT_COLLECTION + "."):
            bpy.data.collections.remove(collection)
    for obj in list(bpy.data.objects):
        if obj.name in {part["name"] for part in PARTS}:
            bpy.data.objects.remove(obj, do_unlink=True)

    material_by_name = {spec["name"]: make_material(spec) for spec in MATERIALS}
    for part in PARTS:
        build_part(part, material_by_name)

    build_camera_and_light()
    setup_viewport()
    try:
        bpy.ops.file.pack_all()
    except Exception as error:
        print("贴图打包跳过：", error)

    print("已生成 %d 个对象：%s" % (len(PARTS), ", ".join(part["name"] for part in PARTS[:8])))


if __name__ == "__main__":
    main()
`
}

/* ------------------------------------------------------------------ */
/* 导出器 2 / 3：OBJ + MTL、glTF                                       */
/* ------------------------------------------------------------------ */

export function sceneToObj(scene: Nameplate3DScene): { obj: string; mtl: string } {
  const obj: string[] = ['# Minecraft 名牌工坊 · 名牌 3D 模型', '# 单位：名牌高度 = 1', 'mtllib nameplate.mtl', '']
  const mtl: string[] = ['# Minecraft 名牌工坊 · 材质库', '']

  for (const material of scene.materials) {
    const color = material.color.replace('#', '')
    const rgb = [0, 2, 4].map((i) => (Number.parseInt(color.slice(i, i + 2), 16) / 255).toFixed(4))
    mtl.push(`newmtl ${material.name}`)
    mtl.push(`Ka ${rgb.join(' ')}`)
    mtl.push(`Kd ${rgb.join(' ')}`)
    mtl.push('Ks 0.000 0.000 0.000')
    mtl.push(`d ${material.alphaMask ? '1.000' : '1.000'}`)
    mtl.push('illum 2')
    if (material.textureFile) {
      mtl.push(`map_Kd textures/${material.textureFile}`)
      if (material.alphaMask) mtl.push(`map_d textures/${material.textureFile}`)
    }
    mtl.push('')
  }

  let vertexIndex = 1
  let uvIndex = 1
  let normalIndex = 1
  for (const part of scene.parts) {
    obj.push(`o ${part.name}`)
    for (const quad of part.quads) {
      // 面法线（用于 vn）
      const [p0, p1, p2] = quad.verts
      const ux = p1.x - p0.x
      const uy = p1.y - p0.y
      const uz = p1.z - p0.z
      const vx = p2.x - p0.x
      const vy = p2.y - p0.y
      const vz = p2.z - p0.z
      let nx = uy * vz - uz * vy
      let ny = uz * vx - ux * vz
      let nz = ux * vy - uy * vx
      const length = Math.hypot(nx, ny, nz) || 1
      nx /= length
      ny /= length
      nz /= length

      for (const vertex of quad.verts) {
        obj.push(`v ${vertex.x.toFixed(6)} ${vertex.y.toFixed(6)} ${vertex.z.toFixed(6)}`)
      }
      // OBJ 的纹理原点在左下角（v 向上），而贴图行序是自上而下，所以 v 必须翻转。
      // 漏掉这一步，导入 Blender 后整张脸会上下颠倒。
      for (const uv of [
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ]) {
        obj.push(`vt ${uv[0]} ${uv[1]}`)
      }
      for (let i = 0; i < 4; i++) obj.push(`vn ${nx.toFixed(6)} ${ny.toFixed(6)} ${nz.toFixed(6)}`)

      obj.push(`usemtl ${quad.material}`)
      const a = vertexIndex
      const t = uvIndex
      const n = normalIndex
      obj.push(`f ${a}/${t}/${n} ${a + 1}/${t + 1}/${n + 1} ${a + 2}/${t + 2}/${n + 2}`)
      obj.push(`f ${a}/${t}/${n} ${a + 2}/${t + 2}/${n + 2} ${a + 3}/${t + 3}/${n + 3}`)
      vertexIndex += 4
      uvIndex += 4
      normalIndex += 4
    }
    obj.push('')
  }

  return { obj: obj.join('\n'), mtl: mtl.join('\n') }
}

function pngBytes(image: RgbaImage): Uint8Array {
  const base64 = rgbaToDataUrl(image).split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

interface GltfModel {
  json: Record<string, unknown>
  binary: Uint8Array
}

/**
 * 构建 glTF 2.0 模型。embedImages 决定贴图怎么放：
 * 'dataUri' 适合单文件 .gltf，'bufferView' 是 .glb 的要求。
 */
function buildGltfModel(
  scene: Nameplate3DScene,
  embedImages: 'dataUri' | 'bufferView',
  encodePng: (image: RgbaImage) => string,
): GltfModel {
  const materials: unknown[] = []
  const images: Array<Record<string, unknown>> = []
  const textures: Array<{ source: number; sampler: number }> = []
  const textured = new Set<string>()
  const materialIndex = new Map<string, number>()
  const pendingImages: Array<{ index: number; bytes: Uint8Array; mimeType: string }> = []

  for (const material of scene.materials) {
    const color = material.color.replace('#', '')
    const rgb = [0, 2, 4].map((i) => {
      const srgb = Number.parseInt(color.slice(i, i + 2), 16) / 255
      return Number(toLinear(srgb * 255).toFixed(6))
    })
    const entry: Record<string, unknown> = {
      name: material.name,
      pbrMetallicRoughness: {
        baseColorFactor: [...rgb, 1],
        metallicFactor: 0,
        roughnessFactor: 1,
      },
      doubleSided: true,
    }
    if (material.textureFile) {
      const image = scene.textures[material.textureFile]
      if (embedImages === 'dataUri') {
        images.push({ uri: encodePng(image) })
      } else {
        images.push({ mimeType: 'image/png', bufferView: -1 })
        pendingImages.push({ index: images.length - 1, bytes: pngBytes(image), mimeType: 'image/png' })
      }
      textures.push({ source: images.length - 1, sampler: 0 })
      ;(entry.pbrMetallicRoughness as Record<string, unknown>).baseColorTexture = {
        index: textures.length - 1,
      }
      textured.add(material.name)
      if (material.alphaMask) {
        entry.alphaMode = 'MASK'
        entry.alphaCutoff = 0.5
      }
    }
    materialIndex.set(material.name, materials.length)
    materials.push(entry)
  }

  const chunks: Uint8Array[] = []
  let byteOffset = 0
  const bufferViews: Array<Record<string, unknown>> = []
  const accessors: Array<Record<string, unknown>> = []

  const append = (bytes: Uint8Array, target?: number): number => {
    const padding = (4 - (byteOffset % 4)) % 4
    if (padding) {
      chunks.push(new Uint8Array(padding))
      byteOffset += padding
    }
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: bytes.byteLength,
      ...(target ? { target } : {}),
    })
    chunks.push(bytes)
    byteOffset += bytes.byteLength
    return bufferViews.length - 1
  }

  const pushFloats = (values: number[], type: string, components: number): number => {
    const view = append(new Uint8Array(new Float32Array(values).buffer), 34962)
    const min = new Array(components).fill(Number.POSITIVE_INFINITY)
    const max = new Array(components).fill(Number.NEGATIVE_INFINITY)
    for (let i = 0; i < values.length; i++) {
      const slot = i % components
      if (values[i] < min[slot]) min[slot] = values[i]
      if (values[i] > max[slot]) max[slot] = values[i]
    }
    // glTF 规范要求 POSITION 必须有 min/max —— 缺了官方校验器直接判 error
    accessors.push({
      bufferView: view,
      componentType: 5126,
      count: values.length / components,
      type,
      min,
      max,
    })
    return accessors.length - 1
  }

  const pushIndices = (values: number[]): number => {
    const view = append(new Uint8Array(new Uint32Array(values).buffer), 34963)
    accessors.push({
      bufferView: view,
      componentType: 5125,
      count: values.length,
      type: 'SCALAR',
      min: [Math.min(...values)],
      max: [Math.max(...values)],
    })
    return accessors.length - 1
  }

  const meshes: unknown[] = []
  const nodes: unknown[] = []
  for (const part of scene.parts) {
    const byMaterial = new Map<string, SceneQuad[]>()
    for (const quad of part.quads) {
      const list = byMaterial.get(quad.material)
      if (list) list.push(quad)
      else byMaterial.set(quad.material, [quad])
    }
    const primitives: unknown[] = []
    for (const [material, quads] of byMaterial) {
      const positions: number[] = []
      const normals: number[] = []
      const uvs: number[] = []
      const indices: number[] = []
      quads.forEach((quad, quadIndex) => {
        const [p0, p1, p2] = quad.verts
        const ux = p1.x - p0.x
        const uy = p1.y - p0.y
        const uz = p1.z - p0.z
        const vx = p2.x - p0.x
        const vy = p2.y - p0.y
        const vz = p2.z - p0.z
        let nx = uy * vz - uz * vy
        let ny = uz * vx - ux * vz
        let nz = ux * vy - uy * vx
        const length = Math.hypot(nx, ny, nz) || 1
        nx /= length
        ny /= length
        nz /= length
        for (const vertex of quad.verts) {
          positions.push(vertex.x, vertex.y, vertex.z)
          normals.push(nx, ny, nz)
        }
        // glTF 的 UV 原点在左上、v 向下（three.js 载入 glTF 时正是 flipY=false），
        // 与贴图行序一致，四个角按 (0,0)(1,0)(1,1)(0,1) 直接对应即可
        uvs.push(0, 0, 1, 0, 1, 1, 0, 1)
        const base = quadIndex * 4
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
      })
      const attributes: Record<string, number> = {
        POSITION: pushFloats(positions, 'VEC3', 3),
        NORMAL: pushFloats(normals, 'VEC3', 3),
      }
      // 纯色材质用不到 UV，不写可以少一堆校验器提示
      if (textured.has(material)) attributes.TEXCOORD_0 = pushFloats(uvs, 'VEC2', 2)
      primitives.push({
        attributes,
        indices: pushIndices(indices),
        material: materialIndex.get(material) ?? 0,
        mode: 4,
      })
    }
    meshes.push({ name: part.name, primitives })
    nodes.push({ mesh: meshes.length - 1, name: part.name })
  }

  // .glb：贴图字节追加进 BIN，并回填 bufferView 下标
  for (const pending of pendingImages) {
    images[pending.index] = { mimeType: pending.mimeType, bufferView: append(pending.bytes) }
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const merged = new Uint8Array(total)
  let cursor = 0
  for (const chunk of chunks) {
    merged.set(chunk, cursor)
    cursor += chunk.byteLength
  }

  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'Minecraft 名牌工坊 · nameplate 3D exporter' },
    scene: 0,
    scenes: [{ name: '名牌', nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes,
    materials,
    textures,
    images,
    samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: total }],
  }
  return { json, binary: merged }
}

/** glTF 2.0（贴图走 data URI，单文件自包含）。encodePng 可注入，便于 Node 单测。 */
export function sceneToGltf(
  scene: Nameplate3DScene,
  encodePng: (image: RgbaImage) => string = rgbaToDataUrl,
): string {
  const model = buildGltfModel(scene, 'dataUri', encodePng)
  const buffer = (model.json.buffers as Array<Record<string, unknown>>)[0]
  buffer.uri = `data:application/octet-stream;base64,${base64FromBytes(model.binary)}`
  return JSON.stringify(model.json, null, 2)
}

/**
 * glTF Binary（.glb）：JSON 与 BIN 各一个 chunk，贴图放进 BIN 用 bufferView 引用。
 * 不依赖 data URI，是 Blender / Spline 这类工具最省事、最不容易出问题的格式。
 */
export function sceneToGlb(scene: Nameplate3DScene): Uint8Array {
  const model = buildGltfModel(scene, 'bufferView', () => '')
  const jsonBytes = new TextEncoder().encode(JSON.stringify(model.json))
  const jsonPadding = (4 - (jsonBytes.byteLength % 4)) % 4
  const binPadding = (4 - (model.binary.byteLength % 4)) % 4
  const totalLength =
    12 + 8 + jsonBytes.byteLength + jsonPadding + 8 + model.binary.byteLength + binPadding
  const out = new Uint8Array(totalLength)
  const view = new DataView(out.buffer)
  let offset = 0

  view.setUint32(offset, 0x46546c67, true) // "glTF"
  view.setUint32(offset + 4, 2, true)
  view.setUint32(offset + 8, totalLength, true)
  offset += 12

  view.setUint32(offset, jsonBytes.byteLength + jsonPadding, true)
  view.setUint32(offset + 4, 0x4e4f534a, true) // "JSON"
  offset += 8
  out.set(jsonBytes, offset)
  offset += jsonBytes.byteLength
  for (let i = 0; i < jsonPadding; i++) out[offset + i] = 0x20
  offset += jsonPadding

  view.setUint32(offset, model.binary.byteLength + binPadding, true)
  view.setUint32(offset + 4, 0x004e4942, true) // "BIN\0"
  offset += 8
  out.set(model.binary, offset)

  return out
}

/* ------------------------------------------------------------------ */
/* ZIP 打包                                                            */
/* ------------------------------------------------------------------ */

const README = `Minecraft 名牌工坊 · 名牌 3D 模型包
========================================

这是**整块名牌**的三维版本，按与 2D 导出一致的分层拆成可单独编辑的对象：

  集合「名牌」
    底板 / 背景 / 外框倒角（上·左·下·右）/ 分割线（暗·亮）/ 头像肖像位（底+四壁）
  集合「头像」
    基础层 6 个面对象 + 帽子层 6 个面对象
  集合「ID文字」
    每个字符一个对象（点阵逐段挤出，带真实厚度）

世界坐标：名牌高度 = 1 个单位；x 向右、y 向上、z 朝向观察者，底板在 z = 0 平面。
2.5D 视角烘在头像立方体自身的旋转里 —— 从 +Z 正交看过去与 2D 预览完全一致，
但底板、文字、外框都是轴对齐的，在 Blender 里就是一个正常的立体名牌。
相机与灯光已按导出时的 2.5D 视角摆好。

文件说明
  blender/build_nameplate_3d.py   推荐入口：在 Blender 里运行，直接生成原生场景
  nameplate.glb                   glTF 二进制单文件（推荐：直接拖进 Blender）
  nameplate.gltf                  glTF 2.0（贴图走 data URI），Blender / Spline / Three.js 导入
  nameplate.obj + nameplate.mtl   通用 OBJ
  textures/*.png                  背景贴图 + 头像 12 面贴图（逐面亮度已烘好）
  导入说明.txt                     本文件

在 Blender 里用（推荐）
  方式 A：脚本工作区 → 打开 → 选 blender/build_nameplate_3d.py → 运行
          生成集合与对象、材质、UV；贴图自动 pack；视口自动切到 Material Preview；
          随后 文件 → 保存 即得 .blend
  方式 B：文件 → 导入 → glTF 2.0 → 选 nameplate.glb（二进制单文件，最省事）

看不到贴图？先确认视口不是 Solid 模式
  Blender 的 Solid 着色模式**不会显示 image texture**，只显示材质的基础色，
  所以导入后看到一片灰是正常的。按 Z → Material Preview（或页眉第三个球）即可。
  想确认贴图到底有没有导进来：切到 Shading 工作区点任一材质，
  应该能看到 Image Texture 节点已经接在 Principled BSDF 的 Base Color 上。

坐标与编辑提示
  · 底板厚度、文字厚度、肖像位凹深都在脚本顶部的常量里，直接改数值即可
  · 头像立方体是世界轴对齐的，所以相机看过去正好是 2.5D 视角；可整体旋转
  · 想要 2D 矢量版本（Figma / Illustrator）请用名牌 SVG 导出

为什么没有 .blend
  .blend 是 Blender 的内存转储二进制，结构随版本变化，程序生成无法保证被正确加载。
  建场脚本生成的是完全原生的场景，运行后另存即为 .blend，效果等价且不会版本不兼容。
`

export interface ModelBundle {
  files: Record<string, Uint8Array | string>
  zip: Uint8Array
  stats: Nameplate3DScene['stats'] & { bytes: number }
}

export function buildNameplate3dZip(scene: Nameplate3DScene): ModelBundle {
  const { obj, mtl } = sceneToObj(scene)
  const files: Record<string, Uint8Array | string> = {
    '导入说明.txt': README,
    'blender/build_nameplate_3d.py': sceneToBlenderScript(scene),
    'nameplate.glb': sceneToGlb(scene),
    'nameplate.gltf': sceneToGltf(scene),
    'nameplate.obj': obj,
    'nameplate.mtl': mtl,
  }
  for (const [file, image] of Object.entries(scene.textures)) {
    files[`textures/${file}`] = pngBytes(image)
  }

  const zipInput: Record<string, Uint8Array> = {}
  for (const [name, content] of Object.entries(files)) {
    zipInput[name] = typeof content === 'string' ? strToU8(content) : content
  }
  const zip = zipSync(zipInput, { level: 6 })
  return { files, zip, stats: { ...scene.stats, bytes: zip.byteLength } }
}

/** 由皮肤与配置直接构建场景 + 打包（导出按钮用的入口，与 SVG 导出同源） */
export function buildNameplateModelZip(
  skin: ParsedSkin | null,
  config: NameplateConfig,
  style?: TextStyle | null,
): ModelBundle {
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
  const textLayout = layoutIdText(font, theme, config, layout.idBox)
  const usable = skin !== null && !skin.issues.some((issue) => issue.level === 'error')

  return buildNameplate3dZip(
    buildNameplate3DScene({
      layout,
      theme,
      skin,
      cube: usable ? extractHeadCube(skin) : null,
      text: {
        text: textLayout.text,
        image: textLayout.block.image,
        scale: textLayout.scale,
        placement: textLayout.placement,
        font: { measure: (char: string) => measureText(font, char).advance, padding: textLayout.block.padding },
        fill: theme.text.fill,
        shadow: textLayout.outline ? null : config.shadow ? theme.text.shadow : null,
        outline: textLayout.outline,
        scrim: style?.scrim ? { color: style.scrim.color, alpha: style.scrim.alpha } : null,
      },
    }),
  )
}

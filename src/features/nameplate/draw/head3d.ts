/**
 * 3D 立体头像：用 three.js 渲染真正的方块模型。
 *
 * 相比手写斜投影，这里得到的是：
 *   · 正确的正交投影与前后遮挡（深度缓冲）
 *   · Minecraft 原版的逐面光照（顶 1.0 / 前后 0.8 / 左右 0.6 / 底 0.5）
 *   · 第二层（帽子）作为略微放大的外壳，用 alphaTest 切成硬边
 *   · 纹理最近邻采样 + MSAA 轮廓，观感接近游戏内物品栏里的方块头像
 *
 * three.js 体积不小，因此走动态 import：首屏不加载，进入页面后再后台拉取；
 * 还没就绪时渲染自动走 2D 头顶图，加载完成后再无缝切到 3D。
 */

import type * as ThreeNS from 'three'
import { rgbaToCanvas } from '../../../lib/imageIo'
import type { HeadCube, HeadFaceName } from '../../../lib/skin'
import type { ParsedSkin } from '../../../lib/types'
import { HEAD3D_MARGIN, HEAD3D_PROJECTION } from '../headGeometry'

/** Minecraft 原版的逐面亮度 */
const FACE_BRIGHTNESS: Record<HeadFaceName, number> = {
  top: 1,
  bottom: 0.5,
  front: 0.8,
  back: 0.8,
  left: 0.6,
  right: 0.6,
}

/** BoxGeometry 的材质顺序：+X, -X, +Y, -Y, +Z, -Z */
const MATERIAL_ORDER: HeadFaceName[] = ['left', 'right', 'top', 'bottom', 'front', 'back']

/** 第二层外壳相对头部的放大倍率：8 → 9 皮肤像素 */
const HAT_SCALE = 9 / 8

let THREE: typeof ThreeNS | null = null
let loadPromise: Promise<boolean> | null = null
let loadFailed = false

/** 后台加载 three.js；返回是否可用 */
export function ensureHead3D(): Promise<boolean> {
  if (THREE) return Promise.resolve(true)
  if (loadFailed) return Promise.resolve(false)
  if (!loadPromise) {
    loadPromise = import('three')
      .then((module) => {
        THREE = module
        return true
      })
      .catch(() => {
        loadFailed = true
        return false
      })
  }
  return loadPromise
}

export function isHead3DReady(): boolean {
  return THREE !== null
}

interface Head3DContext {
  renderer: ThreeNS.WebGLRenderer
  scene: ThreeNS.Scene
  camera: ThreeNS.OrthographicCamera
  group: ThreeNS.Group
  builtFor: ParsedSkin | null
  disposables: Array<{ dispose: () => void }>
}

let context: Head3DContext | null = null
let contextFailed = false

function createTexture(lib: typeof ThreeNS, canvas: HTMLCanvasElement): ThreeNS.CanvasTexture {
  const texture = new lib.CanvasTexture(canvas)
  texture.magFilter = lib.NearestFilter
  texture.minFilter = lib.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = lib.SRGBColorSpace
  return texture
}

function ensureContext(): Head3DContext | null {
  if (context) return context
  const lib = THREE
  if (!lib || contextFailed) return null
  try {
    const renderer = new lib.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    })
    renderer.setPixelRatio(1)
    renderer.setClearAlpha(0)
    renderer.toneMapping = lib.NoToneMapping
    renderer.outputColorSpace = lib.SRGBColorSpace

    const camera = new lib.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
    const direction = HEAD3D_PROJECTION.direction
    camera.position.set(direction.x, direction.y, direction.z).multiplyScalar(6)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()

    context = {
      renderer,
      scene: new lib.Scene(),
      camera,
      group: new lib.Group(),
      builtFor: null,
      disposables: [],
    }
    context.scene.add(context.group)
    return context
  } catch {
    contextFailed = true
    return null
  }
}

function buildBox(lib: typeof ThreeNS, cube: HeadCube, layer: 'base' | 'hat'): ThreeNS.Mesh {
  const faces = layer === 'base' ? cube.base : cube.hat
  if (!faces) throw new Error('missing face layer')
  const materials = MATERIAL_ORDER.map((name) => {
    const material = new lib.MeshBasicMaterial({
      map: createTexture(lib, rgbaToCanvas(faces[name])),
      color: new lib.Color().setScalar(FACE_BRIGHTNESS[name]),
      toneMapped: false,
    })
    // 硬边裁切，不用半透明混合，避免深度排序问题
    if (layer === 'hat') material.alphaTest = 0.5
    return material
  })
  const mesh = new lib.Mesh(new lib.BoxGeometry(1, 1, 1), materials)
  if (layer === 'hat') mesh.scale.setScalar(HAT_SCALE)
  return mesh
}

function buildScene(ctx: Head3DContext, skin: ParsedSkin, cube: HeadCube): void {
  const lib = THREE
  if (!lib) return
  ctx.group.clear()
  for (const item of ctx.disposables) item.dispose()
  ctx.disposables = []

  const base = buildBox(lib, cube, 'base')
  ctx.group.add(base)
  ctx.disposables.push(base.geometry, ...(base.material as ThreeNS.Material[]))

  if (cube.hat) {
    const hat = buildBox(lib, cube, 'hat')
    ctx.group.add(hat)
    ctx.disposables.push(hat.geometry, ...(hat.material as ThreeNS.Material[]))
  }
  ctx.builtFor = skin
}

export interface Head3DResult {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

/**
 * 把 3D 头像渲染成一张画布，尺寸正好等于传入的头像框（内容填满、留 3% 余量）。
 * three.js 未就绪或 WebGL 不可用时返回 null，由调用方回退到 2D 头顶图。
 */
export function renderHead3D(
  skin: ParsedSkin,
  cube: HeadCube,
  boxWidth: number,
  boxHeight: number,
): Head3DResult | null {
  const ctx = ensureContext()
  if (!ctx) return null
  if (ctx.builtFor !== skin) {
    try {
      buildScene(ctx, skin, cube)
    } catch {
      return null
    }
  }

  const aspect = Math.max(0.2, boxWidth / Math.max(1, boxHeight))
  const halfHeight = HEAD3D_PROJECTION.halfV / HEAD3D_MARGIN
  ctx.camera.left = -aspect * halfHeight
  ctx.camera.right = aspect * halfHeight
  ctx.camera.top = halfHeight
  ctx.camera.bottom = -halfHeight
  ctx.camera.updateProjectionMatrix()

  ctx.renderer.setSize(Math.max(1, boxWidth), Math.max(1, boxHeight), false)
  ctx.renderer.render(ctx.scene, ctx.camera)
  return { canvas: ctx.renderer.domElement, width: boxWidth, height: boxHeight }
}

/**
 * 立体头像的投影几何（纯数学，不依赖 three.js / DOM）。
 *
 * 布局模块需要知道“立体头像的轮廓宽高比”才能算出正确的头像框，
 * 渲染模块需要同一组相机参数。放在这里让两边共用一份真相。
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** 相机方向：稍微偏右上方，类似 Minecraft 物品栏里方块图标的视角 */
const RAW_DIRECTION: Vec3 = { x: 0.62, y: 0.32, z: 1 }

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / length, y: v.y / length, z: v.z / length }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export interface Head3DProjection {
  /** 单位立方体轮廓的宽高比（宽 / 高） */
  aspect: number
  /** 轮廓在屏幕右方向的半幅 */
  halfU: number
  /** 轮廓在屏幕上方向的半幅 */
  halfV: number
  /** 正面在屏幕上的宽度 ÷ 轮廓宽度，用于换算“1 皮肤像素 ≈ 多少画布像素” */
  frontFaceRatio: number
  /** 相机单位方向向量 */
  direction: Vec3
  /** 屏幕右 / 上方向（相机基向量，用于把三维点投到画布坐标） */
  right: Vec3
  up: Vec3
}

function computeProjection(): Head3DProjection {
  const direction = normalize(RAW_DIRECTION)
  const forward: Vec3 = { x: -direction.x, y: -direction.y, z: -direction.z }
  const worldUp: Vec3 = { x: 0, y: 1, z: 0 }
  // 屏幕右方向 r = forward × up
  const right = normalize(cross(forward, worldUp))
  const up = cross(right, forward)

  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (const x of [-0.5, 0.5]) {
    for (const y of [-0.5, 0.5]) {
      for (const z of [-0.5, 0.5]) {
        const u = x * right.x + y * right.y + z * right.z
        const v = x * up.x + y * up.y + z * up.z
        minU = Math.min(minU, u)
        maxU = Math.max(maxU, u)
        minV = Math.min(minV, v)
        maxV = Math.max(maxV, v)
      }
    }
  }

  const halfU = (maxU - minU) / 2
  const halfV = (maxV - minV) / 2
  // 正面（z = +0.5）在屏幕上的宽度只由 x 轴贡献
  const frontFaceWidth = Math.abs(right.x)
  return {
    aspect: halfU / halfV,
    halfU,
    halfV,
    frontFaceRatio: frontFaceWidth / (halfU * 2),
    direction,
    right,
    up,
  }
}

export const HEAD3D_PROJECTION: Head3DProjection = computeProjection()

/** 轮廓里留出 3% 的余量，避免贴边被裁 */
export const HEAD3D_MARGIN = 0.97

/** 六个面的固定顺序（与 three.js BoxGeometry 的贴图方向一致） */
export const CUBE_FACE_ORDER: CubeFaceName[] = ['front', 'back', 'left', 'right', 'top', 'bottom']

/** 面的中文名，导出成图层名用 */
export const CUBE_FACE_LABEL: Record<CubeFaceName, string> = {
  front: '正面',
  back: '后脑',
  left: '左脸',
  right: '右脸',
  top: '头顶',
  bottom: '下巴',
}

export interface CubeFaceGeometry {
  name: CubeFaceName
  /** 4 个角（贴图 u,v 顺序：(0,0) (n,0) (n,n) (0,n)） */
  corners: Vec3[]
  normal: Vec3
  /** 贴图坐标（glTF 的 v 轴向上，需要翻转） */
  uvs: number[]
  /** 两个三角形的索引 */
  indices: number[]
}

/** 单个面的三维几何：供 SVG 仿射变换与 glTF 网格共用同一套角点约定 */
export function cubeFaceGeometry(name: CubeFaceName, halfSize: number, faceSize: number): CubeFaceGeometry {
  const corners = [
    faceCorner(name, halfSize, faceSize, 0, 0),
    faceCorner(name, halfSize, faceSize, faceSize, 0),
    faceCorner(name, halfSize, faceSize, faceSize, faceSize),
    faceCorner(name, halfSize, faceSize, 0, faceSize),
  ]
  return {
    name,
    corners,
    normal: faceNormal(name),
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    indices: [0, 1, 2, 0, 2, 3],
  }
}

/* ------------------------------------------------------------------ */
/* 立方体六个面 → 画布坐标                                              */
/* ------------------------------------------------------------------ */

export type CubeFaceName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'

export interface CubeFaceProjection {
  name: CubeFaceName
  /** 贴图 (0,0) (n,0) (n,n) (0,n) 四个角对应的画布坐标 */
  corners: Array<{ x: number; y: number }>
  /** 贴图空间(0..n) → 画布空间 的仿射矩阵 [a, b, c, d, e, f] */
  matrix: [number, number, number, number, number, number]
  /** 面心沿相机方向的深度，越大越靠近相机（画家算法：先画远的） */
  depth: number
  /** 面法线是否朝向相机 */
  facingCamera: boolean
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

/**
 * 面的四角在三维空间的位置（半边长 h，贴图边长 n）。
 * 顺序与 three.js BoxGeometry 的贴图方向一致：
 *   u 沿贴图向右，v 沿贴图向下。
 */
export function faceCorner(name: CubeFaceName, h: number, n: number, u: number, v: number): Vec3 {
  const su = (u / n) * 2 * h
  const sv = (v / n) * 2 * h
  switch (name) {
    case 'front': // +Z：u→+X，v→-Y
      return { x: -h + su, y: h - sv, z: h }
    case 'back': // -Z：u→-X，v→-Y
      return { x: h - su, y: h - sv, z: -h }
    case 'left': // +X（角色左脸）：u→-Z，v→-Y
      return { x: h, y: h - sv, z: h - su }
    case 'right': // -X（角色右脸）：u→+Z，v→-Y
      return { x: -h, y: h - sv, z: -h + su }
    case 'top': // +Y：u→+X，v→+Z（贴图 v=0 是后脑）
      return { x: -h + su, y: h, z: -h + sv }
    case 'bottom': // -Y：u→+X，v→-Z
      return { x: -h + su, y: -h, z: h - sv }
  }
}

/**
 * 把立方体六个面投到画布坐标（正交投影，与 three.js 渲染时的取景完全一致：
 * 轮廓刚好填满 headBox，四周留 HEAD3D_MARGIN 的余量）。
 */
export function projectCubeFaces(
  box: { x: number; y: number; width: number; height: number },
  halfSize: number,
  faceSize: number,
): CubeFaceProjection[] {
  const { direction, right, up, halfV } = HEAD3D_PROJECTION
  const aspect = box.width / Math.max(1, box.height)
  const halfHeight = halfV / HEAD3D_MARGIN
  const left = -aspect * halfHeight
  const rightEdge = aspect * halfHeight
  const top = halfHeight
  const bottom = -halfHeight

  const toScreen = (point: Vec3): { x: number; y: number } => {
    const u = dot(point, right)
    const v = dot(point, up)
    return {
      x: box.x + ((u - left) / (rightEdge - left)) * box.width,
      y: box.y + ((top - v) / (top - bottom)) * box.height,
    }
  }

  const faces: CubeFaceName[] = ['front', 'back', 'left', 'right', 'top', 'bottom']
  return faces.map((name) => {
    const corners = [
      toScreen(faceCorner(name, halfSize, faceSize, 0, 0)),
      toScreen(faceCorner(name, halfSize, faceSize, faceSize, 0)),
      toScreen(faceCorner(name, halfSize, faceSize, faceSize, faceSize)),
      toScreen(faceCorner(name, halfSize, faceSize, 0, faceSize)),
    ]
    const origin = corners[0]
    const [ux, uy] = [corners[1].x - origin.x, corners[1].y - origin.y]
    const [vx, vy] = [corners[3].x - origin.x, corners[3].y - origin.y]
    const centre = faceCorner(name, halfSize, faceSize, faceSize / 2, faceSize / 2)
    return {
      name,
      corners,
      matrix: [
        ux / faceSize,
        uy / faceSize,
        vx / faceSize,
        vy / faceSize,
        origin.x,
        origin.y,
      ] as [number, number, number, number, number, number],
      depth: dot(centre, direction),
      facingCamera: dot(faceNormal(name), direction) > 0,
    }
  })
}

export function faceNormal(name: CubeFaceName): Vec3 {
  switch (name) {
    case 'front':
      return { x: 0, y: 0, z: 1 }
    case 'back':
      return { x: 0, y: 0, z: -1 }
    case 'left':
      return { x: 1, y: 0, z: 0 }
    case 'right':
      return { x: -1, y: 0, z: 0 }
    case 'top':
      return { x: 0, y: 1, z: 0 }
    case 'bottom':
      return { x: 0, y: -1, z: 0 }
  }
}

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
  }
}

export const HEAD3D_PROJECTION: Head3DProjection = computeProjection()

/** 轮廓里留出 3% 的余量，避免贴边被裁 */
export const HEAD3D_MARGIN = 0.97

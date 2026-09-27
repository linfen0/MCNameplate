import { describe, expect, it } from 'vitest'
import { HEAD3D_MARGIN, HEAD3D_PROJECTION } from './headGeometry'

describe('3D 头像投影几何', () => {
  it('相机方向是单位向量，且指向正前方偏右上', () => {
    const { direction } = HEAD3D_PROJECTION
    expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1, 10)
    expect(direction.z).toBeGreaterThan(direction.x)
    expect(direction.z).toBeGreaterThan(direction.y)
    expect(direction.x).toBeGreaterThan(0)
    expect(direction.y).toBeGreaterThan(0)
  })

  it('立方体轮廓宽大于高（能看到顶面和右侧面）', () => {
    expect(HEAD3D_PROJECTION.aspect).toBeGreaterThan(1)
    expect(HEAD3D_PROJECTION.aspect).toBeLessThan(1.6)
    expect(HEAD3D_PROJECTION.aspect).toBeCloseTo(
      HEAD3D_PROJECTION.halfU / HEAD3D_PROJECTION.halfV,
      10,
    )
  })

  it('正面宽度占比在合理区间，且能推出“1 皮肤像素 ≈ N px”', () => {
    const { frontFaceRatio } = HEAD3D_PROJECTION
    expect(frontFaceRatio).toBeGreaterThan(0.5)
    expect(frontFaceRatio).toBeLessThan(0.9)
    // 8 皮肤像素的正面，在 1024 宽的轮廓里每个皮肤像素约 100px 上下
    const scale = (1024 * frontFaceRatio) / 8
    expect(scale).toBeGreaterThan(60)
    expect(scale).toBeLessThan(120)
  })

  it('渲染留白系数在 (0,1) 区间，保证不贴边裁切', () => {
    expect(HEAD3D_MARGIN).toBeGreaterThan(0.9)
    expect(HEAD3D_MARGIN).toBeLessThan(1)
  })
})

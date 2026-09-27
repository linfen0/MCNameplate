import { describe, expect, it } from 'vitest'
import { HEAD3D_PROJECTION } from './headGeometry'
import { computeNameplateLayout, type LayoutInput, type LayoutPlan } from './layout'
import { ASPECT_PRESETS, sizeFrom } from './config'

/** 只取数值型预设，'auto' 需要在浏览器里测量字体 */
const NUMERIC_ASPECTS = ASPECT_PRESETS.filter(
  (preset): preset is typeof preset & { value: number } => typeof preset.value === 'number',
).map((preset) => preset.value)

const HEIGHTS = [256, 512, 1024]

const base: Omit<LayoutInput, 'height' | 'aspect'> = {
  splitMode: 'ratio',
  ratioLeft: 0.3819660112501051,
  avatarSide: 'left',
  headStyle: 'iso',
  avatarFill: 0.92,
  showDivider: true,
}

function plan(patch: Partial<LayoutInput> = {}): LayoutPlan {
  return computeNameplateLayout({ ...base, height: 512, aspect: 4, ...patch })
}

describe('画布尺寸', () => {
  it('宽度 = 高度 × 宽高比', () => {
    for (const height of HEIGHTS) {
      for (const aspect of NUMERIC_ASPECTS) {
        const layout = plan({ height, aspect })
        expect(layout.height).toBe(height)
        expect(layout.width).toBe(Math.round(height * aspect))
      }
    }
  })

  it('与 sizeFrom 的结果一致（界面与渲染同源）', () => {
    for (const aspect of NUMERIC_ASPECTS) {
      const layout = plan({ height: 512, aspect })
      expect(sizeFrom(512, aspect)).toEqual({ width: layout.width, height: layout.height })
    }
  })

  it('所有预设都产出宽 > 高的横版铭牌', () => {
    for (const aspect of NUMERIC_ASPECTS) {
      const layout = plan({ aspect })
      expect(layout.width).toBeGreaterThan(layout.height)
    }
  })

  it('基础网格由高度决定', () => {
    expect(plan({ height: 256 }).unit).toBe(1)
    expect(plan({ height: 512 }).unit).toBe(2)
    expect(plan({ height: 1024 }).unit).toBe(4)
  })
})

describe('黄金分割切分', () => {
  it('两块恰好填满内容区，不留缝隙也不溢出', () => {
    for (const height of HEIGHTS) {
      for (const aspect of NUMERIC_ASPECTS) {
        const layout = plan({ height, aspect })
        expect(layout.leftRect.x).toBe(layout.inner.x)
        expect(layout.leftRect.width + layout.rightRect.width).toBe(layout.inner.width)
        expect(layout.rightRect.x).toBe(layout.leftRect.x + layout.leftRect.width)
        expect(layout.rightRect.x + layout.rightRect.width).toBe(layout.inner.x + layout.inner.width)
        expect(layout.leftRect.height).toBe(layout.inner.height)
      }
    }
  })

  it('实际像素比例与黄金分割的误差小于 1px', () => {
    for (const height of HEIGHTS) {
      for (const aspect of NUMERIC_ASPECTS) {
        const layout = plan({ height, aspect })
        const ratio = layout.leftRect.width / layout.inner.width
        expect(Math.abs(ratio - 0.3819660112501051) * layout.inner.width).toBeLessThan(1)
      }
    }
  })

  it('avatarSide 决定哪一侧是头像', () => {
    const left = plan({ avatarSide: 'left' })
    expect(left.avatarRect).toBe(left.leftRect)
    expect(left.nameRect).toBe(left.rightRect)

    const right = plan({ avatarSide: 'right' })
    expect(right.avatarRect).toBe(right.rightRect)
    expect(right.nameRect).toBe(right.leftRect)
  })

  it('分割线位于两块交界处', () => {
    const layout = plan({ showDivider: true })
    const boundary = layout.inner.x + layout.leftRect.width
    expect(Math.abs(layout.dividerX + layout.dividerWidth / 2 - boundary)).toBeLessThanOrEqual(1)
  })
})

describe('两种切分模式', () => {
  it('tight 模式：头像块宽度等于内容区高度，其余全给 ID', () => {
    for (const height of HEIGHTS) {
      const layout = plan({ height, splitMode: 'tight' })
      expect(layout.avatarRect.width).toBe(Math.min(layout.inner.height, Math.floor(layout.inner.width / 2)))
      expect(layout.avatarRect.width + layout.nameRect.width).toBe(layout.inner.width)
    }
  })

  it('tight 模式让 ID 区域明显更宽（字号才能做大）', () => {
    const tight = plan({ height: 512, aspect: 4, splitMode: 'tight' })
    const ratio = plan({ height: 512, aspect: 4, splitMode: 'ratio' })
    expect(tight.nameRect.width).toBeGreaterThan(ratio.nameRect.width)
    expect(tight.avatarRect.width).toBeLessThan(ratio.avatarRect.width)
  })

  it('tight 模式下头像几乎占满铭牌高度', () => {
    const layout = plan({ height: 512, aspect: 4, splitMode: 'tight', headStyle: 'iso' })
    expect(layout.headBox.height / layout.height).toBeGreaterThan(0.7)
    expect(layout.slot.width).toBe(layout.slot.height)
    expect(layout.slot.width).toBeGreaterThan(layout.avatarRect.width * 0.85)
  })

  it('avatarSide 在两种模式下都生效', () => {
    for (const splitMode of ['tight', 'ratio'] as const) {
      const left = plan({ splitMode, avatarSide: 'left' })
      expect(left.avatarRect).toBe(left.leftRect)
      const right = plan({ splitMode, avatarSide: 'right' })
      expect(right.avatarRect).toBe(right.rightRect)
      expect(right.nameRect).toBe(right.leftRect)
    }
  })
})

describe('头像肖像位', () => {
  it('肖像位始终是正方形，且完整落在头像块内', () => {
    for (const height of HEIGHTS) {
      for (const aspect of NUMERIC_ASPECTS) {
        const layout = plan({ height, aspect })
        expect(layout.slot.width).toBe(layout.slot.height)
        expect(layout.slot.x).toBeGreaterThanOrEqual(layout.avatarRect.x)
        expect(layout.slot.y).toBeGreaterThanOrEqual(layout.avatarRect.y)
        expect(layout.slot.x + layout.slot.width).toBeLessThanOrEqual(
          layout.avatarRect.x + layout.avatarRect.width,
        )
        expect(layout.slot.y + layout.slot.height).toBeLessThanOrEqual(
          layout.avatarRect.y + layout.avatarRect.height,
        )
      }
    }
  })

  it('肖像位紧贴头像块高度（不会留一大片空底板）', () => {
    const layout = plan()
    expect(layout.slot.height).toBeGreaterThan(layout.avatarRect.height * 0.7)
  })

  it('3D 头像按投影宽高比取最大内接矩形', () => {
    for (const height of HEIGHTS) {
      const layout = plan({ height, headStyle: 'iso' })
      const ratio = layout.headBox.width / layout.headBox.height
      expect(Math.abs(ratio - HEAD3D_PROJECTION.aspect)).toBeLessThan(0.05)
      expect(layout.headBox.x).toBeGreaterThanOrEqual(layout.slot.x)
      expect(layout.headBox.y).toBeGreaterThanOrEqual(layout.slot.y)
      expect(layout.headBox.x + layout.headBox.width).toBeLessThanOrEqual(
        layout.slot.x + layout.slot.width,
      )
      expect(layout.headBox.y + layout.headBox.height).toBeLessThanOrEqual(
        layout.slot.y + layout.slot.height,
      )
    }
  })

  it('2D 头像外框是 8 皮肤像素的整数倍（逐像素硬边）', () => {
    for (const height of HEIGHTS) {
      const layout = plan({ height, headStyle: 'flat' })
      expect(layout.headBox.width).toBe(layout.headBox.height)
      expect(layout.headBox.width % 8).toBe(0)
      expect(layout.headScale).toBe(layout.headBox.width / 8)
    }
  })

  it('头像足够大（黄金比铭牌也至少占高度 45%）', () => {
    for (const aspect of NUMERIC_ASPECTS) {
      for (const headStyle of ['iso', 'flat'] as const) {
        const layout = plan({ height: 512, aspect, headStyle })
        const floor = aspect >= 2 ? 0.6 : 0.45
        expect(layout.headBox.height / layout.height, `${headStyle} @ ${aspect}`).toBeGreaterThan(floor)
      }
    }
  })

  it('头像大小比例生效', () => {
    expect(plan({ avatarFill: 1 }).headBox.width).toBeGreaterThan(
      plan({ avatarFill: 0.5 }).headBox.width,
    )
  })

  it('肖像位不与分割线重叠', () => {
    for (const height of HEIGHTS) {
      const layout = plan({ height })
      if (layout.avatarSide === 'left') {
        expect(layout.slot.x + layout.slot.width).toBeLessThanOrEqual(layout.dividerX)
      }
    }
  })
})

describe('ID 文本区域', () => {
  it('文本框完全落在 ID 区域内', () => {
    for (const height of HEIGHTS) {
      for (const aspect of NUMERIC_ASPECTS) {
        for (const ratioLeft of [0.2, 0.3819660112501051, 0.5, 0.6180339887498949, 0.8]) {
          const layout = plan({ height, aspect, ratioLeft })
          expect(layout.idBox.x).toBeGreaterThanOrEqual(layout.nameRect.x)
          expect(layout.idBox.y).toBeGreaterThanOrEqual(layout.nameRect.y)
          expect(layout.idBox.x + layout.idBox.width).toBeLessThanOrEqual(
            layout.nameRect.x + layout.nameRect.width,
          )
          expect(layout.idBox.y + layout.idBox.height).toBeLessThanOrEqual(
            layout.nameRect.y + layout.nameRect.height,
          )
          expect(layout.idBox.width).toBeGreaterThan(0)
          expect(layout.idBox.height).toBeGreaterThan(0)
        }
      }
    }
  })

  it('文本框高度占 ID 区域 85% 以上（不留大片空白）', () => {
    const layout = plan()
    expect(layout.idBox.height / layout.nameRect.height).toBeGreaterThan(0.85)
  })
})

describe('像素对齐与健壮性', () => {
  it('所有几何量都是整数', () => {
    for (const height of HEIGHTS) {
      const layout = plan({ height })
      const numbers = [
        layout.unit,
        layout.frame,
        layout.bevel,
        layout.inner.x,
        layout.inner.width,
        layout.leftRect.width,
        layout.dividerX,
        layout.slot.x,
        layout.slot.width,
        layout.headBox.x,
        layout.headBox.width,
        layout.idBox.x,
        layout.idBox.width,
      ]
      for (const value of numbers) expect(Number.isInteger(value)).toBe(true)
    }
  })

  it('装饰尺寸与基础网格对齐', () => {
    const layout = plan({ height: 1024 })
    expect(layout.unit).toBe(4)
    expect(layout.frame).toBe(12)
    expect(layout.inner.width).toBe(layout.width - (12 + 4) * 2)
  })

  it('极端尺寸不会产生非法几何量', () => {
    for (const height of [1, 16, 96, 4096, 100000]) {
      for (const aspect of [0.5, 1, 4, 8, 99]) {
        const layout = plan({ height, aspect })
        expect(layout.width).toBeGreaterThan(0)
        expect(layout.headBox.width).toBeGreaterThan(0)
        expect(layout.headBox.height).toBeGreaterThan(0)
        expect(layout.idBox.width).toBeGreaterThan(0)
      }
    }
  })
})

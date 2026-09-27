import { describe, expect, it } from 'vitest'
import { createImage, setPixel } from '../../lib/raster'
import { getPixelFont, renderTextBlock, placeTextBlock } from '../../lib/pixelFont'
import { getTheme } from '../../lib/themes'
import type { HeadCube } from '../../lib/skin'
import type { RgbaImage } from '../../lib/types'
import { DEFAULT_CONFIG } from './config'
import { computeNameplateLayout } from './layout'
import {
  buildNameplate3DScene,
  createSceneProjection,
  sceneToBlenderScript,
  sceneToGltf,
  sceneToObj,
  type Nameplate3DScene,
} from './export3d'

const FONT = getPixelFont('mojangles')

function makeHeadImage(color: [number, number, number, number] = [200, 120, 80, 255]): RgbaImage {
  const image = createImage(8, 8)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) setPixel(image, x, y, color)
  return image
}

function makeCube(withHat = true): HeadCube {
  const faces = {
    front: makeHeadImage(),
    back: makeHeadImage(),
    left: makeHeadImage(),
    right: makeHeadImage(),
    top: makeHeadImage([0, 0, 128, 255]),
    bottom: makeHeadImage(),
  }
  return { faceSize: 8, base: faces, hat: withHat ? { ...faces } : null }
}

function buildScene(withHat = true, themeId = DEFAULT_CONFIG.themeId): Nameplate3DScene {
  const config = { ...DEFAULT_CONFIG, themeId }
  const layout = computeNameplateLayout({
    height: 512,
    aspect: 4,
    splitMode: 'tight',
    ratioLeft: config.ratioLeft,
    avatarSide: config.avatarSide,
    headStyle: config.headStyle,
    avatarFill: config.avatarFill,
    showDivider: config.showDivider,
  })
  const theme = getTheme(themeId)
  const block = renderTextBlock({ text: 'NOTCH_2024', font: FONT, fill: theme.text.fill })
  const scale = 8
  const placement = placeTextBlock(block, layout.idBox, scale, 'center', 'middle')
  return buildNameplate3DScene({
    layout,
    theme,
    skin: null,
    cube: makeCube(withHat),
    text: {
      text: 'NOTCH_2024',
      image: block.image,
      scale,
      placement,
      font: { measure: (char: string) => (char === ' ' ? 4 : 6), padding: block.padding },
      fill: theme.text.fill,
      shadow: theme.text.shadow,
    },
  })
}

describe('世界坐标映射', () => {
  it('名牌高度 = 1 个单位，正面居中', () => {
    const layout = computeNameplateLayout({
      height: 512,
      aspect: 4,
      splitMode: 'tight',
      ratioLeft: 0.3819660112501051,
      avatarSide: 'left',
      headStyle: 'iso',
      avatarFill: 0.92,
      showDivider: true,
    })
    const projection = createSceneProjection(layout)
    const topLeft = projection.to3d(0, 0, 0)
    const bottomRight = projection.to3d(layout.width, layout.height, 0)
    // 上边缘与下边缘之间在屏幕“上”方向的距离应为 1
    const upDistance = topLeft.y - bottomRight.y
    expect(Math.abs(upDistance)).toBeGreaterThan(0)
    expect(projection.headHalfSize).toBeGreaterThan(0)
    // 头像中心应落在肖像位附近
    const slotCentre = {
      x: layout.slot.x + layout.slot.width / 2,
      y: layout.slot.y + layout.slot.height / 2,
    }
    const expected = projection.to3d(slotCentre.x, slotCentre.y, 0)
    const distance = Math.hypot(
      projection.headCenter.x - expected.x,
      projection.headCenter.y - expected.y,
      projection.headCenter.z - expected.z,
    )
    expect(distance).toBeLessThan(layout.slot.width * 0.2)
  })
})

describe('3D 场景分层', () => {
  const scene = buildScene()

  it('名牌每个构件都是独立对象', () => {
    const names = scene.parts.map((part) => part.name)
    for (const expected of [
      '底板',
      '背景',
      '外框-上',
      '外框-左',
      '外框-下',
      '外框-右',
      '分割线-暗',
      '分割线-亮',
      '肖像位-底',
    ]) {
      expect(names, `缺少 ${expected}`).toContain(expected)
    }
  })

  it('头像按分层拆成 12 个面对象（基础层 6 + 帽子层 6）', () => {
    const base = scene.parts.filter((part) => part.group === '头像/基础层')
    const hat = scene.parts.filter((part) => part.group === '头像/帽子层')
    expect(base).toHaveLength(6)
    expect(hat).toHaveLength(6)
    expect(base.map((part) => part.name)).toEqual([
      '基础层-正面',
      '基础层-后脑',
      '基础层-左脸',
      '基础层-右脸',
      '基础层-头顶',
      '基础层-下巴',
    ])
  })

  it('文字每个字符一个对象，且带真实厚度', () => {
    const chars = scene.parts.filter((part) => part.group === 'ID文字')
    expect(chars).toHaveLength('NOTCH_2024'.length)
    expect(chars[0].name).toBe('字符-01-N')
    const quad = chars[0].quads[0]
    // 挤出：同一段像素的前后两面 z 不同
    const zs = quad.verts.map((v) => v.z)
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0)
  })

  it('没有帽子层时只生成基础层', () => {
    const noHat = buildScene(false)
    expect(noHat.parts.filter((part) => part.group.includes('帽子层'))).toHaveLength(0)
  })

  it('所有四边形都有 4 个顶点，且引用的材质都已定义', () => {
    const defined = new Set(scene.materials.map((material) => material.name))
    for (const part of scene.parts) {
      expect(part.quads.length, `${part.name} 没有几何`).toBeGreaterThan(0)
      for (const quad of part.quads) {
        expect(quad.verts).toHaveLength(4)
        for (const vertex of quad.verts) {
          expect(Number.isFinite(vertex.x) && Number.isFinite(vertex.y) && Number.isFinite(vertex.z)).toBe(true)
        }
        expect(defined.has(quad.material), `材质缺失：${quad.material}`).toBe(true)
      }
    }
  })

  it('贴图包含背景与 12 张头像面贴图', () => {
    const files = Object.keys(scene.textures)
    expect(files).toContain('background.png')
    expect(files.filter((file) => file.startsWith('avatar_base_'))).toHaveLength(6)
    expect(files.filter((file) => file.startsWith('avatar_hat_'))).toHaveLength(6)
  })

  it('底板有厚度，头像立方体是三维体', () => {
    const plate = scene.parts.find((part) => part.name === '底板')
    const zs = plate ? plate.quads.flatMap((quad) => quad.verts.map((v) => v.z)) : []
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.01)

    const head = scene.parts.find((part) => part.name === '基础层-正面')
    const headYs = head ? head.quads[0].verts.map((v) => v.y) : []
    expect(Math.max(...ys(headYs)) - Math.min(...ys(headYs))).toBeGreaterThan(0.05)
  })

  it('纯色主题不会生成背景贴图', () => {
    const solid = buildScene(true, 'gui')
    expect(Object.keys(solid.textures)).not.toContain('background.png')
    expect(solid.materials.some((material) => material.name === '背景')).toBe(true)
  })
})

function ys(values: number[]): number[] {
  return values
}

describe('OBJ / MTL 导出', () => {
  const scene = buildScene()
  const { obj, mtl } = sceneToObj(scene)

  it('每个部件一个 o 分组', () => {
    for (const part of scene.parts) {
      expect(obj).toContain(`o ${part.name}`)
    }
  })

  it('顶点 / 面数量与场景一致', () => {
    const quadCount = scene.parts.reduce((sum, part) => sum + part.quads.length, 0)
    expect((obj.match(/^v /gm) ?? []).length).toBe(quadCount * 4)
    expect((obj.match(/^f /gm) ?? []).length).toBe(quadCount * 2)
    expect((obj.match(/^vt /gm) ?? []).length).toBe(quadCount * 4)
  })

  it('用到的材质都在 MTL 里定义，并引用贴图文件', () => {
    const used = new Set([...obj.matchAll(/^usemtl (.+)$/gm)].map((m) => m[1]))
    const defined = new Set([...mtl.matchAll(/^newmtl (.+)$/gm)].map((m) => m[1]))
    for (const material of used) expect(defined.has(material), `MTL 缺少 ${material}`).toBe(true)
    expect(mtl).toContain('map_Kd textures/background.png')
    expect(mtl).toContain('map_d textures/avatar_hat_front.png')
  })

  it('没有 NaN / undefined 泄漏到文件里', () => {
    expect(obj).not.toContain('NaN')
    expect(obj).not.toContain('undefined')
    expect(mtl).not.toContain('NaN')
  })
})

describe('glTF 导出', () => {
  it('结构完整且可被解析', () => {
    const scene = buildScene()
    const gltf = JSON.parse(
      sceneToGltf(scene, () => 'data:image/png;base64,iVBORw0KGgo='),
    )
    expect(gltf.asset.version).toBe('2.0')
    expect(gltf.meshes).toHaveLength(scene.parts.length)
    expect(gltf.nodes).toHaveLength(scene.parts.length)
    expect(gltf.scenes[0].nodes).toHaveLength(scene.parts.length)
    expect(gltf.materials.length).toBe(scene.materials.length)
    expect(gltf.accessors.length).toBeGreaterThan(0)
    expect(gltf.buffers[0].uri.startsWith('data:application/octet-stream;base64,')).toBe(true)
    const binary = Buffer.from(gltf.buffers[0].uri.split(',')[1], 'base64').length
    expect(binary).toBe(gltf.buffers[0].byteLength)
    expect(gltf.images.length).toBe(Object.keys(scene.textures).length)
    expect(gltf.materials.some((material: { alphaMode?: string }) => material.alphaMode === 'MASK')).toBe(true)
  })
})

describe('Blender 建场脚本', () => {
  const scene = buildScene()
  const script = sceneToBlenderScript(scene)

  it('包含全部对象与集合', () => {
    for (const part of scene.parts) {
      expect(script, `脚本缺少对象 ${part.name}`).toContain(JSON.stringify(part.name))
    }
    expect(script).toContain('"名牌"')
    expect(script).toContain('"头像/基础层"')
    expect(script).toContain('"ID文字"')
  })

  it('包含材质、贴图路径与打包逻辑', () => {
    for (const material of scene.materials) {
      expect(script).toContain(JSON.stringify(material.name))
    }
    expect(script).toContain('avatar_base_front.png')
    expect(script).toContain('bpy.ops.file.pack_all()')
    expect(script).toContain('def main()')
  })

  it('没有把 undefined / NaN 写进 Python', () => {
    expect(script).not.toContain('undefined')
    expect(script).not.toContain('NaN')
  })

  it('缩进与括号成对（粗检，精确语法由 CI 里的 python3 -m py_compile 把关）', () => {
    const opens = (script.match(/\[/g) ?? []).length
    const closes = (script.match(/\]/g) ?? []).length
    expect(opens).toBe(closes)
    expect((script.match(/\(/g) ?? []).length).toBe((script.match(/\)/g) ?? []).length)
  })
})

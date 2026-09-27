#!/usr/bin/env node
/**
 * 把 3D 包里的 OBJ 用“场景相机”（正对 +Z 的正交投影）软件渲染成 PNG。
 *
 * 用途：不开 Blender 也能一眼看出 3D 导出是否与 2D 预览一致（朝向、位置、大小）。
 * 实现：解析 OBJ → 三角形 → z-buffer 光栅化 → 重心坐标插值 UV → 最近邻采样贴图。
 * 开发工具，不参与打包。
 *
 * 用法：node scripts/render-3d-preview.mjs [zip路径]
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { PNG } from 'pngjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] ?? path.join(ROOT, 'verification/nameplate_3d.zip')
const outPath = process.argv[3] ?? path.join(ROOT, 'verification/nameplate-3d-render.png')

const zip = unzipSync(new Uint8Array(await readFile(target)))
const decode = (name) => Buffer.from(zip[name]).toString('utf8')

/* ---------- 解析 OBJ / MTL ---------- */

const vertices = []
const uvs = []
const materials = new Map()
const triangles = []

let currentMaterial = null
for (const raw of decode('nameplate.obj').split('\n')) {
  const line = raw.trim()
  if (line.startsWith('v ')) {
    const [, x, y, z] = line.split(/\s+/)
    vertices.push([Number(x), Number(y), Number(z)])
  } else if (line.startsWith('vt ')) {
    const [, u, v] = line.split(/\s+/)
    uvs.push([Number(u), Number(v)])
  } else if (line.startsWith('usemtl ')) {
    currentMaterial = line.slice(7).trim()
  } else if (line.startsWith('f ')) {
    const corners = line
      .split(/\s+/)
      .slice(1)
      .map((token) => {
        const [v, t] = token.split('/')
        return { v: Number(v) - 1, t: Number(t) - 1 }
      })
    for (let i = 1; i + 1 < corners.length; i++) {
      triangles.push({ a: corners[0], b: corners[i], c: corners[i + 1], material: currentMaterial })
    }
  }
}

for (const raw of decode('nameplate.mtl').split('\n')) {
  const line = raw.trim()
  if (line.startsWith('newmtl ')) {
    materials.set(line.slice(7).trim(), { texture: null, alpha: false })
  } else if (line.startsWith('map_Kd ')) {
    const name = line.slice(7).trim().replace(/^textures\//, '')
    const entry = materials.get([...materials.keys()].at(-1))
    if (entry) entry.texture = name
  } else if (line.startsWith('map_d ')) {
    const entry = materials.get([...materials.keys()].at(-1))
    if (entry) entry.alpha = true
  }
}

/* ---------- 贴图 ---------- */

const textureCache = new Map()
function texture(name) {
  if (!name) return null
  if (textureCache.has(name)) return textureCache.get(name)
  const bytes = zip[`textures/${name}`]
  const png = bytes ? PNG.sync.read(Buffer.from(bytes)) : null
  textureCache.set(name, png)
  return png
}

/* ---------- 视口：正交，正对 +Z ---------- */

let minX = Infinity
let maxX = -Infinity
let minY = Infinity
let maxY = -Infinity
for (const [x, y] of vertices) {
  minX = Math.min(minX, x)
  maxX = Math.max(maxX, x)
  minY = Math.min(minY, y)
  maxY = Math.max(maxY, y)
}

const SCALE = 900
const margin = 24
const width = Math.round((maxX - minX) * SCALE) + margin * 2
const height = Math.round((maxY - minY) * SCALE) + margin * 2
const project = ([x, y]) => [margin + (x - minX) * SCALE, margin + (maxY - y) * SCALE]

const color = new Float32Array(width * height * 4)
const depth = new Float32Array(width * height).fill(-Infinity)

/* ---------- 光栅化 ---------- */

for (const tri of triangles) {
  const material = materials.get(tri.material) ?? { texture: null, alpha: false }
  const tex = texture(material.texture)
  const p = [tri.a, tri.b, tri.c].map((corner) => ({
    screen: project(vertices[corner.v]),
    uv: uvs[corner.t] ?? [0, 0],
    z: vertices[corner.v][2],
  }))

  const [a, b, c] = p
  const area = (b.screen[0] - a.screen[0]) * (c.screen[1] - a.screen[1]) -
    (c.screen[0] - a.screen[0]) * (b.screen[1] - a.screen[1])
  if (Math.abs(area) < 1e-9) continue

  const minXp = Math.max(0, Math.floor(Math.min(a.screen[0], b.screen[0], c.screen[0])))
  const maxXp = Math.min(width - 1, Math.ceil(Math.max(a.screen[0], b.screen[0], c.screen[0])))
  const minYp = Math.max(0, Math.floor(Math.min(a.screen[1], b.screen[1], c.screen[1])))
  const maxYp = Math.min(height - 1, Math.ceil(Math.max(a.screen[1], b.screen[1], c.screen[1])))

  for (let y = minYp; y <= maxYp; y++) {
    for (let x = minXp; x <= maxXp; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const w0 = ((b.screen[0] - px) * (c.screen[1] - py) - (c.screen[0] - px) * (b.screen[1] - py)) / area
      const w1 = ((c.screen[0] - px) * (a.screen[1] - py) - (a.screen[0] - px) * (c.screen[1] - py)) / area
      const w2 = 1 - w0 - w1
      if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue

      const z = w0 * a.z + w1 * b.z + w2 * c.z
      const index = y * width + x
      if (z <= depth[index]) continue

      let r = 200
      let g = 200
      let bl = 200
      let alpha = 255
      if (tex) {
        const u = w0 * a.uv[0] + w1 * b.uv[0] + w2 * c.uv[0]
        const v = w0 * a.uv[1] + w1 * b.uv[1] + w2 * c.uv[1]
        const tx = Math.min(tex.width - 1, Math.max(0, Math.floor(u * tex.width)))
        const ty = Math.min(tex.height - 1, Math.max(0, Math.floor((1 - v) * tex.height)))
        const ti = (ty * tex.width + tx) * 4
        r = tex.data[ti]
        g = tex.data[ti + 1]
        bl = tex.data[ti + 2]
        alpha = tex.data[ti + 3]
        if (material.alpha && alpha < 128) continue
      } else if (material.color) {
        r = material.color[0]
        g = material.color[1]
        bl = material.color[2]
      }

      depth[index] = z
      color[index * 4] = r
      color[index * 4 + 1] = g
      color[index * 4 + 2] = bl
      color[index * 4 + 3] = alpha
    }
  }
}

/* ---------- 输出 ---------- */

const png = new PNG({ width, height })
for (let i = 0; i < width * height; i++) {
  const a = color[i * 4 + 3] / 255
  png.data[i * 4] = Math.round(color[i * 4] * a + 30 * (1 - a))
  png.data[i * 4 + 1] = Math.round(color[i * 4 + 1] * a + 30 * (1 - a))
  png.data[i * 4 + 2] = Math.round(color[i * 4 + 2] * a + 34 * (1 - a))
  png.data[i * 4 + 3] = 255
}
await writeFile(outPath, PNG.sync.write(png))
console.log(
  `已渲染 3D 场景（正对 +Z 正交）→ ${path.relative(ROOT, outPath)}  ${width}×${height}，${triangles.length} 个三角面`,
)

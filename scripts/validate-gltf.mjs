#!/usr/bin/env node
/**
 * 用 Khronos 官方 glTF-Validator 校验 3D 包里的 glTF。
 * 开发工具：node scripts/validate-gltf.mjs [zip路径]
 *
 * 为什么要它：glTF 规范有不少“必填但容易漏”的字段（例如 POSITION accessor 的 min/max、
 * 索引 accessor 的类型、buffer 对齐）。Blender 这类导入器对不合规文件的容错各不相同，
 * 症状往往就是“贴图没出现”“材质丢了”，用官方校验器能直接定位。
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import validator from 'gltf-validator'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] ?? path.join(ROOT, 'verification/nameplate_3d.zip')

const zip = unzipSync(new Uint8Array(await readFile(target)))
const gltfBytes = zip['nameplate.gltf']
if (!gltfBytes) throw new Error(`${target} 里没有 nameplate.gltf`)

const report = await validator.validateBytes(new Uint8Array(gltfBytes), {
  maxIssues: 60,
  uri: 'nameplate.gltf',
})

const { issues, info } = report
console.log(`glTF 校验：${path.relative(ROOT, target)}`)
console.log(`  版本 ${info.version} · 资源体积 ${(info.totalByteLength / 1024).toFixed(1)} KB`)
console.log(`  绘制调用 ${info.drawCallCount} · 顶点 ${info.totalVertexCount} · 三角面 ${info.totalTriangleCount}`)
console.log(`  问题：错误 ${issues.numErrors} · 警告 ${issues.numWarnings} · 提示 ${issues.numInfos} · 隐患 ${issues.numHints}`)

for (const message of issues.messages) {
  const where = message.pointer ? ` @${message.pointer}` : ''
  console.log(`  [${message.severity}] ${message.code}${where}: ${message.message}`)
}

process.exitCode = issues.numErrors > 0 ? 1 : 0

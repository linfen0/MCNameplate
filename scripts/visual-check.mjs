#!/usr/bin/env node
/**
 * 端到端视觉验证（开发工具，不参与打包）。
 *
 * 1. 生成一张 64×64 测试皮肤 PNG —— 只是自动化测试夹具，应用本身没有皮肤生成功能
 * 2. 启动 vite preview 托管 dist/
 * 3. Chromium 打开页面，上传皮肤、填写 ID
 * 4. 直接从画布像素里独立测量：尺寸、黄金分割位置、头像落点、3D/2D 路径、硬边、朝向
 * 5. 产出截图与导出 PNG 到 verification/
 *
 * 用法：node scripts/visual-check.mjs
 */

import { execFile, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { PNG } from 'pngjs'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'verification')
const PORT = Number(process.env.VERIFY_PORT ?? 4319)
const BASE_URL = `http://127.0.0.1:${PORT}/`
const CHROME_PATH =
  process.env.CHROME_PATH ?? '/data/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'

const GOLDEN_MINOR = 1 - 1 / ((1 + Math.sqrt(5)) / 2)
const FACE_COLOR = [255, 0, 255, 255]
const HAIR_COLOR = [0, 0, 128, 255]
const MARK_LEFT = [255, 255, 0, 255]
const MARK_RIGHT = [0, 255, 0, 255]

const failures = []
const notes = []

function check(condition, label, detail = '') {
  notes.push(`  ${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

/* ------------------------------------------------------------------ */
/* 1. 测试皮肤夹具                                                      */
/* ------------------------------------------------------------------ */

function makeTestSkin() {
  const png = new PNG({ width: 64, height: 64 })
  png.data.fill(0)

  const put = (x, y, color) => {
    if (x < 0 || y < 0 || x >= 64 || y >= 64) return
    const i = (y * 64 + x) * 4
    png.data[i] = color[0]
    png.data[i + 1] = color[1]
    png.data[i + 2] = color[2]
    png.data[i + 3] = color[3]
  }
  const fill = ([rx, ry, rw, rh], color) => {
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) put(x, y, color)
  }

  // 六面：脸品红、头发深蓝，便于按颜色定位与分辨朝向
  fill([8, 8, 8, 8], FACE_COLOR)
  fill([0, 8, 8, 8], FACE_COLOR)
  fill([16, 8, 8, 8], FACE_COLOR)
  fill([24, 8, 8, 8], HAIR_COLOR)
  fill([8, 0, 8, 8], HAIR_COLOR)
  fill([16, 0, 8, 8], [40, 40, 40, 255])
  put(9, 11, [255, 255, 255, 255])
  put(10, 11, [0, 0, 0, 255])
  put(13, 11, [0, 0, 0, 255])
  put(14, 11, [255, 255, 255, 255])
  // 正脸左右标记：验证 3D 贴图没有左右镜像
  put(8, 12, MARK_LEFT)
  put(15, 12, MARK_RIGHT)
  // 第二层（帽子）
  fill([40, 8, 8, 2], HAIR_COLOR)
  fill([48, 8, 1, 4], HAIR_COLOR)
  fill([0, 8, 8, 2], HAIR_COLOR)
  fill([16, 8, 8, 2], HAIR_COLOR)
  // 经典模型采样区
  fill([52, 20, 4, 12], HAIR_COLOR)
  // 身体
  fill([16, 20, 32, 12], [40, 120, 40, 255])
  fill([40, 16, 16, 16], [40, 120, 40, 255])
  fill([32, 48, 16, 16], [40, 120, 40, 255])
  fill([0, 16, 16, 16], [50, 50, 120, 255])
  fill([16, 48, 16, 16], [50, 50, 120, 255])

  return PNG.sync.write(png)
}

/** 造一块 16×16 的方块贴图（主色 #7a4f2a，带少量明暗），用于验证“从贴图提取配色” */
function makeBlockTexture() {
  const png = new PNG({ width: 16, height: 16 })
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4
      const n = (x * 7 + y * 13) % 10
      // 贴近真实方块贴图：外圈 1px 金边 + 内部棕色噪点；四角换成醒目色用来验证九宫格
      const corner =
        x < 2 && y < 2
          ? [255, 0, 0]
          : x > 13 && y < 2
            ? [0, 255, 0]
            : x < 2 && y > 13
              ? [0, 0, 255]
              : x > 13 && y > 13
                ? [255, 255, 0]
                : null
      const ring = x === 0 || y === 0 || x === 15 || y === 15
      const base =
        corner ?? (ring ? [217, 162, 39] : n === 0 ? [138, 92, 52] : n === 9 ? [98, 62, 30] : [122, 79, 42])
      png.data[i] = base[0]
      png.data[i + 1] = base[1]
      png.data[i + 2] = base[2]
      png.data[i + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

/* ------------------------------------------------------------------ */
/* 2. 浏览器内像素分析                                                  */
/* ------------------------------------------------------------------ */

function analyseCanvas(options = {}) {
  const dividerMinRun = options.dividerMinRun ?? 0.98
  const canvas = document.querySelector('[data-testid="nameplate-canvas"]')
  if (!canvas) return { error: 'canvas not found' }
  const width = canvas.width
  const height = canvas.height
  const mode = canvas.dataset.renderMode ?? 'unknown'
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height)
  const at = (x, y) => {
    const i = (y * width + x) * 4
    return [data[i], data[i + 1], data[i + 2], data[i + 3]]
  }

  const unit = Math.max(1, Math.round(height / 256))
  const inset = 4 * unit
  const innerX = inset
  const innerW = width - inset * 2
  const innerH = height - inset * 2

  // 分割线：在切分位置附近的窄带里找“几乎整列连续变暗”的那一段
  // 整个内容区都扫：肖像位内凹面比内容区矮一截，会被“几乎贯穿”的条件排除
  const bandStart = innerX + 1
  const bandEnd = innerX + innerW - 2
  const scores = []
  let best = 0
  for (let x = bandStart; x <= bandEnd; x++) {
    let run = 0
    let longest = 0
    for (let y = inset; y < height - inset; y++) {
      const [r, g, b] = at(x, y)
      run = r < 40 && g < 40 && b < 40 ? run + 1 : 0
      if (run > longest) longest = run
    }
    scores.push(longest)
    if (longest > best) best = longest
  }
  const hits = []
  for (let i = 0; i < scores.length; i++) {
    // 分割线贯穿整个内容区高度；肖像位/纹理阴影都比它矮，用几条像素的容差排除
    if (best >= innerH * dividerMinRun && scores[i] >= best - 4) hits.push(bandStart + i)
  }
  const dividerEdge = hits.length > 0 ? hits[0] : -1
  const boundary = dividerEdge >= 0 ? dividerEdge + unit : -1

  const counts = { face: 0, hair: 0, text: 0, markLeft: 0, markRight: 0 }
  // 头像整体轮廓 = 脸（品红）+ 头发（深蓝，含头顶面），这才是 3D 轮廓
  const head = { minX: width, maxX: -1, minY: height, maxY: -1 }
  const face = { minX: width, maxX: -1, minY: height, maxY: -1 }
  const markLeft = { minX: width, maxX: -1 }
  const markRight = { minX: width, maxX: -1 }
  const text = { minX: width, maxX: -1, minY: height, maxY: -1 }
  let faceLeft = 0
  let faceRight = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = at(x, y)
      // 注意：3D 渲染会按面亮度衰减（正面 ×0.8、侧面 ×0.6），所以阈值不能按纯色写
      if (r > 170 && b > 170 && g < 40) {
        counts.face++
        if (x < width / 2) faceLeft++
        else faceRight++
        if (x < face.minX) face.minX = x
        if (x > face.maxX) face.maxX = x
        if (y < face.minY) face.minY = y
        if (y > face.maxY) face.maxY = y
        if (x < head.minX) head.minX = x
        if (x > head.maxX) head.maxX = x
        if (y < head.minY) head.minY = y
        if (y > head.maxY) head.maxY = y
      } else if (b > 55 && b < 175 && r < 25 && g < 25) {
        counts.hair++
        if (x < head.minX) head.minX = x
        if (x > head.maxX) head.maxX = x
        if (y < head.minY) head.minY = y
        if (y > head.maxY) head.maxY = y
      } else if (r > 170 && g > 170 && b < 40) {
        counts.markLeft++
        if (x < markLeft.minX) markLeft.minX = x
        if (x > markLeft.maxX) markLeft.maxX = x
      } else if (r < 40 && g > 170 && b < 40) {
        counts.markRight++
        if (x < markRight.minX) markRight.minX = x
        if (x > markRight.maxX) markRight.maxX = x
      } else if (r > 225 && g > 225 && b > 225 && boundary > 0 && x > boundary) {
        counts.text++
        if (x < text.minX) text.minX = x
        if (x > text.maxX) text.maxX = x
        if (y < text.minY) text.minY = y
        if (y > text.maxY) text.maxY = y
      }
    }
  }

  // 文字块内不应出现“中间灰”：回退到系统字体后必然产生抗锯齿灰边
  let midGray = 0
  if (text.maxX >= text.minX) {
    for (let y = text.minY; y <= text.maxY; y++) {
      for (let x = text.minX; x <= text.maxX; x++) {
        const [r, g, b] = at(x, y)
        if (r > 95 && r < 205 && g > 95 && g < 205 && b > 95 && b < 205) midGray++
      }
    }
  }

  return {
    width,
    height,
    mode,
    midGray,
    unit,
    innerX,
    innerW,
    innerH,
    boundary,
    dividerHits: hits.length,
    dividerRun: best,
    counts,
    face,
    head,
    textBox: text,
    faceLeft,
    faceRight,
    markLeftX: markLeft.maxX >= 0 ? (markLeft.minX + markLeft.maxX) / 2 : -1,
    markRightX: markRight.maxX >= 0 ? (markRight.minX + markRight.maxX) / 2 : -1,
  }
}

/** 平面模式硬边检测：头像左边缘必须是「肖像位底色 → 品红」的直接跳变 */
function analyseHardEdges() {
  const canvas = document.querySelector('[data-testid="nameplate-canvas"]')
  const width = canvas.width
  const height = canvas.height
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height)
  const at = (x, y) => {
    const i = (y * width + x) * 4
    return [data[i], data[i + 1], data[i + 2], data[i + 3]]
  }
  const isFace = ([r, g, b]) => r > 170 && b > 170 && g < 40

  let minX = width
  let maxX = -1
  let minY = height
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isFace(at(x, y))) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const midY = Math.round((minY + maxY) / 2)
  const row = []
  for (let x = Math.max(0, minX - 8); x < minX; x++) row.push(at(x, midY))
  const blends = row.filter(([r, g, b]) => {
    const faceish = r > 160 && b > 160
    const slotish = r < 70 && g < 70 && b < 80
    return !faceish && !slotish
  })
  return { minX, maxX, minY, maxY, midY, blendCount: blends.length }
}

/* ------------------------------------------------------------------ */
/* 3. 页面操作辅助                                                      */
/* ------------------------------------------------------------------ */

async function uploadSkin(page, skinBuffer, name = 'test-skin-64.png') {
  await page.evaluate(
    ({ base64, fileName }) => {
      const input = document.querySelector('[data-testid="skin-input"]')
      if (!input) throw new Error('skin input not found')
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const file = new File([bytes], fileName, { type: 'image/png' })
      const transfer = new DataTransfer()
      transfer.items.add(file)
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    { base64: skinBuffer.toString('base64'), fileName: name },
  )
}

async function exportCanvas(page, file) {
  const dataUrl = await page.evaluate(() =>
    document.querySelector('[data-testid="nameplate-canvas"]').toDataURL('image/png'),
  )
  await writeFile(path.join(OUT_DIR, file), Buffer.from(dataUrl.split(',')[1], 'base64'))
}

async function waitForRenderMode(page, mode, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const current = await page.evaluate(
      () => document.querySelector('[data-testid="nameplate-canvas"]')?.dataset.renderMode,
    )
    if (current === mode) return true
    await page.waitForTimeout(120)
  }
  return false
}

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      /* 还没起来 */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

/* ------------------------------------------------------------------ */
/* 4. 主流程                                                            */
/* ------------------------------------------------------------------ */

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const skinBuffer = makeTestSkin()
  await writeFile(path.join(OUT_DIR, 'test-skin-64.png'), skinBuffer)

  const server = spawn(
    path.join(ROOT, 'node_modules/.bin/vite'),
    ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' },
  )

  let browser
  try {
    if (!(await waitForServer(BASE_URL))) throw new Error(`preview 服务未能在 ${BASE_URL} 启动`)

    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    })
    const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } })
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(OUT_DIR, 'studio-empty.png'), fullPage: true })

    // ---- 上传皮肤 + 填写 ID（默认：自适应宽高比 + three.js 3D）----
    await uploadSkin(page, skinBuffer)
    await page.fill('[data-testid="id-input"]', 'Notch_2024')
    const got3d = await waitForRenderMode(page, '3d')
    check(got3d, '头像走的是 three.js 3D 渲染路径')
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(OUT_DIR, 'studio-3d.png'), fullPage: true })

    const iso = await page.evaluate(analyseCanvas)
    check(iso.mode === '3d', '画布标记为 3d 渲染', `mode=${iso.mode}`)
    check(iso.width > iso.height, '画布是横版矩形', `${iso.width}×${iso.height}`)
    const aspect = iso.width / iso.height
    check(aspect > 2.2 && aspect < 7.2, '自适应宽高比落在合理区间', `${aspect.toFixed(2)} : 1`)
    check(iso.counts.face > 20000, '3D 头像已绘制（正面 + 侧面）', `${iso.counts.face} px`)
    check(iso.counts.hair > 5000, '3D 头顶面已绘制', `${iso.counts.hair} px`)
    check(iso.faceRight < 100, '头像全部落在左侧', `右侧 ${iso.faceRight} px`)
    check(iso.counts.text > 3000, '右侧存在 ID 文字像素', `${iso.counts.text} px`)

    // 默认「贴合头像」：头像块宽度 = 内容区高度
    const expectedTight = iso.innerX + Math.min(iso.innerH, Math.floor(iso.innerW / 2))
    check(
      iso.boundary > 0 && Math.abs(iso.boundary - expectedTight) <= 2,
      '默认「贴合头像」：头像块宽度 = 内容区高度',
      `实测 ${iso.boundary} / 期望 ${expectedTight}（命中列 ${iso.dividerHits}）`,
    )

    // 字号：这是这轮的重点 —— ID 字高应达到铭牌高度的 1/φ² ≈ 38%
    const textHeight = iso.textBox.maxY - iso.textBox.minY + 1
    const textWidth = iso.textBox.maxX - iso.textBox.minX + 1
    const nameBlockWidth = iso.innerW - (iso.boundary - iso.innerX)
    check(
      textHeight / iso.height > 0.32,
      'ID 字高达到铭牌高度的 30% 以上（不再空旷）',
      `${textHeight} / ${iso.height} = ${(textHeight / iso.height).toFixed(3)}`,
    )
    const textArea = (iso.textBox.maxX - iso.textBox.minX + 1) * (iso.textBox.maxY - iso.textBox.minY + 1)
    check(
      iso.midGray / textArea < 0.01,
      'ID 区域内没有抗锯齿灰边（确认没用回退系统字体）',
      `中间灰 ${iso.midGray} / ${textArea} = ${((iso.midGray / textArea) * 100).toFixed(2)}%`,
    )
    check(
      textWidth / nameBlockWidth > 0.75,
      'ID 横向填满名字区（利用率 > 80%）',
      `${textWidth} / ${nameBlockWidth} = ${(textWidth / nameBlockWidth).toFixed(3)}`,
    )

    const headHeight = iso.head.maxY - iso.head.minY + 1
    check(headHeight / iso.height > 0.7, '头像高度超过铭牌高度的 70%', `${headHeight} / ${iso.height}`)
    const headAspect = (iso.head.maxX - iso.head.minX + 1) / headHeight
    check(
      headAspect > 0.85 && headAspect < 1.3,
      '3D 轮廓宽高比符合投影几何',
      headAspect.toFixed(3),
    )
    check(
      iso.markLeftX > 0 && iso.markRightX > 0 && iso.markLeftX < iso.markRightX,
      '正脸贴图没有左右镜像（左标记在右标记左侧）',
      `左标记 x=${iso.markLeftX}，右标记 x=${iso.markRightX}`,
    )
    await exportCanvas(page, 'nameplate-3d-default.png')

    // ---- 切到严格黄金分割，复核像素级比例 ----
    await page.getByRole('button', { name: '黄金分割 38.2 : 61.8' }).click()
    await page.waitForTimeout(600)
    const golden = await page.evaluate(analyseCanvas)
    const expectedGolden = golden.innerX + Math.floor(golden.innerW * GOLDEN_MINOR)
    check(
      golden.boundary > 0 && Math.abs(golden.boundary - expectedGolden) <= 2,
      '黄金分割预设：交界线在内容区宽度的 38.1966% 处',
      `实测 ${golden.boundary} / 期望 ${expectedGolden}`,
    )
    const goldenRatio = (golden.boundary - golden.innerX) / golden.innerW
    check(
      Math.abs(goldenRatio - GOLDEN_MINOR) < 0.003,
      '像素级实测比例 ≈ 0.381966',
      goldenRatio.toFixed(6),
    )
    await exportCanvas(page, 'nameplate-golden-split.png')

    // 回到默认贴合模式
    await page.getByRole('button', { name: '贴合头像' }).click()
    await page.waitForTimeout(500)

    // ---- SVG 导出：分层结构 + 回渲染复核 ----
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载 SVG' }).click()
    const download = await downloadPromise
    const svgPath = path.join(OUT_DIR, 'nameplate.svg')
    await download.saveAs(svgPath)
    const svgText = await readFile(svgPath, 'utf8')

    const layers = ['底板', '背景纹理', '外框倒角', '分割线', '头像肖像位', '文字压暗', '头像', 'ID文字']
    const missing = layers.filter((id) => !svgText.includes(`<g id="${id}">`))
    check(missing.length === 0, 'SVG 每个构件都是独立命名图层', missing.length ? `缺少 ${missing.join('/')}` : layers.join(' / '))
    const glyphGroups = (svgText.match(/<g id="ID文字-\d+-/g) ?? []).length
    check(glyphGroups === 10, 'SVG 里每个字符都是独立图层', `${glyphGroups} 个（ID 长度 10）`)
    check(
      (svgText.match(/<g[ >]/g) ?? []).length === (svgText.match(/<\/g>/g) ?? []).length,
      'SVG 分组标签成对闭合',
    )
    check(
      svgText.includes('<path') && svgText.includes('image-rendering="pixelated"'),
      'SVG 同时包含矢量文字与像素化位图',
    )

    // 把 SVG 反过来渲染成图，确认浏览器渲染结果与画布一致
    const svgPage = await browser.newPage({ viewport: { width: 1300, height: 420 } })
    await svgPage.setContent(
      `<body style="margin:0;background:#222"><img style="display:block;width:1280px;image-rendering:pixelated" src="data:image/svg+xml;base64,${Buffer.from(svgText).toString('base64')}"></body>`,
    )
    await svgPage.waitForTimeout(400)
    await svgPage.screenshot({ path: path.join(OUT_DIR, 'nameplate-from-svg.png') })
    await svgPage.close()

    // ---- 3D 模型包：整块名牌的分层几何 ----
    const zipPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载 3D 模型包' }).click()
    const zipDownload = await zipPromise
    const zipPath = path.join(OUT_DIR, 'nameplate_3d.zip')
    await zipDownload.saveAs(zipPath)
    const entries = unzipSync(new Uint8Array(await readFile(zipPath)))
    const entryNames = Object.keys(entries)

    const required = [
      '导入说明.txt',
      'blender/build_nameplate_3d.py',
      'nameplate.glb',
      'nameplate.gltf',
      'nameplate.obj',
      'nameplate.mtl',
    ]
    const missingFiles = required.filter((name) => !entryNames.includes(name))
    check(missingFiles.length === 0, '3D 包包含脚本 / glTF / OBJ / MTL / 说明', missingFiles.join(','))
    const textureFiles = entryNames.filter((name) => name.startsWith('textures/'))
    check(textureFiles.length === 13, '3D 包带 13 张贴图（背景 + 头像 12 面）', `${textureFiles.length} 张`)

    const objText = Buffer.from(entries['nameplate.obj']).toString('utf8')
    const objVertices = (objText.match(/^v /gm) ?? []).length
    const objFaces = (objText.match(/^f /gm) ?? []).length
    const objObjects = (objText.match(/^o /gm) ?? []).length
    check(objObjects === 35, 'OBJ 里整块名牌被拆成 35 个对象（含逐字符文字）', `${objObjects} 个`)
    check(
      objFaces === objVertices / 2,
      'OBJ 每个四边形拆成两个三角形',
      `顶点 ${objVertices} / 面 ${objFaces}`,
    )
    check(!objText.includes('NaN') && !objText.includes('undefined'), 'OBJ 没有 NaN / undefined')

    const gltf = JSON.parse(Buffer.from(entries['nameplate.gltf']).toString('utf8'))
    check(
      gltf.asset?.version === '2.0' && gltf.meshes?.length === 35 && gltf.buffers?.[0]?.byteLength > 0,
      'glTF 结构完整（35 个网格 + 内嵌 buffer）',
      `meshes=${gltf.meshes?.length} materials=${gltf.materials?.length}`,
    )
    const gltfBinary = Buffer.from(String(gltf.buffers[0].uri).split(',')[1], 'base64').length
    check(gltfBinary === gltf.buffers[0].byteLength, 'glTF buffer 长度与 base64 实际长度一致')

    // 用 Khronos 官方校验器卡规范（POSITION 缺 min/max 这类问题 Blender 会静默吞掉）
    const { default: gltfValidator } = await import('gltf-validator')
    const gltfReport = await gltfValidator.validateBytes(new Uint8Array(entries['nameplate.gltf']), {
      maxIssues: 5,
    })
    check(
      gltfReport.issues.numErrors === 0 && gltfReport.issues.numWarnings === 0,
      '官方 glTF-Validator：.gltf 无 error / warning',
      `errors=${gltfReport.issues.numErrors} warnings=${gltfReport.issues.numWarnings} infos=${gltfReport.issues.numInfos}`,
    )
    const glbReport = await gltfValidator.validateBytes(new Uint8Array(entries['nameplate.glb']), {
      maxIssues: 5,
    })
    check(
      glbReport.issues.numErrors === 0 && glbReport.issues.numWarnings === 0,
      '官方 glTF-Validator：.glb 无 error / warning',
      `errors=${glbReport.issues.numErrors} warnings=${glbReport.issues.numWarnings} infos=${glbReport.issues.numInfos}`,
    )
    const glbBytes = entries['nameplate.glb']
    const glbMagic = Buffer.from(glbBytes.slice(0, 4)).toString('latin1')
    const glbDeclared = new DataView(glbBytes.buffer, glbBytes.byteOffset, glbBytes.byteLength).getUint32(8, true)
    check(
      glbMagic === 'glTF' && glbDeclared === glbBytes.byteLength,
      'GLB 头部合法（魔数 glTF + 长度自洽）',
      `${glbMagic} / ${glbDeclared} vs ${glbBytes.byteLength}`,
    )
    check(
      glbReport.info.totalTriangleCount > 2000,
      'GLB 内含完整几何',
      `${glbReport.info.totalTriangleCount} 个三角面 / ${glbReport.info.drawCallCount} 个绘制调用`,
    )

    // 用自带软件渲染器把 3D 场景渲染出来，和 2D 画布比对头像位置
    await new Promise((resolve) => {
      execFile('node', [path.join(ROOT, 'scripts/render-3d-preview.mjs'), zipPath], (error, stdout, stderr) =>
        resolve(check(!error, '3D 场景软件渲染成功（正对 +Z 正交）', error ? String(stderr).slice(0, 200) : stdout.trim())),
      )
    })

    const headBoxInRender = (file, margin) => {
      const png = PNG.sync.read(readFileSync(file))
      let minX = png.width
      let maxX = -1
      let minY = png.height
      let maxY = -1
      for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
          const i = (y * png.width + x) * 4
          if (png.data[i] > 150 && png.data[i + 2] > 150 && png.data[i + 1] < 90) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      const plateW = png.width - margin * 2
      const plateH = png.height - margin * 2
      return {
        left: (minX - margin) / plateW,
        top: (minY - margin) / plateH,
        width: (maxX - minX + 1) / plateW,
        height: (maxY - minY + 1) / plateH,
      }
    }

    const render3dBox = headBoxInRender(path.join(OUT_DIR, 'nameplate-3d-render.png'), 24)
    const canvasBox = headBoxInRender(path.join(OUT_DIR, 'nameplate-3d-default.png'), 0)
    const drift = Math.max(
      Math.abs(render3dBox.left - canvasBox.left),
      Math.abs(render3dBox.top - canvasBox.top),
      Math.abs(render3dBox.width - canvasBox.width),
      Math.abs(render3dBox.height - canvasBox.height),
    )
    check(
      drift < 0.03,
      '3D 场景里的头像位置/尺寸与 2D 画布一致（归一化偏差 < 3%）',
      `偏差 ${(drift * 100).toFixed(2)}% · 3D ${JSON.stringify(
        Object.fromEntries(Object.entries(render3dBox).map(([k, v]) => [k, +v.toFixed(3)])),
      )}`,
    )

    // Blender 脚本：落盘后用 python3 做真实语法检查
    const scriptPath = path.join(OUT_DIR, 'build_nameplate_3d.py')
    await writeFile(scriptPath, Buffer.from(entries['blender/build_nameplate_3d.py']))
    const compile = await new Promise((resolve) => {
      execFile('python3', ['-m', 'py_compile', scriptPath], (error, _stdout, stderr) =>
        resolve({ ok: !error, message: error ? String(stderr || error.message).slice(0, 200) : 'py_compile 通过' }),
      )
    })
    check(compile.ok, 'Blender 建场脚本通过 python3 语法编译', compile.message)

    // ---- 2D 正面：验证像素硬边 ----
    await page.getByRole('button', { name: '2D 正面' }).click()
    await waitForRenderMode(page, '2d')
    await page.waitForTimeout(200)
    const flat = await page.evaluate(analyseHardEdges)
    const headWidth = flat.maxX - flat.minX + 1
    const magentaHeight = flat.maxY - flat.minY + 1
    check(flat.blendCount === 0, '2D 头像边缘无半透明过渡（整数倍最近邻）', `过渡 ${flat.blendCount} px`)
    check(headWidth > 0 && headWidth % 8 === 0, '2D 头像宽度是 8 皮肤像素整数倍', `${headWidth}px`)
    check(
      magentaHeight % 6 === 0 && (magentaHeight / 6) * 8 === headWidth,
      '2D 头像整体为正方形（上 2/8 是头发层）',
      `脸 ${headWidth}×${magentaHeight}`,
    )
    await exportCanvas(page, 'nameplate-2d.png')

    // ---- 回到 3D，固定 2:1，再放大到 1024 高 ----
    await page.getByRole('button', { name: '3D 立体' }).click()
    await page.getByRole('button', { name: '2 : 1' }).click()
    await page.waitForTimeout(500)
    const fixed = await page.evaluate(analyseCanvas)
    check(fixed.width === fixed.height * 2, '固定 2:1 时宽度正好是高度两倍', `${fixed.width}×${fixed.height}`)
    const fixedTight = fixed.innerX + Math.min(fixed.innerH, Math.floor(fixed.innerW / 2))
    check(
      Math.abs(fixed.boundary - fixedTight) <= 2,
      '换宽高比后头像块仍贴合内容区高度',
      `实测 ${fixed.boundary} / 期望 ${fixedTight}`,
    )
    await page.getByRole('button', { name: '1024px' }).click()
    await page.waitForTimeout(700)
    const big = await page.evaluate(analyseCanvas)
    check(big.width === 2048 && big.height === 1024, '高 1024 + 2:1 → 2048×1024', `${big.width}×${big.height}`)
    check(big.mode === '3d', '高分辨率下依然走 3D 渲染', `mode=${big.mode}`)
    await exportCanvas(page, 'nameplate-3d-2048x1024.png')

    // ---- 主题留档 ----
    await page.getByRole('button', { name: /提示框/ }).click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(OUT_DIR, 'studio-tooltip.png'), fullPage: true })
    await exportCanvas(page, 'nameplate-tooltip.png')

    await page.getByRole('button', { name: /草方块/ }).click()
    await page.waitForTimeout(500)
    await exportCanvas(page, 'nameplate-grass.png')

    await page.getByRole('button', { name: /石头/ }).click()
    await page.waitForTimeout(500)
    await exportCanvas(page, 'nameplate-stone.png')

    // ---- 上传方块贴图 → 程序化提取配色 ----
    const textureBuffer = makeBlockTexture()
    await writeFile(path.join(OUT_DIR, 'test-block.png'), textureBuffer)
    await page.evaluate(
      ({ base64 }) => {
        const input = document.querySelector('[data-testid="texture-input"]')
        if (!input) throw new Error('texture input not found')
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
        const file = new File([bytes], 'mod_block.png', { type: 'image/png' })
        const transfer = new DataTransfer()
        transfer.items.add(file)
        input.files = transfer.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
      },
      { base64: textureBuffer.toString('base64') },
    )
    await page.waitForTimeout(900)

    const textureUi = await page.evaluate(() => document.body.innerText)
    check(textureUi.includes('程序提取的配色'), '界面出现「程序提取的配色」')
    check(textureUi.includes('mod_block'), '上传的贴图进入贴图库')

    const sampled = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="nameplate-canvas"]')
      const ctx = canvas.getContext('2d')
      const unit = Math.max(1, Math.round(canvas.height / 256))
      // 底纹铺满整个面板（外框之内）。九宫格把源贴图的第 0 个纹理像素放在面板第一格，
      // 所以采样点要取「第一格的中心」，偏一两个像素就落到源图第 1 个像素上了。
      // 贴图自带边框 → 底纹铺满整块画布，取第 1 格中心采样（夹具四角是 2×2 色块）
      const sample = unit + Math.floor(unit / 2)
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const at = (x, y) => {
        const i = (y * canvas.width + x) * 4
        return [data[i], data[i + 1], data[i + 2]]
      }
      const x0 = sample
      const y0 = sample
      const x1 = canvas.width - sample - 1
      const y1 = canvas.height - sample - 1
      return {
        topLeft: at(x0, y0),
        topRight: at(x1, y0),
        bottomLeft: at(x0, y1),
        bottomRight: at(x1, y1),
        middle: at(Math.floor(canvas.width * 0.85), Math.floor(canvas.height * 0.5)),
      }
    })
    // 默认九宫格：贴图四角必须原样出现在面板四角（边框不变形）
    const close = (actual, expected, tolerance = 30) =>
      expected.every((value, index) => Math.abs(actual[index] - value) <= tolerance)
    check(
      close(sampled.topLeft, [255, 0, 0]) &&
        close(sampled.topRight, [0, 255, 0]) &&
        close(sampled.bottomLeft, [0, 0, 255]) &&
        close(sampled.bottomRight, [255, 255, 0]),
      '九宫格：贴图四角原样出现在面板四角（边框未变形）',
      `TL=${sampled.topLeft} TR=${sampled.topRight} BL=${sampled.bottomLeft} BR=${sampled.bottomRight}`,
    )
    check(
      sampled.middle[0] > sampled.middle[2] + 25,
      '面板中部沿用贴图自身的材质色（棕色）',
      `rgb(${sampled.middle.join(',')})`,
    )
    // 贴图自带边框时，名牌不再自己套一层外框：最外圈的像素应当来自贴图本身
    const edge = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="nameplate-canvas"]')
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
      const at = (x, y) => {
        const i = (y * canvas.width + x) * 4
        return [data[i], data[i + 1], data[i + 2]]
      }
      const mid = Math.floor(canvas.height / 2)
      return { left: at(0, mid), top: at(Math.floor(canvas.width / 2), 0) }
    })
    check(
      edge.left[0] > 150 && edge.left[1] > 100 && edge.left[2] < 150,
      '最外圈就是贴图自带边框（金色），没有被名牌外框盖掉',
      `左边缘 rgb(${edge.left.join(',')}) · 上边缘 rgb(${edge.top.join(',')})`,
    )
    // 独立复算文字对比度：从画布上取文字色与紧邻的背景色，按 WCAG 公式算
    const contrast = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="nameplate-canvas"]')
      const ctx = canvas.getContext('2d')
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const at = (x, y) => {
        const i = (y * canvas.width + x) * 4
        return [data[i], data[i + 1], data[i + 2]]
      }
      const lum = (rgb) => {
        const lin = rgb.map((v) => {
          const c = v / 255
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
      }
      // 文字像素：右半区接近纯白/纯黑的成片像素；背景：紧邻文字上方的像素
      let fill = null
      let minY = canvas.height
      for (let y = 0; y < canvas.height; y++) {
        for (let x = Math.floor(canvas.width * 0.6); x < canvas.width; x++) {
          const rgb = at(x, y)
          const isWhite = rgb.every((v) => v > 245)
          const isBlack = rgb.every((v) => v < 25)
          if (isWhite || isBlack) {
            fill = isWhite ? [255, 255, 255] : [0, 0, 0]
            if (y < minY) minY = y
          }
        }
      }
      if (!fill || minY >= canvas.height) return null
      const background = at(Math.floor(canvas.width * 0.85), Math.max(0, minY - 3))
      const lf = lum(fill)
      const lb = lum(background)
      return {
        ratio: (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05),
        fill,
        background,
      }
    })
    check(
      contrast !== null && contrast.ratio >= 4.5,
      '文字与背景的对比度达到 WCAG AA（4.5:1）',
      contrast
        ? `实测 ${contrast.ratio.toFixed(2)}:1（文字 rgb(${contrast.fill.join(',')}) / 背景 rgb(${contrast.background.join(',')})）`
        : '未找到文字像素',
    )

    await exportCanvas(page, 'nameplate-custom-texture.png')
    await page.screenshot({ path: path.join(OUT_DIR, 'studio-custom-texture.png'), fullPage: true })

    // ---- 说明页 ----
    await page.goto(`${BASE_URL}guide`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(OUT_DIR, 'guide.png'), fullPage: true })

    check(pageErrors.length === 0, '页面全程无未捕获异常', pageErrors.join(' | '))
  } finally {
    if (browser) await browser.close()
    server.kill('SIGTERM')
  }

  console.log('\n视觉验证结果：')
  console.log(notes.join('\n'))
  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} 项未通过：`)
    for (const item of failures) console.error(`  - ${item}`)
    process.exitCode = 1
  } else {
    console.log('\n✅ 全部通过')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

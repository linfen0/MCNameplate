#!/usr/bin/env node
/**
 * 把点阵字体烘成位图数据（开发工具，产出提交进仓库）。
 *
 * 为什么不用 webfont：
 *   一旦字体文件被 CSP / iframe / 隐私设置拦掉，canvas 会静默回退到系统字体，
 *   名牌上的 ID 立刻变成模糊的抗锯齿文字——而且没有任何报错。
 *   把字形烘成位图后，文字渲染完全不依赖字体文件，任何环境下都是硬边像素。
 *
 * 两类来源：
 *   1) sheet    —— Minecraft 原版字体表 ascii.png（128×128，16×16 个 8×8 字格，code = 索引）
 *   2) webfont  —— Silkscreen / Press Start 2P，用无头 Chromium 逐字光栅化
 *
 * 用法：node scripts/build-bitmap-font.mjs
 * 产出：src/lib/bitmapFontData.ts
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = path.join(ROOT, '.cache')
const PORT = Number(process.env.FONT_PORT ?? 4332)
const CHROME_PATH =
  process.env.CHROME_PATH ?? '/data/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'

/** Minecraft 原版字体表：来自官方资源镜像，只用于烘焙，不进应用包 */
const SHEET_URL =
  process.env.MOJANGLES_SHEET_URL ??
  'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.20.4/assets/minecraft/textures/font/ascii.png'

const ASCII = []
for (let code = 32; code <= 126; code++) ASCII.push(code)

/** 原版 default.json：字格 8 高、ascent 7、比例字体（步进 = 墨迹宽 + 1） */
const SHEET_FONT = {
  id: 'mojangles',
  name: 'Mojangles',
  description: 'Minecraft 原版字体（官方 ascii.png 字模）',
  cssFamily: '"Minecraft", "Silkscreen", monospace',
  ascent: 7,
  baselineRow: 7,
  letterSpacing: 1,
  spaceAdvance: 4,
}

const WEB_FONTS = [
  {
    id: 'silkscreen',
    name: 'Silkscreen',
    description: '5×5 点阵，工整克制',
    cssFamily: 'Silkscreen',
    file: 'silkscreen-regular.woff2',
  },
  {
    id: 'press-start-2p',
    name: 'Press Start 2P',
    description: '经典 8 位街机字体，字重更粗',
    cssFamily: '"Press Start 2P"',
    file: 'press-start-2p.woff2',
  },
]
const WEB_FONT_SIZE = 8

/* ------------------------------------------------------------------ */
/* 1. 原版字体表                                                        */
/* ------------------------------------------------------------------ */

async function loadSheet() {
  await mkdir(CACHE_DIR, { recursive: true })
  const cached = path.join(CACHE_DIR, 'ascii.png')
  try {
    const buffer = await readFile(cached)
    if (buffer.length > 500) return PNG.sync.read(buffer)
  } catch {
    /* 缓存不存在，去下载 */
  }
  const response = await fetch(SHEET_URL)
  if (!response.ok) throw new Error(`字体表下载失败：${response.status} ${SHEET_URL}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  await writeFile(cached, buffer)
  return PNG.sync.read(buffer)
}

function boundsOf(glyphs) {
  let top = 0
  let bottom = 0
  for (const glyph of Object.values(glyphs)) {
    if (glyph.h === 0) continue
    top = Math.min(top, glyph.y)
    bottom = Math.max(bottom, glyph.y + glyph.h)
  }
  return { ascent: -top, descent: bottom }
}

function bakeSheetFont(png) {
  const cellSize = png.width / 16
  const glyphs = {}
  const at = (row, col, x, y) => png.data[((row * cellSize + y) * png.width + col * cellSize + x) * 4 + 3]

  for (const code of ASCII) {
    const col = code % 16
    const row = Math.floor(code / 16)
    let minX = cellSize
    let maxX = -1
    let minY = cellSize
    let maxY = -1
    for (let y = 0; y < cellSize; y++) {
      for (let x = 0; x < cellSize; x++) {
        if (at(row, col, x, y) < 128) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }

    if (maxX < minX || maxY < minY) {
      glyphs[code] = { advance: SHEET_FONT.spaceAdvance, x: 0, y: 0, w: 0, h: 0, rows: [] }
      continue
    }

    const w = maxX - minX + 1
    const h = maxY - minY + 1
    const rows = []
    for (let y = minY; y <= maxY; y++) {
      let bits = 0
      for (let x = minX; x <= maxX; x++) {
        if (at(row, col, x, y) < 128) continue
        bits |= 1 << (x - minX)
      }
      rows.push(bits)
    }
    glyphs[code] = {
      advance: w + SHEET_FONT.letterSpacing,
      x: minX,
      y: minY - SHEET_FONT.baselineRow,
      w,
      h,
      rows,
    }
  }

  return {
    ...SHEET_FONT,
    nativeSize: cellSize,
    glyphs,
    metrics: boundsOf(glyphs),
  }
}

/* ------------------------------------------------------------------ */
/* 2. webfont（无头 Chromium 光栅化）                                    */
/* ------------------------------------------------------------------ */

async function bakeWebFonts() {
  const server = spawn(
    path.join(ROOT, 'node_modules/.bin/vite'),
    ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' },
  )
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  const browser = await chromium.launch({ executablePath: CHROME_PATH, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  // 必须先在真实页面上打开：about:blank 是不透明源，字体请求会被拒
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })

  const result = await page.evaluate(
    async ({ fonts, chars, size }) => {
      const out = []
      for (const font of fonts) {
        await document.fonts.load(`${size}px ${font.cssFamily}`, chars.join(''))
        await document.fonts.ready
        if (!document.fonts.check(`${size}px ${font.cssFamily}`)) {
          throw new Error(`字体未加载成功：${font.name}`)
        }
        const ctx = document.createElement('canvas').getContext('2d')
        ctx.font = `${size}px ${font.cssFamily}`
        ctx.textBaseline = 'alphabetic'

        const glyphs = {}
        for (const ch of chars) {
          const advance = Math.round(ctx.measureText(ch).width)
          const pad = 4
          const canvas = document.createElement('canvas')
          canvas.width = advance + pad * 2
          canvas.height = size * 3
          const g = canvas.getContext('2d')
          g.font = `${size}px ${font.cssFamily}`
          g.textBaseline = 'alphabetic'
          g.fillStyle = '#fff'
          const baseline = size * 2
          g.fillText(ch, pad, baseline)
          const data = g.getImageData(0, 0, canvas.width, canvas.height).data

          let x0 = Infinity
          let y0 = Infinity
          let x1 = -Infinity
          let y1 = -Infinity
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              if (data[(y * canvas.width + x) * 4 + 3] < 128) continue
              if (x < x0) x0 = x
              if (x > x1) x1 = x
              if (y < y0) y0 = y
              if (y > y1) y1 = y
            }
          }
          if (x1 < x0) {
            glyphs[ch.charCodeAt(0)] = { advance, x: 0, y: 0, w: 0, h: 0, rows: [] }
            continue
          }
          const w = x1 - x0 + 1
          const h = y1 - y0 + 1
          const rows = []
          for (let y = y0; y <= y1; y++) {
            let bits = 0
            for (let x = x0; x <= x1; x++) {
              if (data[(y * canvas.width + x) * 4 + 3] < 128) continue
              bits |= 1 << (x - x0)
            }
            rows.push(bits)
          }
          glyphs[ch.charCodeAt(0)] = { advance, x: x0 - pad, y: y0 - baseline, w, h, rows }
        }

        let top = 0
        let bottom = 0
        for (const glyph of Object.values(glyphs)) {
          if (glyph.h === 0) continue
          top = Math.min(top, glyph.y)
          bottom = Math.max(bottom, glyph.y + glyph.h)
        }
        out.push({ ...font, nativeSize: size, glyphs, metrics: { ascent: -top, descent: bottom } })
      }
      return out
    },
    { fonts: WEB_FONTS, chars: ASCII.map((code) => String.fromCharCode(code)), size: WEB_FONT_SIZE },
  )

  await browser.close()
  server.kill('SIGTERM')
  return result
}

/* ------------------------------------------------------------------ */
/* 3. 输出 TS                                                          */
/* ------------------------------------------------------------------ */

const sheetFont = bakeSheetFont(await loadSheet())
const webFonts = await bakeWebFonts()
const all = [sheetFont, ...webFonts]

const lines = [
  '/* eslint-disable */',
  '// 本文件由 scripts/build-bitmap-font.mjs 自动生成，请勿手改。',
  '// 字形来源：Minecraft 原版 ascii.png（Mojangles）/ Silkscreen / Press Start 2P，',
  '// 全部烘成位图，运行时不再依赖任何字体文件。',
  '',
  'export interface BitmapGlyph {',
  '  /** 步进宽度（原生像素） */',
  '  advance: number',
  '  /** 相对落笔点的水平偏移 */',
  '  x: number',
  '  /** 相对基线的垂直偏移（向上为负） */',
  '  y: number',
  '  w: number',
  '  h: number',
  '  /** 每行位掩码，最低位是最左像素 */',
  '  rows: number[]',
  '}',
  '',
  'export interface BitmapFontData {',
  '  id: string',
  '  name: string',
  '  nativeSize: number',
  '  /** 基线到字形顶部 / 底部的最大距离 */',
  '  ascent: number',
  '  descent: number',
  '  glyphs: Record<number, BitmapGlyph>',
  '}',
  '',
  'export const BITMAP_FONTS: BitmapFontData[] = [',
]

for (const font of all) {
  lines.push('  {')
  lines.push(`    id: ${JSON.stringify(font.id)},`)
  lines.push(`    name: ${JSON.stringify(font.name)},`)
  lines.push(`    nativeSize: ${font.nativeSize},`)
  lines.push(`    ascent: ${font.metrics.ascent},`)
  lines.push(`    descent: ${font.metrics.descent},`)
  lines.push('    glyphs: {')
  for (const code of Object.keys(font.glyphs).map(Number).sort((a, b) => a - b)) {
    const g = font.glyphs[code]
    lines.push(
      `      ${code}: { advance: ${g.advance}, x: ${g.x}, y: ${g.y}, w: ${g.w}, h: ${g.h}, rows: [${g.rows.join(', ')}] },`,
    )
  }
  lines.push('    },')
  lines.push('  },')
}
lines.push(']', '')

await writeFile(path.join(ROOT, 'src/lib/bitmapFontData.ts'), lines.join('\n'))

for (const font of all) {
  const ink = Object.values(font.glyphs).filter((g) => g.h > 0).length
  console.log(
    `${font.name.padEnd(16)} 字形 ${Object.keys(font.glyphs).length}（有墨迹 ${ink}） ascent=${font.metrics.ascent} descent=${font.metrics.descent}`,
  )
}
console.log('已写出 src/lib/bitmapFontData.ts')

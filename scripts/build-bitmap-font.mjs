#!/usr/bin/env node
/**
 * 把像素字体烘成位图数据（开发工具，产出提交进仓库）。
 *
 * 为什么不用 webfont：
 *   一旦字体文件被 CSP / iframe / 隐私设置拦掉，canvas 会静默回退到系统字体，
 *   名牌上的 ID 立刻变成模糊的抗锯齿文字——而且没有任何报错。
 *   把字形烘成位图后，文字渲染完全不依赖字体文件，任何环境下都是硬边像素。
 *
 * 用法：node scripts/build-bitmap-font.mjs
 * 产出：src/lib/bitmapFontData.ts
 */

import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.FONT_PORT ?? 4332)
const CHROME_PATH =
  process.env.CHROME_PATH ?? '/data/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'

const FONTS = [
  { id: 'silkscreen', name: 'Silkscreen', cssFamily: 'Silkscreen', file: 'silkscreen-regular.woff2', nativeSize: 8 },
  { id: 'press-start-2p', name: 'Press Start 2P', cssFamily: '"Press Start 2P"', file: 'press-start-2p.woff2', nativeSize: 8 },
]

/** 需要烘进数据的字符：可打印 ASCII */
const CHARS = []
for (let code = 32; code <= 126; code++) CHARS.push(String.fromCharCode(code))

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
  async ({ fonts, chars, port }) => {
    void port
    const ctx = document.createElement('canvas').getContext('2d')
    const out = []

    for (const font of fonts) {
      await document.fonts.load(`${font.nativeSize}px ${font.cssFamily}`, chars.join(''))
      await document.fonts.ready
      const ok = document.fonts.check(`${font.nativeSize}px ${font.cssFamily}`)
      if (!ok) throw new Error(`字体未加载成功：${font.name}`)

      ctx.font = `${font.nativeSize}px ${font.cssFamily}`
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'

      const metrics = ctx.measureText('Hg')
      const ascent = Math.ceil(metrics.actualBoundingBoxAscent)
      const descent = Math.ceil(metrics.actualBoundingBoxDescent)

      const glyphs = {}
      let minX = 0
      let maxY = 0
      for (const ch of chars) {
        const advance = Math.round(ctx.measureText(ch).width)
        // 画大一点再裁剪，避免负偏移被截断
        const pad = 4
        const canvas = document.createElement('canvas')
        canvas.width = advance + pad * 2
        canvas.height = font.nativeSize * 3
        const g = canvas.getContext('2d')
        g.font = `${font.nativeSize}px ${font.cssFamily}`
        g.textBaseline = 'alphabetic'
        g.fillStyle = '#fff'
        const baseline = font.nativeSize * 2
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
          // 空格等无墨迹的字形
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
        const offsetX = x0 - pad
        const offsetY = y0 - baseline
        minX = Math.min(minX, offsetX)
        maxY = Math.max(maxY, offsetY + h)
        glyphs[ch.charCodeAt(0)] = { advance, x: offsetX, y: offsetY, w, h, rows }
      }

      // 用全部字形的真实上下界重算度量：'_' 之类会落在基线行上，
      // 只按 'Hg' 量会得到偏小的 descent，关掉阴影时下划线就被裁掉。
      let inkTop = 0
      let inkBottom = 0
      for (const g of Object.values(glyphs)) {
        if (g.h === 0) continue
        inkTop = Math.min(inkTop, g.y)
        inkBottom = Math.max(inkBottom, g.y + g.h)
      }
      out.push({
        id: font.id,
        name: font.name,
        nativeSize: font.nativeSize,
        ascent: -inkTop,
        descent: inkBottom,
        minX,
        inkHeight: maxY,
        glyphs,
      })
      void ascent
      void descent
    }
    return out
  },
  { fonts: FONTS, chars: CHARS, port: PORT },
)

await browser.close()
server.kill('SIGTERM')

const lines = [
  '/* eslint-disable */',
  '// 本文件由 scripts/build-bitmap-font.mjs 自动生成，请勿手改。',
  '// 字形来源：Silkscreen / Press Start 2P（SIL OFL 1.1），已烘成位图，运行时不再依赖字体文件。',
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

for (const font of result) {
  lines.push('  {')
  lines.push(`    id: ${JSON.stringify(font.id)},`)
  lines.push(`    name: ${JSON.stringify(font.name)},`)
  lines.push(`    nativeSize: ${font.nativeSize},`)
  lines.push(`    ascent: ${font.ascent},`)
  lines.push(`    descent: ${font.descent},`)
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

for (const font of result) {
  const count = Object.keys(font.glyphs).length
  const ink = Object.values(font.glyphs).filter((g) => g.h > 0).length
  console.log(`${font.name}: ${count} 个字形（有墨迹 ${ink}），ascent=${font.ascent} descent=${font.descent}`)
}
console.log('已写出 src/lib/bitmapFontData.ts')

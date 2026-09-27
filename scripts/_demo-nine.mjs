/** 用用户那张 16×16 带边框的贴图，对比九宫格 / 整张拉伸 / 平铺三种效果 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'

const PORT = 4341
const URL = `http://127.0.0.1:${PORT}/`
const OUT = path.join(process.cwd(), 'verification')
await mkdir(OUT, { recursive: true })
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: process.cwd(), stdio: 'ignore' })
for (let i = 0; i < 80; i++) { try { if ((await fetch(URL)).ok) break } catch {} await new Promise((r) => setTimeout(r, 250)) }

const browser = await chromium.launch({ executablePath: '/data/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const upload = async (testId, filePath, name) => {
  const base64 = (await readFile(filePath)).toString('base64')
  await page.evaluate(({ testId, base64, name }) => {
    const input = document.querySelector(`[data-testid="${testId}"]`)
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type: 'image/png' }))
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }))
  }, { testId, base64, name })
}
await upload('skin-input', path.join(OUT, 'test-skin-64.png'), 'skin.png')
await page.fill('[data-testid="id-input"]', 'XIEQING')
await page.waitForTimeout(500)
await upload('texture-input', path.join(OUT, 'radial_chassis_top.png'), 'radial_chassis_top')
await page.waitForTimeout(900)
for (const [label, name] of [['nine-slice', 'a-九宫格'], ['stretch', 'b-整张拉伸'], ['tile', 'c-平铺']]) {
  await page.getByRole('button', { name: label === 'nine-slice' ? '九宫格拉伸（推荐）' : label === 'stretch' ? '整张拉伸' : '平铺成方块墙' }).click()
  await page.waitForTimeout(700)
  const dataUrl = await page.evaluate(() => document.querySelector('[data-testid="nameplate-canvas"]').toDataURL('image/png'))
  await writeFile(path.join(OUT, `demo-${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'))
}
await browser.close(); server.kill('SIGTERM')
console.log('已导出 demo-a-九宫格 / demo-b-整张拉伸 / demo-c-平铺')

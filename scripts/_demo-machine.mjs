/** 一次性复现脚本：深底 + 金色细节的“机器类”贴图，检查底纹是否还炸 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PNG } from 'pngjs'
import { chromium } from 'playwright-core'

const URL = 'http://127.0.0.1:4173/'
const OUT = path.join(process.cwd(), 'verification')

// 深色底 + 少量金色细节（radial chassis 那类）
const png = new PNG({ width: 16, height: 16 })
for (let y = 0; y < 16; y++) {
  for (let x = 0; x < 16; x++) {
    const i = (y * 16 + x) * 4
    const n = (x * 5 + y * 3) % 20
    const c = n === 0 ? [250, 200, 60] : n === 1 ? [255, 240, 200] : n === 3 ? [58, 54, 48] : [26, 24, 22]
    png.data[i] = c[0]
    png.data[i + 1] = c[1]
    png.data[i + 2] = c[2]
    png.data[i + 3] = 255
  }
}
await writeFile(path.join(OUT, 'test-block-machine.png'), PNG.sync.write(png))

const browser = await chromium.launch({
  executablePath: '/data/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } })
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

const upload = async (testId, filePath, name) => {
  const base64 = (await readFile(filePath)).toString('base64')
  await page.evaluate(
    ({ testId, base64, name }) => {
      const input = document.querySelector(`[data-testid="${testId}"]`)
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], name, { type: 'image/png' }))
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    { testId, base64, name },
  )
}

await upload('skin-input', path.join(OUT, 'test-skin-64.png'), 'skin.png')
await page.fill('[data-testid="id-input"]', 'XIEQING')
await page.waitForTimeout(600)
await upload('texture-input', path.join(OUT, 'test-block-machine.png'), 'radial_chassis.png')
await page.waitForTimeout(1000)

const dataUrl = await page.evaluate(
  () => document.querySelector('[data-testid="nameplate-canvas"]').toDataURL('image/png'),
)
await writeFile(path.join(OUT, 'demo-machine-texture.png'), Buffer.from(dataUrl.split(',')[1], 'base64'))
await page.screenshot({ path: path.join(OUT, 'studio-machine-texture.png'), fullPage: true })

const palette = await page.evaluate(() => {
  const text = document.body.innerText
  const section = text.slice(text.indexOf('程序提取的配色'))
  return section.slice(0, 260)
})
console.log('提取出的配色面板：\n' + palette)
await browser.close()

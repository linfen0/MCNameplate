import { describe, it } from 'vitest'
import { createImage, setPixel } from './raster'
import { extractPalette } from './palette'
import { planText } from './textPlan'

describe('dbg', () => {
  it('print', () => {
    const image = createImage(8, 8)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) setPixel(image, x, y, [244, 244, 244, 255])
    const p = extractPalette(image)
    const style = planText({
      swatches: [p.light, p.accent, p.dark, p.base],
      background: { dark: p.dark, light: p.light, lightBackground: p.luminance > 0.32 },
      tint: p.base,
      textHeightPx: 200,
    })
    console.log(JSON.stringify({ palette: p, style }, null, 2))
  })
})

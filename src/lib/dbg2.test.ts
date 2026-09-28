import { describe, it } from 'vitest'
import { getPixelFont, fitWrappedText, measureText, wrapText } from './pixelFont'
const font = getPixelFont('mojangles')
describe('dbg', () => {
  it('print', () => {
    const long = 'SUPER_LONG_PLAYER_NAME'
    for (const n of [1, 2, 3]) {
      const lines = wrapText(font, long, n)
      console.log(n, JSON.stringify(lines), lines.map((l) => measureText(font, l).advance))
    }
    for (const n of [1, 2, 3]) {
      const fit = fitWrappedText(font, long, { width: 200, height: 160 }, { maxLines: n, targetScale: 40 })
      console.log('fit', n, fit.lines.length, fit.scale)
    }
  })
})

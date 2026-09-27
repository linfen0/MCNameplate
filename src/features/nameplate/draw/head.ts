/** 2D 正面头像：贴图整数倍最近邻放大，逐像素硬边 */

import { rgbaToCanvas } from '../../../lib/imageIo'
import type { HeadFaces } from '../../../lib/types'
import type { LayoutPlan } from '../layout'

export function drawFlatHead(ctx: CanvasRenderingContext2D, plan: LayoutPlan, faces: HeadFaces): void {
  const faceSize = faces.faceSize
  const { headBox } = plan
  const front = rgbaToCanvas(faces.front)
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(
    front,
    0,
    0,
    faceSize,
    faceSize,
    headBox.x,
    headBox.y,
    headBox.width,
    headBox.height,
  )
  ctx.restore()
}

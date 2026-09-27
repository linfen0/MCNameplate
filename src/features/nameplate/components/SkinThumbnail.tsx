import { useEffect, useRef } from 'react'
import { cx } from '../../../lib/cx'
import { rgbaToCanvas } from '../../../lib/imageIo'
import type { RgbaImage } from '../../../lib/types'

export interface SkinThumbnailProps {
  image: RgbaImage
  /** CSS 显示尺寸（画布按整数倍放大后由浏览器缩放，保持硬边） */
  displaySize?: number
  className?: string
}

/** 在 checkerboard 背景上以整数倍最近邻显示皮肤原图 */
export function SkinThumbnail({ image, displaySize = 96, className }: SkinThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scale = Math.max(1, Math.floor(displaySize / image.width))
    canvas.width = image.width * scale
    canvas.height = image.height * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(rgbaToCanvas(image), 0, 0, canvas.width, canvas.height)
  }, [image, displaySize])

  return (
    <canvas
      ref={canvasRef}
      className={cx('pixelated mc-panel-flat checker-bg', className)}
      style={{ width: displaySize, height: displaySize }}
    />
  )
}

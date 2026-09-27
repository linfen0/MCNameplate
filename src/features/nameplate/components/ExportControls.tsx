import { useEffect, useState, type RefObject } from 'react'
import { ChipRow, PixelButton, PixelChip } from '../../../components/pixel'
import { canvasToBlob, copyCanvasToClipboard, downloadCanvas, formatBytes } from '../../../lib/imageIo'
import { HEIGHT_OPTIONS, nameplateFileName, type NameplateConfig } from '../config'
import { resolveOutputSize } from '../resolve'

export interface ExportControlsProps {
  canvasRef: RefObject<HTMLCanvasElement | null>
  config: NameplateConfig
  patch: (changes: Partial<NameplateConfig>) => void
  disabled: boolean
  onReset: () => void
  /** 每次渲染完成时变化，用于重新估算文件体积 */
  revision: number
}

export function ExportControls({
  canvasRef,
  config,
  patch,
  disabled,
  onReset,
  revision,
}: ExportControlsProps) {
  const [status, setStatus] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<string | null>(null)
  const size = resolveOutputSize(config)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || disabled) {
      setEstimate(null)
      return
    }
    let cancelled = false
    canvasToBlob(canvas)
      .then((blob) => {
        if (!cancelled) setEstimate(`约 ${formatBytes(blob.size)}`)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [canvasRef, disabled, revision])

  const handleDownload = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      await downloadCanvas(canvas, nameplateFileName(config.id, size.width, size.height))
      setStatus('PNG 已开始下载')
    } catch {
      setStatus('导出失败，请重试')
    }
  }

  const handleCopy = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      await copyCanvasToClipboard(canvas)
      setStatus('已复制到剪贴板')
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : '复制失败')
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="mc-label">名牌高度</span>
        <ChipRow>
          {HEIGHT_OPTIONS.map((height) => (
            <PixelChip key={height} active={config.height === height} onClick={() => patch({ height })}>
              {height}px
            </PixelChip>
          ))}
        </ChipRow>
        <p className="font-sans text-xs text-ink-300">
          当前输出 {size.width}×{size.height} · 文件名 {nameplateFileName(config.id, size.width, size.height)}
          {estimate ? ` · ${estimate}` : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <PixelButton variant="primary" onClick={handleDownload} disabled={disabled}>
          下载 PNG
        </PixelButton>
        <PixelButton onClick={handleCopy} disabled={disabled}>
          复制图片
        </PixelButton>
        <PixelButton variant="ghost" onClick={onReset}>
          重置选项
        </PixelButton>
      </div>

      {disabled ? (
        <p className="font-sans text-xs text-gold-400">上传皮肤并填写 ID 后即可导出。</p>
      ) : status ? (
        <p className="font-sans text-xs text-grass-400">{status}</p>
      ) : null}
    </div>
  )
}

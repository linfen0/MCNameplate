import { useEffect, useState, type RefObject } from 'react'
import { ChipRow, PixelButton, PixelChip } from '../../../components/pixel'
import { canvasToBlob, copyCanvasToClipboard, downloadBlob, downloadCanvas, formatBytes } from '../../../lib/imageIo'
import type { ParsedSkin } from '../../../lib/types'
import { buildNameplateModelZip } from '../export3d'
import { HEIGHT_OPTIONS, nameplateFileName, type NameplateConfig } from '../config'
import { buildNameplateSvg } from '../exportSvg'
import { resolveOutputSize } from '../resolve'

export interface ExportControlsProps {
  canvasRef: RefObject<HTMLCanvasElement | null>
  config: NameplateConfig
  skin: ParsedSkin | null
  patch: (changes: Partial<NameplateConfig>) => void
  disabled: boolean
  onReset: () => void
  /** 每次渲染完成时变化，用于重新估算文件体积 */
  revision: number
}

export function ExportControls({
  canvasRef,
  config,
  skin,
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

  const handleSvg = () => {
    try {
      const svg = buildNameplateSvg(skin, config)
      const name = nameplateFileName(config.id, size.width, size.height).replace(/\.png$/, '.svg')
      downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), name)
      setStatus('SVG 已开始下载（分层，可在 Figma 里逐个改）')
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : 'SVG 导出失败')
    }
  }

  const handleModel = () => {
    if (!skin) return
    try {
      const bundle = buildNameplateModelZip(skin, config)
      const base = nameplateFileName(config.id, size.width, size.height).replace(/\.png$/, '')
      const bytes = new Uint8Array(bundle.zip)
      downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' }), `${base}_3d.zip`)
      setStatus(
        `3D 包已开始下载：${bundle.stats.parts} 个对象 / ${bundle.stats.quads} 个面 / ${bundle.stats.materials} 个材质`,
      )
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : '3D 导出失败')
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
        <PixelButton onClick={handleSvg} disabled={disabled}>
          下载 SVG
        </PixelButton>
        <PixelButton onClick={handleModel} disabled={disabled}>
          下载 3D 模型包
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
      ) : (
        <div className="space-y-2 font-sans text-xs leading-relaxed text-ink-300">
          <p>
            <b className="text-ink-100">SVG</b>：分层矢量（底板 / 背景 / 外框 / 分割线 / 肖像位 /
            头像 / ID 文字，每个字符一个图层）。2.5D 模式下头像附带立方体几何——
            <b className="text-ink-100">基础层 + 帽子层 × 6 个面 = 12 个可单独选中的面图层</b>，
            每个面是"仿射变换 + 蒙皮贴图"，Figma / Illustrator 原生可读可编辑。
          </p>
          <p>
            <b className="text-ink-100">3D 模型包（ZIP）</b>：<b className="text-ink-100">整块名牌</b>的三维版本，
            按同一套分层拆成 35 个对象——底板 / 背景 / 外框倒角 / 分割线 / 肖像位凹槽 / 头像立方体
            （基础层 + 帽子层 × 6 面）/ ID 文字（每个字符挤出一块）。含
            <b className="text-ink-100">Blender 建场脚本</b>（运行即生成原生场景与材质、贴图自动打包）、
            glTF、OBJ+MTL 与 13 张贴图。
          </p>
        </div>
      )}
    </div>
  )
}

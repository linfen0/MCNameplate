import { useRef, useState, type DragEvent } from 'react'
import { PixelButton } from '../../../components/pixel'
import { cx } from '../../../lib/cx'
import { skinFormatLabel, skinModelLabel } from '../../../lib/skin'
import type { ParsedSkin } from '../../../lib/types'
import { SkinThumbnail } from './SkinThumbnail'

export interface SkinUploaderProps {
  skin: ParsedSkin | null
  loading: boolean
  error: string | null
  onFile: (file: File) => void
  onClear: () => void
}

const ACCEPT = 'image/png,image/*'

export function SkinUploader({ skin, loading, error, onFile, onClear }: SkinUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)

  const pick = () => inputRef.current?.click()

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) onFile(file)
  }

  const hasBlockingError = skin?.issues.some((issue) => issue.level === 'error') ?? false

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        data-testid="skin-input"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onFile(file)
          event.target.value = ''
        }}
      />

      <div
        role="button"
        tabIndex={0}
        onClick={pick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') pick()
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cx(
          'checker-bg flex cursor-pointer flex-col items-center justify-center gap-2 border-4 border-dashed px-4 py-7 text-center',
          dragging ? 'border-grass-400 bg-grass-600/20' : 'border-ink-400',
        )}
      >
        <span className="mc-title text-[14px] text-grass-400">
          {loading ? '正在读取…' : '拖入 / 点击选择皮肤 PNG'}
        </span>
        <span className="font-sans text-xs text-ink-200">
          支持 64×64 现代皮肤与 64×32 旧版皮肤 · 也可直接 Ctrl/⌘+V 粘贴
        </span>
      </div>

      {error ? (
        <p className="border-l-4 border-red-500 bg-red-950/40 px-3 py-2 font-sans text-xs text-red-300">{error}</p>
      ) : null}

      {skin ? (
        <div className="mc-panel-flat flex gap-3 p-3">
          <SkinThumbnail image={skin.image} displaySize={96} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="mc-label truncate text-grass-400">{skin.fileName ?? '已载入皮肤'}</p>
            <dl className="space-y-1 font-sans text-xs text-ink-200">
              <div className="flex gap-2">
                <dt className="text-ink-300">尺寸</dt>
                <dd>{skinFormatLabel(skin)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-ink-300">模型</dt>
                <dd>{skinModelLabel(skin)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-ink-300">第二层</dt>
                <dd>{skin.hasOverlay ? '已合成帽子 / 头发' : '无（旧版皮肤）'}</dd>
              </div>
            </dl>
            <div className="flex gap-2 pt-1">
              <PixelButton variant="ghost" className="!px-2 !py-1 !text-[12px]" onClick={pick}>
                更换
              </PixelButton>
              <PixelButton variant="ghost" className="!px-2 !py-1 !text-[12px]" onClick={onClear}>
                移除
              </PixelButton>
            </div>
          </div>
        </div>
      ) : null}

      {skin && skin.issues.length > 0 ? (
        <ul className="space-y-1">
          {skin.issues.map((issue, index) => (
            <li
              key={`${issue.level}-${index}`}
              className={cx(
                'border-l-4 px-3 py-1.5 font-sans text-xs',
                issue.level === 'error' && 'border-red-500 bg-red-950/40 text-red-300',
                issue.level === 'warning' && 'border-gold-400 bg-gold-500/10 text-gold-400',
                issue.level === 'info' && 'border-ink-400 bg-ink-600/50 text-ink-200',
              )}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      {hasBlockingError ? (
        <p className="font-sans text-xs text-red-300">当前皮肤无法用于生成名牌，请更换文件。</p>
      ) : null}
    </div>
  )
}

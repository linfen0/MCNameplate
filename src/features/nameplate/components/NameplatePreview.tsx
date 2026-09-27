import type { RefObject } from 'react'
import { cx } from '../../../lib/cx'
import { getTheme } from '../../../lib/themes'
import type { NameplateConfig } from '../config'
import { resolveOutputSize } from '../resolve'
import type { RenderResult } from '../renderer'

export interface NameplatePreviewProps {
  canvasRef: RefObject<HTMLCanvasElement | null>
  result: RenderResult | null
  config: NameplateConfig
  hasSkin: boolean
  /** 网页文字用的 webfont 是否可用；false 只影响界面观感，不影响名牌输出 */
  webFontsReady: boolean
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="mc-panel-flat px-3 py-2">
      <dt className="mc-label text-[11px] text-ink-300">{label}</dt>
      <dd className={cx('mc-label mt-1 text-[13px]', highlight ? 'text-gold-400' : 'text-ink-100')}>{value}</dd>
    </div>
  )
}

export function NameplatePreview({
  canvasRef,
  result,
  config,
  hasSkin,
  webFontsReady,
}: NameplatePreviewProps) {
  const theme = getTheme(config.themeId)
  const size = resolveOutputSize(config)

  return (
    <div className="space-y-3">
      <div className="checker-bg mc-panel-flat relative p-3">
        <canvas
          ref={canvasRef}
          data-testid="nameplate-canvas"
          className="pixelated block h-auto w-full"
        />

        {!hasSkin ? (
          <div className="absolute inset-3 flex items-center justify-center bg-ink-900/78 px-6 text-center">
            <div className="space-y-2">
              <p className="mc-title text-[15px] text-grass-400">先上传你的皮肤</p>
              <p className="font-sans text-xs text-ink-200">
                64×64 的皮肤 PNG 即可，名牌会自动取头部（含帽子图层）放到左侧肖像位
              </p>
            </div>
          </div>
        ) : null}

      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="输出尺寸" value={`${size.width}×${size.height}`} />
        <Stat
          label="两块占比"
          value={
            result
              ? `头像 ${result.ratio.avatarPercent.toFixed(1)}% : ID ${result.ratio.idPercent.toFixed(1)}%`
              : '—'
          }
          highlight={result?.ratio.golden ?? false}
        />
        <Stat label="头像倍率" value={result ? `1 皮肤像素 ≈ ${result.headScale}px` : '—'} />
        <Stat label="底色" value={theme.name} />
      </dl>

      {!webFontsReady ? (
        <p className="border-l-4 border-gold-400 bg-gold-500/10 px-3 py-2 font-sans text-xs text-gold-400">
          网页像素字体未加载成功（可能被 CSP / 扩展拦截）。名牌上的 ID 使用内置点阵字库渲染，
          <b> 不受影响</b>；只有界面文字会退回系统字体。
        </p>
      ) : null}

      {result ? (
        <p className="font-sans text-xs leading-relaxed text-ink-300">
          {config.aspect === 'auto' ? '自适应' : '固定'}宽高比 {size.width}×{size.height} · ID 文本放大{' '}
          {result.textScale}× ·{' '}
          {result.hasSkin
            ? `头像 ${result.head3d ? 'three.js 3D 立体' : config.headStyle === 'iso' ? '3D 不可用，已回退 2D' : '2D 正面'}`
            : '尚未载入皮肤'}
          {result.ratio.golden ? ' · 当前两块比例严格等于黄金分割 1 : 0.618' : ''}
        </p>
      ) : null}
    </div>
  )
}

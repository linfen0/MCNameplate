import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ChipRow, Field, PixelButton, PixelChip, PixelSlider } from '../../../components/pixel'
import { cx } from '../../../lib/cx'
import { rgbaToCanvas } from '../../../lib/imageIo'
import { paletteToCssGradient } from '../../../lib/palette'
import type { RgbaImage } from '../../../lib/types'
import type { TextureLibraryState } from '../../../hooks/useTextureLibrary'
import type { NameplateConfig } from '../config'

export interface TextureThemePanelProps {
  config: NameplateConfig
  patch: (changes: Partial<NameplateConfig>) => void
  library: TextureLibraryState
}

/**
 * 自定义纹理主题：拖入任意方块贴图（MC 原版或 Mod 都行），
 * 程序化提取配色并直接套用到整套主题。
 */
export function TextureThemePanel({ config, patch, library }: TextureThemePanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const active = config.customTexture
  const activeId = active?.id ?? null

  const pickFiles = async (files: File[]) => {
    const added = await library.addFiles(files)
    if (added.length > 0) {
      patch({ themeId: 'custom', customTexture: added[0] })
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void pickFiles([...(event.dataTransfer.files ?? [])])
  }

  return (
    <div className="space-y-4">
      <Field
        label="方块贴图（支持 Mod）"
        aside={
          <span className="mc-label text-ink-300">
            {library.entries.length > 0 ? `${library.entries.length} 张` : '未上传'}
          </span>
        }
        hint="拖入 16×16 的方块 PNG（原版材质包或 Mod 的 assets/…/textures/block 里那些），一次可多张，点选切换。贴图只当取色源：程序从中提取配色，再用这套配色生成底纹。"
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          data-testid="texture-input"
          className="sr-only"
          onChange={(event) => {
            void pickFiles([...(event.target.files ?? [])])
            event.target.value = ''
          }}
        />
        <div
          role="button"
          tabIndex={0}
          data-testid="texture-drop"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cx(
            'checker-bg flex cursor-pointer flex-col items-center justify-center gap-1 border-4 border-dashed px-3 py-4 text-center',
            dragging ? 'border-grass-400 bg-grass-600/20' : 'border-ink-400',
          )}
        >
          <span className="mc-title text-[13px] text-grass-400">
            {library.loading ? '正在提取配色…' : '拖入 / 点击选择方块贴图'}
          </span>
          <span className="font-sans text-[11px] text-ink-200">
            任何尺寸都行，越小越像素；可多选，也可直接拖一整个材质包文件夹里的图
          </span>
        </div>
      </Field>

      {library.error ? (
        <p className="border-l-4 border-red-500 bg-red-950/40 px-3 py-2 font-sans text-xs text-red-300">
          {library.error}
        </p>
      ) : null}

      {library.entries.length > 0 ? (
        <Field label="已上传的贴图" hint="点一下就用它生成主题；每张的配色都是独立提取的。">
          <div className="flex flex-wrap gap-2">
            {library.entries.map((entry) => (
              <div key={entry.id} className="relative">
                <PixelChip
                  active={activeId === entry.id && config.themeId === 'custom'}
                  onClick={() => patch({ themeId: 'custom', customTexture: entry })}
                  title={`主色 ${entry.palette.base} · 亮 ${entry.palette.light} · 暗 ${entry.palette.dark}`}
                  className="!pr-6"
                >
                  <span className="flex items-center gap-2">
                    <TextureSwatch image={entry.image} />
                    <span className="max-w-[120px] truncate">{entry.name}</span>
                  </span>
                </PixelChip>
                <button
                  type="button"
                  aria-label={`移除 ${entry.name}`}
                  onClick={() => {
                    if (activeId === entry.id) {
                      const rest = library.entries.filter((item) => item.id !== entry.id)
                      patch({ customTexture: rest[0] ?? null, themeId: rest[0] ? 'custom' : config.themeId })
                    }
                    library.remove(entry.id)
                  }}
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 border-2 border-black bg-ink-500 text-[10px] leading-none text-ink-100"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </Field>
      ) : null}

      {active ? (
        <>
          <Field
            label="底纹怎么用这张贴图"
            hint="「九宫格」是 MC 基岩版 GUI 贴图的做法：四角原样、边框只沿一个方向拉伸、只有中间被拉开 —— 边框细节不会变形。带边框的方块贴图首选这个。"
          >
            <ChipRow>
              <PixelChip
                active={config.textureFillMode === 'nine-slice'}
                onClick={() => patch({ textureFillMode: 'nine-slice' })}
              >
                九宫格拉伸（推荐）
              </PixelChip>
              <PixelChip
                active={config.textureFillMode === 'stretch'}
                onClick={() => patch({ textureFillMode: 'stretch' })}
              >
                整张拉伸
              </PixelChip>
              <PixelChip
                active={config.textureFillMode === 'tile'}
                onClick={() => patch({ textureFillMode: 'tile' })}
              >
                平铺成方块墙
              </PixelChip>
              <PixelChip
                active={config.textureFillMode === 'palette'}
                onClick={() => patch({ textureFillMode: 'palette' })}
              >
                只取配色
              </PixelChip>
            </ChipRow>
          </Field>

          {config.textureFillMode === 'nine-slice' ? (
            <PixelSlider
              label="九宫格边框"
              value={config.textureSlice}
              min={0}
              max={8}
              step={1}
              valueText={`${config.textureSlice} 像素`}
              onChange={(value) => patch({ textureSlice: value })}
              hint="贴图四边有多少像素保持不变形；带边框的贴图调成边框的实际厚度，0 = 退化成整张拉伸"
            />
          ) : null}

          {config.textureFillMode === 'tile' ? (
            <PixelSlider
              label="方块大小"
              value={config.textureTexelScale}
              min={1}
              max={16}
              step={1}
              valueText={`1 纹理像素 = ${config.textureTexelScale} 格`}
              onChange={(value) => patch({ textureTexelScale: value })}
              hint="数值越大方块越大、重复越少"
            />
          ) : null}

          <Field label="程序提取的配色" hint={`平均亮度 ${(active.palette.luminance * 100).toFixed(0)}% · 文字色和描边色是按对比度自动选的`}>
            <div className="space-y-2">
              <div
                className="h-6 border-2 border-black"
                style={{ background: paletteToCssGradient(active.palette) }}
              />
              <dl className="grid grid-cols-2 gap-1.5 font-sans text-[11px] text-ink-200 sm:grid-cols-3">
                {[
                  ['主色 base', active.palette.base],
                  ['亮部 light', active.palette.light],
                  ['暗部 dark', active.palette.dark],
                  ['强调 accent', active.palette.accent],
                  ['平均 average', active.palette.average],
                  ['文字 fill', resolveTheme(config).text.fill],
                  ['描边 shadow', resolveTheme(config).text.shadow ?? '—'],
                ].map(([label, color]) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="block h-3 w-3 border border-black" style={{ backgroundColor: color }} />
                    <span className="text-ink-300">{label}</span>
                    <code className="font-mono text-[10px] text-ink-100">{color}</code>
                  </div>
                ))}
              </dl>
            </div>
          </Field>

          <div className="flex flex-wrap gap-2">
            <PixelButton
              variant="ghost"
              onClick={() => patch({ themeId: 'custom' })}
              disabled={config.themeId === 'custom'}
            >
              应用这张贴图
            </PixelButton>
            <PixelButton
              variant="ghost"
              onClick={() => {
                library.clear()
                patch({ customTexture: null, themeId: 'deepslate' })
              }}
            >
              清空贴图库
            </PixelButton>
          </div>
        </>
      ) : null}
    </div>
  )
}

/** 贴图小样：按整数倍放大原始像素，保持硬边 */
function TextureSwatch({ image, size = 16 }: { image: RgbaImage; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const scale = Math.max(1, Math.floor(size / Math.max(image.width, image.height)))
    canvas.width = image.width * scale
    canvas.height = image.height * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(rgbaToCanvas(image), 0, 0, canvas.width, canvas.height)
  }, [image, size])
  return (
    <canvas
      ref={ref}
      className="pixelated block border-2 border-black"
      style={{ width: size, height: size }}
    />
  )
}

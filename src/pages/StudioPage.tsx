import { useEffect, useState } from 'react'
import { canRenderSkin } from '../features/nameplate/renderer'
import { AppearanceControls } from '../features/nameplate/components/AppearanceControls'
import { ExportControls } from '../features/nameplate/components/ExportControls'
import { IdField } from '../features/nameplate/components/IdField'
import { NameplatePreview } from '../features/nameplate/components/NameplatePreview'
import { RatioControls } from '../features/nameplate/components/RatioControls'
import { SkinUploader } from '../features/nameplate/components/SkinUploader'
import { Panel } from '../components/pixel'
import { useImagePaste } from '../hooks/useImagePaste'
import { useNameplateConfig } from '../hooks/useNameplateConfig'
import { useNameplateRenderer } from '../hooks/useNameplateRenderer'
import { useSkinUpload } from '../hooks/useSkinUpload'

export function StudioPage() {
  const { skin, loading, error, loadFile, clear } = useSkinUpload()
  const { config, patch, reset } = useNameplateConfig()
  const { canvasRef, result, webFontsReady } = useNameplateRenderer(skin, config)
  const [revision, setRevision] = useState(0)

  useImagePaste(loadFile)

  // 每次重绘完成后通知导出区重新估算文件体积
  useEffect(() => {
    setRevision((value) => value + 1)
  }, [result])

  const hasSkin = canRenderSkin(skin)
  const canExport = hasSkin && config.id.trim().length > 0

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,430px)]">
      <div className="space-y-5 lg:sticky lg:top-5 lg:self-start">
        <Panel
          title="名牌预览"
          aside={
            <span className="mc-label text-[12px] text-ink-300">
              {result?.placeholderId ? '占位文字' : '所见即所得'}
            </span>
          }
        >
          <NameplatePreview
            canvasRef={canvasRef}
            result={result}
            config={config}
            hasSkin={hasSkin}
            webFontsReady={webFontsReady}
          />
        </Panel>

        <Panel title="导出">
          <ExportControls
            canvasRef={canvasRef}
            config={config}
            patch={patch}
            disabled={!canExport}
            onReset={reset}
            revision={revision}
          />
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel title="1 · 上传皮肤">
          <SkinUploader
            skin={skin}
            loading={loading}
            error={error}
            onFile={loadFile}
            onClear={clear}
          />
        </Panel>

        <Panel title="2 · 填写 ID">
          <IdField value={config.id} onChange={(id) => patch({ id })} />
        </Panel>

        <Panel title="3 · 版式与比例">
          <RatioControls config={config} patch={patch} />
        </Panel>

        <Panel title="4 · 外观">
          <AppearanceControls config={config} patch={patch} />
        </Panel>
      </div>
    </div>
  )
}

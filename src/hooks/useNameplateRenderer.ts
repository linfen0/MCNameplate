import { useEffect, useRef, useState, type RefObject } from 'react'
import { ensureWebFonts } from '../lib/pixelFont'
import type { ParsedSkin } from '../lib/types'
import type { NameplateConfig } from '../features/nameplate/config'
import { ensureHead3D } from '../features/nameplate/draw/head3d'
import { renderNameplate, type RenderResult } from '../features/nameplate/renderer'

export interface NameplateRendererState {
  canvasRef: RefObject<HTMLCanvasElement | null>
  result: RenderResult | null
  /** 网页文字用的 webfont 是否可用（canvas 文字已不依赖字体文件，失败不影响导出） */
  webFontsReady: boolean
}

/**
 * 把 canvas 与 (皮肤, 配置) 绑定：配置变化时重绘。
 * 用 setTimeout 做轻量防抖，避免拖动滑杆时在大画布上反复重绘。
 */
export function useNameplateRenderer(
  skin: ParsedSkin | null,
  config: NameplateConfig,
): NameplateRendererState {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [result, setResult] = useState<RenderResult | null>(null)
  const [webFontsReady, setWebFontsReady] = useState(false)
  const [head3dReady, setHead3dReady] = useState(false)

  useEffect(() => {
    let alive = true
    // 只影响网页文字观感；名牌上的 ID 走内置点阵字库，不依赖它
    ensureWebFonts()
      .catch(() => false)
      .then((ok) => {
        if (alive) setWebFontsReady(ok)
      })
    // three.js 体积较大，首屏之后再后台拉取
    ensureHead3D()
      .catch(() => false)
      .then((ok) => {
        if (alive && ok) setHead3dReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    const handle = window.setTimeout(() => {
      if (cancelled) return
      try {
        const rendered = renderNameplate(canvas, skin, config)
        // 便于 e2e / 调试确认头像实际走的哪条渲染路径
        canvas.dataset.renderMode = rendered.hasSkin ? (rendered.head3d ? '3d' : '2d') : 'none'
        setResult(rendered)
      } catch (cause) {
        console.error('[nameplate] 渲染失败', cause)
      }
    }, 24)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [head3dReady, skin, config])

  return { canvasRef, result, webFontsReady }
}

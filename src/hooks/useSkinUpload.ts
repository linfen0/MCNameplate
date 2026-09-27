import { useCallback, useState } from 'react'
import { fileToRgbaImage } from '../lib/imageIo'
import { parseSkin } from '../lib/skin'
import type { ParsedSkin } from '../lib/types'

export interface SkinUploadState {
  skin: ParsedSkin | null
  loading: boolean
  /** 读取文件本身的失败（尺寸问题在 skin.issues 里） */
  error: string | null
  loadFile: (file: File) => Promise<void>
  clear: () => void
}

/** 皮肤上传：File → RgbaImage → ParsedSkin */
export function useSkinUpload(): SkinUploadState {
  const [skin, setSkin] = useState<ParsedSkin | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadFile = useCallback(async (file: File) => {
    setLoading(true)
    setError(null)
    try {
      const isPng = file.type === 'image/png' || /\.png$/i.test(file.name)
      if (!file.type.startsWith('image/') && !isPng) {
        throw new Error('请上传 PNG 图片文件')
      }
      const image = await fileToRgbaImage(file)
      setSkin(parseSkin(image, file.name))
    } catch (cause) {
      setSkin(null)
      setError(cause instanceof Error ? cause.message : '皮肤读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => {
    setSkin(null)
    setError(null)
  }, [])

  return { skin, loading, error, loadFile, clear }
}

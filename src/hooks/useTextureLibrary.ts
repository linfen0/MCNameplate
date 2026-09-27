import { useCallback, useState } from 'react'
import { fileToRgbaImage } from '../lib/imageIo'
import { extractPalette } from '../lib/palette'
import type { CustomTexture } from '../features/nameplate/theme'

export interface TextureLibraryState {
  /** 已上传的方块贴图（可多张，点选切换） */
  entries: CustomTexture[]
  loading: boolean
  error: string | null
  addFiles: (files: File[]) => Promise<CustomTexture[]>
  remove: (id: string) => void
  clear: () => void
}

/** 贴图库：一次可以拖入多张方块贴图（原版或 Mod），逐张算好配色 */
export function useTextureLibrary(): TextureLibraryState {
  const [entries, setEntries] = useState<CustomTexture[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addFiles = useCallback(async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (images.length === 0) return []
    setLoading(true)
    setError(null)
    const added: CustomTexture[] = []
    try {
      for (const file of images) {
        const image = await fileToRgbaImage(file)
        if (image.width < 2 || image.height < 2 || image.width * image.height > 1024 * 1024) {
          setError(`「${file.name}」尺寸不合适（需要 2px 以上、总量不超过 1M 像素的贴图）`)
          continue
        }
        added.push({
          id: `${file.name}-${image.width}x${image.height}-${Date.now()}-${added.length}`,
          name: file.name.replace(/\.(png|jpg|jpeg|webp)$/i, ''),
          image,
          palette: extractPalette(image),
        })
      }
      if (added.length > 0) setEntries((current) => [...current, ...added])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '贴图读取失败')
    } finally {
      setLoading(false)
    }
    return added
  }, [])

  const remove = useCallback((id: string) => {
    setEntries((current) => current.filter((entry) => entry.id !== id))
  }, [])

  const clear = useCallback(() => setEntries([]), [])

  return { entries, loading, error, addFiles, remove, clear }
}

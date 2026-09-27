import { useEffect } from 'react'

/** 监听全局粘贴事件：用户可以直接 Ctrl/⌘+V 粘贴皮肤图片 */
export function useImagePaste(onImage: (file: File) => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (file) {
          event.preventDefault()
          onImage(file)
          return
        }
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [onImage, enabled])
}

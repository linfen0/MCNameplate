import { useCallback, useMemo, useState } from 'react'
import { DEFAULT_CONFIG, normalizeConfig, type NameplateConfig } from '../features/nameplate/config'

/** 名牌配置状态：提供整体更新与局部 patch */
export function useNameplateConfig(initial: Partial<NameplateConfig> = {}) {
  const [config, setConfig] = useState<NameplateConfig>(() => normalizeConfig(initial))

  const patch = useCallback((changes: Partial<NameplateConfig>) => {
    setConfig((current) => {
      const next = { ...current, ...changes }
      return isSameConfig(current, next) ? current : next
    })
  }, [])

  const reset = useCallback(() => setConfig(normalizeConfig({ id: config.id })), [config.id])

  return useMemo(() => ({ config, patch, reset }), [config, patch, reset])
}

function isSameConfig(a: NameplateConfig, b: NameplateConfig): boolean {
  const keys = Object.keys(a) as Array<keyof NameplateConfig>
  return keys.every((key) => a[key] === b[key])
}

export { DEFAULT_CONFIG }

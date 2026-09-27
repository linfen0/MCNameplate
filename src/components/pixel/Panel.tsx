import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface PanelProps {
  title?: string
  /** 标题右侧的说明 / 操作 */
  aside?: ReactNode
  children: ReactNode
  className?: string
}

export function Panel({ title, aside, children, className }: PanelProps) {
  return (
    <section className={cx('mc-panel p-4', className)}>
      {title ? (
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="mc-title text-[15px] text-grass-400">{title}</h2>
          {aside}
        </header>
      ) : null}
      {children}
    </section>
  )
}

export interface FieldProps {
  label: string
  hint?: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}

export function Field({ label, hint, aside, children, className }: FieldProps) {
  return (
    <div className={cx('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="mc-label">{label}</span>
        {aside}
      </div>
      {children}
      {hint ? <p className="font-sans text-xs leading-relaxed text-ink-300">{hint}</p> : null}
    </div>
  )
}

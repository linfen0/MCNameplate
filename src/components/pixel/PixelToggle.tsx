import { cx } from '../../lib/cx'

export interface PixelToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}

export function PixelToggle({ checked, onChange, label, hint, disabled = false }: PixelToggleProps) {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-center gap-3 select-none',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="mc-toggle" data-on={checked ? 'true' : 'false'} aria-hidden="true" />
      <span className="min-w-0">
        <span className="mc-label block">{label}</span>
        {hint ? <span className="mt-0.5 block font-sans text-xs text-ink-300">{hint}</span> : null}
      </span>
    </label>
  )
}

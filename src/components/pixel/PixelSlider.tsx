import { cx } from '../../lib/cx'

export interface PixelSliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  /** 右侧数值展示 */
  valueText?: string
  hint?: string
  className?: string
}

export function PixelSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  valueText,
  hint,
  className,
}: PixelSliderProps) {
  return (
    <div className={cx('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="mc-label">{label}</span>
        {valueText ? <span className="mc-label text-grass-400">{valueText}</span> : null}
      </div>
      <input
        className="mc-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint ? <p className="font-sans text-xs text-ink-300">{hint}</p> : null}
    </div>
  )
}

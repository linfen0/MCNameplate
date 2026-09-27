import type { ButtonHTMLAttributes } from 'react'
import { cx } from '../../lib/cx'

type Variant = 'default' | 'primary' | 'ghost'

export interface PixelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  block?: boolean
}

const VARIANT_CLASS: Record<Variant, string> = {
  default: '',
  primary: 'mc-btn-primary',
  ghost: 'mc-btn-ghost',
}

export function PixelButton({
  variant = 'default',
  block = false,
  className,
  type = 'button',
  ...rest
}: PixelButtonProps) {
  return (
    <button
      type={type}
      className={cx('mc-btn', VARIANT_CLASS[variant], block && 'w-full', className)}
      {...rest}
    />
  )
}

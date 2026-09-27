import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface PixelChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

export function PixelChip({ active = false, className, type = 'button', ...rest }: PixelChipProps) {
  return <button type={type} data-active={active ? 'true' : 'false'} className={cx('mc-chip', className)} {...rest} />
}

export function ChipRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex flex-wrap gap-2', className)}>{children}</div>
}

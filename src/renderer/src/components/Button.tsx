import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

type Variant = 'primary' | 'play' | 'secondary' | 'ghost' | 'danger'

const variants: Record<Variant, string> = {
  primary: 'bg-blue text-white hover:bg-blue-strong',
  play: 'bg-orange text-white hover:brightness-110',
  secondary: 'bg-surface-2 text-fg border border-line hover:border-faint',
  ghost: 'text-muted hover:text-fg hover:bg-white/5',
  danger: 'text-danger hover:bg-danger/10'
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  icon?: ReactNode
  busy?: boolean
  size?: 'sm' | 'md'
}

export function Button({ variant = 'secondary', icon, busy, size = 'md', className = '', children, disabled, ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-50 ${
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm'
      } ${variants[variant]} ${className}`}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

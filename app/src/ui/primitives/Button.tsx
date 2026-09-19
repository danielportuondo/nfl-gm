import type { ButtonHTMLAttributes } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  /** Shown instead of children while an async action is in flight (e.g. "Simming…"). No spinner. */
  busy?: boolean
  busyLabel?: string
}

/** Buttons say what happens: a verb, sentence case (docs/DESIGN.md §8, §9). */
export function Button({
  variant = 'secondary',
  busy,
  busyLabel,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const classes = ['gg-button', `gg-button--${variant}`]
  if (className) classes.push(className)
  return (
    <button className={classes.join(' ')} disabled={disabled || busy} {...rest}>
      {busy ? (busyLabel ?? 'Working…') : children}
    </button>
  )
}

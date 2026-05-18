import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-brand text-white hover:bg-brand-hover disabled:bg-brand/50 disabled:text-white/70',
  secondary:
    'bg-surface text-fg border border-border hover:bg-surface-hover hover:border-border-strong disabled:text-fg-disabled',
  ghost:
    'bg-transparent text-fg-muted hover:bg-surface-hover hover:text-fg disabled:text-fg-disabled',
  danger:
    'bg-neg text-white hover:bg-neg/90 disabled:bg-neg/50',
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-body',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded font-medium',
        'transition-colors duration-fast ease-precise',
        'disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  );
});

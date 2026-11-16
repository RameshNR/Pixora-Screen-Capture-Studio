import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Spinner } from './Progress';
import { Tooltip } from './Tooltip';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'recording';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={[styles.button, styles[variant], styles[size], block ? styles.block : '', className ?? ''].join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === 'lg' ? 18 : 14} /> : icon}
      {children !== undefined && <span className={styles.label}>{children}</span>}
    </button>
  );
});

export const PrimaryButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'variant'>>(function PrimaryButton(props, ref) {
  return <Button ref={ref} variant="primary" {...props} />;
});

export const SecondaryButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'variant'>>(function SecondaryButton(props, ref) {
  return <Button ref={ref} variant="secondary" {...props} />;
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'default' | 'dark' | 'danger';
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  shortcut?: string;
  badge?: ReactNode;
}

/** Icon-only button. Always has an accessible label and a tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, active, size = 'md', tone = 'default', tooltipSide = 'bottom', shortcut, badge, className, type = 'button', ...rest },
  ref,
) {
  return (
    <Tooltip content={shortcut ? `${label}  ·  ${shortcut}` : label} side={tooltipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        className={[styles.iconButton, styles[`icon-${size}`], styles[`tone-${tone}`], active ? styles.active : '', className ?? ''].join(' ')}
        {...rest}
      >
        {icon}
        {badge !== undefined && <span className={styles.badge}>{badge}</span>}
      </button>
    </Tooltip>
  );
});

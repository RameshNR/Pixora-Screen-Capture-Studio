import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import styles from './Dropdown.module.css';
import { formatKeys } from '@/shared/utils/keys';

export interface MenuItem {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  separatorBefore?: boolean;
  onSelect?: () => void;
}

interface MenuProps {
  items: MenuItem[];
  anchor: { x: number; y: number; width?: number; placement?: 'below' | 'above' };
  onClose: () => void;
  minWidth?: number;
  ariaLabel?: string;
}

/** Floating menu with keyboard navigation. Used by Dropdown, Select and ContextMenu. */
export function Menu({ items, anchor, onClose, minWidth = 180, ariaLabel }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => Math.max(0, items.findIndex((i) => i.checked && !i.disabled)));
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = anchor.x;
    let top = anchor.placement === 'above' ? anchor.y - r.height - 6 : anchor.y;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - r.width - 8);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, anchor.y - r.height - 6);
    setPos({ left, top });
    el.focus();
  }, [anchor.x, anchor.y, anchor.placement]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onBlur = () => onClose();
    // Scrolling inside the menu scrolls its list; scrolling anywhere else closes it (the anchor moved).
    const onWheel = (e: WheelEvent) => {
      if (ref.current && ref.current.contains(e.target as Node)) return;
      onClose();
    };
    // pointerdown too: pages that cancel pointerdown (the editor canvas) never send mousedown.
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    };
  }, [onClose]);

  const move = (dir: 1 | -1) => {
    if (!items.some((i) => !i.disabled)) return;
    let i = active;
    do {
      i = (i + dir + items.length) % items.length;
    } while (items[i]?.disabled);
    setActive(i);
  };

  const choose = (item: MenuItem | undefined) => {
    if (!item || item.disabled) return;
    item.onSelect?.();
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={ariaLabel}
      tabIndex={-1}
      className={styles.menu}
      style={{ left: pos.left, top: pos.top, minWidth: Math.max(minWidth, anchor.width ?? 0) }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(items[active]); }
        else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); }
      }}
    >
      {items.map((item, i) => (
        <div key={item.id}>
          {item.separatorBefore && <div className={styles.separator} role="separator" />}
          <button
            type="button"
            role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={item.checked}
            disabled={item.disabled}
            className={`${styles.item} ${i === active ? styles.itemActive : ''} ${item.danger ? styles.danger : ''}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(item)}
          >
            {item.icon && <span className={styles.icon}>{item.icon}</span>}
            <span className={styles.text}>
              <span>{item.label}</span>
              {item.description && <span className={styles.desc}>{typeof item.description === 'string' ? formatKeys(item.description) : item.description}</span>}
            </span>
            {item.checked && <Check size={15} className={styles.check} />}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

interface DropdownProps {
  trigger: (props: { open: boolean; toggle: (e: React.MouseEvent<HTMLElement>) => void }) => ReactNode;
  items: MenuItem[];
  placement?: 'below' | 'above';
  align?: 'start' | 'end';
  minWidth?: number;
  ariaLabel?: string;
}

export function Dropdown({ trigger, items, placement = 'below', align = 'start', minWidth, ariaLabel }: DropdownProps) {
  const [anchor, setAnchor] = useState<MenuProps['anchor'] | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const toggle = (e: React.MouseEvent<HTMLElement>) => {
    if (anchor) return close();
    const r = e.currentTarget.getBoundingClientRect();
    const width = minWidth ?? 180;
    setAnchor({
      x: align === 'end' ? Math.max(8, r.right - Math.max(width, r.width)) : r.left,
      y: placement === 'above' ? r.top : r.bottom + 6,
      width: r.width,
      placement,
    });
  };
  return (
    <>
      {trigger({ open: anchor !== null, toggle })}
      {anchor && <Menu items={items} anchor={anchor} onClose={close} minWidth={minWidth} ariaLabel={ariaLabel} />}
    </>
  );
}

export interface SelectOption<T extends string | number> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

interface SelectProps<T extends string | number> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  label: string;
  variant?: 'field' | 'inline' | 'dark';
  icon?: ReactNode;
  placement?: 'below' | 'above';
  minWidth?: number;
  disabled?: boolean;
  renderValue?: (option: SelectOption<T> | undefined) => ReactNode;
}

/** Accessible custom select built on Menu. `inline` is the compact popup-toolbar style. */
export function Select<T extends string | number>({
  value, options, onChange, label, variant = 'field', icon, placement, minWidth, disabled, renderValue,
}: SelectProps<T>) {
  const current = options.find((o) => o.value === value);
  return (
    <Dropdown
      placement={placement}
      minWidth={minWidth}
      ariaLabel={label}
      items={options.map((o) => ({
        id: String(o.value),
        label: o.label,
        description: o.description,
        icon: o.icon,
        disabled: o.disabled,
        checked: o.value === value,
        onSelect: () => onChange(o.value),
      }))}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${label}: ${typeof current?.label === 'string' ? current.label : String(value)}`}
          disabled={disabled}
          className={`${styles.select} ${styles[variant]} ${open ? styles.open : ''}`}
          onClick={toggle}
        >
          {icon && <span className={styles.selectIcon}>{icon}</span>}
          <span className={styles.selectValue}>{renderValue ? renderValue(current) : current?.label ?? '—'}</span>
          <ChevronDown size={14} className={styles.chevron} />
        </button>
      )}
    />
  );
}

/** Context menu helper: call `open(e)` from onContextMenu. */
export function useContextMenu() {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    setAnchor({ x: e.clientX, y: e.clientY });
  };
  const close = useCallback(() => setAnchor(null), []);
  return { anchor, open, close };
}

export function ContextMenu({ anchor, items, onClose }: { anchor: { x: number; y: number } | null; items: MenuItem[]; onClose: () => void }) {
  if (!anchor) return null;
  return <Menu items={items} anchor={anchor} onClose={onClose} />;
}

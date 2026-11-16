import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Menu, type MenuItem } from './Dropdown';

/** Text fields keep Chrome's own menu (cut, copy, paste, spelling). */
export function wantsNativeMenu(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  return !!el.closest('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]), textarea, [contenteditable="true"], [contenteditable=""]');
}

/** A right click on a button that opens a menu opens that menu (instead of a context menu). */
export function openOwnDropdown(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const sel = 'button[aria-haspopup]:not([aria-haspopup="false"]), [role="button"][aria-haspopup]:not([aria-haspopup="false"])';
  // A split button (e.g. "Restore ▾"): a right click on any part of it opens its dropdown.
  const group = el?.closest?.('[data-has-menu]') as HTMLElement | null;
  const btn = (el?.closest?.(sel) ?? group?.querySelector(sel) ?? null) as HTMLElement | null;
  if (!btn || (btn as HTMLButtonElement).disabled || btn.getAttribute('aria-expanded') === 'true') return !!btn;
  btn.click();
  return true;
}

export type MenuSource = MenuItem[] | null | undefined | ((target: HTMLElement, e: MouseEvent) => MenuItem[] | null | undefined);

/**
 * Replaces Chrome's right-click menu on a page with Pixora's own: items depend on what was
 * clicked (`resolve`), buttons with a dropdown open that dropdown, text fields keep the native menu.
 * Parts of the page can show their own items first by calling `show(e, items)` from onContextMenu
 * (it marks the event as handled).
 */
export function usePageContextMenu(resolve: (target: HTMLElement, e: MouseEvent) => MenuItem[] | null | undefined, opts: { global?: boolean } = {}) {
  const global = opts.global ?? true;
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const close = useCallback(() => setState(null), []);

  const show = useCallback((e: { clientX: number; clientY: number; preventDefault: () => void; nativeEvent?: Event }, items: MenuItem[] | null | undefined) => {
    e.preventDefault();
    const native = (e.nativeEvent ?? e) as Event & { __pixoraMenu?: boolean };
    native.__pixoraMenu = true;
    const list = (items ?? []).filter(Boolean);
    setState(list.length ? { x: e.clientX, y: e.clientY, items: list } : null);
  }, []);

  /** React onContextMenu for a part of the page: its own items (text fields and dropdown buttons keep their behaviour). */
  const handle = useCallback((e: React.MouseEvent, items: MenuSource) => {
    // An inner part (e.g. the canvas) already showed its menu for this click.
    if ((e.nativeEvent as Event & { __pixoraMenu?: boolean }).__pixoraMenu) return;
    if (wantsNativeMenu(e.target)) return;
    if (openOwnDropdown(e.target)) {
      e.preventDefault();
      (e.nativeEvent as Event & { __pixoraMenu?: boolean }).__pixoraMenu = true;
      setState(null);
      return;
    }
    show(e, typeof items === 'function' ? items(e.target as HTMLElement, e.nativeEvent) : items);
  }, [show]);

  useEffect(() => {
    // Embedded parts (the editor inside the Flow Editor) only show menus for their own area.
    if (!global) return;
    const onMenu = (e: MouseEvent) => {
      if ((e as MouseEvent & { __pixoraMenu?: boolean }).__pixoraMenu) return;
      if (wantsNativeMenu(e.target)) return;
      e.preventDefault();
      if (openOwnDropdown(e.target)) {
        setState(null);
        return;
      }
      const items = resolve(e.target as HTMLElement, e);
      setState(items?.length ? { x: e.clientX, y: e.clientY, items } : null);
    };
    window.addEventListener('contextmenu', onMenu);
    return () => window.removeEventListener('contextmenu', onMenu);
  }, [resolve, global]);

  const element: ReactNode = state ? <Menu items={state.items} anchor={{ x: state.x, y: state.y }} onClose={close} minWidth={210} ariaLabel="Actions" /> : null;
  return { show, handle, close, element };
}

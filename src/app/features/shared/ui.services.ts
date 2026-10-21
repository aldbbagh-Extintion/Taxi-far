import { Injectable, signal } from '@angular/core';

/* ===== In-app confirm (replaces window.confirm) ===== */
export interface ConfirmOptions {
  title?: string;
  message: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
}
interface ConfirmRequest extends ConfirmOptions { resolve: (ok: boolean) => void; }

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly current = signal<ConfirmRequest | null>(null);

  ask(opts: ConfirmOptions | string): Promise<boolean> {
    const o = typeof opts === 'string' ? { message: opts } : opts;
    this.current()?.resolve(false);
    return new Promise<boolean>((resolve) => this.current.set({ ...o, resolve }));
  }

  close(ok: boolean): void {
    const c = this.current();
    this.current.set(null);
    c?.resolve(ok);
  }
}

/* ===== Lightweight toast ===== */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly message = signal('');
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(msg: string, ms = 2600): void {
    this.message.set(msg);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.message.set(''), ms);
  }
}

/* ===== Theme (auto / light / dark), persisted per device ===== */
export type ThemeMode = 'auto' | 'light' | 'dark';
const THEME_KEY = 'ui_theme_v1';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(this.load());

  constructor() { this.apply(this.mode()); }

  set(mode: ThemeMode): void {
    this.mode.set(mode);
    try { localStorage.setItem(THEME_KEY, mode); } catch { /* storage blocked: keep in memory */ }
    this.apply(mode);
  }

  private load(): ThemeMode {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === 'light' || v === 'dark' || v === 'auto') return v;
    } catch { /* ignore */ }
    return 'auto';
  }

  private apply(mode: ThemeMode): void {
    const el = document.documentElement;
    el.classList.toggle('theme-light', mode === 'light');
    el.classList.toggle('theme-dark', mode === 'dark');
  }
}

/* ===== Small per-device UI flags (e.g. dismissed tips) ===== */
export const uiFlag = {
  get(key: string): boolean {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
  },
  set(key: string): void {
    try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
  },
};

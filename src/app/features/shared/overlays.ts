import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmService, ToastService } from './ui.services';

/** Host for the in-app confirm dialog and toast. Place once in app.html. */
@Component({
  selector: 'app-overlays',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (confirm.current(); as c) {
      <div class="backdrop" (click)="confirm.close(false)"></div>
      <div class="dialog" role="alertdialog" aria-modal="true" [attr.aria-label]="c.title || c.message">
        @if (c.title) { <h2>{{ c.title }}</h2> }
        <p>{{ c.message }}</p>
        <div class="actions">
          <button type="button" class="btn" [class.btn-danger]="c.danger" [class.btn-primary]="!c.danger"
                  (click)="confirm.close(true)">{{ c.okText || 'أكيد' }}</button>
          <button type="button" class="btn btn-ghost" (click)="confirm.close(false)">{{ c.cancelText || 'إلغاء' }}</button>
        </div>
      </div>
    }
    @if (toast.message()) {
      <div class="toast" role="status">{{ toast.message() }}</div>
    }
  `,
  styles: `
    .backdrop { position: fixed; inset: 0; z-index: 90; background: rgb(0 0 0 / .55); backdrop-filter: blur(2px); animation: fade .15s ease-out; }
    .dialog {
      position: fixed; z-index: 91; inset-inline: 1.25rem; top: 50%; transform: translateY(-50%);
      max-width: 420px; margin-inline: auto; background: var(--surface); color: var(--ink);
      border-radius: 1.5rem; padding: 1.5rem 1.25rem 1.25rem; box-shadow: 0 20px 40px rgb(0 0 0 / .25);
      animation: pop .18s ease-out;
    }
    h2 { margin: 0 0 .5rem; font-size: 1.15rem; font-weight: 700; }
    p { margin: 0 0 1.25rem; line-height: 1.8; color: var(--ink-2); }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
    .toast {
      position: fixed; z-index: 95; inset-inline: 1rem; bottom: calc(5.5rem + env(safe-area-inset-bottom));
      max-width: 420px; margin-inline: auto; background: #111; color: #fff; text-align: center;
      padding: .85rem 1rem; border-radius: 1rem; font-size: .9rem; box-shadow: 0 8px 24px rgb(0 0 0 / .3);
      animation: fade .2s ease-out;
    }
    @keyframes fade { from { opacity: 0 } }
    @keyframes pop { from { opacity: 0; transform: translateY(-46%) scale(.97) } }
  `,
})
export class Overlays {
  protected readonly confirm = inject(ConfirmService);
  protected readonly toast = inject(ToastService);
}

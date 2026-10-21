import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { FareRows, FareParts } from '../shared/fare-rows';

/** Bottom sheet "تفاصيل الأجرة" (fare_breakdown_popup_2). */
@Component({
  selector: 'app-fare-sheet',
  imports: [FareRows],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="scrim" (click)="closed.emit()"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="fs-title">
      <div class="grab" aria-hidden="true"></div>
      <h2 id="fs-title">تفاصيل الأجرة</h2>
      <app-fare-rows class="body" [parts]="parts()" [big]="true" />
      @if (live()) { <p class="muted note">الأرقام بتتحدّث كل ثانية والرحلة شغّالة.</p> }
      <button #closeBtn type="button" class="btn btn-primary close" (click)="closed.emit()">إغلاق</button>
    </section>
  `,
  styles: `
    .scrim { position: fixed; inset: 0; z-index: 80; background: rgb(0 0 0 / .55); backdrop-filter: blur(3px); animation: fade .2s ease-out; }
    .sheet {
      position: fixed; z-index: 81; inset-inline: 0; bottom: 0; max-width: 520px; margin-inline: auto;
      background: var(--bg); color: var(--ink); border-radius: 1.5rem 1.5rem 0 0;
      padding: .75rem 1.5rem calc(1.5rem + var(--safe-bottom)); box-shadow: 0 -20px 40px rgb(0 0 0 / .25);
      animation: up .25s cubic-bezier(.2,.8,.2,1);
    }
    .grab { width: 40px; height: 6px; border-radius: 999px; background: var(--line); margin: 0 auto 1.25rem; }
    h2 { text-align: center; font-size: 1.5rem; font-weight: 700; margin-bottom: 1.5rem; }
    .body { --ink-2: var(--subtle); }
    .note { margin-top: .75rem; text-align: center; font-size: .8rem; }
    .close { width: 100%; min-height: 56px; margin-top: 1.75rem; border-radius: 1rem; font-size: 1.125rem; }
    @keyframes up { from { transform: translateY(100%); } }
    @keyframes fade { from { opacity: 0; } }
  `,
})
export class FareSheet {
  readonly parts = input.required<FareParts>();
  readonly live = input(false);
  readonly closed = output<void>();
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');

  constructor() {
    effect(() => this.closeBtn()?.nativeElement.focus({ preventScroll: true }));
  }
}

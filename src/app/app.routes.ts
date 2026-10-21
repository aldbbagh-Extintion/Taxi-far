import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', title: 'عداد التاكسي',
    loadComponent: () => import('./features/meter/meter-page').then((m) => m.MeterPage) },
  { path: 'trip-result', title: 'اكتملت الرحلة',
    loadComponent: () => import('./features/trip-result/trip-result-page').then((m) => m.TripResultPage) },
  { path: 'history', title: 'السجل',
    loadComponent: () => import('./features/history/history-page').then((m) => m.HistoryPage) },
  { path: 'history/:id', title: 'تفاصيل الرحلة',
    loadComponent: () => import('./features/history/trip-detail-page').then((m) => m.TripDetailPage) },
  { path: 'settings', title: 'الإعدادات',
    loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage) },
  { path: '**', redirectTo: '' },
];

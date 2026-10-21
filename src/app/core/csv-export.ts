/* csv-export.ts — تصدير السجل CSV بنفس أعمدة وصيغة النسخة الأصلية */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { SavedTrip } from '../contracts';
import { jd } from './format';

export const CSV_EMPTY_MSG = 'ما في رحلات للتصدير.';

const HEAD = [
  'التاريخ',
  'الوقت',
  'الفترة',
  'المسافة (كم)',
  'المدة (دقيقة)',
  'الانتظار (دقيقة)',
  'التقدير (د.أ)',
  'قراءة العداد (د.أ)',
  'الفرق (د.أ)',
  'ملاحظة',
];

const q = (v: unknown): string => '"' + String(v ?? '').replace(/"/g, '""') + '"';

/** نص الملف كامل (مع BOM عشان Excel يقرأ العربي صح)، الرحلات مرتبة من الأقدم */
export function buildCsv(trips: SavedTrip[]): string {
  const arr = [...trips].sort((a, b) => a.start - b.start);
  const rows = arr.map((t) => {
    const d = new Date(t.start);
    return [
      d.toLocaleDateString('en-CA'),
      d.toTimeString().slice(0, 5),
      t.period === 'day' ? 'نهاري' : 'ليلي',
      t.distanceKm.toFixed(2),
      (t.durationSec / 60).toFixed(1),
      (t.waitingSec / 60).toFixed(1),
      jd(t.fare),
      t.meter ? jd(t.meter) : '',
      t.meter ? jd(t.meter - t.fare) : '',
      t.note,
    ]
      .map(q)
      .join(',');
  });
  return '﻿' + [HEAD.map(q).join(','), ...rows].join('\r\n');
}

export function csvFileName(now = new Date()): string {
  return 'taxi-trips-' + now.toISOString().slice(0, 10) + '.csv';
}

/** Android: يكتب الملف بالـ Cache ويفتح المشاركة. المتصفح: تنزيل.
 *  يرمي Error('ما في رحلات للتصدير.') إذا السجل فاضي. */
export async function exportCsv(trips: SavedTrip[]): Promise<void> {
  if (!trips.length) throw new Error(CSV_EMPTY_MSG);
  const csv = buildCsv(trips);
  const name = csvFileName();

  if (Capacitor.isNativePlatform()) {
    const res = await Filesystem.writeFile({
      path: name,
      data: csv,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    try {
      await Share.share({ title: 'سجل رحلات التاكسي', url: res.uri, dialogTitle: 'مشاركة السجل' });
    } catch (e) {
      // المستخدم سكّر نافذة المشاركة: مش خطأ
      const msg = String((e as Error)?.message ?? e);
      if (!/cancel/i.test(msg)) throw e;
    }
    return;
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

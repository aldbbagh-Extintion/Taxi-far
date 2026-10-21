import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { GpsFix, SavedTrip, Tariff } from '../contracts';
import * as ts from './fare-engine';
import { buildCsv } from './csv-export';
import { jd, mmss } from './format';
import { appendRoutePoint, downsampleRoute, RoutePoint } from './route';
import { TARIFF_INVALID_MSG, validateTariff } from './tariff';
import { verdict } from './verdict';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const orig: any = require('../../../design-ref/original-fare.js');

/* ---------- synthetic fix generators ---------- */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const AMMAN = { lat: 31.9539, lon: 35.9106 };
const M_PER_DEG_LAT = 111_320;
const mPerDegLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

type Seq = { name: string; startMs: number; fixes: GpsFix[]; endMs: number; tariff?: Tariff };

const dayStart = new Date(2026, 9, 21, 10, 0, 0).getTime();
const nightStart = new Date(2026, 9, 21, 22, 30, 0).getTime();

function moving(startMs: number, n: number, kmh: number, opts: { speed: boolean; seed: number; dtMs?: number; acc?: number }) {
  const rnd = lcg(opts.seed);
  const v = kmh / 3.6;
  const dtMs = opts.dtMs ?? 1000;
  const out: GpsFix[] = [];
  let north = 0;
  for (let i = 1; i <= n; i++) {
    north += v * (dtMs / 1000);
    const jn = (rnd() - 0.5) * 4,
      je = (rnd() - 0.5) * 4;
    out.push({
      lat: AMMAN.lat + (north + jn) / M_PER_DEG_LAT,
      lon: AMMAN.lon + je / mPerDegLon(AMMAN.lat),
      accuracy: opts.acc ?? 6 + rnd() * 6,
      speed: opts.speed ? v + (rnd() - 0.5) * 0.6 : null,
      ts: startMs + i * dtMs,
    });
  }
  return out;
}

function jitter(startMs: number, n: number, seed: number, dtMs = 2000, speed: number | null = null) {
  const rnd = lcg(seed);
  return Array.from({ length: n }, (_, i) => ({
    lat: AMMAN.lat + ((rnd() - 0.5) * 10) / M_PER_DEG_LAT,
    lon: AMMAN.lon + ((rnd() - 0.5) * 10) / mPerDegLon(AMMAN.lat),
    accuracy: 8 + rnd() * 10,
    speed,
    ts: startMs + (i + 1) * dtMs,
  }));
}

const shift = (fixes: GpsFix[], dLatM: number, dtMs: number): GpsFix[] =>
  fixes.map((f) => ({ ...f, lat: f.lat + dLatM / M_PER_DEG_LAT, ts: f.ts + dtMs }));

const last = (a: GpsFix[]) => a[a.length - 1];

function buildSequences(): Seq[] {
  const seqs: Seq[] = [];

  const mv = moving(dayStart, 300, 40, { speed: true, seed: 1 });
  seqs.push({ name: 'moving 40 km/h with Doppler speed', startMs: dayStart, fixes: mv, endMs: last(mv).ts + 2000 });

  const mvNoSpeed = moving(dayStart, 200, 40, { speed: false, seed: 2, dtMs: 3000 });
  seqs.push({ name: 'moving 40 km/h without speed (position method)', startMs: dayStart, fixes: mvNoSpeed, endMs: last(mvNoSpeed).ts });

  const jt = jitter(dayStart, 150, 3);
  seqs.push({ name: 'stationary jitter', startMs: dayStart, fixes: jt, endMs: last(jt).ts + 5000 });

  const jtSpeed = jitter(dayStart, 100, 4, 1000, 0.2);
  seqs.push({ name: 'stationary jitter with ~0 speed', startMs: dayStart, fixes: jtSpeed, endMs: last(jtSpeed).ts });

  // stop-and-go: move, wait (pending logic), move again
  const a = moving(dayStart, 60, 30, { speed: false, seed: 5, dtMs: 2000 });
  const b = shift(jitter(0, 30, 6, 2000), (60 * 2 * 30) / 3.6, last(a).ts);
  const c = shift(moving(0, 60, 30, { speed: false, seed: 7, dtMs: 2000 }), (60 * 2 * 30) / 3.6, last(b).ts);
  seqs.push({ name: 'stop and go (pending wait)', startMs: dayStart, fixes: [...a, ...b, ...c], endMs: last(c).ts });

  // GPS gap: 90 s silence while moving ~1 km
  const g1 = moving(dayStart, 60, 40, { speed: true, seed: 8 });
  const g2 = shift(moving(0, 60, 40, { speed: true, seed: 9 }), 60 * (40 / 3.6) + 1000, last(g1).ts + 90_000);
  seqs.push({ name: 'GPS gap', startMs: dayStart, fixes: [...g1, ...g2], endMs: last(g2).ts });

  // impossible jump + bad accuracy + out-of-order duplicates
  const j = moving(dayStart, 120, 35, { speed: true, seed: 10 });
  const bad: GpsFix[] = [
    { ...j[40], lat: j[40].lat + 0.05, ts: j[40].ts + 300 }, // ~5.5 km in 0.3 s
    { ...j[50], accuracy: 80, ts: j[50].ts + 300 }, // bad accuracy
    { ...j[60], ts: j[59].ts }, // duplicate ts
  ];
  const mixed = [...j, ...bad].sort((x, y) => x.ts - y.ts);
  seqs.push({ name: 'impossible jump / bad accuracy / dup ts', startMs: dayStart, fixes: mixed, endMs: last(j).ts });

  const nt = moving(nightStart, 400, 50, { speed: true, seed: 11 });
  seqs.push({ name: 'night period', startMs: nightStart, fixes: nt, endMs: last(nt).ts + 10_000 });

  const mf = moving(dayStart, 20, 20, { speed: true, seed: 12 });
  seqs.push({ name: 'min fare', startMs: dayStart, fixes: mf, endMs: last(mf).ts });

  seqs.push({ name: 'no fixes at all', startMs: dayStart, fixes: [], endMs: dayStart + 60_000 });

  const custom: Tariff = {
    version: 'custom',
    dayStartHour: 22,
    nightStartHour: 6, // wraps midnight
    day: { base: 0.5, perKm: 0.4, waitPer35s: 0.05 },
    night: { base: 0.6, perKm: 0.45, waitPer35s: 0.06 },
    minFare: 0,
  };
  const cu = moving(nightStart, 200, 25, { speed: true, seed: 13 });
  seqs.push({ name: 'custom wrapping tariff', startMs: nightStart, fixes: cu, endMs: last(cu).ts, tariff: custom });

  return seqs;
}

describe('fare engine equivalence with original-fare.js', () => {
  for (const seq of buildSequences()) {
    it(seq.name, () => {
      const tOrig = orig.createTrip(seq.startMs, seq.tariff);
      const tNew = ts.createTrip(seq.startMs, seq.tariff);
      const resO: string[] = [],
        resN: string[] = [];
      for (const f of seq.fixes) {
        resO.push(orig.addFix(tOrig, { ...f }));
        resN.push(ts.addFix(tNew, { ...f }));
      }
      expect(resN).toEqual(resO);
      // mid-trip and end summaries
      for (const now of [seq.startMs + 30_000, seq.endMs]) {
        expect(ts.summary(tNew, now)).toEqual(orig.summary(tOrig, now));
      }
      expect(ts.roundFils(ts.summary(tNew, seq.endMs).fare)).toBe(orig.roundFils(orig.summary(tOrig, seq.endMs).fare));
      // the engine state (minus the display-only lastKind) is identical
      const { lastKind: _lk, ...rest } = tNew;
      expect(JSON.parse(JSON.stringify(rest))).toEqual(JSON.parse(JSON.stringify(tOrig)));
    });
  }

  it('survives JSON round-trip mid-trip (persist + resume)', () => {
    const fixes = moving(dayStart, 200, 40, { speed: true, seed: 21 });
    const ref = ts.createTrip(dayStart);
    let t = ts.createTrip(dayStart);
    fixes.forEach((f, i) => {
      ts.addFix(ref, f);
      ts.addFix(t, f);
      if (i % 37 === 0) t = JSON.parse(JSON.stringify(t));
    });
    expect(ts.summary(t, last(fixes).ts)).toEqual(ts.summary(ref, last(fixes).ts));
  });

  it('sanity: 40 km/h for 300 s ≈ 3.33 km, night/day/min-fare flags', () => {
    const fixes = moving(dayStart, 300, 40, { speed: true, seed: 1 });
    const t = ts.createTrip(dayStart);
    fixes.forEach((f) => ts.addFix(t, f));
    const s = ts.summary(t, last(fixes).ts);
    expect(s.distanceKm).toBeGreaterThan(3.1);
    expect(s.distanceKm).toBeLessThan(3.5);
    expect(s.period).toBe('day');
    expect(ts.createTrip(nightStart).period).toBe('night');
    const short = ts.createTrip(dayStart);
    expect(ts.summary(short, dayStart + 10_000).minApplied).toBe(true);
    expect(ts.summary(short, dayStart + 10_000).fare).toBe(1);
  });

  it('constants match the original', () => {
    expect(JSON.parse(JSON.stringify(ts.DEFAULT_TARIFF))).toEqual(orig.DEFAULT_TARIFF);
    expect({ ...ts.GPS }).toEqual(orig.GPS);
    expect(ts.ratesOf(ts.DEFAULT_TARIFF.day)).toEqual(orig.ratesOf(orig.DEFAULT_TARIFF.day));
    expect(ts.haversineM(AMMAN, { lat: 32, lon: 36 })).toBe(orig.haversineM(AMMAN, { lat: 32, lon: 36 }));
  });
});

describe('lastSegmentKind', () => {
  it('is null before any segment, distance while moving, time while stationary', () => {
    const t = ts.createTrip(dayStart);
    expect(ts.lastSegmentKind(t)).toBeNull();
    const mv = moving(dayStart, 30, 40, { speed: true, seed: 31 });
    mv.forEach((f) => ts.addFix(t, f));
    expect(ts.lastSegmentKind(t)).toBe('distance');
    jitter(last(mv).ts, 10, 32, 1000, 0)
      .map((f) => ({ ...f, lat: mv[29].lat, lon: mv[29].lon }))
      .forEach((f) => ts.addFix(t, f));
    expect(ts.lastSegmentKind(t)).toBe('time');
  });
});

describe('verdict', () => {
  it('ok within max(0.10, 8%)', () => {
    const v = verdict(2.0, 2.15);
    expect(v.cls).toBe('ok');
    expect(v.short).toBe('منطقي');
    expect(v.text).toBe('العداد قريب من التقدير (فرق 0.150 د.أ، 7%). يبدو سليم.');
    expect(verdict(1.0, 1.09).cls).toBe('ok'); // tolerance floor 0.10
    expect(verdict(1.0, 0.91).cls).toBe('ok');
  });
  it('is identical to the original verdict() over a grid', () => {
    const html = readFileSync(new URL('../../../design-ref/original-index.html', import.meta.url), 'utf8');
    const src = html.match(/function verdict\(est, meter\)\{[\s\S]*?\n\}/)![0];
    const jdSrc = html.match(/const jd = [^\n]*/)![0];
    const origVerdict = new Function(`${jdSrc}\n${src}\nreturn verdict;`)() as typeof verdict;
    for (let est = 0; est <= 6; est += 0.37)
      for (let meter = 0.05; meter <= 7; meter += 0.113) expect(verdict(est, meter)).toEqual(origVerdict(est, meter));
  });
  it('bad when meter higher', () => {
    const v = verdict(2.0, 2.5);
    expect(v).toEqual({
      cls: 'bad',
      short: 'أعلى',
      text: 'العداد أعلى من التقدير بـ 0.500 د.أ (25%). ممكن يكون في مبالغة، أو الـ GPS قصّر بالمسافة.',
    });
  });
  it('warn when meter lower', () => {
    const v = verdict(3.0, 2.5);
    expect(v).toEqual({ cls: 'warn', short: 'أقل', text: 'العداد أقل من التقدير بـ 0.500 د.أ (-17%).' });
  });
  it('est = 0 gives pct 0', () => {
    expect(verdict(0, 1).text).toContain('(0%)');
  });
});

describe('format helpers', () => {
  it('jd / mmss', () => {
    expect(jd(1)).toBe('1.000');
    expect(jd(0.1235)).toBe('0.124');
    expect(mmss(65)).toBe('01:05');
    expect(mmss(3725)).toBe('1:02:05');
    expect(mmss(-3)).toBe('00:00');
  });
});

describe('validateTariff', () => {
  const good = (): Tariff => JSON.parse(JSON.stringify(ts.DEFAULT_TARIFF));
  it('accepts valid and marks custom', () => {
    expect(validateTariff(good()).version).toBe('custom');
  });
  it('rejects negatives, NaN, bad or equal hours', () => {
    const bad: Tariff[] = [];
    let t = good();
    t.day.base = -1;
    bad.push(t);
    t = good();
    t.night.perKm = NaN;
    bad.push(t);
    t = good();
    t.dayStartHour = 24;
    bad.push(t);
    t = good();
    t.nightStartHour = t.dayStartHour;
    bad.push(t);
    t = good();
    t.dayStartHour = 7.5;
    bad.push(t);
    for (const b of bad) expect(() => validateTariff(b)).toThrow(TARIFF_INVALID_MSG);
  });
});

describe('route helpers', () => {
  it('appends only after > 15 m and downsamples to <= 300', () => {
    const r: RoutePoint[] = [];
    expect(appendRoutePoint(r, 31.95, 35.91)).toBe(true);
    expect(appendRoutePoint(r, 31.95 + 10 / M_PER_DEG_LAT, 35.91)).toBe(false);
    expect(appendRoutePoint(r, 31.95 + 20 / M_PER_DEG_LAT, 35.91)).toBe(true);
    const big: RoutePoint[] = Array.from({ length: 1000 }, (_, i) => [i, i]);
    const d = downsampleRoute(big);
    expect(d.length).toBe(300);
    expect(d[0]).toEqual([0, 0]);
    expect(d[299]).toEqual([999, 999]);
  });
});

describe('buildCsv', () => {
  it('matches original format', () => {
    const start = new Date(2026, 9, 21, 9, 5).getTime();
    const trip = (over: Partial<SavedTrip>): SavedTrip => ({
      id: String(start), start, end: start + 600_000, period: 'day', distanceKm: 3.456, durationSec: 600,
      waitingSec: 90, base: 0.39, distCharge: 0.97, waitCharge: 0.072, fare: 1.432, minApplied: false,
      gapSec: 0, fixes: 300, tariff: '2026-05-11', rate: { base: 0.39, perKm: 0.28, waitPer35s: 0.028 },
      meter: null, note: '', route: [], ...over,
    });
    const csv = buildCsv([
      trip({ id: 'b', start: start + 3600_000, meter: 1.6, note: 'قال "تمام"', period: 'night' }),
      trip({ id: 'a' }),
    ]);
    const lines = csv.split('\r\n');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]).toBe(
      '﻿"التاريخ","الوقت","الفترة","المسافة (كم)","المدة (دقيقة)","الانتظار (دقيقة)","التقدير (د.أ)","قراءة العداد (د.أ)","الفرق (د.أ)","ملاحظة"',
    );
    expect(lines[1]).toBe('"2026-10-21","09:05","نهاري","3.46","10.0","1.5","1.432","","",""');
    expect(lines[2]).toBe('"2026-10-21","10:05","ليلي","3.46","10.0","1.5","1.432","1.600","0.168","قال ""تمام"""');
  });
});

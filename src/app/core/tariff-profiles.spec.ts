import '@angular/compiler';
import { Injector } from '@angular/core';
import { describe, expect, it } from 'vitest';
import {
  LOCATION_TRACKER,
  GpsFix,
  LocationTracker,
  ProfilesState,
  SavedTrip,
  Tariff,
  TariffProfile,
  TRIP_REPOSITORY,
  TripRepository,
} from '../contracts';
import { buildCsv } from './csv-export';
import * as eng from './fare-engine';
import { periodName } from './format';
import { TripSessionService } from './trip-session.service';

const dayStart = new Date(2026, 9, 21, 12, 0, 0).getTime();
const nightStart = new Date(2026, 9, 21, 23, 0, 0).getTime();

describe('loadProfiles', () => {
  it('defaults: three profiles, taxi active, mycar flat with min 1.00', () => {
    const s = eng.loadProfiles(null, null);
    expect(s.active).toBe('taxi');
    expect(Object.keys(s.profiles)).toEqual(['taxi', 'mycar', 'other']);
    expect(s.profiles.taxi.name).toBe('التاكسي الأصفر');
    expect(s.profiles.mycar.name).toBe('سيارتي');
    expect(s.profiles.other.name).toBe('أخرى');
    const my = s.profiles.mycar as { flat: unknown; minFare: number };
    expect(my.flat).toEqual(eng.DEFAULT_TARIFF.day);
    expect(my.minFare).toBe(1);
    expect('dayStartHour' in s.profiles.mycar).toBe(false);
  });

  it('old single tariff migrates into taxi only', () => {
    const old: Tariff = { ...JSON.parse(JSON.stringify(eng.DEFAULT_TARIFF)), version: 'custom', minFare: 2 };
    old.day.base = 0.5;
    const s = eng.loadProfiles(null, old);
    expect((s.profiles.taxi as Tariff).day.base).toBe(0.5);
    expect(s.profiles.taxi.minFare).toBe(2);
    expect(s.profiles.other).toEqual(eng.defaultProfiles().other);
    expect(s.active).toBe('taxi');
  });

  it('valid v3 wins over the old tariff; active kept', () => {
    const base = eng.defaultProfiles();
    base.mycar = { ...base.mycar, minFare: 3 } as TariffProfile;
    const old = { ...JSON.parse(JSON.stringify(eng.DEFAULT_TARIFF)), minFare: 9 };
    const s = eng.loadProfiles({ active: 'mycar', profiles: base }, old);
    expect(s.active).toBe('mycar');
    expect(s.profiles.mycar.minFare).toBe(3);
    expect(s.profiles.taxi.minFare).toBe(1); // not the old 9
  });

  it('invalid profile falls back to that profile defaults only', () => {
    const base = eng.defaultProfiles();
    base.other = { ...base.other, minFare: -5 } as TariffProfile;
    base.mycar = { ...base.mycar, minFare: 4 } as TariffProfile;
    const s = eng.loadProfiles({ active: 'bogus', profiles: base }, null);
    expect(s.profiles.other).toEqual(eng.defaultProfiles().other);
    expect(s.profiles.mycar.minFare).toBe(4);
    expect(s.active).toBe('taxi');
  });

  it('garbage input gives defaults', () => {
    expect(eng.loadProfiles('x', 5)).toEqual(eng.loadProfiles(null, null));
    expect(eng.loadProfiles({ profiles: { taxi: { minFare: 1 } } }, null)).toEqual(eng.loadProfiles(null, null));
  });
});

describe('flat period', () => {
  const my = eng.defaultProfiles().mycar;
  it('periodFor returns flat at any hour', () => {
    expect(eng.periodFor(new Date(dayStart), my as never)).toBe('flat');
    expect(eng.periodFor(new Date(nightStart), my as never)).toBe('flat');
  });
  it('createTrip uses the flat rate and stores profile id/name', () => {
    for (const ms of [dayStart, nightStart]) {
      const t = eng.createTrip(ms, my);
      expect(t.period).toBe('flat');
      expect(t.rate).toEqual(eng.DEFAULT_TARIFF.day);
      expect(t.tariffId).toBe('mycar');
      expect(t.tariffName).toBe('سيارتي');
    }
    const night = eng.createTrip(nightStart, eng.defaultProfiles().taxi);
    expect(night.period).toBe('night');
    expect(night.tariffId).toBe('taxi');
  });
  it('periodName label for flat', () => {
    expect(periodName('flat')).toBe('تعرفة واحدة');
  });
});

describe('raw fare at t=0 (live meter starts at flag-fall)', () => {
  it('summary.raw = base while fare = min fare', () => {
    const s = eng.summary(eng.createTrip(dayStart, eng.defaultProfiles().taxi), dayStart);
    expect(s.raw).toBeCloseTo(0.39, 6);
    expect(s.fare).toBe(1);
    expect(s.minApplied).toBe(true);
  });
});

/* ===== real path: TripSessionService.start() -> createTrip with the active profile ===== */
class FakeRepo implements TripRepository {
  v3: unknown = null;
  old: Tariff | null = null;
  active: unknown = null;
  trips: SavedTrip[] = [];
  async init() {}
  async listTrips() { return this.trips; }
  async getTrip() { return null; }
  async saveTrip(t: SavedTrip) { this.trips.push(t); }
  async deleteTrip() {}
  async clearTrips() {}
  async getTariff() { return this.old; }
  async saveTariff() {}
  async getProfiles() { return this.v3; }
  async saveProfiles(s: ProfilesState) { this.v3 = JSON.parse(JSON.stringify(s)); }
  async getActiveTrip() { return this.active; }
  async saveActiveTrip(s: unknown) { this.active = s; }
}
class FakeTracker implements LocationTracker {
  isNative = false;
  notes: string[] = [];
  async checkPermissions() { return { location: 'granted', notifications: 'granted' } as const; }
  async requestPermissions() { return this.checkPermissions(); }
  async start() {}
  async stop() {}
  async isRunning() { return false; }
  onFix(_cb: (f: GpsFix) => void) { return () => {}; }
  onError() { return () => {}; }
  async drainBufferedFixes() { return []; }
  async updateNotification(_t: string, text: string) { this.notes.push(text); }
  async openBatterySettings() {}
}

function makeSession(repo: FakeRepo, tracker = new FakeTracker()) {
  const inj = Injector.create({
    providers: [
      { provide: TRIP_REPOSITORY, useValue: repo },
      { provide: LOCATION_TRACKER, useValue: tracker },
      { provide: TripSessionService, useClass: TripSessionService, deps: [] },
    ],
  });
  return { svc: inj.get(TripSessionService), tracker };
}

describe('TripSessionService (real createTrip path)', () => {
  it('setProfile activates + persists, trip uses active profile, live summary raw, saved keeps min fare', async () => {
    const repo = new FakeRepo();
    const { svc } = makeSession(repo);
    await svc.init();
    expect(svc.profiles().active).toBe('taxi');

    const my = { ...(eng.defaultProfiles().mycar as object), version: 'custom' } as TariffProfile;
    (my as { minFare: number }).minFare = 2;
    await svc.setProfile(my);
    expect(svc.tariff().id).toBe('mycar');
    expect((repo.v3 as ProfilesState).active).toBe('mycar');

    await svc.start();
    const s = svc.summary();
    expect(s).not.toBeNull();
    expect(s!.period).toBe('flat');
    expect(s!.raw).toBeCloseTo(0.39, 2);
    expect(s!.fare).toBe(2); // min applied only in fare, not raw
    const st = repo.active as { trip: { tariffId: string; tariffName: string } };
    expect(st.trip.tariffId).toBe('mycar');
    expect(st.trip.tariffName).toBe('سيارتي');

    await svc.stop();
    const p = svc.pending()!;
    expect(p.period).toBe('flat');
    expect(p.tariffId).toBe('mycar');
    expect(p.tariffName).toBe('سيارتي');
    expect(p.fare).toBe(2); // saved record keeps the min-applied fare
    expect(buildCsv([p]).split('\r\n')[1]).toContain('"واحدة","سيارتي"');
  });

  it('setProfile rejects bad values; resetProfile resets only that profile', async () => {
    const repo = new FakeRepo();
    const { svc } = makeSession(repo);
    await svc.init();
    const bad = { ...eng.defaultProfiles().mycar, minFare: -1 } as TariffProfile;
    await expect(svc.setProfile(bad)).rejects.toThrow();
    const other = { ...(eng.defaultProfiles().other as object) } as TariffProfile;
    (other as { minFare: number }).minFare = 3;
    await svc.setProfile(other);
    await svc.resetProfile('mycar');
    expect(svc.profiles().profiles.other.minFare).toBe(3);
    expect(svc.profiles().active).toBe('other');
  });

  it('legacy saved tariff migrates into taxi on init', async () => {
    const repo = new FakeRepo();
    repo.old = { ...JSON.parse(JSON.stringify(eng.DEFAULT_TARIFF)), version: 'custom', minFare: 1.5 };
    const { svc } = makeSession(repo);
    await svc.init();
    expect(svc.profiles().profiles.taxi.minFare).toBe(1.5);
  });
});

/* trip-repository.ts — قاعدة البيانات المحلية.
 * Android: SQLite (@capacitor-community/sqlite)
 * المتصفح (للتطوير): localStorage
 */
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { SavedTrip, Tariff, TripRepository } from '../contracts';

const DB_NAME = 'taxi_meter';
const SCHEMA_VERSION = 1;
const KV_TARIFF = 'tariff';
const KV_ACTIVE = 'active_trip';
const KV_SCHEMA = 'schema_version';

/** يكمّل الحقول الناقصة (رحلات قديمة بدون route مثلًا) */
function normalizeTrip(t: SavedTrip): SavedTrip {
  return {
    ...t,
    meter: t.meter ?? null,
    note: t.note ?? '',
    route: Array.isArray(t.route) ? t.route : [],
  };
}

const byNewest = (a: SavedTrip, b: SavedTrip) => b.start - a.start;

/* ===================== SQLite ===================== */
export class SqliteTripRepository implements TripRepository {
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db: SQLiteDBConnection | null = null;
  private initPromise: Promise<void> | null = null;

  init(): Promise<void> {
    return (this.initPromise ??= this.doInit().catch((e) => {
      this.initPromise = null;
      throw e;
    }));
  }

  private async doInit(): Promise<void> {
    const consistent = (await this.sqlite.checkConnectionsConsistency()).result;
    const exists = (await this.sqlite.isConnection(DB_NAME, false)).result;
    const db =
      consistent && exists
        ? await this.sqlite.retrieveConnection(DB_NAME, false)
        : await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', SCHEMA_VERSION, false);
    await db.open();
    await db.execute(
      `CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY NOT NULL, start INTEGER NOT NULL, data TEXT NOT NULL);
       CREATE INDEX IF NOT EXISTS idx_trips_start ON trips(start);
       CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT);`,
    );
    const cur = await this.kvGetRaw(db, KV_SCHEMA);
    if (cur !== String(SCHEMA_VERSION)) {
      // مستقبلًا: migrations حسب cur
      await db.run('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [KV_SCHEMA, String(SCHEMA_VERSION)]);
    }
    this.db = db;
  }

  private async conn(): Promise<SQLiteDBConnection> {
    if (!this.db) await this.init();
    return this.db as SQLiteDBConnection;
  }

  private async kvGetRaw(db: SQLiteDBConnection, key: string): Promise<string | null> {
    const r = await db.query('SELECT value FROM kv WHERE key = ?', [key]);
    const row = r.values?.[0] as { value?: string | null } | undefined;
    return row?.value ?? null;
  }

  private async kvGet<T>(key: string): Promise<T | null> {
    const raw = await this.kvGetRaw(await this.conn(), key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async kvSet(key: string, value: unknown | null): Promise<void> {
    const db = await this.conn();
    if (value == null) await db.run('DELETE FROM kv WHERE key = ?', [key]);
    else await db.run('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
  }

  async listTrips(): Promise<SavedTrip[]> {
    const db = await this.conn();
    const r = await db.query('SELECT data FROM trips ORDER BY start DESC');
    const out: SavedTrip[] = [];
    for (const row of (r.values ?? []) as { data: string }[]) {
      try {
        out.push(normalizeTrip(JSON.parse(row.data) as SavedTrip));
      } catch {
        /* صف تالف: بنتجاهله */
      }
    }
    return out.sort(byNewest);
  }

  async getTrip(id: string): Promise<SavedTrip | null> {
    const db = await this.conn();
    const r = await db.query('SELECT data FROM trips WHERE id = ?', [id]);
    const row = r.values?.[0] as { data?: string } | undefined;
    if (!row?.data) return null;
    try {
      return normalizeTrip(JSON.parse(row.data) as SavedTrip);
    } catch {
      return null;
    }
  }

  async saveTrip(trip: SavedTrip): Promise<void> {
    const db = await this.conn();
    await db.run('INSERT OR REPLACE INTO trips (id, start, data) VALUES (?, ?, ?)', [
      trip.id,
      trip.start,
      JSON.stringify(trip),
    ]);
  }

  async deleteTrip(id: string): Promise<void> {
    await (await this.conn()).run('DELETE FROM trips WHERE id = ?', [id]);
  }

  async clearTrips(): Promise<void> {
    await (await this.conn()).run('DELETE FROM trips', []);
  }

  getTariff(): Promise<Tariff | null> {
    return this.kvGet<Tariff>(KV_TARIFF);
  }
  saveTariff(t: Tariff | null): Promise<void> {
    return this.kvSet(KV_TARIFF, t);
  }
  getActiveTrip(): Promise<unknown | null> {
    return this.kvGet<unknown>(KV_ACTIVE);
  }
  saveActiveTrip(state: unknown | null): Promise<void> {
    return this.kvSet(KV_ACTIVE, state);
  }
}

/* ===================== localStorage (متصفح) ===================== */
const LS_TRIPS = 'taxi_trips_v2',
  LS_ACTIVE = 'taxi_active_v2',
  LS_TARIFF = 'taxi_tariff_v2';

const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown): void {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      throw new Error('ما قدرت أحفظ — مساحة التخزين ممتلئة أو محظورة.');
    }
  },
  del(k: string): void {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export class LocalStorageTripRepository implements TripRepository {
  async init(): Promise<void> {}

  private all(): SavedTrip[] {
    const arr = store.get<SavedTrip[]>(LS_TRIPS, []);
    return Array.isArray(arr) ? arr.map(normalizeTrip) : [];
  }

  async listTrips(): Promise<SavedTrip[]> {
    return this.all().sort(byNewest);
  }
  async getTrip(id: string): Promise<SavedTrip | null> {
    return this.all().find((t) => t.id === id) ?? null;
  }
  async saveTrip(trip: SavedTrip): Promise<void> {
    const arr = this.all().filter((t) => t.id !== trip.id);
    arr.push(trip);
    store.set(LS_TRIPS, arr);
  }
  async deleteTrip(id: string): Promise<void> {
    store.set(
      LS_TRIPS,
      this.all().filter((t) => t.id !== id),
    );
  }
  async clearTrips(): Promise<void> {
    store.del(LS_TRIPS);
  }
  async getTariff(): Promise<Tariff | null> {
    return store.get<Tariff | null>(LS_TARIFF, null);
  }
  async saveTariff(t: Tariff | null): Promise<void> {
    if (t == null) store.del(LS_TARIFF);
    else store.set(LS_TARIFF, t);
  }
  async getActiveTrip(): Promise<unknown | null> {
    return store.get<unknown | null>(LS_ACTIVE, null);
  }
  async saveActiveTrip(state: unknown | null): Promise<void> {
    if (state == null) store.del(LS_ACTIVE);
    else store.set(LS_ACTIVE, state);
  }
}

/** يختار التنفيذ المناسب حسب المنصة */
export function createTripRepository(): TripRepository {
  return Capacitor.isNativePlatform() ? new SqliteTripRepository() : new LocalStorageTripRepository();
}

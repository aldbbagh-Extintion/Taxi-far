/* core public API */
import { Provider } from '@angular/core';
import { TRIP_REPOSITORY, TRIP_SESSION } from '../contracts';
import { createTripRepository } from './trip-repository';
import { TripSessionService } from './trip-session.service';

/** يضيف قاعدة البيانات ومنسّق الرحلة. لازم الواجهة تنادي TRIP_SESSION.init() مرة عند الإقلاع (آمنة للتكرار). */
export function provideCore(): Provider[] {
  return [
    { provide: TRIP_REPOSITORY, useFactory: createTripRepository },
    TripSessionService,
    { provide: TRIP_SESSION, useExisting: TripSessionService },
  ];
}

export { TripSessionService } from './trip-session.service';
export { verdict } from './verdict';
export type { Verdict } from './verdict';
export { buildCsv, exportCsv, csvFileName, CSV_EMPTY_MSG } from './csv-export';
export {
  DEFAULT_TARIFF,
  cloneDefaultTariff,
  periodFor,
  ratesOf,
  roundFils,
} from './fare-engine';
export { jd, mmss, fmtDate, periodName, monthKey } from './format';
export { validateTariff, effectiveTariff, TARIFF_INVALID_MSG } from './tariff';
export { createTripRepository, SqliteTripRepository, LocalStorageTripRepository } from './trip-repository';

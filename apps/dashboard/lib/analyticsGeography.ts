import { FieldPath, Timestamp, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { AnalyticsCache, PRESENCE_WINDOW_MS, type Geography } from './analytics';

type RegistryUser = { country: string | null; lastSeen: number | null };
type Registry = { at: number; users: Map<string, RegistryUser> };
const registries = new WeakMap<Firestore, AnalyticsCache<Registry>>();
const names = new Intl.DisplayNames(['en'], { type: 'region' });

/** Never guess a country from shared calling codes, invalid numbers or public
 * user fields. Phone country describes registration, not physical location. */
export function registrationCountry(phone: unknown): string | null {
  if (typeof phone !== 'string' || !phone.startsWith('+')) return null;
  const parsed = parsePhoneNumberFromString(phone);
  return parsed?.isValid() && parsed.country ? parsed.country : null;
}
export function seenMillis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}
export function isFreshPresence(data: Record<string, unknown>, now: number) {
  const seen = seenMillis(data.lastSeen);
  return data.online === true && seen !== null && seen <= now && seen >= now - PRESENCE_WINDOW_MS;
}

/** Five-minute, process-local directory. Fetch ONLY phoneNumber from private
 * profiles, and presence from public users. Fully paginate or fail; no partial
 * directory may be presented as a global map. Never serialized or logged. */
export async function loadCountryRegistry(db: Firestore, now: number): Promise<Registry> {
  const users = new Map<string, RegistryUser>();
  let cursor: QueryDocumentSnapshot | undefined;
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('Country directory timed out');
    let query = db.collection('users').orderBy(FieldPath.documentId()).select('lastSeen').limit(500);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (!page.size) break;
    // Guard pathological scans without reporting truncated data as complete.
    if (users.size + page.size > 100_000) throw new Error('Country directory requires materialization');
    for (let i = 0; i < page.docs.length; i += 100) {
      const group = page.docs.slice(i, i + 100);
      const profiles = await db.getAll(...group.map(d => d.ref.collection('userPrivate').doc('profile')), { fieldMask: ['phoneNumber'] });
      group.forEach((d, j) => users.set(d.id, {
        country: registrationCountry(profiles[j].data()?.phoneNumber), lastSeen: seenMillis(d.data().lastSeen),
      }));
    }
    cursor = page.docs[page.docs.length - 1];
    if (page.size < 500) break;
  }
  return { at: now, users };
}

export async function getGeography(db: Firestore, now: Date, onlineIds: string[] | null): Promise<Geography> {
  let cache = registries.get(db);
  if (!cache) { cache = new AnalyticsCache<Registry>(300_000, 1); registries.set(db, cache); }
  const registry = await cache.get('platform', () => loadCountryRegistry(db, now.getTime()));
  const countries = new Map<string, Geography['countries'][number]>();
  let unknown = 0, onlineUnknown = 0;
  for (const user of registry.users.values()) {
    if (!user.country) { unknown++; continue; }
    const row = countries.get(user.country) ?? { iso: user.country, name: names.of(user.country) ?? user.country,
      registered: 0, active24h: 0, online: onlineIds === null ? null : 0 };
    row.registered++;
    if (user.lastSeen !== null && user.lastSeen <= registry.at && user.lastSeen >= registry.at - 86_400_000) row.active24h++;
    countries.set(user.country, row);
  }
  for (const uid of onlineIds ?? []) {
    const country = registry.users.get(uid)?.country;
    const row = country ? countries.get(country) : undefined;
    if (row) row.online = (row.online ?? 0) + 1;
    else onlineUnknown++; // New registration not yet in the cached directory.
  }
  return { registeredAt: new Date(registry.at).toISOString(), presenceAt: now.toISOString(),
    total: registry.users.size, unknown, onlineUnknown: onlineIds === null ? null : onlineUnknown,
    countries: [...countries.values()].sort((a, b) => b.registered - a.registered || a.iso.localeCompare(b.iso)) };
}

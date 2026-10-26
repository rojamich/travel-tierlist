export const PROFILE_KEYS = ['mike', 'jen'];
export const PHASES = ['expected', 'experienced'];
export const SCORE_FIELDS = ['wonder', 'things', 'food', 'transportation', 'safety'];
export const SCORE_LABELS = {
  wonder: 'Wonder',
  things: 'Things to do',
  food: 'Food',
  transportation: 'Transportation',
  safety: 'Safety',
};
export const STATUSES = ['visited', 'planning', 'not-visited'];
export const TIERS = ['S', 'A', 'B', 'C', 'D', 'unranked'];
export const SCHEMA_VERSION = 3;
export const normalizeName = (value) =>
  String(value).normalize('NFKC').trim().toLocaleLowerCase('en');
export const uid = () => globalThis.crypto.randomUUID();
export const clone = (value) => structuredClone(value);
export const isDestinationId = (value) =>
  typeof value === 'string' &&
  !Object.hasOwn(Object.prototype, value) &&
  /^[\p{L}\p{N}_()'’-][\p{L}\p{N}_()'’ .-]{0,149}$/u.test(value);

export function emptyProfile() {
  return {
    expected: { scores: null },
    experienced: { scores: null },
    notes: '',
    preNotes: '',
    postNotes: '',
  };
}

function text(value, max = 20000) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max)
    throw new Error(`Text must be at most ${max} characters.`);
  return value.trim();
}

export function safeUrl(value) {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

export function normalizeScores(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid score data.');
  return Object.fromEntries(
    SCORE_FIELDS.map((key) => {
      const value = raw[key];
      if (value == null || value === '') return [key, null];
      const score = Number(value);
      if (!Number.isInteger(score) || score < 1 || score > 5)
        throw new Error('Scores must be whole numbers from 1 to 5.');
      return [key, score];
    }),
  );
}

export function total(scores) {
  if (!scores) return null;
  const values = SCORE_FIELDS.map((key) => scores[key]);
  return values.every((v) => Number.isInteger(v) && v >= 1 && v <= 5)
    ? values.reduce((a, b) => a + b, 0)
    : null;
}

export function tierFor(score) {
  if (!Number.isFinite(score)) return 'unranked';
  return score >= 23 ? 'S' : score >= 20 ? 'A' : score >= 17 ? 'B' : score >= 14 ? 'C' : 'D';
}

export function ratingPhase(country, selected = 'auto') {
  return PHASES.includes(selected)
    ? selected
    : country.status === 'visited'
      ? 'experienced'
      : 'expected';
}

export function rating(country, view = 'average', phase = 'auto') {
  const selected = ratingPhase(country, phase);
  const mike = phaseTotal(country.profiles?.mike?.[selected]);
  const jen = phaseTotal(country.profiles?.jen?.[selected]);
  const values = [mike, jen].filter(Number.isFinite);
  const score =
    view === 'mike'
      ? mike
      : view === 'jen'
        ? jen
        : values.length
          ? values.reduce((a, b) => a + b, 0) / values.length
          : null;
  return {
    score,
    tier: country.manualTier || tierFor(score),
    count: values.length,
    mike,
    jen,
    disagreement: Number.isFinite(mike) && Number.isFinite(jen) ? Math.abs(mike - jen) : null,
    phase: selected,
  };
}

export function phaseTotal(phase) {
  const score = total(phase?.scores);
  return (
    score ??
    (Number.isFinite(phase?.legacyTotal) && phase.legacyTotal >= 5 && phase.legacyTotal <= 25
      ? phase.legacyTotal
      : null)
  );
}

export function cleanProfile(raw = {}, status = 'visited') {
  const result = emptyProfile();
  const legacyPhase = status === 'visited' ? 'experienced' : 'expected';
  for (const phase of PHASES) {
    const phaseData = raw[phase] || (phase === legacyPhase ? raw : {});
    const scores = normalizeScores(phaseData.scores);
    const legacy = phaseData.legacyTotal ?? phaseData.scoreTotal;
    result[phase] = {
      scores,
      legacyTotal:
        total(scores) === null && Number.isFinite(legacy) && legacy >= 5 && legacy <= 25
          ? legacy
          : null,
    };
  }
  for (const field of ['notes', 'preNotes', 'postNotes']) result[field] = text(raw[field]);
  return result;
}

export function cleanMeta(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid destination.');
  const name = text(raw.name, 100);
  if (!name) throw new Error('Every destination needs a name.');
  const status = STATUSES.includes(raw.status) ? raw.status : 'not-visited';
  const images = Array.isArray(raw.images)
    ? raw.images
        .slice(0, 5)
        .map((image) => ({
          src: safeUrl(image?.src),
          alt: text(image?.alt, 500),
          photographer: text(image?.photographer, 200),
          url: safeUrl(image?.url),
          locked: Boolean(image?.locked),
        }))
        .filter((image) => image.src)
    : [];
  let budget;
  if (raw.budget && typeof raw.budget === 'object') {
    const amount =
      raw.budget.amount === '' || raw.budget.amount == null ? null : Number(raw.budget.amount);
    const days = raw.budget.days === '' || raw.budget.days == null ? null : Number(raw.budget.days);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1e9))
      throw new Error('Enter a valid budget.');
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650))
      throw new Error('Budget duration must be 1–3650 days.');
    budget = {
      amount,
      currency: /^[A-Z]{3}$/.test(raw.budget.currency) ? raw.budget.currency : 'USD',
      basis: raw.budget.basis === 'couple' ? 'couple' : 'person',
      days,
      legacy: text(raw.budget.legacy, 500),
    };
  } else
    budget = {
      amount: null,
      currency: 'USD',
      basis: 'person',
      days: null,
      legacy: text(raw.budget, 500),
    };
  return {
    name,
    status,
    bestTime: text(raw.bestTime, 500),
    days: text(raw.days, 500),
    budget,
    manualTier:
      TIERS.includes(raw.manualTier) && raw.manualTier !== 'unranked' ? raw.manualTier : null,
    flagUrl: safeUrl(raw.flagUrl),
    images,
    attractions: Array.isArray(raw.attractions)
      ? raw.attractions
          .slice(0, 30)
          .map((v) => text(v, 200))
          .filter(Boolean)
      : [],
    custom: Boolean(raw.custom),
    deleted: Boolean(raw.deleted),
    schemaVersion: SCHEMA_VERSION,
  };
}

export function migrateCountry(raw) {
  const meta = cleanMeta(raw);
  const profiles = Object.fromEntries(
    PROFILE_KEYS.map((key) => [
      key,
      cleanProfile(raw.profiles?.[key] ?? (key === 'mike' ? raw : {}), meta.status),
    ]),
  );
  const hasScores = PROFILE_KEYS.some((key) =>
    PHASES.some((phase) => Number.isFinite(phaseTotal(profiles[key][phase]))),
  );
  if (!hasScores && !('manualTier' in raw) && TIERS.includes(raw.tier) && raw.tier !== 'unranked')
    meta.manualTier = raw.tier;
  const id = isDestinationId(raw.id) ? raw.id : `destination-${uid()}`;
  return { id, ...meta, profiles };
}

export function parseBackup(input) {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  const list = Array.isArray(raw)
    ? raw
    : raw?.format === 'travel-tiers' && raw.version === SCHEMA_VERSION
      ? raw.countries
      : null;
  if (!Array.isArray(list) || list.length > 1000)
    throw new Error('Choose a Travel Tiers JSON backup with at most 1,000 destinations.');
  const countries = list.map(migrateCountry);
  if (new Set(countries.map((c) => normalizeName(c.name))).size !== countries.length)
    throw new Error('The backup contains duplicate destination names.');
  if (new Set(countries.map((c) => c.id)).size !== countries.length)
    throw new Error('The backup contains duplicate destination IDs.');
  return countries;
}

export function exportBackup(countries) {
  return {
    format: 'travel-tiers',
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    countries: clone(countries),
  };
}

export function rankingQueue(countries, phase = 'auto') {
  const queue = { mike: [], jen: [], neither: [] };
  for (const country of countries) {
    const r = rating(country, 'average', phase);
    if (r.mike === null) queue.mike.push(country);
    if (r.jen === null) queue.jen.push(country);
    if (r.count === 0) queue.neither.push(country);
  }
  for (const list of Object.values(queue))
    list.sort(
      (a, b) =>
        Number(b.status === 'visited') - Number(a.status === 'visited') ||
        a.name.localeCompare(b.name),
    );
  return queue;
}

export function selectCountries(countries, filters) {
  const query = normalizeName(filters.query || '');
  return countries
    .filter((country) => {
      const r = rating(country, filters.view, filters.phase);
      const search = [
        country.name,
        country.bestTime,
        country.days,
        country.budget.legacy,
        ...country.attractions,
        ...PROFILE_KEYS.flatMap((key) =>
          ['notes', 'preNotes', 'postNotes'].map((field) => country.profiles[key][field]),
        ),
        ...country.images.map((image) => `${image.alt} ${image.photographer}`),
      ].join(' ');
      return (
        (!query || normalizeName(search).includes(query)) &&
        (filters.status === 'all' || country.status === filters.status) &&
        (filters.tier === 'all' || r.tier === filters.tier)
      );
    })
    .sort((a, b) => {
      const ra = rating(a, filters.view, filters.phase),
        rb = rating(b, filters.view, filters.phase);
      const sort =
        filters.sort === 'score'
          ? (rb.score ?? -1) - (ra.score ?? -1)
          : filters.sort === 'disagreement'
            ? (rb.disagreement ?? -1) - (ra.disagreement ?? -1)
            : 0;
      return sort || a.name.localeCompare(b.name);
    });
}

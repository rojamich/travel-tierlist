import { PROFILE_KEYS, PHASES, SCORE_FIELDS, phaseTotal, hasVisited, rating } from './model.js';

export function tripReport(country) {
  const people = Object.fromEntries(
    PROFILE_KEYS.map((key) => {
      const profile = country.profiles[key];
      const before = phaseTotal(profile.expected),
        after = phaseTotal(profile.experienced);
      return [
        key,
        {
          before,
          after,
          change: before !== null && after !== null ? after - before : null,
          categories: SCORE_FIELDS.map((field) => {
            const before = profile.expected.scores?.[field] ?? null;
            const after = profile.experienced.scores?.[field] ?? null;
            return {
              field,
              before,
              after,
              change: before !== null && after !== null ? after - before : null,
            };
          }),
        },
      ];
    }),
  );
  const missing = PROFILE_KEYS.flatMap((person) =>
    PHASES.filter((phase) => phaseTotal(country.profiles[person][phase]) === null).map((phase) => ({
      person,
      phase,
    })),
  );
  const before = rating(country, 'average', 'expected');
  const after = rating(country, 'average', 'experienced');
  return {
    people,
    missing,
    complete: hasVisited(country) && missing.length === 0,
    before,
    after,
    change: before.count === 2 && after.count === 2 ? after.score - before.score : null,
  };
}

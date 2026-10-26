import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import '../countries.js';
import {
  PROFILE_KEYS,
  PHASES,
  SCORE_FIELDS,
  SCORE_LABELS,
  TIERS,
  cleanMeta,
  cleanProfile,
  emptyProfile,
  clone,
  normalizeName,
  phaseTotal,
  tierFor,
  rating,
  ratingPhase,
  rankingQueue,
  selectCountries,
  parseBackup,
  safeUrl,
  uid,
} from './model.js';
import { TravelStore } from './store.js';
import { deviceStorage, getLegacyData, getSetting, saveSetting } from './storage.js';
import { CloudSync } from './cloud.js';
import { fetchPhotos, replacePhotos } from './photos.js';

const $ = (selector) => document.querySelector(selector);
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const person = (key) => (key === 'mike' ? 'Mike' : 'Jen');
const statusLabel = { visited: 'Visited', planning: 'Planning', 'not-visited': 'Not visited' };
const number = (value) =>
  Number.isFinite(value) ? (Number.isInteger(value) ? String(value) : value.toFixed(1)) : '—';
const date = (value) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const form = $('#country-form');
let store,
  cloud,
  session = null,
  page = 'board',
  photoRequest = null,
  photoIndex = 0,
  draftTimer,
  toastTimer,
  importData = null,
  installPrompt = null,
  waitingWorker = null;
let syncState = 'local',
  syncError = null,
  pexelsKey = '';
const filters = {
  query: '',
  view: 'average',
  phase: 'auto',
  status: 'all',
  tier: 'all',
  sort: 'name',
};

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => ($('#toast').hidden = true), 6000);
}
function friendlyError(error) {
  const code = error?.code || '';
  if (code.includes('permission-denied'))
    return 'Your account needs access to the shared list. Your changes are safe on this device.';
  if (
    code.includes('invalid-credential') ||
    code.includes('wrong-password') ||
    code.includes('user-not-found')
  )
    return 'The email or password is incorrect.';
  if (code.includes('operation-not-allowed'))
    return 'Email sign-in needs to be enabled for this shared list.';
  if (code.includes('network') || code.includes('unavailable'))
    return 'No connection to the shared list. Your changes are saved here and will retry when connected.';
  if (code.includes('too-many-requests'))
    return 'Too many attempts. Wait a little before trying again.';
  return error?.message || 'Something went wrong. Your saved data has been kept.';
}
const guard = (callback) => async (event) => {
  try {
    await callback(event);
  } catch (error) {
    toast(friendlyError(error));
  }
};
function dirtyParts() {
  if (!session) return { meta: false, profiles: [] };
  const meta = (country) => {
    const { id, profiles, ...fields } = country;
    return fields;
  };
  return {
    meta: JSON.stringify(meta(session.country)) !== JSON.stringify(meta(session.initial)),
    profiles: PROFILE_KEYS.filter(
      (key) =>
        JSON.stringify(cleanProfile(session.country.profiles[key])) !==
        JSON.stringify(cleanProfile(session.initial.profiles[key])),
    ),
  };
}
const hasChanges = () => {
  const dirty = dirtyParts();
  return Boolean(session?.isNew && session.country.name) || dirty.meta || dirty.profiles.length;
};

async function confirmAction(title, description, label = 'Continue') {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-description').textContent = description;
  $('#confirm-accept').textContent = label;
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {
      once: true,
    });
    dialog.showModal();
  });
}

function filterMarkup() {
  return `<div class="filters" id="shared-filters"><div class="search-line"><label>Find a destination<input type="search" id="search" placeholder="Search names, notes, or interests" value="${escape(filters.query)}" /></label><label>Whose rating?<select id="filter-view"><option value="average">Our average</option><option value="mike">Mike</option><option value="jen">Jen</option></select></label><label>Which experience?<select id="filter-phase"><option value="auto">Match trip status</option><option value="expected">Before the trip</option><option value="experienced">After the trip</option></select></label></div><details><summary>Filter & sort</summary><div class="advanced-filters"><label>Status<select id="filter-status"><option value="all">All statuses</option>${Object.entries(
    statusLabel,
  )
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join(
      '',
    )}</select></label><label>Tier<select id="filter-tier"><option value="all">All tiers</option>${TIERS.map((t) => `<option value="${t}">${t === 'unranked' ? 'Unranked' : t}</option>`).join('')}</select></label><label>Sort by<select id="filter-sort"><option value="name">Destination name</option><option value="score">Highest rating</option><option value="disagreement">Biggest difference of opinion</option></select></label></div></details></div>`;
}
function installFilters() {
  $('#filters-slot').innerHTML = filterMarkup();
  for (const key of ['view', 'phase', 'status', 'tier', 'sort']) {
    const input = $(`#filter-${key}`);
    input.value = filters[key];
    input.addEventListener('change', () => {
      filters[key] = input.value;
      render();
    });
  }
  $('#search').addEventListener('input', (event) => {
    filters.query = event.target.value;
    render();
  });
}

function setPage() {
  page = ['board', 'countries', 'settings'].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : 'board';
  for (const item of ['board', 'countries', 'settings']) {
    $(`#page-${item}`).hidden = item !== page;
    const nav = $(`[data-page="${item}"]`);
    if (item === page) nav.setAttribute('aria-current', 'page');
    else nav.removeAttribute('aria-current');
  }
  if (page !== 'settings')
    $(`#${page === 'countries' ? 'countries-' : ''}filters-slot`).append($('#shared-filters'));
  if (page === 'settings') renderSettings();
  if (page !== 'board') setTierOnly(false);
}

function setTierOnly(enabled) {
  document.body.classList.toggle('tier-only', enabled);
  $('#exit-tier-only').hidden = !enabled;
  $('#toggle-tier-only').setAttribute('aria-pressed', String(enabled));
  if (enabled) window.scrollTo(0, 0);
}

function budgetText(budget) {
  if (budget.amount === null) return budget.legacy || 'No budget yet';
  let amount;
  try {
    amount = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: budget.currency,
      maximumFractionDigits: 0,
    }).format(budget.amount);
  } catch {
    amount = `${number(budget.amount)} ${budget.currency}`;
  }
  return `${amount} · ${budget.basis === 'couple' ? 'both of us' : 'per person'}${budget.days ? ` / ${budget.days} days` : ''}`;
}
function scoreDescription(r) {
  return `${r.phase === 'expected' ? 'Expected' : 'Experienced'} · ${r.count === 2 ? 'both rated' : r.count === 1 ? '1 of 2 rated' : 'not rated'}`;
}
function notesMarkup(country) {
  return PROFILE_KEYS.map((key) => {
    const profile = country.profiles[key];
    const notes = [
      ['Notes', profile.notes],
      ['Before the trip', profile.preNotes],
      ['After the trip', profile.postNotes],
    ].filter(([, value]) => value);
    return notes.length
      ? `<div class="notes-block ${key}"><strong>${person(key)}</strong>${notes.map(([label, value]) => `<p><b>${label}:</b> ${escape(value)}</p>`).join('')}</div>`
      : '';
  }).join('');
}
function emptyMarkup(filtered = false) {
  return `<div class="empty-state"><p class="eyebrow">${filtered ? 'KEEP EXPLORING' : 'YOUR NEXT CHAPTER'}</p><h2>${filtered ? 'No destinations match.' : 'A world of possibilities.'}</h2><p>${filtered ? 'Try another search or change your filters.' : 'Add your first destination, or import your previous list in Settings.'}</p>${filtered ? '<button data-action="reset-filters">Clear filters</button>' : '<button class="primary" data-action="add">Add a destination</button>'}</div>`;
}
function render() {
  if (!store) return;
  const countries = store.countries;
  const displayed = selectCountries(countries, filters);
  const queue = rankingQueue(countries, filters.phase);
  const ranked = countries.filter(
    (c) => rating(c, filters.view, filters.phase).score !== null,
  ).length;
  $('#overview').innerHTML = [
    ['Visited', countries.filter((c) => c.status === 'visited').length],
    ['Planning', countries.filter((c) => c.status === 'planning').length],
    ['Destinations', countries.length],
    ['Rated', ranked],
  ]
    .map(
      ([label, value]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`,
    )
    .join('');
  $('#queue-summary').textContent = countries.length
    ? `${queue.neither.length} ${queue.neither.length === 1 ? 'destination needs' : 'destinations need'} both of your ratings. The queue includes destinations neither of you has rated.`
    : 'Start a list together, then come back to compare your ratings.';
  $('#queue-actions').innerHTML = PROFILE_KEYS.map(
    (key) =>
      `<button data-action="rank-next" data-profile-key="${key}" ${queue[key].length ? '' : 'disabled'}>Rank next for ${person(key)}<small>${queue[key].length ? `${queue[key].length} still to rate` : 'All caught up'}</small></button>`,
  ).join('');
  $('#rating-queues').innerHTML =
    `<summary>See who still needs to rate</summary><div class="rating-queue-lists">${[
      ['neither', 'Neither rated'],
      ['mike', 'Needs Mike'],
      ['jen', 'Needs Jen'],
    ]
      .map(
        ([key, label]) =>
          `<section><h3>${label} · ${queue[key].length}</h3>${queue[key].length ? queue[key].map((country) => `<button data-action="queue-edit" data-id="${escape(country.id)}" data-profile-key="${key === 'jen' ? 'jen' : 'mike'}">${escape(country.name)}</button>`).join('') : '<p class="helper">All caught up.</p>'}</section>`,
      )
      .join('')}</div>`;
  $('#result-count').textContent = `${displayed.length} of ${countries.length} destinations`;
  $('#tier-board').innerHTML = !displayed.length
    ? emptyMarkup(Boolean(countries.length))
    : TIERS.map((tier) => {
        const entries = displayed.filter(
          (c) => rating(c, filters.view, filters.phase).tier === tier,
        );
        return `<section class="tier-row tier-${tier}" aria-label="${tier === 'unranked' ? 'Unranked' : `Tier ${tier}`}"><div class="tier-label"><strong>${tier === 'unranked' ? '?' : tier}</strong><small>${{ S: 'LEGENDARY', A: 'ESSENTIAL', B: 'STRONG', C: 'MAYBE', D: 'LOW', unranked: 'UNRANKED' }[tier]}</small></div><div class="tier-items">${
          entries.length
            ? entries
                .map((country) => {
                  const r = rating(country, filters.view, filters.phase);
                  return `<button class="tier-pill" data-action="edit" data-id="${escape(country.id)}" aria-label="Edit ${escape(country.name)}"><span class="pill-name">${country.flagUrl ? `<img src="${escape(country.flagUrl)}" alt="" loading="lazy" />` : ''}${escape(country.name)}${r.score !== null ? ` <strong>${number(r.score)}</strong>` : ''}</span><small>${statusLabel[country.status]} · ${r.count}/2 rated</small></button>`;
                })
                .join('')
            : '<p class="subtle">Room for a new favorite.</p>'
        }</div></section>`;
      }).join('');
  $('#country-cards').innerHTML = displayed.length
    ? displayed
        .map((country) => {
          const r = rating(country, filters.view, filters.phase);
          const notes = notesMarkup(country);
          return `<article class="country-card tier-${r.tier}"><header><div><h2>${escape(country.name)}</h2><span class="tag">${statusLabel[country.status]}${country.custom ? ' · Custom' : ''}</span></div><button data-action="edit" data-id="${escape(country.id)}" aria-label="Edit ${escape(country.name)}">Edit</button></header><div class="score-line"><span class="tag">${r.tier === 'unranked' ? 'Unranked' : `Tier ${r.tier}`}</span><div><strong>${r.score === null ? 'Not scored' : `${number(r.score)} / 25`}</strong><br /><small>${scoreDescription(r)}<br />Mike ${number(r.mike)} · Jen ${number(r.jen)}${r.disagreement !== null ? ` · Difference ${number(r.disagreement)}` : ''}</small></div></div><dl><div><dt>Best time</dt><dd>${escape(country.bestTime || 'Still exploring')}</dd></div><div><dt>Time needed</dt><dd>${escape(country.days || 'Not set')}</dd></div><div><dt>Budget</dt><dd>${escape(budgetText(country.budget))}</dd></div><div><dt>Interests</dt><dd>${escape(country.attractions.join(', ') || 'Add your highlights')}</dd></div></dl>${notes ? `<details><summary>Your notes</summary>${notes}</details>` : ''}</article>`;
        })
        .join('')
    : emptyMarkup(Boolean(countries.length));
  $('#draft-banner').hidden = !store.state.draft || Boolean(session);
  updateConnection();
  if (page === 'settings') renderSettings();
}

function updateConnection() {
  const pending = store.pending.length,
    conflicts = store.conflicts.length;
  const labels = {
    local: 'On this device',
    verify: 'Verify email',
    connecting: 'Connecting…',
    offline: 'Offline · saved here',
    syncing: 'Syncing…',
    synced: 'All changes synced',
    pending: `${pending} pending`,
    error: 'Saved here · retry sync',
    conflict: `${conflicts} to review`,
  };
  const state = !navigator.onLine ? 'offline' : conflicts ? 'conflict' : syncState;
  $('#connection-label').textContent = labels[state] || labels.local;
  $('#connection-button').dataset.state = state;
  const messages = {
    local: 'Your list is saved on this device. Sign in to share it across your phones.',
    verify: 'Check your email to verify your account, then tap “I’ve verified my email.”',
    connecting: 'Connecting to your shared list. Your local copy is ready to use.',
    offline: `You’re offline. ${pending ? `${pending} changes will retry when you reconnect.` : 'Your saved list is ready to use.'}`,
    syncing: `Uploading ${pending} saved changes…`,
    synced: 'Your saved changes are synced with the shared list.',
    pending: `${pending} changes are saved on this device and waiting to upload.`,
    conflict: 'Another device changed the same information. Review both versions below.',
  };
  $('#sync-message').textContent = syncError
    ? friendlyError(syncError)
    : messages[state] || messages.local;
}

function renderSettings() {
  const user = cloud?.user;
  $('#auth-form').hidden = Boolean(user);
  $('#account-actions').hidden = !user;
  $('#account-label').textContent = user ? `Signed in as ${user.email}` : '';
  $('#verify-email').hidden = !user || user.emailVerified;
  $('#refresh-account').hidden = !user || user.emailVerified;
  $('#retry-sync').hidden = Boolean(user && !user.emailVerified);
  $('#export-legacy').hidden = !store.state.legacyArchive && !store.state.legacyCloudArchive;
  $('#migration-message').hidden = !store.state.migrationWarnings;
  $('#migration-message').textContent =
    `${store.state.migrationWarnings || 0} older entries could not be converted. Export the original data to keep a copy for recovery.`;
  $('#conflicts').innerHTML = store.conflicts
    .map((op) => {
      const name = store.entity(op.countryId).meta?.data.name || op.countryId;
      return `<div class="conflict-row"><div><strong>${escape(name)} · ${op.kind === 'meta' ? 'Trip details' : `${person(op.profile)}’s profile`}</strong><small>${op.conflict.reason === 'deleted-country' ? 'This destination was deleted on another device.' : 'Choose which version to keep. A recovery point will preserve your local copy.'}</small><details><summary>Compare versions</summary><p class="helper">This device</p><div class="conflict-detail">${comparison(op.data, op.kind)}</div><p class="helper">Shared list</p><div class="conflict-detail">${comparison(op.conflict.remote?.data, op.kind)}</div></details></div><div class="button-row"><button data-action="conflict-remote" data-key="${escape(op.key)}">Use shared version</button>${op.conflict.reason !== 'deleted-country' ? `<button data-action="conflict-local" data-key="${escape(op.key)}">Keep this device’s version</button>` : ''}</div></div>`;
    })
    .join('');
  $('#recovery-points').innerHTML = store.state.history.length
    ? `<h3 class="recovery-heading">Recovery points</h3>${store.state.history.map((item) => `<div class="recovery-row"><div>${escape(item.label)}<small>${date(item.createdAt)}</small></div><button data-action="restore" data-id="${item.id}">Restore</button></div>`).join('')}`
    : '<p class="helper">Recovery points appear here after imports, resets, or deletions.</p>';
}

function comparison(data, kind) {
  if (!data) return 'No saved version.';
  const lines =
    kind === 'meta'
      ? [
          ['Destination', data.name],
          ['Status', data.deleted ? 'Deleted' : statusLabel[data.status]],
          ['Best time', data.bestTime],
          ['Time needed', data.days],
          ['Budget', budgetText(data.budget)],
          ['Interests', data.attractions.join(', ')],
          ['Photos', `${data.images.length} saved`],
        ]
      : [
          ['Before-trip rating', `${number(phaseTotal(data.expected))} / 25`],
          ['After-trip rating', `${number(phaseTotal(data.experienced))} / 25`],
          ['Notes', data.notes],
          ['Before-you-go notes', data.preNotes],
          ['After-the-trip notes', data.postNotes],
        ];
  return lines
    .filter(([, value]) => value)
    .map(([label, value]) => `<p><strong>${label}:</strong> ${escape(value)}</p>`)
    .join('');
}

const choices = {
  wonder: [
    '1 · No main attractions',
    '2 · One main attraction',
    '3 · Multiple big attractions',
    '4 · At least one wonder',
    '5 · Multiple wonders',
  ],
  things: [
    '1 · No sights',
    '2 · One sightseeing focus',
    '3 · Multiple sights',
    '4 · At least one adventure',
    '5 · Multiple adventure types',
  ],
  food: [
    '1 · Bring your own',
    '2 · Enough to eat',
    '3 · Good / some variety',
    '4 · Delicious or varied',
    '5 · Delicious and varied',
  ],
  transportation: [
    '1 · No transport',
    '2 · Challenging',
    '3 · Basic transportation',
    '4 · Multiple modes',
    '5 · Easy, clean, varied',
  ],
  safety: [
    '1 · Why are we going?',
    '2 · Major precautions',
    '3 · Some areas off limits',
    '4 · Standard precautions',
    '5 · Zero concerns',
  ],
};
function blankCountry() {
  return {
    id: '',
    ...cleanMeta({ name: 'New destination' }),
    name: '',
    profiles: { mike: emptyProfile(), jen: emptyProfile() },
  };
}
function openEditor(id = null, profile = 'mike', draft = null) {
  photoRequest?.abort();
  photoRequest = null;
  clearTimeout(draftTimer);
  const country = id ? store.countries.find((c) => c.id === id) : blankCountry();
  if (!country && !draft) return;
  session = draft
    ? clone(draft)
    : {
        token: uid(),
        country: clone(country),
        initial: clone(country),
        base: id ? store.entity(id) : { meta: null, profiles: {} },
        activeProfile: profile,
        phase: id ? ratingPhase(country, filters.phase) : 'expected',
        isNew: !id,
      };
  session.token = uid();
  photoIndex = 0;
  fillEditor();
  $('#editor-error').hidden = true;
  $('#country-dialog').showModal();
  $('#draft-banner').hidden = true;
}
function fillEditor() {
  const c = session.country;
  $('#dialog-title').textContent = session.isNew ? 'Add destination' : c.name;
  $('#random-country').hidden = !session.isNew;
  $('#destination-name').value = c.name;
  $('#destination-status').value = c.status;
  $('#destination-season').value = c.bestTime;
  $('#destination-days').value = c.days;
  $('#budget-amount').value = c.budget.amount ?? '';
  $('#budget-basis').value = c.budget.basis;
  $('#budget-duration').value = c.budget.days ?? '';
  const knownCurrency = [...$('#budget-currency').options].some(
    (o) => o.value === c.budget.currency,
  );
  $('#budget-currency').value = knownCurrency ? c.budget.currency : 'Other';
  $('#budget-custom-currency').hidden = knownCurrency;
  $('#budget-custom-currency').required = !knownCurrency;
  $('#budget-custom-currency').value = knownCurrency ? '' : c.budget.currency;
  $('#legacy-budget').hidden = !c.budget.legacy;
  $('#legacy-budget').textContent = `Previous budget: ${c.budget.legacy}`;
  $('#destination-attractions').value = c.attractions.join(', ');
  $('#destination-flag').value = c.flagUrl;
  $('#auto-tier').checked = !c.manualTier;
  $('#manual-tier').value = c.manualTier || 'B';
  $('#manual-tier-label').hidden = !c.manualTier;
  $('#delete-destination').hidden = session.isNew;
  $('#reset-destination').hidden = session.isNew;
  renderProfile();
  renderGallery();
  $('#photo-status').textContent = '';
  $('#regenerate-photos').disabled = false;
}
function renderProfile() {
  const profile = session.country.profiles[session.activeProfile];
  for (const key of PROFILE_KEYS)
    $(`[data-profile="${key}"]`).setAttribute(
      'aria-pressed',
      String(key === session.activeProfile),
    );
  for (const phase of PHASES)
    $(`[data-phase="${phase}"]`).setAttribute('aria-pressed', String(phase === session.phase));
  $('#phase-help').textContent =
    session.phase === 'expected' ? 'Expected rating' : 'Experienced rating';
  $('#rating-help').textContent =
    session.phase === 'expected'
      ? 'What do you expect from this destination? Keep these impressions to compare after your trip.'
      : 'How was your actual experience? Your before-trip rating stays separate.';
  $('#score-fields').innerHTML = SCORE_FIELDS.map(
    (key) =>
      `<label for="score-${key}">${SCORE_LABELS[key]}<select id="score-${key}" data-score="${key}"><option value="">Not scored</option>${choices[key].map((label, i) => `<option value="${i + 1}">${label}</option>`).join('')}</select></label>`,
  ).join('');
  for (const key of SCORE_FIELDS)
    $(`#score-${key}`).value = profile[session.phase]?.scores?.[key] ?? '';
  $('#profile-notes').value = profile.notes;
  $('#profile-pre-notes').value = profile.preNotes;
  $('#profile-post-notes').value = profile.postNotes;
  $('#profile-notes-label').firstChild.textContent = `${person(session.activeProfile)}’s notes`;
  $('#score-preview').hidden = true;
}
function collectEditor(eventTarget = null) {
  if (!session) return;
  const c = session.country;
  c.name = $('#destination-name').value.trim();
  c.status = $('#destination-status').value;
  c.custom = !window.ALL_COUNTRIES.some((name) => normalizeName(name) === normalizeName(c.name));
  c.bestTime = $('#destination-season').value.trim();
  c.days = $('#destination-days').value.trim();
  c.flagUrl = $('#destination-flag').value.trim();
  c.budget = {
    amount: $('#budget-amount').value === '' ? null : Number($('#budget-amount').value),
    currency:
      $('#budget-currency').value === 'Other'
        ? $('#budget-custom-currency').value.trim().toUpperCase()
        : $('#budget-currency').value,
    basis: $('#budget-basis').value,
    days: $('#budget-duration').value === '' ? null : Number($('#budget-duration').value),
    legacy: c.budget.legacy,
  };
  c.attractions = $('#destination-attractions')
    .value.split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  c.manualTier = $('#auto-tier').checked ? null : $('#manual-tier').value;
  const profile = c.profiles[session.activeProfile];
  const scores = Object.fromEntries(
    SCORE_FIELDS.map((key) => [
      key,
      $(`#score-${key}`).value ? Number($(`#score-${key}`).value) : null,
    ]),
  );
  const any = SCORE_FIELDS.some((key) => scores[key] !== null);
  profile[session.phase] = {
    scores: any ? scores : null,
    legacyTotal: eventTarget?.matches('[data-score]')
      ? null
      : (profile[session.phase]?.legacyTotal ?? null),
  };
  profile.notes = $('#profile-notes').value;
  profile.preNotes = $('#profile-pre-notes').value;
  profile.postNotes = $('#profile-post-notes').value;
  $('#manual-tier-label').hidden = $('#auto-tier').checked;
  const otherCurrency = $('#budget-currency').value === 'Other';
  $('#budget-custom-currency').hidden = !otherCurrency;
  $('#budget-custom-currency').required = otherCurrency;
  const existing = store.countries.find(
    (country) => normalizeName(country.name) === normalizeName(c.name) && country.id !== c.id,
  );
  $('#destination-hint').textContent = existing
    ? 'Already on your list. Close this draft and edit the existing destination.'
    : c.custom
      ? 'Custom destination: regions and special trips are welcome.'
      : 'Country from the world list.';
  if (!$('#score-preview').hidden) revealScore();
}
function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (session && hasChanges())
      void store
        .saveDraft(session)
        .catch((error) => toast(`Draft could not be saved: ${friendlyError(error)}`));
  }, 300);
}
async function closeEditor({ discard = false } = {}) {
  if (!session) return;
  photoRequest?.abort();
  photoRequest = null;
  clearTimeout(draftTimer);
  collectEditor();
  if (!discard && hasChanges()) await store.saveDraft(session);
  else await store.clearDraft();
  session = null;
  $('#country-dialog').close();
  render();
}
function revealScore() {
  const score = phaseTotal(session.country.profiles[session.activeProfile][session.phase]);
  $('#score-preview').hidden = false;
  $('#score-preview').textContent =
    score === null
      ? 'Choose all five scores to reveal a total.'
      : `${person(session.activeProfile)} · ${session.phase === 'expected' ? 'Expected' : 'Experienced'}: ${number(score)} / 25 · Tier ${tierFor(score)}${session.country.profiles[session.activeProfile][session.phase].legacyTotal ? ' (imported total)' : ''}`;
}
function renderGallery() {
  $('#photo-gallery').innerHTML = session.country.images
    .map(
      (image, i) =>
        `<figure><img src="${escape(image.src)}" alt="${escape(image.alt || 'Destination photo')}" loading="lazy" /><button type="button" data-lock="${i}" aria-pressed="${image.locked}">${image.locked ? 'Locked · keep this photo' : 'Lock this photo'}</button><figcaption>${image.url ? `<a href="${escape(image.url)}" target="_blank" rel="noopener noreferrer">${escape(image.photographer || 'Photographer')}</a> · Pexels` : escape(image.photographer || 'Saved photo')}</figcaption></figure>`,
    )
    .join('');
}
async function regeneratePhotos() {
  collectEditor();
  if (!session.country.name) throw new Error('Enter a destination before finding photos.');
  if (
    session.country.images.length === 5 &&
    session.country.images.every((image) => image.locked)
  ) {
    toast('All five photos are locked. Unlock one to find a replacement.');
    return;
  }
  photoRequest?.abort();
  const controller = new AbortController();
  photoRequest = controller;
  const token = session.token,
    name = session.country.name;
  $('#regenerate-photos').disabled = true;
  $('#photo-status').textContent = 'Finding photos…';
  try {
    const photos = await fetchPhotos(name, pexelsKey, {
      signal: controller.signal,
      index: photoIndex++,
    });
    if (
      !session ||
      session.token !== token ||
      controller.signal.aborted ||
      session.country.name !== name
    )
      return;
    session.country.images = replacePhotos(session.country.images, photos);
    renderGallery();
    scheduleDraft();
    $('#photo-status').textContent =
      'Choose your favorites. Save this destination to keep the photos.';
  } catch (error) {
    if (error.name !== 'AbortError' && session?.token === token)
      $('#photo-status').textContent = error.message;
  } finally {
    if (session?.token === token) {
      $('#regenerate-photos').disabled = false;
      photoRequest = null;
    }
  }
}

async function exportFile(data, filename) {
  const content = JSON.stringify(data, null, 2);
  if (Capacitor.isNativePlatform()) {
    const result = await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({
      title: 'Travel Tiers backup',
      url: result.uri,
      dialogTitle: 'Save your travel backup',
    });
  } else {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

function bindEvents() {
  $('#toggle-tier-only').addEventListener('click', () => setTierOnly(true));
  $('#exit-tier-only').addEventListener('click', () => setTierOnly(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setTierOnly(false);
  });
  $('#random-country').addEventListener('click', () => {
    const existing = new Set(store.countries.map((country) => normalizeName(country.name)));
    const available = window.ALL_COUNTRIES.filter((name) => !existing.has(normalizeName(name)));
    if (!available.length) {
      toast('Every country is already on your list.');
      return;
    }
    $('#destination-name').value = available[Math.floor(Math.random() * available.length)];
    collectEditor();
    scheduleDraft();
    $('#destination-name').focus();
  });
  window.addEventListener('hashchange', setPage);
  document.addEventListener(
    'click',
    guard(async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'add') openEditor();
      if (action === 'edit') openEditor(button.dataset.id);
      if (action === 'queue-edit') openEditor(button.dataset.id, button.dataset.profileKey);
      if (action === 'rank-next') {
        const key = button.dataset.profileKey;
        const next = rankingQueue(store.countries, filters.phase)[key][0];
        if (next) openEditor(next.id, key);
      }
      if (action === 'reset-filters') {
        Object.assign(filters, { query: '', status: 'all', tier: 'all', sort: 'name' });
        $('#search').value = '';
        for (const key of ['status', 'tier', 'sort']) $(`#filter-${key}`).value = filters[key];
        render();
      }
      if (
        action === 'restore' &&
        (await confirmAction(
          'Restore this recovery point?',
          'This will replace the current list. A new recovery point will preserve your current data.',
          'Restore list',
        ))
      ) {
        await store.restore(button.dataset.id);
        toast('List restored on this device.');
      }
      if (action === 'conflict-remote' || action === 'conflict-local')
        await store.resolveConflict(
          button.dataset.key,
          action === 'conflict-remote' ? 'remote' : 'local',
        );
    }),
  );
  for (const type of ['input', 'change'])
    form.addEventListener(type, (event) => {
      collectEditor(event.target);
      if (type === 'change' && event.target.id === 'destination-status') {
        session.phase = ratingPhase(session.country);
        renderProfile();
      }
      scheduleDraft();
    });
  form.addEventListener('click', (event) => {
    const profileButton = event.target.closest('[data-profile]'),
      phaseButton = event.target.closest('[data-phase]'),
      lockButton = event.target.closest('[data-lock]');
    if (profileButton || phaseButton) {
      collectEditor();
      if (profileButton) session.activeProfile = profileButton.dataset.profile;
      if (phaseButton) session.phase = phaseButton.dataset.phase;
      renderProfile();
      scheduleDraft();
    }
    if (lockButton) {
      const image = session.country.images[Number(lockButton.dataset.lock)];
      image.locked = !image.locked;
      renderGallery();
      scheduleDraft();
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearTimeout(draftTimer);
    collectEditor();
    $('#editor-error').hidden = true;
    $('#save-destination').disabled = true;
    try {
      const flag = $('#destination-flag').value;
      if (flag && !safeUrl(flag)) throw new Error('Use an HTTPS URL for the flag image.');
      if (session.country.budget.currency.length !== 3)
        throw new Error('Use a three-letter currency code.');
      if (!session.country.id) {
        const slug = normalizeName(session.country.name)
          .replace(/[^\p{L}\p{N}]+/gu, '-')
          .replace(/^-|-$/g, '');
        session.country.id = slug
          ? `${session.country.custom ? 'destination-' : ''}${slug}`
          : `destination-${uid()}`;
      }
      const dirty = dirtyParts();
      if (session.isNew) {
        dirty.meta = true;
        dirty.profiles = PROFILE_KEYS;
      }
      await store.saveCountry(session.country, session.base, dirty);
      photoRequest?.abort();
      session = null;
      $('#country-dialog').close();
      render();
      toast('Saved on this device.');
    } catch (error) {
      $('#editor-error').textContent = friendlyError(error);
      $('#editor-error').hidden = false;
    } finally {
      $('#save-destination').disabled = false;
    }
  });
  $('#close-editor').addEventListener(
    'click',
    guard(() => closeEditor()),
  );
  $('#country-dialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    void closeEditor().catch((error) => toast(friendlyError(error)));
  });
  $('#reveal-score').addEventListener('click', () => {
    collectEditor();
    revealScore();
  });
  $('#clear-profile-scores').addEventListener('click', () => {
    collectEditor();
    session.country.profiles[session.activeProfile][session.phase] = {
      scores: null,
      legacyTotal: null,
    };
    renderProfile();
    scheduleDraft();
  });
  $('#regenerate-photos').addEventListener('click', guard(regeneratePhotos));
  $('#delete-destination').addEventListener(
    'click',
    guard(async () => {
      if (
        await confirmAction(
          `Delete ${session.country.name}?`,
          'Your ratings and notes will be saved in a recovery point. The deletion will sync to your other devices.',
          'Delete destination',
        )
      ) {
        clearTimeout(draftTimer);
        photoRequest?.abort();
        await store.deleteCountry(session.country.id);
        session = null;
        $('#country-dialog').close();
        render();
        toast('Deleted. You can restore it in Settings.');
      }
    }),
  );
  $('#reset-destination').addEventListener(
    'click',
    guard(async () => {
      if (
        await confirmAction(
          'Clear both people’s ratings?',
          'This clears expected and experienced scores for Mike and Jen. Your notes, budget, and photos stay. A recovery point is saved first.',
          'Clear ratings',
        )
      ) {
        const id = session.country.id,
          profile = session.activeProfile;
        clearTimeout(draftTimer);
        await store.resetCountry(id);
        session = null;
        $('#country-dialog').close();
        openEditor(id, profile);
        toast('Ratings cleared; notes kept.');
      }
    }),
  );
  $('#resume-draft').addEventListener('click', () => openEditor(null, 'mike', store.state.draft));
  $('#discard-draft').addEventListener(
    'click',
    guard(async () => {
      await store.clearDraft();
      render();
    }),
  );
  $('#connection-button').addEventListener('click', () => {
    location.hash = 'settings';
  });
  $('#auth-form').addEventListener(
    'submit',
    guard(async (event) => {
      event.preventDefault();
      await cloud.signIn($('#auth-email').value, $('#auth-password').value);
      $('#auth-password').value = '';
    }),
  );
  $('#register-account').addEventListener(
    'click',
    guard(async () => {
      if (!$('#auth-form').reportValidity()) return;
      await cloud.register($('#auth-email').value, $('#auth-password').value);
      $('#auth-password').value = '';
      toast('Account created. Check your email to verify it.');
    }),
  );
  $('#reset-password').addEventListener(
    'click',
    guard(async () => {
      if (!$('#auth-email').reportValidity()) return;
      await cloud.resetPassword($('#auth-email').value);
      toast('If an account exists, a password reset email is on its way.');
    }),
  );
  $('#sign-out').addEventListener(
    'click',
    guard(async () => {
      await cloud.signOut();
      toast('Signed out. Your local copy is still available.');
    }),
  );
  $('#verify-email').addEventListener(
    'click',
    guard(async () => {
      await cloud.verify();
      toast('Verification email sent.');
    }),
  );
  $('#refresh-account').addEventListener(
    'click',
    guard(() => cloud.refreshUser()),
  );
  $('#retry-sync').addEventListener(
    'click',
    guard(() => cloud.retry()),
  );
  $('#export-backup').addEventListener(
    'click',
    guard(() =>
      exportFile(store.export(), `travel-tiers-${new Date().toISOString().slice(0, 10)}.json`),
    ),
  );
  $('#export-legacy').addEventListener(
    'click',
    guard(() =>
      exportFile(
        {
          format: 'travel-tiers-original-archive',
          local: store.state.legacyArchive || null,
          cloud: store.state.legacyCloudArchive || null,
        },
        'travel-tiers-original.json',
      ),
    ),
  );
  $('#import-backup').addEventListener(
    'change',
    guard(async (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose a backup smaller than 2 MB.');
      importData = parseBackup(await file.text());
      const matches = importData.filter((c) =>
        store.countries.some((existing) => normalizeName(existing.name) === normalizeName(c.name)),
      ).length;
      $('#import-summary').textContent =
        `${importData.length} destinations in this backup. ${matches} match names already on this device.`;
      $('#import-mode').value = 'merge';
      $('#import-dialog').showModal();
    }),
  );
  $('#cancel-import').addEventListener('click', () => {
    $('#import-dialog').close();
    importData = null;
  });
  $('#import-form').addEventListener(
    'submit',
    guard(async (event) => {
      event.preventDefault();
      if (!importData) return;
      await store.importCountries(importData, $('#import-mode').value);
      $('#import-dialog').close();
      importData = null;
      toast('Backup imported. A recovery point was saved.');
    }),
  );
  $('#photo-settings').addEventListener(
    'submit',
    guard(async (event) => {
      event.preventDefault();
      pexelsKey = $('#pexels-key').value.trim();
      await saveSetting('pexelsApiKey', pexelsKey);
      toast(pexelsKey ? 'Photo key saved on this device.' : 'Photo key removed.');
    }),
  );
  $('#clear-device').addEventListener(
    'click',
    guard(async () => {
      if (
        await confirmAction(
          'Clear this device?',
          'Export a backup first if you need it. Unsynced changes, drafts, and recovery points on this device will be removed. Your shared cloud list stays.',
          'Clear this device',
        )
      ) {
        await cloud.signOut();
        cloud.stop();
        await store.clearDevice();
        await saveSetting('pexelsApiKey', '');
        pexelsKey = '';
        $('#pexels-key').value = '';
        toast('Device cleared. Sign in to download your shared list.');
      }
    }),
  );
  window.addEventListener('online', () => {
    syncError = null;
    updateConnection();
  });
  window.addEventListener('offline', () => {
    syncError = null;
    updateConnection();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session) {
      collectEditor();
      clearTimeout(draftTimer);
      void store.saveDraft(session).catch(() => {});
    } else if (!document.hidden) void cloud.retry();
  });
  window.addEventListener('beforeunload', (event) => {
    if (session && hasChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  if (Capacitor.isNativePlatform()) {
    $('#install-card').hidden = true;
    void App.addListener('backButton', () => {
      if ($('#confirm-dialog').open) $('#confirm-dialog').close('cancel');
      else if ($('#import-dialog').open) $('#import-dialog').close();
      else if (session) void closeEditor().catch((error) => toast(friendlyError(error)));
      else if (document.body.classList.contains('tier-only')) setTierOnly(false);
      else if (page !== 'board') location.hash = 'board';
      else void App.minimizeApp();
    });
    void App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void cloud.retry();
    });
  }
}

async function setupInstall() {
  if (Capacitor.isNativePlatform() || !('serviceWorker' in navigator)) return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    $('#install-app').hidden = false;
  });
  $('#install-app').addEventListener(
    'click',
    guard(async () => {
      if (installPrompt) {
        await installPrompt.prompt();
        installPrompt = null;
        $('#install-app').hidden = true;
      }
    }),
  );
  $('#apply-update').addEventListener(
    'click',
    guard(async () => {
      if (session) await closeEditor();
      waitingWorker?.postMessage({ type: 'ACTIVATE_UPDATE' });
    }),
  );
  const registration = await navigator.serviceWorker.register('./sw.js');
  const offer = () => {
    if (registration.waiting && navigator.serviceWorker.controller) {
      waitingWorker = registration.waiting;
      $('#update-banner').hidden = false;
    }
  };
  offer();
  registration.addEventListener('updatefound', () =>
    registration.installing?.addEventListener('statechange', offer),
  );
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (waitingWorker && !refreshing) {
      refreshing = true;
      location.reload();
    }
  });
  if (navigator.storage?.persist) void navigator.storage.persist();
}

async function init() {
  store = await new TravelStore(deviceStorage).init(await getLegacyData());
  pexelsKey = (await getSetting('pexelsApiKey')) || '';
  $('#pexels-key').value = pexelsKey;
  $('#country-options').innerHTML = window.ALL_COUNTRIES.map(
    (country) => `<option value="${escape(country)}"></option>`,
  ).join('');
  installFilters();
  bindEvents();
  store.subscribe(render);
  cloud = new CloudSync(store, (state, error) => {
    syncState = state;
    syncError = error || null;
    updateConnection();
    if (page === 'settings') renderSettings();
  });
  setPage();
  render();
  void setupInstall().catch(() => {});
}
init().catch((error) => {
  $('#content').innerHTML =
    `<div class="empty-state"><h1>Your data couldn’t be opened</h1><p>${escape(friendlyError(error))}</p><p>Free some device storage, then reopen the app. Your existing data has not been replaced.</p></div>`;
});

const STORAGE_KEY = "travelTierListData";
const COUNTRY_SOURCE = Array.isArray(window.ALL_COUNTRIES)
  ? window.ALL_COUNTRIES
  : [];

const defaultCountries = [
  {
    id: "japan",
    name: "Japan",
    status: "planning",
    tier: "A",
    bestTime: "Mar-May",
    days: "10-14 days",
    budget: "$2,800",
    profiles: {
      mike: {
        scores: null,
        scoreTotal: null,
        notes: "Food, culture, and transit ease make it a high priority.",
        preNotes: "",
        postNotes: "",
      },
      jen: createEmptyProfile(),
    },
    attractions: [],
    images: [],
    scoreAverage: null,
  },
  {
    id: "italy",
    name: "Italy",
    status: "visited",
    tier: "S",
    bestTime: "Apr-Jun",
    days: "10 days",
    budget: "$2,400",
    profiles: {
      mike: {
        scores: null,
        scoreTotal: null,
        notes: "Loved Rome + Florence; need to see the Dolomites.",
        preNotes: "",
        postNotes: "",
      },
      jen: createEmptyProfile(),
    },
    attractions: [],
    images: [],
    scoreAverage: null,
  },
  {
    id: "peru",
    name: "Peru",
    status: "planning",
    tier: "B",
    bestTime: "May-Sep",
    days: "8-12 days",
    budget: "$1,800",
    profiles: {
      mike: {
        scores: null,
        scoreTotal: null,
        notes: "Machu Picchu + Sacred Valley itinerary.",
        preNotes: "",
        postNotes: "",
      },
      jen: createEmptyProfile(),
    },
    attractions: [],
    images: [],
    scoreAverage: null,
  },
  {
    id: "morocco",
    name: "Morocco",
    status: "not-visited",
    tier: "unranked",
    bestTime: "Oct-Nov",
    days: "7-9 days",
    budget: "$1,500",
    profiles: {
      mike: {
        scores: null,
        scoreTotal: null,
        notes: "Need to compare safety and transport options.",
        preNotes: "",
        postNotes: "",
      },
      jen: createEmptyProfile(),
    },
    attractions: [],
    images: [],
    scoreAverage: null,
  },
];

const statusLabel = {
  visited: "Visited",
  planning: "Planning",
  "not-visited": "Not Visited",
};

const scoreFields = [
  { key: "wonder", label: "Wonder" },
  { key: "things", label: "Things" },
  { key: "food", label: "Food" },
  { key: "transportation", label: "Transit" },
  { key: "safety", label: "Safety" },
];

const scoreTiers = [
  { tier: "S", min: 23 },
  { tier: "A", min: 20 },
  { tier: "B", min: 17 },
  { tier: "C", min: 14 },
  { tier: "D", min: 5 },
];

const PROFILE_KEYS = ["mike", "jen"];

function createEmptyProfile() {
  return {
    scores: null,
    scoreTotal: null,
    notes: "",
    preNotes: "",
    postNotes: "",
  };
}

const dialog = document.getElementById("country-dialog");
const form = document.getElementById("country-form");
const openAddButton = document.getElementById("open-add-country");
const closeDialogButton = document.getElementById("close-dialog");
const deleteButton = document.getElementById("delete-country");
const countrySelect = document.getElementById("country-name");
const countryAvailability = document.getElementById("country-availability");
const randomCountryButton = document.getElementById("random-country");

const statusFilter = document.getElementById("status-filter");
const tierFilter = document.getElementById("tier-filter");
const searchInput = document.getElementById("search-input");

const countryCards = document.getElementById("country-cards");
const tierContainers = Array.from(document.querySelectorAll(".tier-items"));
const cardTemplate = document.getElementById("country-card-template");
const summaryVisitedCount = document.getElementById("summary-visited-count");
const summaryPlanningCount = document.getElementById("summary-planning-count");
const summaryNotVisitedCount = document.getElementById("summary-not-visited-count");
const summaryRankedCount = document.getElementById("summary-ranked-count");
const summaryUnrankedCount = document.getElementById("summary-unranked-count");
const summaryRemainingCount = document.getElementById("summary-remaining-count");
const summaryVisitedList = document.getElementById("summary-visited-list");
const summaryPlanningList = document.getElementById("summary-planning-list");
const summaryNotVisitedList = document.getElementById("summary-not-visited-list");
const summaryRemainingList = document.getElementById("summary-remaining-list");

const dialogTitle = document.getElementById("dialog-title");
const scoreTotalOutput = document.getElementById("score-total");
const scoreTierOutput = document.getElementById("score-tier");
const autoTierToggle = document.getElementById("score-auto-tier");
const revealScoreButton = document.getElementById("reveal-score");
const profileRadios = Array.from(
  document.querySelectorAll('input[name="profile"]')
);
const revealDialog = document.getElementById("score-reveal-dialog");
const revealCloseButton = document.getElementById("close-reveal");
const revealTitle = document.getElementById("reveal-title");
const revealSubtitle = document.getElementById("reveal-subtitle");
const revealScoreValue = document.getElementById("reveal-score-value");
const revealBreakdown = document.getElementById("reveal-breakdown");
const revealGallery = document.getElementById("reveal-gallery");
const revealGalleryNote = document.getElementById("reveal-gallery-note");
const revealAttractions = document.getElementById("reveal-attractions");
const scoreSection = document.querySelector(".score-section");
const formFields = {
  id: null,
  name: document.getElementById("country-name"),
  status: document.getElementById("country-status"),
  tier: document.getElementById("country-tier"),
  bestTime: document.getElementById("country-best-time"),
  days: document.getElementById("country-days"),
  budget: document.getElementById("country-budget"),
  notes: document.getElementById("country-notes"),
  preNotes: document.getElementById("country-pre-notes"),
  postNotes: document.getElementById("country-post-notes"),
  attractions: document.getElementById("country-attractions"),
  images: document.getElementById("country-images"),
  scores: {
    wonder: document.getElementById("score-wonder"),
    things: document.getElementById("score-things"),
    food: document.getElementById("score-food"),
    transportation: document.getElementById("score-transportation"),
    safety: document.getElementById("score-safety"),
  },
};

let countries = loadCountries();
let activeId = null;
let activeProfile = "mike";
let dialogProfileDrafts = {
  mike: createEmptyProfile(),
  jen: createEmptyProfile(),
};

function normalizeName(value) {
  return value.trim().toLowerCase();
}

function normalizeCountry(country) {
  const hasProfiles = country && typeof country.profiles === "object";
  const baseProfiles = hasProfiles
    ? country.profiles
    : {
        mike: {
          scores: country?.scores ?? null,
          scoreTotal: country?.scoreTotal ?? null,
          notes: country?.notes ?? "",
          preNotes: country?.preNotes ?? "",
          postNotes: country?.postNotes ?? "",
        },
        jen: createEmptyProfile(),
      };

  const normalizedProfiles = PROFILE_KEYS.reduce((acc, key) => {
    const profile = baseProfiles?.[key] ?? createEmptyProfile();
    const rawScores =
      profile && typeof profile.scores === "object" ? profile.scores : null;
    const normalizedScores = rawScores
      ? scoreFields.reduce((scoreAcc, { key: scoreKey }) => {
          const value = Number(rawScores[scoreKey]);
          scoreAcc[scoreKey] = Number.isFinite(value) ? value : null;
          return scoreAcc;
        }, {})
      : null;
    const normalizedTotal = Number.isFinite(profile?.scoreTotal)
      ? profile.scoreTotal
      : computeScoreTotal(normalizedScores);
    acc[key] = {
      scores: normalizedScores,
      scoreTotal: Number.isFinite(normalizedTotal) ? normalizedTotal : null,
      notes: profile?.notes || "",
      preNotes: profile?.preNotes || "",
      postNotes: profile?.postNotes || "",
    };
    return acc;
  }, {});

  const normalizedTotal = computeAverageScore(normalizedProfiles);
  return {
    ...country,
    profiles: normalizedProfiles,
    scoreAverage: Number.isFinite(normalizedTotal) ? normalizedTotal : null,
    attractions: Array.isArray(country?.attractions) ? country.attractions : [],
    images: Array.isArray(country?.images) ? country.images : [],
  };
}

function loadCountries() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return defaultCountries;
  }
  try {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeCountry);
    }
  } catch (error) {
    console.error("Failed to parse saved data", error);
  }
  return defaultCountries;
}

function saveCountries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(countries));
}

function matchesFilters(country) {
  const statusValue = statusFilter.value;
  const tierValue = tierFilter.value;
  const query = searchInput.value.trim().toLowerCase();

  if (statusValue !== "all" && country.status !== statusValue) {
    return false;
  }

  if (tierValue !== "all" && country.tier !== tierValue) {
    return false;
  }

  if (query) {
    const profileNotes = PROFILE_KEYS.map((key) => {
      const profile = country.profiles?.[key];
      return [profile?.notes, profile?.preNotes, profile?.postNotes].join(" ");
    }).join(" ");
    const haystack = [
      country.name,
      country.bestTime,
      country.days,
      country.budget,
      profileNotes,
      (country.attractions || []).join(" "),
      (country.images || []).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) {
      return false;
    }
  }

  return true;
}

function renderTierList() {
  tierContainers.forEach((container) => {
    container.innerHTML = "";
  });

  const filtered = countries.filter(matchesFilters);

  filtered
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((country) => {
      const container = tierContainers.find(
        (target) => target.dataset.tier === country.tier
      );
      if (!container) {
        return;
      }
      const pill = document.createElement("div");
      pill.className = "tier-pill";
      pill.textContent = country.name;
      if (Number.isFinite(country.scoreAverage)) {
        const scoreBadge = document.createElement("strong");
        scoreBadge.className = "score-badge";
        scoreBadge.textContent = formatScoreValue(country.scoreAverage);
        pill.appendChild(scoreBadge);
      }
      const meta = document.createElement("span");
      meta.textContent = statusLabel[country.status];
      pill.appendChild(meta);
      pill.addEventListener("click", () => openDialog(country));
      container.appendChild(pill);
    });
}

function renderCards() {
  countryCards.innerHTML = "";
  const filtered = countries.filter(matchesFilters);

  filtered
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((country) => {
      const card = cardTemplate.content.cloneNode(true);
      const article = card.querySelector(".country-card");
      article.dataset.id = country.id;
      card.querySelector("h3").textContent = country.name;
      card.querySelector(
        ".meta"
      ).textContent = `${statusLabel[country.status]} - Tier ${country.tier.toUpperCase()}`;
      card.querySelector(".best-time").textContent =
        country.bestTime || "Add a season";
      card.querySelector(".time-needed").textContent =
        country.days || "Add a duration";
      card.querySelector(".budget").textContent =
        country.budget || "Add a budget";
      const scoreTotal = card.querySelector(".score-total");
      const scoreBreakdown = card.querySelector(".score-breakdown");
      const scoreData = buildScoreSummary(country);
      scoreTotal.textContent = scoreData.totalText;
      scoreBreakdown.textContent = scoreData.breakdownText;
      const notes = card.querySelector(".notes");
      const combinedNotes = combineProfileText(country, "notes");
      notes.textContent =
        combinedNotes || "Add ranking notes or quiz results.";
      const preNotes = card.querySelector(".pre-notes");
      const postNotes = card.querySelector(".post-notes");
      const noteGrid = card.querySelector(".note-grid");
      const combinedPre = combineProfileText(country, "preNotes");
      const combinedPost = combineProfileText(country, "postNotes");
      const hasPre = Boolean(combinedPre);
      const hasPost = Boolean(combinedPost);
      preNotes.textContent = combinedPre || "No pre-trip notes yet.";
      postNotes.textContent = combinedPost || "No post-trip notes yet.";
      noteGrid.classList.toggle("empty", !hasPre && !hasPost);
      preNotes.parentElement.classList.toggle("empty", !hasPre);
      postNotes.parentElement.classList.toggle("empty", !hasPost);
      const editButton = card.querySelector(".edit-button");
      editButton.addEventListener("click", () => openDialog(country));
      countryCards.appendChild(card);
    });
}

function render() {
  renderTierList();
  renderCards();
  renderSummary();
  renderCountryOptions();
}

function renderSummary() {
  const visited = countries.filter((country) => country.status === "visited");
  const planning = countries.filter((country) => country.status === "planning");
  const notVisited = countries.filter(
    (country) => country.status === "not-visited"
  );
  const ranked = countries.filter((country) => country.tier !== "unranked");
  const unranked = countries.filter((country) => country.tier === "unranked");

  summaryVisitedCount.textContent = visited.length;
  summaryPlanningCount.textContent = planning.length;
  summaryNotVisitedCount.textContent = notVisited.length;
  summaryRankedCount.textContent = ranked.length;
  summaryUnrankedCount.textContent = unranked.length;

  const availableCountries = getRemainingCountries();
  summaryRemainingCount.textContent = availableCountries.length;

  fillSummaryList(summaryVisitedList, visited.map((country) => country.name));
  fillSummaryList(summaryPlanningList, planning.map((country) => country.name));
  fillSummaryList(
    summaryNotVisitedList,
    notVisited.map((country) => country.name)
  );
  fillSummaryList(summaryRemainingList, availableCountries);
}

function fillSummaryList(list, items) {
  list.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("li");
    empty.textContent = "None yet";
    list.appendChild(empty);
    return;
  }
  items
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });
}

function openDialog(country = null) {
  if (country) {
    dialogTitle.textContent = `Edit ${country.name}`;
    activeId = country.id;
    formFields.name.value = country.name;
    formFields.name.disabled = true;
    if (randomCountryButton) {
      randomCountryButton.disabled = true;
    }
    formFields.status.value = country.status;
    formFields.tier.value = country.tier;
    formFields.bestTime.value = country.bestTime || "";
    formFields.days.value = country.days || "";
    formFields.budget.value = country.budget || "";
    formFields.attractions.value = (country.attractions || []).join(", ");
    formFields.images.value = (country.images || []).join(", ");
    dialogProfileDrafts = cloneProfiles(country.profiles);
    activeProfile = "mike";
    setActiveProfile(activeProfile, true);
    deleteButton.style.display = "inline-flex";
  } else {
    dialogTitle.textContent = "Add Country";
    activeId = null;
    form.reset();
    formFields.name.disabled = false;
    if (randomCountryButton) {
      randomCountryButton.disabled = false;
    }
    formFields.tier.value = "unranked";
    formFields.attractions.value = "";
    formFields.images.value = "";
    dialogProfileDrafts = {
      mike: createEmptyProfile(),
      jen: createEmptyProfile(),
    };
    activeProfile = "mike";
    setActiveProfile(activeProfile, true);
    deleteButton.style.display = "none";
  }

  renderCountryOptions();
  updateAvailabilityHint();
  updateScorePreview();
  if (scoreSection) {
    scoreSection.classList.remove("revealed");
  }
  dialog.showModal();
}

function closeDialog() {
  dialog.close();
}

function upsertCountry(data) {
  if (activeId) {
    countries = countries.map((country) =>
      country.id === activeId ? { ...country, ...data } : country
    );
  } else {
    const id = normalizeName(data.name).replace(/\s+/g, "-");
    countries.push({ id, ...data });
  }
  saveCountries();
  render();
}

function deleteCountry() {
  if (!activeId) {
    return;
  }
  countries = countries.filter((country) => country.id !== activeId);
  saveCountries();
  render();
  closeDialog();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  storeActiveProfileDraft();
  const averageScore = computeAverageScore(dialogProfileDrafts);
  const scoreTier = getScoreTier(averageScore);
  const data = {
    name: formFields.name.value.trim(),
    status: formFields.status.value,
    tier: formFields.tier.value,
    bestTime: formFields.bestTime.value.trim(),
    days: formFields.days.value.trim(),
    budget: formFields.budget.value.trim(),
    profiles: cloneProfiles(dialogProfileDrafts),
    scoreAverage: Number.isFinite(averageScore) ? averageScore : null,
    attractions: parseList(formFields.attractions.value),
    images: parseList(formFields.images.value),
  };

  if (autoTierToggle && autoTierToggle.checked && scoreTier !== "unranked") {
    data.tier = scoreTier;
    formFields.tier.value = scoreTier;
  }

  if (!data.name) {
    formFields.name.focus();
    return;
  }

  const existing = countries.find(
    (country) => normalizeName(country.name) === normalizeName(data.name)
  );
  if (existing && !activeId) {
    openDialog(existing);
    return;
  }

  upsertCountry(data);
  closeDialog();
});

deleteButton.addEventListener("click", deleteCountry);
openAddButton.addEventListener("click", () => openDialog());
closeDialogButton.addEventListener("click", closeDialog);

[statusFilter, tierFilter, searchInput].forEach((input) => {
  input.addEventListener("input", render);
});

render();

Object.values(formFields.scores).forEach((input) => {
  if (input) {
    input.addEventListener("input", updateScorePreview);
  }
});

if (autoTierToggle) {
  autoTierToggle.addEventListener("input", updateScorePreview);
}

profileRadios.forEach((radio) => {
  radio.addEventListener("input", (event) => {
    setActiveProfile(event.target.value);
  });
});

if (randomCountryButton) {
  randomCountryButton.addEventListener("click", () => {
    const remaining = getRemainingCountries();
    if (!remaining.length) {
      return;
    }
    const choice = remaining[Math.floor(Math.random() * remaining.length)];
    formFields.name.value = choice;
  });
}

if (revealScoreButton) {
  revealScoreButton.addEventListener("click", () => {
    if (!scoreSection) {
      return;
    }
    scoreSection.classList.add("revealed");
    openRevealDialog();
  });
}

if (revealCloseButton && revealDialog) {
  revealCloseButton.addEventListener("click", () => {
    revealDialog.close();
  });
}

function getRemainingCountries() {
  if (!COUNTRY_SOURCE.length) {
    return [];
  }
  const existing = new Set(countries.map((country) => normalizeName(country.name)));
  return COUNTRY_SOURCE.filter(
    (country) => !existing.has(normalizeName(country))
  );
}

function renderCountryOptions() {
  if (!countrySelect) {
    return;
  }
  countrySelect.innerHTML = "";
  const available = getAvailableCountryOptions();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a country";
  placeholder.disabled = true;
  placeholder.selected = !activeId;
  countrySelect.appendChild(placeholder);

  available
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .forEach((country) => {
      const option = document.createElement("option");
      option.value = country;
      option.textContent = country;
      if (activeId && countrySelect.value === country) {
        option.selected = true;
      }
      countrySelect.appendChild(option);
    });
  if (activeId) {
    countrySelect.value = countries.find((c) => c.id === activeId)?.name || "";
  }
  updateAvailabilityHint();
}

function updateAvailabilityHint() {
  if (!countryAvailability) {
    return;
  }
  const remaining = getRemainingCountries();
  const total = COUNTRY_SOURCE.length;
  if (!total) {
    countryAvailability.textContent = `${countries.length} countries saved`;
    return;
  }
  countryAvailability.textContent = `${remaining.length} of ${total} countries remaining`;
  if (randomCountryButton && !activeId) {
    randomCountryButton.disabled = remaining.length === 0;
  }
}

function getAvailableCountryOptions() {
  if (!COUNTRY_SOURCE.length) {
    return countries.map((country) => country.name);
  }
  if (!activeId) {
    return getRemainingCountries();
  }
  const currentName = countries.find((country) => country.id === activeId)?.name;
  const remaining = getRemainingCountries().filter(
    (name) => normalizeName(name) !== normalizeName(currentName || "")
  );
  return currentName ? [currentName, ...remaining] : remaining;
}

function formatScoreValue(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return value % 1 === 0 ? String(value) : value.toFixed(1);
}

function computeAverageScore(profiles) {
  const totals = PROFILE_KEYS.map((key) => profiles?.[key]?.scoreTotal).filter(
    (value) => Number.isFinite(value)
  );
  if (!totals.length) {
    return null;
  }
  const sum = totals.reduce((acc, value) => acc + value, 0);
  return sum / totals.length;
}

function parseList(value) {
  if (!value) {
    return [];
  }
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cloneProfiles(profiles) {
  return PROFILE_KEYS.reduce((acc, key) => {
    const profile = profiles?.[key] ?? createEmptyProfile();
    acc[key] = {
      scores: profile.scores ? { ...profile.scores } : null,
      scoreTotal: Number.isFinite(profile.scoreTotal) ? profile.scoreTotal : null,
      notes: profile.notes || "",
      preNotes: profile.preNotes || "",
      postNotes: profile.postNotes || "",
    };
    return acc;
  }, {});
}

function buildProfileFromForm() {
  const scores = readScoreInputs();
  const scoreTotal = computeScoreTotal(scores);
  return {
    scores,
    scoreTotal: Number.isFinite(scoreTotal) ? scoreTotal : null,
    notes: formFields.notes.value.trim(),
    preNotes: formFields.preNotes.value.trim(),
    postNotes: formFields.postNotes.value.trim(),
  };
}

function storeActiveProfileDraft() {
  dialogProfileDrafts[activeProfile] = buildProfileFromForm();
}

function setActiveProfile(profile, force = false) {
  if (!PROFILE_KEYS.includes(profile)) {
    activeProfile = "mike";
  } else {
    if (!force) {
      storeActiveProfileDraft();
    }
    activeProfile = profile;
  }

  profileRadios.forEach((radio) => {
    radio.checked = radio.value === activeProfile;
  });

  const profileData = dialogProfileDrafts[activeProfile] || createEmptyProfile();
  formFields.notes.value = profileData.notes || "";
  formFields.preNotes.value = profileData.preNotes || "";
  formFields.postNotes.value = profileData.postNotes || "";
  setScoreInputs(profileData.scores || {});
  updateScorePreview();
}

function combineProfileText(country, field) {
  const parts = PROFILE_KEYS.map((key) => {
    const value = country.profiles?.[key]?.[field];
    if (!value) {
      return "";
    }
    const label = key === "mike" ? "Mike" : "Jen";
    return `${label}: ${value}`;
  }).filter(Boolean);
  return parts.join(" | ");
}

function buildProfileBreakdown(profile) {
  if (!profile?.scores) {
    return "";
  }
  return scoreFields
    .map(({ key, label }) => `${label} ${profile.scores[key] ?? "-"}`)
    .join(", ");
}

function buildDialogPreview() {
  storeActiveProfileDraft();
  const profiles = cloneProfiles(dialogProfileDrafts);
  const average = computeAverageScore(profiles);
  return {
    name: formFields.name.value.trim() || "Score reveal",
    profiles,
    scoreAverage: Number.isFinite(average) ? average : null,
    attractions: parseList(formFields.attractions.value),
    images: parseList(formFields.images.value),
  };
}

function openRevealDialog() {
  if (!revealDialog) {
    return;
  }
  const preview = buildDialogPreview();
  const scoreSummary = buildScoreSummary(preview);
  const mikeBreakdown = buildProfileBreakdown(preview.profiles.mike);
  const jenBreakdown = buildProfileBreakdown(preview.profiles.jen);

  if (revealTitle) {
    revealTitle.textContent = preview.name || "Score reveal";
  }
  if (revealSubtitle) {
    revealSubtitle.textContent = "Average of Mike and Jen.";
  }
  if (revealScoreValue) {
    revealScoreValue.textContent = scoreSummary.totalText;
  }
  if (revealBreakdown) {
    const breakdownParts = [];
    if (mikeBreakdown) {
      breakdownParts.push(`Mike: ${mikeBreakdown}`);
    }
    if (jenBreakdown) {
      breakdownParts.push(`Jen: ${jenBreakdown}`);
    }
    revealBreakdown.textContent =
      breakdownParts.join(" | ") || scoreSummary.breakdownText;
  }

  if (revealGallery) {
    revealGallery.innerHTML = "";
    if (preview.images.length) {
      preview.images.slice(0, 6).forEach((url) => {
        const img = document.createElement("img");
        img.src = url;
        img.alt = preview.name;
        revealGallery.appendChild(img);
      });
      if (revealGalleryNote) {
        revealGalleryNote.textContent = "";
      }
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "reveal-placeholder";
      placeholder.textContent = "Add image URLs in the form to populate this gallery.";
      revealGallery.appendChild(placeholder);
      if (revealGalleryNote) {
        revealGalleryNote.textContent = "";
      }
    }
  }

  if (revealAttractions) {
    revealAttractions.innerHTML = "";
    if (preview.attractions.length) {
      preview.attractions.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        revealAttractions.appendChild(li);
      });
    } else {
      const li = document.createElement("li");
      li.textContent = "Add top attractions in the form to show them here.";
      revealAttractions.appendChild(li);
    }
  }

  revealDialog.showModal();
}

function setScoreInputs(scores = {}) {
  scoreFields.forEach(({ key }) => {
    const input = formFields.scores[key];
    if (!input) {
      return;
    }
    const value = Number(scores[key]);
    input.value = Number.isFinite(value) ? String(value) : "";
  });
}

function readScoreInputs() {
  const values = {};
  scoreFields.forEach(({ key }) => {
    const raw = formFields.scores[key]?.value ?? "";
    const parsed = Number(raw);
    values[key] = Number.isFinite(parsed) ? parsed : null;
  });
  return values;
}

function computeScoreTotal(scores) {
  if (!scores) {
    return null;
  }
  const values = scoreFields.map(({ key }) => scores[key]);
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0);
}

function getScoreTier(total) {
  if (!Number.isFinite(total)) {
    return "unranked";
  }
  const match = scoreTiers.find((entry) => total >= entry.min);
  return match ? match.tier : "unranked";
}

function buildScoreSummary(country) {
  const average = Number.isFinite(country.scoreAverage) ? country.scoreAverage : null;
  if (!Number.isFinite(average)) {
    return {
      totalText: "Not scored",
      breakdownText: "Add scores to generate a tier.",
    };
  }

  const parts = PROFILE_KEYS.map((key) => {
    const total = country.profiles?.[key]?.scoreTotal;
    if (!Number.isFinite(total)) {
      return "";
    }
    const label = key === "mike" ? "Mike" : "Jen";
    return `${label} ${formatScoreValue(total)}`;
  }).filter(Boolean);
  const breakdown = parts.length
    ? `${parts.join(" | ")} (Avg ${formatScoreValue(average)})`
    : `Avg ${formatScoreValue(average)}`;

  return {
    totalText: `${formatScoreValue(average)} / 25`,
    breakdownText: breakdown,
  };
}

function updateScorePreview() {
  if (!scoreTotalOutput || !scoreTierOutput) {
    return;
  }
  const tempProfiles = cloneProfiles(dialogProfileDrafts);
  tempProfiles[activeProfile] = buildProfileFromForm();
  const average = computeAverageScore(tempProfiles);
  const tier = getScoreTier(average);

  scoreTotalOutput.textContent = Number.isFinite(average)
    ? `${formatScoreValue(average)} / 25`
    : "Not scored";
  scoreTierOutput.textContent = tier === "unranked" ? "-" : tier;

  if (autoTierToggle && autoTierToggle.checked && tier !== "unranked") {
    formFields.tier.value = tier;
  }
}

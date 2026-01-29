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
    bestTime: "Mar–May",
    days: "10-14 days",
    budget: "$2,800",
    notes: "Food, culture, and transit ease make it a high priority.",
  },
  {
    id: "italy",
    name: "Italy",
    status: "visited",
    tier: "S",
    bestTime: "Apr–Jun",
    days: "10 days",
    budget: "$2,400",
    notes: "Loved Rome + Florence; need to see the Dolomites.",
  },
  {
    id: "peru",
    name: "Peru",
    status: "planning",
    tier: "B",
    bestTime: "May–Sep",
    days: "8-12 days",
    budget: "$1,800",
    notes: "Machu Picchu + Sacred Valley itinerary.",
  },
  {
    id: "morocco",
    name: "Morocco",
    status: "not-visited",
    tier: "unranked",
    bestTime: "Oct–Nov",
    days: "7-9 days",
    budget: "$1,500",
    notes: "Need to compare safety and transport options.",
  },
];

const statusLabel = {
  visited: "Visited",
  planning: "Planning",
  "not-visited": "Not Visited",
};

const dialog = document.getElementById("country-dialog");
const form = document.getElementById("country-form");
const openAddButton = document.getElementById("open-add-country");
const closeDialogButton = document.getElementById("close-dialog");
const deleteButton = document.getElementById("delete-country");
const countryOptions = document.getElementById("country-options");
const countryAvailability = document.getElementById("country-availability");

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
const formFields = {
  id: null,
  name: document.getElementById("country-name"),
  status: document.getElementById("country-status"),
  tier: document.getElementById("country-tier"),
  bestTime: document.getElementById("country-best-time"),
  days: document.getElementById("country-days"),
  budget: document.getElementById("country-budget"),
  notes: document.getElementById("country-notes"),
};

let countries = loadCountries();
let activeId = null;

function normalizeName(value) {
  return value.trim().toLowerCase();
}

function loadCountries() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return defaultCountries;
  }
  try {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      return parsed;
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
    const haystack = [
      country.name,
      country.notes,
      country.bestTime,
      country.days,
      country.budget,
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
      ).textContent = `${statusLabel[country.status]} · Tier ${country.tier.toUpperCase()}`;
      card.querySelector(".best-time").textContent =
        country.bestTime || "Add a season";
      card.querySelector(".time-needed").textContent =
        country.days || "Add a duration";
      card.querySelector(".budget").textContent =
        country.budget || "Add a budget";
      const notes = card.querySelector(".notes");
      notes.textContent = country.notes || "Add ranking notes or quiz results.";
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
    formFields.status.value = country.status;
    formFields.tier.value = country.tier;
    formFields.bestTime.value = country.bestTime || "";
    formFields.days.value = country.days || "";
    formFields.budget.value = country.budget || "";
    formFields.notes.value = country.notes || "";
    deleteButton.style.display = "inline-flex";
  } else {
    dialogTitle.textContent = "Add Country";
    activeId = null;
    form.reset();
    formFields.tier.value = "unranked";
    deleteButton.style.display = "none";
  }

  updateAvailabilityHint();
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
  const data = {
    name: formFields.name.value.trim(),
    status: formFields.status.value,
    tier: formFields.tier.value,
    bestTime: formFields.bestTime.value.trim(),
    days: formFields.days.value.trim(),
    budget: formFields.budget.value.trim(),
    notes: formFields.notes.value.trim(),
  };

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
  if (!countryOptions) {
    return;
  }
  countryOptions.innerHTML = "";
  const available = COUNTRY_SOURCE.length ? COUNTRY_SOURCE : countries.map((c) => c.name);
  available
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .forEach((country) => {
      const option = document.createElement("option");
      option.value = country;
      countryOptions.appendChild(option);
    });
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
}

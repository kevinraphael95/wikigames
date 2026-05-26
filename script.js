/* ============================================================
   WikiGames — script.js
   Zéro donnée hardcodée. Toutes les questions sont générées
   dynamiquement depuis des APIs publiques :
     · Wikipedia REST API (résumés, images, vues, aléatoire)
     · Open Trivia Database (Vrai/Faux)
   ============================================================ */

"use strict";

/* ── APIs ── */
const WIKI_REST  = "https://fr.wikipedia.org/api/rest_v1";
const WIKI_API   = "https://fr.wikipedia.org/w/api.php";
const WIKI_VIEWS = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/fr.wikipedia/all-access/all-agents";
const OPENTDB    = "https://opentdb.com/api.php";

/* ── État global ── */
const state = {
  mode: "which-country",
  score: 0,
  streak: 0,
  best: 0,
  rounds: 0,
  answered: false,
  opentdbToken: null,
};

/* ── Utilitaires DOM ── */
const qs = s => document.querySelector(s);
const card = qs("#card");

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function decodeHtml(html) {
  const txt = document.createElement("textarea");
  txt.innerHTML = html;
  return txt.value;
}

/* ── Score ── */
function bump(id) {
  const el = qs(`#${id}`);
  if (!el) return;
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
  setTimeout(() => el.classList.remove("bump"), 300);
}

function updateScore() {
  qs("#hdr-score").textContent  = state.score;
  qs("#hdr-streak").textContent = `×${state.streak}`;
  qs("#sb-score").textContent   = state.score;
  qs("#sb-streak").textContent  = state.streak;
  qs("#sb-best").textContent    = state.best;
  qs("#sb-rounds").textContent  = state.rounds;
}

function onCorrect() {
  const pts = 10 + state.streak * 2;
  state.score  += pts;
  state.streak += 1;
  state.best    = Math.max(state.best, state.streak);
  state.rounds += 1;
  bump("sb-score");
  bump("sb-streak");
  updateScore();
  return pts;
}

function onWrong() {
  state.streak  = 0;
  state.rounds += 1;
  updateScore();
}

/* ── UI helpers ── */
function showLoader() {
  card.innerHTML = `
    <div class="loader">
      <div class="loader-ring"></div>
      <span>Chargement…</span>
    </div>`;
}

function showError(msg) {
  card.innerHTML = `
    <div class="error-box">
      <span class="error-icon">⚡</span>
      ${esc(msg)}<br>
      <button class="retry-btn" onclick="loadQuestion()">Réessayer</button>
    </div>`;
}

function nextBtn() {
  return `
    <div class="actions">
      <button class="btn-next" disabled>
        Suivant
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </button>
    </div>`;
}

/* ── Bind options ── */
function bindOptions(correctVal, onReveal) {
  state.answered = false;
  const opts    = card.querySelectorAll(".opt");
  const nextBtnEl = card.querySelector(".btn-next");
  const fb      = card.querySelector(".feedback-bar");

  opts.forEach(btn => {
    btn.onclick = () => {
      if (state.answered) return;
      state.answered = true;

      const isOk = btn.dataset.val === String(correctVal);
      opts.forEach(o => o.disabled = true);
      btn.classList.add(isOk ? "correct" : "wrong");

      if (!isOk) {
        const winner = [...opts].find(o => o.dataset.val === String(correctVal));
        if (winner) winner.classList.add("correct");
      }

      if (fb) {
        fb.className = `feedback-bar show ${isOk ? "ok" : "ko"}`;
        if (!onReveal) {
          fb.textContent = isOk ? "✓ Bonne réponse !" : `✗ C'était : ${correctVal}`;
        }
      }

      isOk ? onCorrect() : onWrong();
      if (onReveal) onReveal(isOk, fb);
      if (nextBtnEl) nextBtnEl.disabled = false;
    };
  });

  if (nextBtnEl) nextBtnEl.onclick = loadQuestion;
}

/* ════════════════════════════════════════════════════
   Wikipedia helpers
   ════════════════════════════════════════════════════ */

/** Résumé complet d'un article Wikipedia (fr) */
async function wikiSummary(title) {
  const r = await fetch(`${WIKI_REST}/page/summary/${encodeURIComponent(title)}`);
  if (!r.ok) throw new Error(`Wiki summary ${r.status}`);
  return r.json();
}

/** Articles random d'une catégorie Wikipedia via SPARQL-like (API action) */
async function wikiRandomInCategory(category, limit = 20) {
  const params = new URLSearchParams({
    action: "query",
    list: "categorymembers",
    cmtitle: `Catégorie:${category}`,
    cmtype: "page",
    cmlimit: String(limit),
    cmsort: "timestamp",
    cmdir: "desc",
    format: "json",
    origin: "*",
  });
  const r = await fetch(`${WIKI_API}?${params}`);
  if (!r.ok) throw new Error(`Wiki cat ${r.status}`);
  const d = await r.json();
  return shuffle(d.query.categorymembers || []);
}

/** Cherche les pages qui lient vers un article donné — utile pour trouver des distracteurs du même thème */
async function wikiSearch(query, limit = 10) {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: String(limit),
    format: "json",
    origin: "*",
  });
  const r = await fetch(`${WIKI_API}?${params}`);
  if (!r.ok) throw new Error(`Wiki search ${r.status}`);
  const d = await r.json();
  return d.query.search || [];
}

/** Nombre de vues Wikipedia d'un article sur les 30 derniers jours */
async function wikiPageviews(title) {
  const now   = new Date();
  const end   = now.toISOString().slice(0, 10).replace(/-/g, "");
  const start = new Date(now - 30 * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
  const url   = `${WIKI_VIEWS}/${encodeURIComponent(title)}/monthly/${start}00/${end}00`;
  const r = await fetch(url);
  if (!r.ok) return 0;
  const d = await r.json();
  return (d.items || []).reduce((s, x) => s + (x.views || 0), 0);
}

/** Extrait le pays depuis les catégories ou les propriétés Wikidata d'un résumé */
function extractCountryFromSummary(page) {
  /* On tente d'abord via description courte puis via extract */
  const desc = (page.description || "") + " " + (page.extract || "");
  /* Table de correspondance mots-clés → pays */
  const COUNTRIES = [
    ["france", "France"], ["italie", "Italie"], ["espagne", "Espagne"],
    ["royaume-uni", "Royaume-Uni"], ["allemagne", "Allemagne"], ["portugal", "Portugal"],
    ["grèce", "Grèce"], ["russie", "Russie"], ["turquie", "Turquie"],
    ["états-unis", "États-Unis"], ["australie", "Australie"], ["canada", "Canada"],
    ["chine", "Chine"], ["japon", "Japon"], ["inde", "Inde"], ["brésil", "Brésil"],
    ["mexique", "Mexique"], ["pérou", "Pérou"], ["egypte", "Égypte"], ["égypte", "Égypte"],
    ["maroc", "Maroc"], ["belgique", "Belgique"], ["suisse", "Suisse"],
    ["pays-bas", "Pays-Bas"], ["autriche", "Autriche"], ["pologne", "Pologne"],
    ["suède", "Suède"], ["norvège", "Norvège"], ["danemark", "Danemark"],
    ["finlande", "Finlande"], ["irlande", "Irlande"], ["hongrie", "Hongrie"],
    ["roumanie", "Roumanie"], ["argentine", "Argentine"], ["chili", "Chili"],
    ["colombie", "Colombie"], ["émirats", "Émirats arabes unis"],
    ["arabie", "Arabie saoudite"], ["iran", "Iran"], ["irak", "Irak"],
    ["israël", "Israël"], ["syrie", "Syrie"], ["jordanie", "Jordanie"],
    ["afrique du sud", "Afrique du Sud"], ["nigeria", "Nigeria"],
    ["kenya", "Kenya"], ["éthiopie", "Éthiopie"], ["tanzanie", "Tanzanie"],
    ["indonésie", "Indonésie"], ["malaisie", "Malaisie"], ["thaïlande", "Thaïlande"],
    ["vietnam", "Vietnam"], ["corée", "Corée du Sud"], ["taiwan", "Taïwan"],
    ["philippines", "Philippines"], ["pakistan", "Pakistan"], ["bangladesh", "Bangladesh"],
    ["nepal", "Népal"], ["sri lanka", "Sri Lanka"],
    ["nouvelle-zélande", "Nouvelle-Zélande"], ["cambodge", "Cambodge"],
    ["birmanie", "Birmanie"], ["laos", "Laos"], ["mongolie", "Mongolie"],
    ["ouzbékistan", "Ouzbékistan"], ["kazakhstan", "Kazakhstan"],
    ["ukraine", "Ukraine"], ["géorgie", "Géorgie"], ["arménie", "Arménie"],
    ["azerbaïdjan", "Azerbaïdjan"], ["biélorussie", "Biélorussie"],
    ["serbie", "Serbie"], ["croatie", "Croatie"], ["slovénie", "Slovénie"],
    ["slovaquie", "Slovaquie"], ["tchéquie", "Tchéquie"], ["bulgarie", "Bulgarie"],
    ["lituanie", "Lituanie"], ["lettonie", "Lettonie"], ["estonie", "Estonie"],
    ["pérou", "Pérou"], ["bolivie", "Bolivie"], ["équateur", "Équateur"],
    ["venezuela", "Venezuela"], ["cuba", "Cuba"], ["jamaïque", "Jamaïque"],
    ["haïti", "Haïti"], ["tunisie", "Tunisie"], ["algérie", "Algérie"],
    ["libye", "Libye"], ["soudan", "Soudan"], ["ghana", "Ghana"],
    ["sénégal", "Sénégal"], ["côte d'ivoire", "Côte d'Ivoire"],
    ["cameroun", "Cameroun"], ["angola", "Angola"], ["mozambique", "Mozambique"],
    ["zimbabwe", "Zimbabwe"], ["zambie", "Zambie"], ["ouganda", "Ouganda"],
  ];
  const lower = desc.toLowerCase();
  for (const [kw, country] of COUNTRIES) {
    if (lower.includes(kw)) return country;
  }
  return null;
}

/* ════════════════════════════════════════════════════
   Open Trivia DB helpers
   ════════════════════════════════════════════════════ */

async function opentdbGetToken() {
  if (state.opentdbToken) return state.opentdbToken;
  const r = await fetch("https://opentdb.com/api_token.php?command=request");
  const d = await r.json();
  state.opentdbToken = d.token;
  return d.token;
}

async function opentdbFetch(amount = 5, category = "") {
  const token = await opentdbGetToken();
  const params = new URLSearchParams({
    amount: String(amount),
    type: "boolean",
    token,
    ...(category ? { category } : {}),
  });
  const r = await fetch(`${OPENTDB}?${params}`);
  const d = await r.json();

  /* Token épuisé → reset */
  if (d.response_code === 4) {
    await fetch(`https://opentdb.com/api_token.php?command=reset&token=${token}`);
    return opentdbFetch(amount, category);
  }
  /* Pas assez de questions → essai sans catégorie */
  if (d.response_code !== 0 || !d.results?.length) {
    if (category) return opentdbFetch(amount, "");
    throw new Error("OpenTDB: pas de questions disponibles");
  }
  return d.results;
}

/* ── Cache de questions V/F ── */
let tfCache = [];

async function getTFQuestion() {
  if (!tfCache.length) {
    /* Catégories variées : science (17), géo (22), histoire (23), général (9) */
    const cats = [17, 22, 23, 9];
    const cat  = cats[Math.floor(Math.random() * cats.length)];
    tfCache    = await opentdbFetch(10, cat);
  }
  return tfCache.pop();
}

/* ── Cache de questions Chrono ── */
let chronoCache = [];

const HISTORY_CATS = [
  "Révolution française",
  "Première Guerre mondiale",
  "Seconde Guerre mondiale",
  "Histoire de l'Antiquité",
  "Révolution industrielle",
  "Guerre froide",
  "Décolonisation",
  "Histoire du Moyen Âge",
  "Renaissance italienne",
];

async function fillChronoCache() {
  const cat    = HISTORY_CATS[Math.floor(Math.random() * HISTORY_CATS.length)];
  const pages  = await wikiRandomInCategory(cat, 30);
  /* Pour chaque page, on veut extraire une année depuis le résumé */
  const results = [];
  for (const p of pages.slice(0, 8)) {
    try {
      const summary = await wikiSummary(p.title);
      const year    = extractYearFromSummary(summary.extract || "");
      if (year !== null) {
        results.push({ label: summary.title, year, page: summary });
      }
    } catch { /* skip */ }
    if (results.length >= 6) break;
  }
  return results;
}

function extractYearFromSummary(text) {
  /* Cherche un nombre entre -3000 et 2023 clairement mentionné comme date */
  /* On préfère des patterns comme "en 1789", "en 476", "(1914)", etc. */
  const patterns = [
    /\((\d{3,4})\)/,                     // (1789)
    /en\s+([-−]?\d{3,4})/i,              // en 1789
    /vers\s+([-−]?\d{3,4})/i,            // vers 1492
    /(?:le|du|au)\s+\d{1,2}\s+\w+\s+(\d{4})/i, // le 14 juillet 1789
    /(\d{4})\s*(?:–|-)\s*\d{4}/,         // 1914-1918
    /^.{0,120}(\d{4})/,                  // premier nombre de 4 chiffres
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const y = parseInt(m[1].replace("−", "-"));
      if (y >= -3000 && y <= 2023) return y;
    }
  }
  return null;
}

/* ── Cache de paires Popularité ── */
const POP_CATEGORIES = [
  ["Capitale_mondiale", "Grande_ville"],
  ["Artiste_français", "Artiste_américain"],
  ["Film_français", "Film_américain"],
  ["Animal_sauvage", "Animal_domestique"],
  ["Sportif_français", "Sportif_mondial"],
  ["Personnalité_politique_française", "Chef_d'État"],
  ["Musique_pop", "Musique_rock"],
  ["Pays_d'Asie", "Pays_d'Europe"],
];

/* Stratégie : prend deux articles Wikipedia bien distincts
   et compare leurs vraies pageviews sur 30 jours */
async function buildPopPair() {
  /* On prend des articles bien connus via la catégorie Featured Articles */
  const candidates = await wikiRandomInCategory("Article_de_qualité", 40);
  if (candidates.length < 4) throw new Error("Pas assez d'articles");

  const picked = shuffle(candidates).slice(0, 4);
  const results = [];
  for (const p of picked.slice(0, 2)) {
    try {
      const views = await wikiPageviews(p.title);
      if (views > 0) results.push({ title: p.title, views });
    } catch { /* skip */ }
  }

  if (results.length < 2) {
    /* Fallback : retry avec d'autres articles */
    for (const p of picked.slice(2)) {
      try {
        const views = await wikiPageviews(p.title);
        if (views > 0) results.push({ title: p.title, views });
      } catch { /* skip */ }
    }
  }

  if (results.length < 2) throw new Error("Pas assez de données pageviews");

  /* Trie pour que A soit le plus populaire */
  results.sort((a, b) => b.views - a.views);
  return {
    a: { title: results[0].title, views: results[0].views },
    b: { title: results[1].title, views: results[1].views },
  };
}

/* ── Pool de monuments/lieux célèbres via catégorie Wikipedia ── */
const LANDMARK_CATEGORIES = [
  "Monument_historique_classé",
  "Patrimoine_mondial",
  "Château_fort",
  "Cathédrale",
  "Mosquée",
  "Temple_bouddhiste",
  "Pyramide",
];

async function getRandomLandmark() {
  const cat   = LANDMARK_CATEGORIES[Math.floor(Math.random() * LANDMARK_CATEGORIES.length)];
  const pages = await wikiRandomInCategory(cat, 30);
  for (const p of shuffle(pages)) {
    try {
      const summary = await wikiSummary(p.title);
      if (!summary.thumbnail?.source) continue;
      const country = extractCountryFromSummary(summary);
      if (!country) continue;
      return { summary, country };
    } catch { /* skip */ }
  }
  throw new Error("Aucun monument avec image et pays détectable");
}

/* ════════════════════════════════════════════════════
   MODE : Pays
   ════════════════════════════════════════════════════ */

const ALL_COUNTRIES = [
  "France","Italie","Espagne","Royaume-Uni","Allemagne","Portugal","Grèce",
  "Russie","Turquie","États-Unis","Australie","Canada","Chine","Japon","Inde",
  "Brésil","Mexique","Pérou","Égypte","Maroc","Belgique","Suisse","Pays-Bas",
  "Autriche","Pologne","Suède","Norvège","Danemark","Finlande","Irlande",
  "Hongrie","Roumanie","Argentine","Chili","Colombie","Émirats arabes unis",
  "Arabie saoudite","Iran","Israël","Afrique du Sud","Nigeria","Kenya",
  "Indonésie","Malaisie","Thaïlande","Vietnam","Corée du Sud","Taïwan",
  "Philippines","Pakistan","Bangladesh","Népal","Nouvelle-Zélande",
];

async function loadCountry() {
  const { summary, country } = await getRandomLandmark();

  /* 3 distracteurs random parmi les pays connus (sauf le bon) */
  const distractors = shuffle(ALL_COUNTRIES.filter(c => c !== country)).slice(0, 3);
  const opts = shuffle([
    { val: country, label: country },
    ...distractors.map(d => ({ val: d, label: d })),
  ]);

  const img = summary.thumbnail?.source;

  card.innerHTML = `
    ${img ? `
      <div class="card-image-wrap">
        <img class="card-image" src="${esc(img)}" alt="${esc(summary.title)}" loading="lazy">
        <div class="card-image-caption">${esc(summary.title)}</div>
      </div>` : ""}
    <div class="card-head">
      <div class="card-mode-label">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        Dans quel pays ?
      </div>
      <div class="card-question">${esc(summary.title)}</div>
      ${summary.description ? `<div class="card-sub">${esc(summary.description)}</div>` : ""}
    </div>
    <div class="feedback-bar"></div>
    <div class="options grid2">
      ${opts.map(o => `<button class="opt" data-val="${esc(o.val)}">${esc(o.label)}</button>`).join("")}
    </div>
    ${nextBtn()}`;

  bindOptions(country);
}

/* ════════════════════════════════════════════════════
   MODE : Chrono
   ════════════════════════════════════════════════════ */
async function loadBeforeAfter() {
  /* Rempli le cache si vide */
  if (chronoCache.length < 2) {
    const fresh = await fillChronoCache();
    chronoCache.push(...fresh);
  }
  if (chronoCache.length < 2) throw new Error("Pas assez d'événements historiques trouvés");

  /* Prend deux événements au hasard dans le cache */
  let a, b;
  do {
    [a, b] = shuffle(chronoCache).slice(0, 2);
  } while (a.year === b.year);

  const earlier = a.year < b.year ? a : b;
  const later   = a.year < b.year ? b : a;

  card.innerHTML = `
    <div class="card-head">
      <div class="card-mode-label">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Lequel s'est produit en premier ?
      </div>
      <div class="card-question">Quel événement est antérieur à l'autre ?</div>
    </div>
    <div class="feedback-bar"></div>
    <div class="options grid2">
      <button class="opt opt-tf" data-val="earlier" style="text-align:center">
        ${esc(earlier.label)}
      </button>
      <button class="opt opt-tf" data-val="later" style="text-align:center">
        ${esc(later.label)}
      </button>
    </div>
    ${nextBtn()}`;

  bindOptions("earlier", (isOk, fb) => {
    /* Affiche les années après la réponse */
    const btns = card.querySelectorAll(".opt");
    btns[0].innerHTML += `<br><span class="event-year-badge">${earlier.year < 0 ? `${Math.abs(earlier.year)} av. J.-C.` : earlier.year}</span>`;
    btns[1].innerHTML += `<br><span class="event-year-badge">${later.year}</span>`;
    if (fb) fb.textContent = isOk
      ? `✓ Correct ! ${earlier.label} (${earlier.year < 0 ? `${Math.abs(earlier.year)} av. J.-C.` : earlier.year}) est bien antérieur.`
      : `✗ Non — ${earlier.label} (${earlier.year < 0 ? `${Math.abs(earlier.year)} av. J.-C.` : earlier.year}) est le plus ancien.`;
  });
}

/* ════════════════════════════════════════════════════
   MODE : Popularité (vraies pageviews Wikipedia)
   ════════════════════════════════════════════════════ */
async function loadPopularity() {
  const pair = await buildPopPair();

  /* On cherche les résumés pour avoir les labels lisibles */
  const [sumA, sumB] = await Promise.all([
    wikiSummary(pair.a.title).catch(() => ({ title: pair.a.title, thumbnail: null })),
    wikiSummary(pair.b.title).catch(() => ({ title: pair.b.title, thumbnail: null })),
  ]);

  const img = sumA.thumbnail?.source ?? sumB.thumbnail?.source ?? null;

  const labelA = sumA.title ?? pair.a.title;
  const labelB = sumB.title ?? pair.b.title;

  /* Pour brouiller la piste, présenter dans un ordre random */
  const presentAFirst = Math.random() > 0.5;
  const btnA = { val: "A", label: labelA };
  const btnB = { val: "B", label: labelB };
  const [left, right] = presentAFirst ? [btnA, btnB] : [btnB, btnA];
  const correctVal    = presentAFirst ? "A" : "B"; /* A est toujours le plus populaire */

  card.innerHTML = `
    ${img ? `
      <div class="card-image-wrap">
        <img class="card-image" src="${esc(img)}" alt="" loading="lazy">
      </div>` : ""}
    <div class="card-head">
      <div class="card-mode-label">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Popularité Wikipédia (30 jours)
      </div>
      <div class="card-question">Lequel de ces articles est le plus consulté sur Wikipédia ?</div>
    </div>
    <div class="feedback-bar"></div>
    <div class="options grid2">
      <button class="opt" data-val="${esc(left.val)}" style="text-align:center">${esc(left.label)}</button>
      <button class="opt" data-val="${esc(right.val)}" style="text-align:center">${esc(right.label)}</button>
    </div>
    ${nextBtn()}`;

  bindOptions(correctVal, (isOk, fb) => {
    const totalViews = pair.a.views + pair.b.views;
    const pctA = Math.round((pair.a.views / totalViews) * 100);
    const pctB = 100 - pctA;

    /* Barre de vues pour chaque option */
    const opts = card.querySelectorAll(".opt");
    opts.forEach(btn => {
      const isA   = (presentAFirst && btn.dataset.val === "A") || (!presentAFirst && btn.dataset.val === "B");
      const pct   = isA ? pctA : pctB;
      const views = isA ? pair.a.views : pair.b.views;
      const isWinner = isA; /* A est toujours le gagnant */
      btn.insertAdjacentHTML("beforeend", `
        <div class="pop-reveal">
          <span>${views.toLocaleString("fr-FR")}&nbsp;vues</span>
          <div class="pop-bar-wrap"><div class="pop-bar-fill ${isWinner ? "winner" : ""}" style="width:${pct}%"></div></div>
          <span>${pct}%</span>
        </div>`);
    });
    /* Déclenche les animations après le paint */
    requestAnimationFrame(() => {
      card.querySelectorAll(".pop-bar-fill").forEach(b => b.style.width = b.style.width);
    });

    if (fb) fb.textContent = isOk
      ? `✓ Oui ! "${labelA}" est plus populaire (${pair.a.views.toLocaleString("fr-FR")} vues vs ${pair.b.views.toLocaleString("fr-FR")}).`
      : `✗ "${labelA}" est en réalité plus consulté (${pair.a.views.toLocaleString("fr-FR")} vues).`;
  });
}

/* ════════════════════════════════════════════════════
   MODE : Vrai / Faux  (Open Trivia DB)
   ════════════════════════════════════════════════════ */

/* Traductions minimales des catégories OpenTDB */
const CAT_LABELS = {
  "General Knowledge": "Culture générale",
  "Science: Computers": "Informatique",
  "Science: Mathematics": "Maths",
  "Science & Nature": "Sciences",
  "Geography": "Géographie",
  "History": "Histoire",
  "Entertainment: Books": "Livres",
  "Entertainment: Film": "Cinéma",
  "Sports": "Sport",
  "Mythology": "Mythologie",
  "Politics": "Politique",
  "Art": "Art",
  "Celebrities": "Célébrités",
  "Animals": "Animaux",
  "Vehicles": "Véhicules",
  "Entertainment: Music": "Musique",
};

async function loadTrueFalse() {
  const raw = await getTFQuestion();
  const q         = decodeHtml(raw.question);
  const correctVal = raw.correct_answer === "True" ? "vrai" : "faux";
  const catLabel   = CAT_LABELS[raw.category] ?? raw.category;

  card.innerHTML = `
    <div class="card-head">
      <div class="card-mode-label">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        Vrai ou Faux — ${esc(catLabel)}
      </div>
      <div class="card-question">${esc(q)}</div>
    </div>
    <div class="feedback-bar"></div>
    <div class="options grid2">
      <button class="opt opt-tf" data-val="vrai" style="text-align:center">✓ Vrai</button>
      <button class="opt opt-tf" data-val="faux"  style="text-align:center">✗ Faux</button>
    </div>
    ${nextBtn()}`;

  bindOptions(correctVal, (isOk, fb) => {
    if (fb) fb.textContent = isOk
      ? `✓ Correct !`
      : `✗ La bonne réponse était : ${correctVal === "vrai" ? "Vrai" : "Faux"}.`;
  });
}

/* ════════════════════════════════════════════════════
   Routeur principal
   ════════════════════════════════════════════════════ */
async function loadQuestion() {
  showLoader();
  try {
    if (state.mode === "which-country") return await loadCountry();
    if (state.mode === "before-after")  return await loadBeforeAfter();
    if (state.mode === "popularity")    return await loadPopularity();
    if (state.mode === "true-false")    return await loadTrueFalse();
  } catch (e) {
    console.error(e);
    showError("Erreur réseau — vérifie ta connexion ou réessaie.");
  }
}

/* Exposé pour le bouton retry inline */
window.loadQuestion = loadQuestion;

/* ════════════════════════════════════════════════════
   Init : mode buttons
   ════════════════════════════════════════════════════ */
qs("#modes").querySelectorAll(".mode-btn").forEach(btn => {
  btn.onclick = () => {
    qs("#modes").querySelectorAll(".mode-btn").forEach(b => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    state.mode = btn.dataset.mode;
    loadQuestion();
  };
});

loadQuestion();

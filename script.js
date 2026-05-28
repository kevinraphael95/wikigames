"use strict";

/* ── APIs ── */
const WIKI_REST   = "https://fr.wikipedia.org/api/rest_v1";
const WIKI_API    = "https://fr.wikipedia.org/w/api.php";
const WIKIDATA    = "https://www.wikidata.org/w/api.php";
const WIKI_VIEWS  = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/fr.wikipedia/all-access/all-agents";

/* ── État global ── */
const state = {
  mode: "which-country",
  score: 0,
  streak: 0,
  best: 0,
  rounds: 0,
  answered: false,
};

/* ── DOM ── */
const qs   = s => document.querySelector(s);
const card = qs("#card");

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
  bump("sb-score"); bump("sb-streak");
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="12 5 19 12 12 19"/>
        </svg>
      </button>
    </div>`;
}

/* ── Bind options ── */
function bindOptions(correctVal, onReveal) {
  state.answered = false;
  const opts     = card.querySelectorAll(".opt");
  const nextBtnEl = card.querySelector(".btn-next");
  const fb       = card.querySelector(".feedback-bar");

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
        if (!onReveal) fb.textContent = isOk ? "✓ Bonne réponse !" : `✗ C'était : ${correctVal}`;
      }
      isOk ? onCorrect() : onWrong();
      if (onReveal) onReveal(isOk, fb);
      if (nextBtnEl) nextBtnEl.disabled = false;
    };
  });
  if (nextBtnEl) nextBtnEl.onclick = loadQuestion;
}

/* ════════════════════════════════════════════════════
   Wikipedia / Wikidata helpers
   ════════════════════════════════════════════════════ */

/** Résumé d'un article Wikipedia fr */
async function wikiSummary(title) {
  const r = await fetch(`${WIKI_REST}/page/summary/${encodeURIComponent(title)}`);
  if (!r.ok) throw new Error(`Wiki summary ${r.status}`);
  return r.json();
}

/** Image haute qualité depuis le résumé Wikipedia (width=800) */
function hqImage(thumbnail) {
  if (!thumbnail?.source) return null;
  return thumbnail.source.replace(/\/\d+px-/, "/800px-");
}

/** Article Wikipedia aléatoire (fr) */
async function wikiRandom() {
  const params = new URLSearchParams({
    action: "query", list: "random", rnnamespace: "0",
    rnlimit: "1", format: "json", origin: "*",
  });
  const r = await fetch(`${WIKI_API}?${params}`);
  if (!r.ok) throw new Error(`Wiki random ${r.status}`);
  const d = await r.json();
  return d.query.random[0];
}

/** QID Wikidata depuis le titre Wikipedia fr */
async function wikidataQID(title) {
  const params = new URLSearchParams({
    action: "query", titles: title, prop: "pageprops",
    ppprop: "wikibase_item", format: "json", origin: "*",
  });
  const r = await fetch(`${WIKI_API}?${params}`);
  if (!r.ok) throw new Error(`QID ${r.status}`);
  const d = await r.json();
  const pages = Object.values(d.query.pages);
  return pages[0]?.pageprops?.wikibase_item ?? null;
}

/** Propriété Wikidata d'un QID : retourne la valeur brute (datavalue) */
async function wikidataClaims(qid, props) {
  const params = new URLSearchParams({
    action: "wbgetclaims", entity: qid,
    property: props.join("|"), format: "json", origin: "*",
  });
  const r = await fetch(`${WIKIDATA}?${params}`);
  if (!r.ok) throw new Error(`Claims ${r.status}`);
  const d = await r.json();
  return d.claims ?? {};
}

/** Label français d'un QID Wikidata */
async function wikidataLabel(qid) {
  const params = new URLSearchParams({
    action: "wbgetentities", ids: qid, props: "labels",
    languages: "fr", format: "json", origin: "*",
  });
  const r = await fetch(`${WIKIDATA}?${params}`);
  if (!r.ok) return qid;
  const d = await r.json();
  return d.entities?.[qid]?.labels?.fr?.value ?? qid;
}

/** Labels français de plusieurs QIDs en une seule requête */
async function wikidataLabels(qids) {
  if (!qids.length) return {};
  const params = new URLSearchParams({
    action: "wbgetentities", ids: qids.join("|"), props: "labels",
    languages: "fr", format: "json", origin: "*",
  });
  const r = await fetch(`${WIKIDATA}?${params}`);
  if (!r.ok) return {};
  const d = await r.json();
  const out = {};
  for (const qid of qids) {
    out[qid] = d.entities?.[qid]?.labels?.fr?.value ?? qid;
  }
  return out;
}

/** Extraire le premier QID d'une propriété dans les claims */
function firstQID(claims, prop) {
  const list = claims[prop];
  if (!list?.length) return null;
  return list[0]?.mainsnak?.datavalue?.value?.id ?? null;
}

/** Extraire le premier entier/quantité d'une propriété */
function firstAmount(claims, prop) {
  const list = claims[prop];
  if (!list?.length) return null;
  const raw = list[0]?.mainsnak?.datavalue?.value?.amount;
  return raw != null ? Math.round(parseFloat(raw)) : null;
}

/** Extraire la première année d'une propriété temps */
function firstYear(claims, prop) {
  const list = claims[prop];
  if (!list?.length) return null;
  const time = list[0]?.mainsnak?.datavalue?.value?.time;
  if (!time) return null;
  const m = time.match(/[+-](\d{4})/);
  return m ? parseInt(m[1]) : null;
}

/** Type Wikidata (P31) → label fr */
async function entityType(claims) {
  const qid = firstQID(claims, "P31");
  if (!qid) return null;
  return wikidataLabel(qid);
}

/** Cherche des entités Wikidata du même type (P31) pour faire des distracteurs */
async function wikidataSearchSameType(typeQID, excludeQID, limit = 10) {
  const params = new URLSearchParams({
    action: "query", list: "search",
    srsearch: `haswbstatement:P31=${typeQID}`,
    srlimit: String(limit), srnamespace: "0",
    format: "json", origin: "*",
  });
  const r = await fetch(`${WIKI_API}?${params}`);
  if (!r.ok) return [];
  const d = await r.json();
  return (d.query?.search || []).map(p => p.title).filter(t => t !== excludeQID);
}

/** Most-read Wikipedia fr (hier) */
async function mostReadYesterday() {
  const pad = n => String(n).padStart(2, "0");
  const now = new Date(Date.now() - 864e5);
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/fr.wikipedia/all-access`
            + `/${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`most-read ${r.status}`);
  const d = await r.json();
  const BLACKLIST = /^(Accueil|Spécial:|Wikipédia:|Portail:|Aide:|Utilisateur|Main_Page|Special:|Wikipedia:)/i;
  return (d.items?.[0]?.articles || []).filter(a => !BLACKLIST.test(a.article) && a.views > 0);
}

/* ════════════════════════════════════════════════════
   MODE : Pays  (100% Wikidata P17)
   ════════════════════════════════════════════════════ */

async function loadCountry() {
  /* Tente jusqu'à trouver un article avec P17 (pays) ET une image */
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const rand    = await wikiRandom();
      const summary = await wikiSummary(rand.title);
      const img     = hqImage(summary.thumbnail);
      if (!img) continue;

      const qid = await wikidataQID(rand.title);
      if (!qid) continue;

      const claims = await wikidataClaims(qid, ["P17", "P131"]);
      /* P17 = pays, P131 = entité administrative (fallback) */
      const countryQID = firstQID(claims, "P17") ?? firstQID(claims, "P131");
      if (!countryQID) continue;

      const correctCountry = await wikidataLabel(countryQID);
      if (!correctCountry || correctCountry === countryQID) continue;

      /* 3 distracteurs : autres pays via articles random */
      const distractorSet = new Set();
      for (let d = 0; d < 12 && distractorSet.size < 3; d++) {
        try {
          const r2   = await wikiRandom();
          const q2   = await wikidataQID(r2.title);
          if (!q2 || q2 === qid) continue;
          const c2   = await wikidataClaims(q2, ["P17"]);
          const cqid = firstQID(c2, "P17");
          if (!cqid || cqid === countryQID) continue;
          const label = await wikidataLabel(cqid);
          if (label && label !== cqid && !distractorSet.has(label))
            distractorSet.add(label);
        } catch { /* skip */ }
      }
      if (distractorSet.size < 2) continue;

      const opts = shuffle([
        { val: correctCountry, label: correctCountry },
        ...[...distractorSet].map(l => ({ val: l, label: l })),
      ]);

      card.innerHTML = `
        <div class="card-image-wrap">
          <img class="card-image" src="${esc(img)}" alt="${esc(summary.title)}" loading="lazy">
          <div class="card-image-caption">${esc(summary.title)}</div>
        </div>
        <div class="card-head">
          <div class="card-mode-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            Dans quel pays ?
          </div>
          <div class="card-question">${esc(summary.title)}</div>
        </div>
        <div class="feedback-bar"></div>
        <div class="options grid2">
          ${opts.map(o => `<button class="opt" data-val="${esc(o.val)}">${esc(o.label)}</button>`).join("")}
        </div>
        ${nextBtn()}`;

      bindOptions(correctCountry);
      return;
    } catch { /* retry */ }
  }
  throw new Error("Impossible de trouver un monument avec pays et image");
}

/* ════════════════════════════════════════════════════
   MODE : Chrono  (Wikidata P571/P585/P580/P577)
   ════════════════════════════════════════════════════ */

const CHRONO_DATE_PROPS = ["P571", "P585", "P580", "P577", "P569", "P575"];

async function fetchChronoItem() {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const rand    = await wikiRandom();
      const summary = await wikiSummary(rand.title);
      const qid     = await wikidataQID(rand.title);
      if (!qid) continue;
      const claims  = await wikidataClaims(qid, CHRONO_DATE_PROPS);
      let year = null;
      for (const prop of CHRONO_DATE_PROPS) {
        year = firstYear(claims, prop);
        if (year !== null) break;
      }
      if (year === null || year < -3000 || year > 2020) continue;
      return { label: summary.title, year };
    } catch { /* retry */ }
  }
  throw new Error("Pas assez d'événements datés trouvés");
}

let chronoCache = [];

async function loadBeforeAfter() {
  /* Remplir le cache si nécessaire */
  while (chronoCache.length < 2) {
    const item = await fetchChronoItem();
    if (!chronoCache.find(c => c.label === item.label))
      chronoCache.push(item);
  }

  let a, b;
  do { [a, b] = shuffle(chronoCache).slice(0, 2); }
  while (a.year === b.year);

  const earlier = a.year < b.year ? a : b;
  const later   = a.year < b.year ? b : a;

  /* Précharger 2 items de plus en arrière-plan */
  fetchChronoItem().then(i => { if (!chronoCache.find(c => c.label === i.label)) chronoCache.push(i); }).catch(() => {});
  fetchChronoItem().then(i => { if (!chronoCache.find(c => c.label === i.label)) chronoCache.push(i); }).catch(() => {});

  const fmtYear = y => y < 0 ? `${Math.abs(y)} av. J.-C.` : String(y);

  card.innerHTML = `
    <div class="card-head">
      <div class="card-mode-label">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Lequel s'est produit en premier ?
      </div>
      <div class="card-question">Quel événement est le plus ancien ?</div>
    </div>
    <div class="feedback-bar"></div>
    <div class="options grid2">
      <button class="opt opt-tf" data-val="earlier" style="text-align:center">${esc(earlier.label)}</button>
      <button class="opt opt-tf" data-val="later"   style="text-align:center">${esc(later.label)}</button>
    </div>
    ${nextBtn()}`;

  bindOptions("earlier", (isOk, fb) => {
    card.querySelectorAll(".opt")[0].insertAdjacentHTML("beforeend",
      `<br><span class="event-year-badge">${fmtYear(earlier.year)}</span>`);
    card.querySelectorAll(".opt")[1].insertAdjacentHTML("beforeend",
      `<br><span class="event-year-badge">${fmtYear(later.year)}</span>`);
    if (fb) fb.textContent = isOk
      ? `✓ Correct ! ${earlier.label} (${fmtYear(earlier.year)}) est bien plus ancien.`
      : `✗ Non — ${earlier.label} (${fmtYear(earlier.year)}) est le plus ancien.`;
  });
}

/* ════════════════════════════════════════════════════
   MODE : Popularité  (most-read, 2 colonnes avec images)
   ════════════════════════════════════════════════════ */

async function loadPopularity() {
  const articles = await mostReadYesterday();
  if (articles.length < 20) throw new Error("most-read: pas assez d'articles");

  const pool = articles.slice(0, 50);
  const idxA = Math.floor(Math.random() * 15);
  const idxB = 15 + Math.floor(Math.random() * Math.min(35, pool.length - 15));

  const artA = pool[idxA];
  const artB = pool[idxB];

  const titleA = artA.article.replaceAll("_", " ");
  const titleB = artB.article.replaceAll("_", " ");

  const [sumA, sumB] = await Promise.all([
    wikiSummary(titleA).catch(() => ({ title: titleA, thumbnail: null })),
    wikiSummary(titleB).catch(() => ({ title: titleB, thumbnail: null })),
  ]);

  const imgA = hqImage(sumA.thumbnail);
  const imgB = hqImage(sumB.thumbnail);

  /* A est toujours le plus populaire, on shuffle la présentation */
  const presentALeft = Math.random() > 0.5;
  const left  = presentALeft ? { title: sumA.title ?? titleA, img: imgA, views: artA.views, key: "A" }
                              : { title: sumB.title ?? titleB, img: imgB, views: artB.views, key: "B" };
  const right = presentALeft ? { title: sumB.title ?? titleB, img: imgB, views: artB.views, key: "B" }
                              : { title: sumA.title ?? titleA, img: imgA, views: artA.views, key: "A" };
  const correctKey = "A"; /* A est toujours le plus populaire */

  function colHTML(side, val) {
    return `
      <button class="opt opt-pop" data-val="${val}" style="padding:0;overflow:hidden;text-align:center">
        ${side.img
          ? `<img class="pop-img" src="${esc(side.img)}" alt="${esc(side.title)}" loading="lazy">`
          : `<div class="pop-img pop-img-placeholder">?</div>`}
        <div class="pop-label">${esc(side.title)}</div>
        <div class="pop-views-reveal" style="display:none">
          <span class="pop-views-num">${side.views.toLocaleString("fr-FR")} vues</span>
          <div class="pop-bar-wrap"><div class="pop-bar-fill" data-views="${side.views}" style="width:0%"></div></div>
        </div>
      </button>`;
  }

  card.innerHTML = `
    <div class="card-head">
      <div class="card-mode-label">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Popularité Wikipédia
      </div>
      <div class="card-question">Lequel est le plus consulté hier sur Wikipédia ?</div>
    </div>
    <div class="feedback-bar"></div>
    <div class="options grid2 pop-grid">
      ${colHTML(left,  presentALeft ? "A" : "B")}
      ${colHTML(right, presentALeft ? "B" : "A")}
    </div>
    ${nextBtn()}`;

  bindOptions(correctKey, (isOk, fb) => {
    const total = artA.views + artB.views;
    card.querySelectorAll(".pop-views-reveal").forEach(el => el.style.display = "");
    card.querySelectorAll(".pop-bar-fill").forEach(bar => {
      const v   = parseInt(bar.dataset.views);
      const pct = Math.round((v / total) * 100);
      bar.classList.toggle("winner", v === artA.views); /* A est le winner */
      requestAnimationFrame(() => { bar.style.width = pct + "%"; });
    });
    if (fb) fb.textContent = isOk
      ? `✓ Oui ! "${sumA.title ?? titleA}" est plus populaire (${artA.views.toLocaleString("fr-FR")} vs ${artB.views.toLocaleString("fr-FR")} vues).`
      : `✗ "${sumA.title ?? titleA}" est en réalité plus consulté (${artA.views.toLocaleString("fr-FR")} vues).`;
  });
}

/* ════════════════════════════════════════════════════
   MODE : Qui est-ce ?  (image + 4 noms)
   ════════════════════════════════════════════════════ */

/* On cherche un article Wikipedia fr avec image, puis on récupère son type Wikidata (P31)
   pour trouver 3 distracteurs du même type. */

async function loadWhoIsIt() {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const rand    = await wikiRandom();
      const summary = await wikiSummary(rand.title);
      const img     = hqImage(summary.thumbnail);
      if (!img) continue;
      /* Doit avoir une courte description lisible */
      if (!summary.description) continue;

      const qid = await wikidataQID(rand.title);
      if (!qid) continue;

      const claims = await wikidataClaims(qid, ["P31"]);
      const typeQID = firstQID(claims, "P31");

      /* Cherche des distracteurs : articles random Wikipedia avec image */
      const distractors = [];
      for (let d = 0; d < 15 && distractors.length < 3; d++) {
        try {
          const r2  = await wikiRandom();
          if (r2.title === rand.title) continue;
          const s2  = await wikiSummary(r2.title);
          /* même type Wikidata si possible, mais pas obligatoire */
          if (s2.title && s2.title !== summary.title && !distractors.find(x => x === s2.title))
            distractors.push(s2.title);
        } catch { /* skip */ }
      }
      if (distractors.length < 3) continue;

      const opts = shuffle([
        { val: summary.title, label: summary.title },
        ...distractors.slice(0, 3).map(t => ({ val: t, label: t })),
      ]);

      card.innerHTML = `
        <div class="card-image-wrap">
          <img class="card-image" src="${esc(img)}" alt="Qui est-ce ?" loading="lazy" style="filter:brightness(.97)">
        </div>
        <div class="card-head">
          <div class="card-mode-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
            Qui est-ce ?
          </div>
          <div class="card-question">${esc(summary.description)}</div>
        </div>
        <div class="feedback-bar"></div>
        <div class="options grid2">
          ${opts.map(o => `<button class="opt" data-val="${esc(o.val)}">${esc(o.label)}</button>`).join("")}
        </div>
        ${nextBtn()}`;

      bindOptions(summary.title, (isOk, fb) => {
        if (fb) fb.textContent = isOk
          ? `✓ Bien joué !`
          : `✗ C'était : ${summary.title}`;
        /* Révèle le nom dans la caption */
        const wrap = card.querySelector(".card-image-wrap");
        if (wrap && !wrap.querySelector(".card-image-caption")) {
          wrap.insertAdjacentHTML("beforeend",
            `<div class="card-image-caption">${esc(summary.title)}</div>`);
        }
      });
      return;
    } catch { /* retry */ }
  }
  throw new Error("Impossible de trouver un article pour Qui est-ce ?");
}

/* ════════════════════════════════════════════════════
   MODE : Combien ?  (Wikidata quantités)
   ════════════════════════════════════════════════════ */

/* Questions possibles : population (P1082), altitude (P2044), longueur (P2043),
   superficie (P2046), nombre de membres (P1082 sur organisations), etc.
   On tente plusieurs propriétés et on prend la première qui retourne une valeur. */

const QUANT_PROPS = [
  { prop: "P1082", label: "Population",          unit: "habitants", fmt: n => n.toLocaleString("fr-FR") },
  { prop: "P2044", label: "Altitude",             unit: "mètres",   fmt: n => n.toLocaleString("fr-FR") },
  { prop: "P2043", label: "Longueur",             unit: "mètres",   fmt: n => n.toLocaleString("fr-FR") },
  { prop: "P2046", label: "Superficie",           unit: "km²",      fmt: n => n.toLocaleString("fr-FR") },
  { prop: "P1181", label: "Indice de développement humain", unit: "", fmt: n => n.toFixed(3) },
  { prop: "P571",  label: "Année de fondation",   unit: "",          fmt: n => String(Math.abs(n)) },
];

function generateDistractors(value, unit, count = 3) {
  /* Génère des distracteurs plausibles autour de la valeur réelle */
  const factors = [0.3, 0.5, 0.6, 1.5, 2, 3, 0.1, 10];
  const used = new Set([value]);
  const result = [];
  shuffle(factors).forEach(f => {
    if (result.length >= count) return;
    let v = Math.round(value * f);
    if (v <= 0) v = Math.round(value / 2);
    if (!used.has(v)) { used.add(v); result.push(v); }
  });
  /* Fallback : +/- 20-80% */
  while (result.length < count) {
    const delta = Math.round(value * (0.2 + Math.random() * 0.6)) * (Math.random() > 0.5 ? 1 : -1);
    const v = Math.max(1, value + delta);
    if (!used.has(v)) { used.add(v); result.push(v); }
  }
  return result;
}

async function loadHowMany() {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const rand    = await wikiRandom();
      const summary = await wikiSummary(rand.title);
      const qid     = await wikidataQID(rand.title);
      if (!qid) continue;

      const propIds = QUANT_PROPS.map(p => p.prop);
      const claims  = await wikidataClaims(qid, propIds);

      let found = null;
      for (const def of shuffle([...QUANT_PROPS])) {
        const val = firstAmount(claims, def.prop);
        if (val !== null && val > 0 && val < 1e12) {
          found = { ...def, value: val };
          break;
        }
      }
      if (!found) continue;

      const distractorVals = generateDistractors(found.value, found.unit);
      const opts = shuffle([
        { val: found.value, label: found.fmt(found.value) + (found.unit ? " " + found.unit : "") },
        ...distractorVals.map(v => ({ val: v, label: found.fmt(v) + (found.unit ? " " + found.unit : "") })),
      ]);

      const img = hqImage(summary.thumbnail);

      card.innerHTML = `
        ${img ? `
          <div class="card-image-wrap">
            <img class="card-image" src="${esc(img)}" alt="${esc(summary.title)}" loading="lazy">
            <div class="card-image-caption">${esc(summary.title)}</div>
          </div>` : ""}
        <div class="card-head">
          <div class="card-mode-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Combien ?
          </div>
          <div class="card-question">${esc(found.label)} de ${esc(summary.title)}</div>
        </div>
        <div class="feedback-bar"></div>
        <div class="options grid2">
          ${opts.map(o => `<button class="opt" data-val="${o.val}">${esc(o.label)}</button>`).join("")}
        </div>
        ${nextBtn()}`;

      bindOptions(String(found.value), (isOk, fb) => {
        if (fb) fb.textContent = isOk
          ? `✓ Exact !`
          : `✗ La réponse était : ${found.fmt(found.value)}${found.unit ? " " + found.unit : ""}`;
      });
      return;
    } catch { /* retry */ }
  }
  throw new Error("Impossible de trouver une question Combien ?");
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
    if (state.mode === "who-is-it")     return await loadWhoIsIt();
    if (state.mode === "how-many")      return await loadHowMany();
  } catch (e) {
    console.error(e);
    showError("Erreur réseau ou données indisponibles — réessaie !");
  }
}

window.loadQuestion = loadQuestion;

/* ── Init ── */
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

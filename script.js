"use strict";

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const WIKI_REST       = "https://fr.wikipedia.org/api/rest_v1";
const WIKI_VIEWS_TOP  = "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/fr.wikipedia/all-access";

const state = {
  mode: "which-country",
  score: 0, streak: 0, best: 0, rounds: 0,
  answered: false,
};

const qs   = s => document.querySelector(s);
const card = qs("#card");

function esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

/* ── Score ── */
function bump(id) {
  const el = qs(`#${id}`);
  if (!el) return;
  el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
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
  state.score += pts; state.streak++; state.rounds++;
  state.best = Math.max(state.best, state.streak);
  bump("sb-score"); bump("sb-streak"); updateScore();
}
function onWrong() { state.streak = 0; state.rounds++; updateScore(); }

/* ── UI ── */
function showLoader() {
  card.innerHTML = `<div class="loader"><div class="loader-ring"></div><span>Chargement…</span></div>`;
}
function showError(msg) {
  card.innerHTML = `<div class="error-box"><span class="error-icon">⚡</span>${esc(msg)}<br><button class="retry-btn" onclick="loadQuestion()">Réessayer</button></div>`;
}
function nextBtn() {
  return `<div class="actions"><button class="btn-next" disabled>Suivant<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button></div>`;
}

/* Image HTML avec fallback — hauteur fixe, object-fit cover, object-position top pour portraits */
function imgHTML(src, alt, cls = "card-image") {
  if (!src) return "";
  return `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer"
    onerror="this.parentElement.style.display='none'"
    style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block">`;
}

function bindOptions(correctVal, onReveal) {
  state.answered = false;
  const opts = card.querySelectorAll(".opt");
  const nb   = card.querySelector(".btn-next");
  const fb   = card.querySelector(".feedback-bar");
  opts.forEach(btn => {
    btn.onclick = () => {
      if (state.answered) return;
      state.answered = true;
      const isOk = btn.dataset.val === String(correctVal);
      opts.forEach(o => o.disabled = true);
      btn.classList.add(isOk ? "correct" : "wrong");
      if (!isOk) {
        const w = [...opts].find(o => o.dataset.val === String(correctVal));
        if (w) w.classList.add("correct");
      }
      if (fb) {
        fb.className = `feedback-bar show ${isOk?"ok":"ko"}`;
        if (!onReveal) fb.textContent = isOk ? "✓ Bonne réponse !" : `✗ C'était : ${correctVal}`;
      }
      isOk ? onCorrect() : onWrong();
      if (onReveal) onReveal(isOk, fb);
      if (nb) nb.disabled = false;
    };
  });
  if (nb) nb.onclick = loadQuestion;
}

/* ════════════════════════════════════════════════════
   SPARQL
   ════════════════════════════════════════════════════ */
async function sparql(query) {
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  const r = await fetch(url, {
    headers: { "Accept": "application/sparql-results+json", "User-Agent": "WikiGames/2.0" }
  });
  if (!r.ok) throw new Error(`SPARQL ${r.status}`);
  const d = await r.json();
  return d.results.bindings;
}

/* Convertit URL image Wikidata → URL Wikimedia upload (pas de pb referrer) */
function wikimediaUrl(wikidataImageUrl, width = 500) {
  if (!wikidataImageUrl) return null;
  try {
    let filename = decodeURIComponent(wikidataImageUrl.split("/").pop());
    filename = filename.replace(/ /g, "_");
    // MD5 pour le path Wikimedia
    // On utilise Special:FilePath qui redirige vers le bon CDN
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=${width}`;
  } catch { return null; }
}

/* Pour les thumbnails Wikipedia REST API → remplace la taille */
function wikiThumb(src, width = 400) {
  if (!src) return null;
  return src.replace(/\/\d+px-/, `/${width}px-`);
}

/* ════════════════════════════════════════════════════
   Caches
   ════════════════════════════════════════════════════ */
const cache = {
  country: [],
  chrono:  [],
  whoIsIt: [],
  howMany: [],
};

/* ── PAYS ── */
async function fillCountryCache() {
  const types = shuffle([
    { id: "wd:Q839954",  label: "site archéologique" },
    { id: "wd:Q16560",   label: "palais" },
    { id: "wd:Q44377",   label: "tour" },
    { id: "wd:Q12280",   label: "pont" },
    { id: "wd:Q484170",  label: "château" },
    { id: "wd:Q33506",   label: "musée" },
    { id: "wd:Q1081138", label: "parc national" },
    { id: "wd:Q5086",    label: "cathédrale" },
    { id: "wd:Q23413",   label: "château fort" },
    { id: "wd:Q570116",  label: "monument" },
  ]);
  const t = types[0];
  const offset = Math.floor(Math.random() * 300);
  const q = `
    SELECT ?label ?image ?paysLabel WHERE {
      ?item wdt:P31 ${t.id} .
      ?item wdt:P18 ?image .
      ?item wdt:P17 ?pays .
      ?item rdfs:label ?label FILTER(lang(?label)="fr") .
      ?pays rdfs:label ?paysLabel FILTER(lang(?paysLabel)="fr") .
    } LIMIT 80 OFFSET ${offset}`;
  const rows = await sparql(q);
  cache.country = shuffle(rows.map(r => ({
    label:   r.label.value,
    image:   wikimediaUrl(r.image.value),
    country: r.paysLabel.value,
  })));
}

/* ── CHRONO : un seul type homogène par batch, on affiche le type ── */
const CHRONO_TYPES = [
  { id: "wd:Q178561",  label: "bataille",         prop: "P580", fallback: "P571" },
  { id: "wd:Q198",     label: "guerre",            prop: "P580", fallback: "P571" },
  { id: "wd:Q5",       label: "personnalité",      prop: "P569", fallback: null   },
  { id: "wd:Q5086",    label: "cathédrale",        prop: "P571", fallback: null   },
  { id: "wd:Q484170",  label: "château",           prop: "P571", fallback: null   },
  { id: "wd:Q33506",   label: "musée",             prop: "P571", fallback: null   },
  { id: "wd:Q11032",   label: "journal",           prop: "P571", fallback: null   },
  { id: "wd:Q11424",   label: "film",              prop: "P577", fallback: null   },
  { id: "wd:Q482994",  label: "album",             prop: "P577", fallback: null   },
];

async function fillChronoCache() {
  const t = shuffle([...CHRONO_TYPES])[0];
  const prop = t.prop;
  const offset = Math.floor(Math.random() * 150);
  const q = `
    SELECT ?label ?date WHERE {
      ?item wdt:P31 ${t.id} .
      ?item wdt:${prop} ?date .
      ?item rdfs:label ?label FILTER(lang(?label)="fr") .
    } LIMIT 80 OFFSET ${offset}`;
  const rows = await sparql(q);
  const items = shuffle(rows.map(r => ({
    label:     r.label.value,
    year:      new Date(r.date.value).getFullYear(),
    typeLabel: t.label,
  })).filter(x => !isNaN(x.year) && x.year >= -500 && x.year <= 2023));
  cache.chrono = { items, typeLabel: t.label };
}

/* ── QUI EST-CE ── */
async function fillWhoIsItCache() {
  const occupations = shuffle([
    "wd:Q33999",    /* acteur */
    "wd:Q36180",    /* écrivain */
    "wd:Q1028181",  /* peintre */
    "wd:Q639669",   /* musicien */
    "wd:Q82955",    /* politicien */
    "wd:Q901",      /* scientifique */
    "wd:Q2374149",  /* footballeur */
    "wd:Q10871364", /* chanteur */
    "wd:Q3282637",  /* réalisateur */
    "wd:Q2526255",  /* directeur de film */
  ]);
  const occ = occupations[0];
  const offset = Math.floor(Math.random() * 400);
  const q = `
    SELECT ?label ?image ?desc WHERE {
      ?item wdt:P31 wd:Q5 .
      ?item wdt:P106 ${occ} .
      ?item wdt:P18 ?image .
      ?item rdfs:label ?label FILTER(lang(?label)="fr") .
      OPTIONAL { ?item schema:description ?desc FILTER(lang(?desc)="fr") }
    } LIMIT 60 OFFSET ${offset}`;
  const rows = await sparql(q);
  cache.whoIsIt = shuffle(rows.map(r => ({
    label: r.label.value,
    image: wikimediaUrl(r.image.value),
    desc:  r.desc?.value ?? "",
  })));
}

/* ── COMBIEN ── */
const HOW_MANY_DEFS = [
  { prop: "P1082", type: "wd:Q515",  question: "Population de",  unit: "habitants", fmt: n => Math.round(n).toLocaleString("fr-FR") },
  { prop: "P2044", type: "wd:Q8502", question: "Altitude de",    unit: "mètres",    fmt: n => Math.round(n).toLocaleString("fr-FR") },
  { prop: "P2043", type: "wd:Q4022", question: "Longueur de",    unit: "km",        fmt: n => Math.round(n/1000).toLocaleString("fr-FR") },
  { prop: "P1082", type: "wd:Q6256", question: "Population de",  unit: "habitants", fmt: n => Math.round(n).toLocaleString("fr-FR") },
  { prop: "P2048", type: "wd:Q44377",question: "Hauteur de",     unit: "mètres",    fmt: n => Math.round(n).toLocaleString("fr-FR") },
];

async function fillHowManyCache() {
  const def = shuffle([...HOW_MANY_DEFS])[0];
  const offset = Math.floor(Math.random() * 250);
  const q = `
    SELECT ?label ?val WHERE {
      ?item wdt:P31 ${def.type} .
      ?item wdt:${def.prop} ?val .
      ?item rdfs:label ?label FILTER(lang(?label)="fr") .
      FILTER(?val > 0)
    } LIMIT 60 OFFSET ${offset}`;
  const rows = await sparql(q);
  cache.howMany = shuffle(rows.map(r => ({
    label:    r.label.value,
    value:    parseFloat(r.val.value),
    question: def.question,
    unit:     def.unit,
    fmt:      def.fmt,
    rawVal:   parseFloat(r.val.value),
  })).filter(x => x.value > 0 && x.value < 1e12));
}

/* ════════════════════════════════════════════════════
   Distracteurs numériques
   ════════════════════════════════════════════════════ */
function makeNumDistractors(value, fmt, count = 3) {
  const factors = shuffle([0.2, 0.35, 0.5, 0.65, 1.4, 1.8, 2.5, 3.5, 0.12, 8]);
  const used = new Set([fmt(value)]);
  const res  = [];
  for (const f of factors) {
    if (res.length >= count) break;
    const v = value * f;
    if (v <= 0) continue;
    const label = fmt(v);
    if (!used.has(label)) { used.add(label); res.push(v); }
  }
  while (res.length < count) {
    const delta = value * (0.15 + Math.random() * 0.6) * (Math.random() > 0.5 ? 1 : -1);
    const v = Math.max(1, value + delta);
    const label = fmt(v);
    if (!used.has(label)) { used.add(label); res.push(v); }
  }
  return res;
}

/* ════════════════════════════════════════════════════
   MODE : Pays
   ════════════════════════════════════════════════════ */
async function loadCountry() {
  if (cache.country.length < 5) await fillCountryCache();
  if (!cache.country.length) throw new Error("Cache pays vide");

  const allCountries = [...new Set(cache.country.map(x => x.country))];
  if (allCountries.length < 4) { cache.country = []; await fillCountryCache(); }

  let item = null;
  for (let i = 0; i < cache.country.length; i++) {
    const others = allCountries.filter(c => c !== cache.country[i].country);
    if (others.length >= 3) { item = cache.country.splice(i, 1)[0]; break; }
  }
  if (!item) item = cache.country.shift();

  const allC = [...new Set(cache.country.map(x => x.country))];
  const distractors = shuffle(allC.filter(c => c !== item.country)).slice(0, 3);
  /* Fallback si pas assez de pays dans le cache courant */
  const FB = ["France","Italie","Espagne","Allemagne","Royaume-Uni","Japon","Brésil","Australie","Inde","Chine","Mexique","Canada","Portugal","Suède","Turquie"];
  while (distractors.length < 3) {
    const f = FB.find(c => c !== item.country && !distractors.includes(c));
    if (f) distractors.push(f); else break;
  }

  const opts = shuffle([
    { val: item.country, label: item.country },
    ...distractors.slice(0,3).map(c => ({ val: c, label: c })),
  ]);

  card.innerHTML = `
    <div class="card-image-wrap">
      ${imgHTML(item.image, item.label)}
      <div class="card-image-caption">${esc(item.label)}</div>
    </div>
    <div class="card-head">
      <div class="card-mode-label">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        Dans quel pays ?
      </div>
      <div class="card-question">${esc(item.label)}</div>
    </div>
    <div class="feedback-bar"></div>
    <div class="options grid2">
      ${opts.map(o=>`<button class="opt" data-val="${esc(o.val)}">${esc(o.label)}</button>`).join("")}
    </div>
    ${nextBtn()}`;
  bindOptions(item.country);
}

/* ════════════════════════════════════════════════════
   MODE : Chrono — même type pour les deux items
   ════════════════════════════════════════════════════ */
async function loadBeforeAfter() {
  if (!cache.chrono?.items || cache.chrono.items.length < 4) await fillChronoCache();
  if (!cache.chrono?.items || cache.chrono.items.length < 2) throw new Error("Cache chrono vide");

  const { items, typeLabel } = cache.chrono;
  let a, b, tries = 0;
  do {
    [a, b] = shuffle(items).slice(0, 2);
    tries++;
  } while (a.year === b.year && tries < 20);

  if (a.year === b.year) { cache.chrono = null; return loadBeforeAfter(); }

  const earlier = a.year < b.year ? a : b;
  const later   = a.year < b.year ? b : a;
  const fmtY    = y => y < 0 ? `${Math.abs(y)} av. J.-C.` : String(y);

  /* Retire les deux */
  cache.chrono.items = items.filter(x => x !== a && x !== b);

  card.innerHTML = `
    <div class="card-head">
      <div class="card-mode-label">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Chrono · ${esc(typeLabel)}
      </div>
      <div class="card-question">Lequel est le plus ancien ?</div>
    </div>
    <div class="feedback-bar"></div>
    <div class="options grid2">
      <button class="opt opt-tf" data-val="earlier" style="text-align:center">${esc(earlier.label)}</button>
      <button class="opt opt-tf" data-val="later"   style="text-align:center">${esc(later.label)}</button>
    </div>
    ${nextBtn()}`;

  bindOptions("earlier", (isOk, fb) => {
    card.querySelectorAll(".opt")[0].insertAdjacentHTML("beforeend",
      `<br><span class="event-year-badge">${fmtY(earlier.year)}</span>`);
    card.querySelectorAll(".opt")[1].insertAdjacentHTML("beforeend",
      `<br><span class="event-year-badge">${fmtY(later.year)}</span>`);
    if (fb) fb.textContent = isOk
      ? `✓ Correct ! ${earlier.label} (${fmtY(earlier.year)}) est plus ancien.`
      : `✗ Non — ${earlier.label} (${fmtY(earlier.year)}) est le plus ancien.`;
  });
}

/* ════════════════════════════════════════════════════
   MODE : Popularité — images via upload.wikimedia.org
   ════════════════════════════════════════════════════ */
async function loadPopularity() {
  const pad = n => String(n).padStart(2,"0");
  const now = new Date(Date.now() - 864e5);
  const url = `${WIKI_VIEWS_TOP}/${now.getUTCFullYear()}/${pad(now.getUTCMonth()+1)}/${pad(now.getUTCDate())}`;
  const r   = await fetch(url);
  if (!r.ok) throw new Error(`most-read ${r.status}`);
  const d   = await r.json();

  const BL = /^(Accueil|Spécial:|Wikipédia:|Portail:|Aide:|Utilisateur|Main_Page|Special:|Wikipedia:)/i;
  const articles = (d.items?.[0]?.articles||[]).filter(a => !BL.test(a.article) && a.views > 0);
  if (articles.length < 20) throw new Error("Pas assez d'articles");

  const pool = articles.slice(0, 60);
  const idxA = Math.floor(Math.random() * 10);
  const idxB = 10 + Math.floor(Math.random() * Math.min(50, pool.length - 10));
  const artA = pool[idxA];
  const artB = pool[idxB];

  const titleA = artA.article.replaceAll("_"," ");
  const titleB = artB.article.replaceAll("_"," ");

  /* Récup résumés Wikipedia pour images + titres lisibles */
  const fetchSum = async title => {
    try {
      const r = await fetch(`${WIKI_REST}/page/summary/${encodeURIComponent(title)}`);
      return r.ok ? r.json() : null;
    } catch { return null; }
  };
  const [sumA, sumB] = await Promise.all([fetchSum(titleA), fetchSum(titleB)]);

  /* Image : on prend le thumbnail Wikipedia et on augmente la résolution */
  const getImg = sum => sum?.thumbnail?.source ? wikiThumb(sum.thumbnail.source, 400) : null;
  const imgA = getImg(sumA);
  const imgB = getImg(sumB);

  const tA = sumA?.title ?? titleA;
  const tB = sumB?.title ?? titleB;

  const presentALeft = Math.random() > 0.5;
  const left  = presentALeft ? { title: tA, img: imgA, views: artA.views, key: "A" }
                              : { title: tB, img: imgB, views: artB.views, key: "B" };
  const right = presentALeft ? { title: tB, img: imgB, views: artB.views, key: "B" }
                              : { title: tA, img: imgA, views: artA.views, key: "A" };
  const total = artA.views + artB.views;

  function colHTML(side) {
    const pct = Math.round((side.views / total) * 100);
    return `
      <button class="opt opt-pop" data-val="${side.key}">
        <div class="pop-img-wrap">
          ${side.img
            ? `<img class="pop-img" src="${esc(side.img)}" alt="${esc(side.title)}"
                loading="lazy" referrerpolicy="no-referrer"
                onerror="this.parentElement.classList.add('pop-img-error')">`
            : `<div class="pop-no-img">?</div>`}
        </div>
        <div class="pop-label">${esc(side.title)}</div>
        <div class="pop-reveal" hidden>
          <span class="pop-views">${side.views.toLocaleString("fr-FR")} vues</span>
          <div class="pop-bar-bg"><div class="pop-bar" data-w="${pct}" style="width:0" ${side.key==="A"?"data-winner":""} ></div></div>
          <span class="pop-pct">${pct}%</span>
        </div>
      </button>`;
  }

  card.innerHTML = `
    <div class="card-head">
      <div class="card-mode-label">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Popularité Wikipedia
      </div>
      <div class="card-question">Lequel a été le plus consulté hier ?</div>
    </div>
    <div class="feedback-bar"></div>
    <div class="options pop-grid">
      ${colHTML(left)}
      ${colHTML(right)}
    </div>
    ${nextBtn()}`;

  bindOptions("A", (isOk, fb) => {
    card.querySelectorAll(".pop-reveal").forEach(el => el.hidden = false);
    requestAnimationFrame(() => {
      card.querySelectorAll(".pop-bar").forEach(bar => {
        bar.style.width = bar.dataset.w + "%";
      });
    });
    if (fb) fb.textContent = isOk
      ? `✓ Oui ! "${tA}" (${artA.views.toLocaleString("fr-FR")} vues) vs ${artB.views.toLocaleString("fr-FR")} vues.`
      : `✗ "${tA}" était plus consulté (${artA.views.toLocaleString("fr-FR")} vues).`;
  });
}

/* ════════════════════════════════════════════════════
   MODE : Qui est-ce ?
   ════════════════════════════════════════════════════ */
async function loadWhoIsIt() {
  if (cache.whoIsIt.length < 5) await fillWhoIsItCache();
  if (cache.whoIsIt.length < 4) throw new Error("Cache qui est-ce vide");

  const item = cache.whoIsIt.shift();
  const distractors = shuffle(cache.whoIsIt.filter(x => x.label !== item.label)).slice(0, 3);
  if (distractors.length < 3) { cache.whoIsIt = []; return loadWhoIsIt(); }

  const opts = shuffle([
    { val: item.label, label: item.label },
    ...distractors.map(d => ({ val: d.label, label: d.label })),
  ]);

  card.innerHTML = `
    <div class="card-image-wrap">
      ${imgHTML(item.image, "Qui est-ce ?")}
      <div class="card-image-caption-hidden" id="reveal-caption"></div>
    </div>
    <div class="card-head">
      <div class="card-mode-label">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        Qui est-ce ?
      </div>
      <div class="card-question">${esc(item.desc || "Identifiez cette personnalité")}</div>
    </div>
    <div class="feedback-bar"></div>
    <div class="options grid2">
      ${opts.map(o=>`<button class="opt" data-val="${esc(o.val)}">${esc(o.label)}</button>`).join("")}
    </div>
    ${nextBtn()}`;

  bindOptions(item.label, (isOk, fb) => {
    const cap = qs("#reveal-caption");
    if (cap) { cap.textContent = item.label; cap.className = "card-image-caption"; }
    if (fb) fb.textContent = isOk ? "✓ Bien joué !" : `✗ C'était : ${item.label}`;
  });
}

/* ════════════════════════════════════════════════════
   MODE : Combien ?
   ════════════════════════════════════════════════════ */
async function loadHowMany() {
  if (cache.howMany.length < 4) await fillHowManyCache();
  if (!cache.howMany.length) throw new Error("Cache combien vide");

  const item = cache.howMany.shift();
  const distractorVals = makeNumDistractors(item.rawVal, item.fmt);
  const opts = shuffle([
    { val: item.fmt(item.rawVal), label: item.fmt(item.rawVal) + " " + item.unit },
    ...distractorVals.map(v => ({ val: item.fmt(v), label: item.fmt(v) + " " + item.unit })),
  ]);

  card.innerHTML = `
    <div class="card-head">
      <div class="card-mode-label">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        Combien ?
      </div>
      <div class="card-question">${esc(item.question)} <em>${esc(item.label)}</em></div>
    </div>
    <div class="feedback-bar"></div>
    <div class="options grid2">
      ${opts.map(o=>`<button class="opt" data-val="${esc(o.val)}">${esc(o.label)}</button>`).join("")}
    </div>
    ${nextBtn()}`;

  bindOptions(item.fmt(item.rawVal), (isOk, fb) => {
    if (fb) fb.textContent = isOk
      ? `✓ Exact !`
      : `✗ La réponse était : ${item.fmt(item.rawVal)} ${item.unit}`;
  });
}

/* ════════════════════════════════════════════════════
   Routeur
   ════════════════════════════════════════════════════ */
async function loadQuestion() {
  showLoader();
  try {
    if (state.mode === "which-country") return await loadCountry();
    if (state.mode === "before-after")  return await loadBeforeAfter();
    if (state.mode === "popularity")    return await loadPopularity();
    if (state.mode === "who-is-it")     return await loadWhoIsIt();
    if (state.mode === "how-many")      return await loadHowMany();
  } catch(e) {
    console.error(e);
    showError("Erreur de chargement — réessaie !");
  }
}
window.loadQuestion = loadQuestion;

qs("#modes").querySelectorAll(".mode-btn").forEach(btn => {
  btn.onclick = () => {
    qs("#modes").querySelectorAll(".mode-btn").forEach(b => {
      b.classList.remove("active"); b.setAttribute("aria-selected","false");
    });
    btn.classList.add("active"); btn.setAttribute("aria-selected","true");
    state.mode = btn.dataset.mode;
    loadQuestion();
  };
});

loadQuestion();
Claude est une IA et peut faire des erreurs. Veuillez vérifier les réponses.


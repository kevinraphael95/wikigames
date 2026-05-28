"use strict";

/* ════════════════════════════════════════════════════
   WikiGames — script.js
   Toutes les données viennent de :
     · Wikidata SPARQL (requêtes ciblées, garanti image + propriété)
     · Wikimedia most-read API (popularité)
   Zéro liste hardcodée.
   ════════════════════════════════════════════════════ */

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const WIKI_REST       = "https://fr.wikipedia.org/api/rest_v1";
const WIKI_VIEWS_TOP  = "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/fr.wikipedia/all-access";

/* ── État ── */
const state = {
  mode: "which-country",
  score: 0, streak: 0, best: 0, rounds: 0,
  answered: false,
};

/* ── DOM ── */
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

/* ── UI helpers ── */
function showLoader() {
  card.innerHTML = `<div class="loader"><div class="loader-ring"></div><span>Chargement…</span></div>`;
}
function showError(msg) {
  card.innerHTML = `<div class="error-box"><span class="error-icon">⚡</span>${esc(msg)}<br><button class="retry-btn" onclick="loadQuestion()">Réessayer</button></div>`;
}
function nextBtn() {
  return `<div class="actions"><button class="btn-next" disabled>Suivant<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button></div>`;
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
   SPARQL helper
   ════════════════════════════════════════════════════ */
async function sparql(query) {
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  const r = await fetch(url, { headers: { "Accept": "application/sparql-results+json", "User-Agent": "WikiGames/2.0" } });
  if (!r.ok) throw new Error(`SPARQL ${r.status}`);
  const d = await r.json();
  return d.results.bindings;
}

/* Convertit une URL image Wikidata en URL haute résolution */
function wikimediaThumb(url, width = 600) {
  if (!url) return null;
  /* Format : https://commons.wikimedia.org/wiki/Special:FilePath/Fichier.jpg */
  const filename = decodeURIComponent(url.split("/").pop());
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=${width}`;
}

/* ════════════════════════════════════════════════════
   Caches SPARQL (chargés une fois, piochés aléatoirement)
   ════════════════════════════════════════════════════ */
const cache = {
  country:    [],
  chrono:     [],
  whoIsIt:    [],
  howMany:    [],
  popularity: [],
};

/* ── Pays ── */
async function fillCountryCache() {
  /* Monuments UNESCO + bâtiments célèbres + parcs naturels avec image ET pays */
  const types = shuffle([
    "wd:Q839954",   /* site archéologique */
    "wd:Q570116",   /* monument commémoratif */
    "wd:Q16560",    /* palais */
    "wd:Q44377",    /* tour */
    "wd:Q12280",    /* pont */
    "wd:Q484170",   /* château */
    "wd:Q23413",    /* château fort */
    "wd:Q33506",    /* musée */
    "wd:Q1081138",  /* parc national */
    "wd:Q5086",     /* cathédrale */
  ]);
  const type = types[0];
  const offset = Math.floor(Math.random() * 200);
  const q = `
    SELECT ?item ?label ?image ?paysLabel WHERE {
      ?item wdt:P31 ${type} .
      ?item wdt:P18 ?image .
      ?item wdt:P17 ?pays .
      ?item rdfs:label ?label FILTER(lang(?label)="fr") .
      ?pays rdfs:label ?paysLabel FILTER(lang(?paysLabel)="fr") .
    } LIMIT 80 OFFSET ${offset}`;
  const rows = await sparql(q);
  cache.country = shuffle(rows.map(r => ({
    label:   r.label.value,
    image:   wikimediaThumb(r.image.value),
    country: r.paysLabel.value,
  })));
}

/* ── Chrono ── */
async function fillChronoCache() {
  const types = shuffle([
    "wd:Q178561",  /* bataille */
    "wd:Q198",     /* guerre */
    "wd:Q4504495", /* conflit armé */
    "wd:Q33506",   /* musée */
    "wd:Q5086",    /* cathédrale */
    "wd:Q484170",  /* château */
  ]);
  const type = types[0];
  const offset = Math.floor(Math.random() * 100);
  const q = `
    SELECT ?item ?label ?date WHERE {
      ?item wdt:P31 ${type} .
      ?item wdt:P571 ?date .
      ?item rdfs:label ?label FILTER(lang(?label)="fr") .
    } LIMIT 60 OFFSET ${offset}`;
  const rows = await sparql(q);
  cache.chrono = shuffle(rows.map(r => ({
    label: r.label.value,
    year:  new Date(r.date.value).getFullYear(),
  })).filter(x => x.year >= -3000 && x.year <= 2023));
}

/* ── Qui est-ce ── */
async function fillWhoIsItCache() {
  const types = shuffle([
    "wd:Q5",        /* humain */
    "wd:Q5",
    "wd:Q5",
  ]);
  /* On cherche des personnes célèbres avec image et description fr */
  const occupations = shuffle([
    "wd:Q33999",   /* acteur */
    "wd:Q36180",   /* écrivain */
    "wd:Q482980",  /* auteur */
    "wd:Q1028181", /* peintre */
    "wd:Q639669",  /* musicien */
    "wd:Q40348",   /* avocat */
    "wd:Q82955",   /* politicien */
    "wd:Q901",     /* scientifique */
    "wd:Q2374149", /* footballeur */
    "wd:Q10871364",/* chanteur */
  ]);
  const occ = occupations[0];
  const offset = Math.floor(Math.random() * 300);
  const q = `
    SELECT ?item ?label ?image ?desc WHERE {
      ?item wdt:P31 wd:Q5 .
      ?item wdt:P106 ${occ} .
      ?item wdt:P18 ?image .
      ?item rdfs:label ?label FILTER(lang(?label)="fr") .
      OPTIONAL { ?item schema:description ?desc FILTER(lang(?desc)="fr") }
    } LIMIT 60 OFFSET ${offset}`;
  const rows = await sparql(q);
  cache.whoIsIt = shuffle(rows.map(r => ({
    label: r.label.value,
    image: wikimediaThumb(r.image.value),
    desc:  r.desc?.value ?? "",
  })));
}

/* ── Combien ── */
const HOW_MANY_DEFS = [
  { prop: "P1082", sparqlType: "wd:Q515",     typeLabel: "ville",     question: "Population de",  unit: "habitants", fmt: n => n.toLocaleString("fr-FR") },
  { prop: "P2044", sparqlType: "wd:Q8502",    typeLabel: "montagne",  question: "Altitude de",    unit: "m",         fmt: n => n.toLocaleString("fr-FR") },
  { prop: "P2044", sparqlType: "wd:Q8502",    typeLabel: "montagne",  question: "Altitude de",    unit: "m",         fmt: n => n.toLocaleString("fr-FR") },
  { prop: "P2043", sparqlType: "wd:Q4022",    typeLabel: "rivière",   question: "Longueur de",    unit: "m",         fmt: n => n.toLocaleString("fr-FR") },
  { prop: "P1082", sparqlType: "wd:Q6256",    typeLabel: "pays",      question: "Population de",  unit: "habitants", fmt: n => n.toLocaleString("fr-FR") },
];

async function fillHowManyCache() {
  const def = shuffle([...HOW_MANY_DEFS])[0];
  const offset = Math.floor(Math.random() * 200);
  const q = `
    SELECT ?item ?label ?val WHERE {
      ?item wdt:P31 ${def.sparqlType} .
      ?item wdt:${def.prop} ?val .
      ?item rdfs:label ?label FILTER(lang(?label)="fr") .
      FILTER(?val > 0)
    } LIMIT 60 OFFSET ${offset}`;
  const rows = await sparql(q);
  cache.howMany = shuffle(rows.map(r => ({
    label:    r.label.value,
    value:    Math.round(parseFloat(r.val.value)),
    question: def.question,
    unit:     def.unit,
    fmt:      def.fmt,
  })).filter(x => x.value > 0 && x.value < 1e12));
}

/* ════════════════════════════════════════════════════
   Distracteurs
   ════════════════════════════════════════════════════ */
function makeNumDistractors(value, count = 3) {
  const factors = shuffle([0.25, 0.4, 0.5, 0.6, 1.5, 2, 3, 4, 0.1, 10, 0.75, 1.25]);
  const used = new Set([value]);
  const res  = [];
  for (const f of factors) {
    if (res.length >= count) break;
    let v = Math.round(value * f);
    if (v <= 0) continue;
    if (!used.has(v)) { used.add(v); res.push(v); }
  }
  while (res.length < count) {
    const delta = Math.round(value * (0.15 + Math.random() * 0.7)) * (Math.random() > 0.5 ? 1 : -1);
    const v = Math.max(1, value + delta);
    if (!used.has(v)) { used.add(v); res.push(v); }
  }
  return res;
}

/* ════════════════════════════════════════════════════
   MODE : Pays
   ════════════════════════════════════════════════════ */
async function loadCountry() {
  if (cache.country.length < 5) await fillCountryCache();
  if (!cache.country.length) throw new Error("Cache pays vide");

  /* Cherche un item dont le pays est unique dans le cache courant (pour avoir des distracteurs) */
  const allCountries = [...new Set(cache.country.map(x => x.country))];
  if (allCountries.length < 4) {
    cache.country = [];
    await fillCountryCache();
  }

  let item = null;
  for (let i = 0; i < cache.country.length; i++) {
    const candidate = cache.country[i];
    const others = allCountries.filter(c => c !== candidate.country);
    if (others.length >= 3) { item = cache.country.splice(i, 1)[0]; break; }
  }
  if (!item) { item = cache.country.shift(); }

  const allC = [...new Set(cache.country.map(x => x.country))];
  const distractors = shuffle(allC.filter(c => c !== item.country)).slice(0, 3);

  /* Si pas assez de distracteurs, on complète avec des pays connus */
  const FALLBACK = ["France","Italie","Espagne","Allemagne","Royaume-Uni","Japon","Brésil","Australie","Inde","Chine","Mexique","Canada"];
  while (distractors.length < 3) {
    const f = FALLBACK.find(c => c !== item.country && !distractors.includes(c));
    if (f) distractors.push(f); else break;
  }

  const opts = shuffle([
    { val: item.country, label: item.country },
    ...distractors.slice(0,3).map(c => ({ val: c, label: c })),
  ]);

  card.innerHTML = `
    <div class="card-image-wrap">
      <img class="card-image" src="${esc(item.image)}" alt="${esc(item.label)}" loading="lazy">
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
   MODE : Chrono
   ════════════════════════════════════════════════════ */
async function loadBeforeAfter() {
  if (cache.chrono.length < 4) await fillChronoCache();
  if (cache.chrono.length < 2) throw new Error("Cache chrono vide");

  let a, b;
  do {
    [a, b] = shuffle(cache.chrono).slice(0, 2);
  } while (a.year === b.year);

  const earlier = a.year < b.year ? a : b;
  const later   = a.year < b.year ? b : a;
  const fmtY    = y => y < 0 ? `${Math.abs(y)} av. J.-C.` : String(y);

  /* Retire les deux du cache */
  cache.chrono = cache.chrono.filter(x => x !== a && x !== b);

  card.innerHTML = `
    <div class="card-head">
      <div class="card-mode-label">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Lequel est le plus ancien ?
      </div>
      <div class="card-question">Quel événement s'est produit en premier ?</div>
    </div>
    <div class="feedback-bar"></div>
    <div class="options grid2">
      <button class="opt opt-tf" data-val="earlier" style="text-align:center">${esc(earlier.label)}</button>
      <button class="opt opt-tf" data-val="later"   style="text-align:center">${esc(later.label)}</button>
    </div>
    ${nextBtn()}`;

  bindOptions("earlier", (isOk, fb) => {
    card.querySelectorAll(".opt")[0].insertAdjacentHTML("beforeend",`<br><span class="event-year-badge">${fmtY(earlier.year)}</span>`);
    card.querySelectorAll(".opt")[1].insertAdjacentHTML("beforeend",`<br><span class="event-year-badge">${fmtY(later.year)}</span>`);
    if (fb) fb.textContent = isOk
      ? `✓ Correct ! ${earlier.label} (${fmtY(earlier.year)}) est bien plus ancien.`
      : `✗ Non — ${earlier.label} (${fmtY(earlier.year)}) est le plus ancien.`;
  });
}

/* ════════════════════════════════════════════════════
   MODE : Popularité  (most-read, 2 colonnes)
   ════════════════════════════════════════════════════ */
async function loadPopularity() {
  /* most-read d'hier */
  const pad  = n => String(n).padStart(2,"0");
  const now  = new Date(Date.now() - 864e5);
  const url  = `${WIKI_VIEWS_TOP}/${now.getUTCFullYear()}/${pad(now.getUTCMonth()+1)}/${pad(now.getUTCDate())}`;
  const r    = await fetch(url);
  if (!r.ok) throw new Error(`most-read ${r.status}`);
  const d    = await r.json();

  const BL = /^(Accueil|Spécial:|Wikipédia:|Portail:|Aide:|Utilisateur|Main_Page|Special:|Wikipedia:)/i;
  const articles = (d.items?.[0]?.articles||[]).filter(a => !BL.test(a.article) && a.views > 0);
  if (articles.length < 20) throw new Error("Pas assez d'articles");

  const pool = articles.slice(0, 50);
  const idxA = Math.floor(Math.random() * 10);
  const idxB = 10 + Math.floor(Math.random() * Math.min(40, pool.length - 10));
  const artA = pool[idxA];
  const artB = pool[idxB];

  const titleA = artA.article.replaceAll("_"," ");
  const titleB = artB.article.replaceAll("_"," ");

  /* Récup résumés pour images — on utilise l'API REST Wikipedia */
  const [sumA, sumB] = await Promise.all([
    fetch(`${WIKI_REST}/page/summary/${encodeURIComponent(titleA)}`).then(r=>r.ok?r.json():null).catch(()=>null),
    fetch(`${WIKI_REST}/page/summary/${encodeURIComponent(titleB)}`).then(r=>r.ok?r.json():null).catch(()=>null),
  ]);

  /* Images : on utilise Special:FilePath via Wikimedia pour éviter les soucis CORS/referrer */
  const getImg = (sum, title) => {
    if (sum?.thumbnail?.source) {
      /* Remplace la taille dans l'URL thumbnail Wikipedia */
      return sum.thumbnail.source.replace(/\/\d+px-/, "/400px-");
    }
    return null;
  };

  const imgA = getImg(sumA, titleA);
  const imgB = getImg(sumB, titleB);

  const presentALeft = Math.random() > 0.5;
  const left  = presentALeft
    ? { title: sumA?.title??titleA, img: imgA, views: artA.views, key: "A" }
    : { title: sumB?.title??titleB, img: imgB, views: artB.views, key: "B" };
  const right = presentALeft
    ? { title: sumB?.title??titleB, img: imgB, views: artB.views, key: "B" }
    : { title: sumA?.title??titleA, img: imgA, views: artA.views, key: "A" };

  const correctKey = "A";

  function colHTML(side, key) {
    return `
      <button class="opt opt-pop" data-val="${key}">
        ${side.img
          ? `<div class="pop-img-wrap"><img class="pop-img" src="${esc(side.img)}" alt="${esc(side.title)}" loading="lazy" referrerpolicy="no-referrer"></div>`
          : `<div class="pop-img-wrap pop-img-placeholder">?</div>`}
        <div class="pop-label">${esc(side.title)}</div>
        <div class="pop-views-reveal" style="display:none">
          <span class="pop-views-num">${side.views.toLocaleString("fr-FR")} vues</span>
          <div class="pop-bar-wrap"><div class="pop-bar-fill ${side.key==="A"?"winner":""}" style="width:0%" data-target="${Math.round((side.views/(artA.views+artB.views))*100)}"></div></div>
        </div>
      </button>`;
  }

  card.innerHTML = `
    <div class="card-head">
      <div class="card-mode-label">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Popularité Wikipedia
      </div>
      <div class="card-question">Lequel est le plus consulté hier ?</div>
    </div>
    <div class="feedback-bar"></div>
    <div class="options grid2 pop-grid">
      ${colHTML(left,  presentALeft?"A":"B")}
      ${colHTML(right, presentALeft?"B":"A")}
    </div>
    ${nextBtn()}`;

  bindOptions(correctKey, (isOk, fb) => {
    card.querySelectorAll(".pop-views-reveal").forEach(el => el.style.display = "");
    requestAnimationFrame(() => {
      card.querySelectorAll(".pop-bar-fill").forEach(bar => {
        bar.style.width = bar.dataset.target + "%";
      });
    });
    if (fb) fb.textContent = isOk
      ? `✓ Oui ! "${sumA?.title??titleA}" (${artA.views.toLocaleString("fr-FR")} vues) vs ${artB.views.toLocaleString("fr-FR")} vues.`
      : `✗ "${sumA?.title??titleA}" était plus consulté (${artA.views.toLocaleString("fr-FR")} vues).`;
  });
}

/* ════════════════════════════════════════════════════
   MODE : Qui est-ce ?
   ════════════════════════════════════════════════════ */
async function loadWhoIsIt() {
  if (cache.whoIsIt.length < 5) await fillWhoIsItCache();
  if (cache.whoIsIt.length < 4) throw new Error("Cache qui est-ce vide");

  const item = cache.whoIsIt.shift();
  /* 3 distracteurs depuis le reste du cache */
  const distractors = shuffle(cache.whoIsIt.filter(x => x.label !== item.label)).slice(0, 3);
  if (distractors.length < 3) {
    cache.whoIsIt = [];
    await fillWhoIsItCache();
    return loadWhoIsIt();
  }

  const opts = shuffle([
    { val: item.label, label: item.label },
    ...distractors.map(d => ({ val: d.label, label: d.label })),
  ]);

  card.innerHTML = `
    <div class="card-image-wrap">
      <img class="card-image" src="${esc(item.image)}" alt="Qui est-ce ?" loading="lazy" referrerpolicy="no-referrer" style="filter:brightness(.92) contrast(1.05)">
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
    /* Révèle le nom dans la caption */
    const wrap = card.querySelector(".card-image-wrap");
    if (wrap && !wrap.querySelector(".card-image-caption")) {
      wrap.insertAdjacentHTML("beforeend", `<div class="card-image-caption">${esc(item.label)}</div>`);
    }
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
  const distractorVals = makeNumDistractors(item.value);
  const opts = shuffle([
    { val: String(item.value), label: item.fmt(item.value) + " " + item.unit },
    ...distractorVals.map(v => ({ val: String(v), label: item.fmt(v) + " " + item.unit })),
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

  bindOptions(String(item.value), (isOk, fb) => {
    if (fb) fb.textContent = isOk
      ? `✓ Exact !`
      : `✗ La réponse était : ${item.fmt(item.value)} ${item.unit}`;
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

/* ── Init ── */
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

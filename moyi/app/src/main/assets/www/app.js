/* ══════════════════════════════════════════════════════════════
   墨一 · Mo Yi — 中华古典诗词档案馆
   数据：CNPoetry-Hermes 流水线产物（全部结论可逐字回源）
   ══════════════════════════════════════════════════════════════ */
"use strict";

/* ── 工具 ─────────────────────────────────────────────────── */
const $view = document.getElementById("view");
const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");
const CJK_RE = /[㐀-鿿豈-﫿\u{20000}-\u{3134F}]/gu;
const cjkOnly = s => (String(s || "").match(CJK_RE) || []).join("");
const HAN_NUM = "一二三四五六七八九十";
const hanNum = n => n <= 10 ? (n === 10 ? "十" : HAN_NUM[n - 1])
  : n < 20 ? "十" + HAN_NUM[n - 11] : String(n);

/* ── 数据层 ───────────────────────────────────────────────── */
const _cache = new Map();
function getJSON(path) {
  if (!_cache.has(path)) {
    _cache.set(path, fetch("data/" + path).then(r => {
      if (!r.ok) throw new Error(path + " → " + r.status);
      return r.json();
    }).catch(e => { _cache.delete(path); throw e; }));
  }
  return _cache.get(path);
}

let _t2s = null;
async function foldMap() {
  if (!_t2s) _t2s = await getJSON("t2s.json");
  return _t2s;
}
function fold(s) {           // 繁→简折叠（需先 await foldMap()）
  if (!_t2s) return String(s || "");
  let out = "";
  for (const ch of String(s || "")) out += _t2s[ch] || ch;
  return out;
}

const N_SHARDS = 48;
function shardOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0x7fffffff;
  return h % N_SHARDS;
}
async function poemById(id) {
  const shard = await getJSON("poems/shard_" + String(shardOf(id)).padStart(2, "0") + ".json");
  return shard.find(p => p.id === id) || null;
}

let _catalogP = null;        // 目录（懒加载，含全文折叠索引）
function catalog() {
  if (!_catalogP) {
    _catalogP = Promise.all([getJSON("catalog.json"), foldMap()]).then(([rows]) => {
      const byId = new Map();
      for (const r of rows) byId.set(r[0], r);
      return { rows, byId };
    });
  }
  return _catalogP;
}

/* ── 收藏夹（localStorage） ────────────────────────────────── */
const FAV_KEY = "moyi_fav_v1";
function getFavs() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); }
  catch { return []; }
}
function isFav(id) { return getFavs().some(f => f.id === id); }
function toggleFav(poem) {
  let favs = getFavs();
  if (favs.some(f => f.id === poem.id)) {
    favs = favs.filter(f => f.id !== poem.id);
  } else {
    favs.unshift({ id: poem.id, t: poem.t, a: poem.a, d: poem.d, ts: Date.now() });
  }
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  return favs.some(f => f.id === poem.id);
}

/* ── 路由 ─────────────────────────────────────────────────── */
const routes = [];
function route(pattern, fn) { routes.push({ pattern, fn }); }
function parseHash() {
  const raw = (location.hash || "#/").slice(1);
  const qIdx = raw.indexOf("?");
  const path = decodeURIComponent(qIdx < 0 ? raw : raw.slice(0, qIdx));
  const query = {};
  if (qIdx >= 0) for (const kv of raw.slice(qIdx + 1).split("&")) {
    const [k, v] = kv.split("=");
    if (k) query[k] = decodeURIComponent(v || "");
  }
  return { path: path || "/", query };
}
async function render() {
  const { path, query } = parseHash();
  const tab = path.split("/")[1] || "home";
  document.querySelectorAll(".tab").forEach(a => {
    const t = a.dataset.tab;
    a.classList.toggle("active",
      t === (["", "poem"].includes(tab) ? "home" : tab) ||
      (t === "home" && path === "/") ||
      (t === "imagery" && tab === "imagery") ||
      (t === "salon" && ["salon", "cipai", "theme", "feihua", "about", "starmap", "fav"].includes(tab)) ||
      (t === "poets" && tab === "poet"));
  });
  for (const { pattern, fn } of routes) {
    const m = path.match(pattern);
    if (m) {
      window.scrollTo(0, 0);
      $view.innerHTML = `<div class="loading">墨 迹 研 磨 中 …</div>`;
      try { await fn(m, query); } catch (e) {
        $view.innerHTML = `<div class="empty">载入失败<br><small>${esc(e.message)}</small></div>`;
      }
      return;
    }
  }
  location.hash = "#/";
}
window.addEventListener("hashchange", render);

/* 阅读器返回：优先浏览历史（保持来路状态） */
function goBack(fallback) {
  if (history.length > 1) history.back();
  else location.hash = fallback || "#/";
}

/* ── 组件 ─────────────────────────────────────────────────── */
const sealHTML = (txt, lg) =>
  `<span class="seal${lg ? " lg" : ""}">${esc(txt)}</span>`;

const kicker = (num, title, hint) => `
  <div class="kicker"><span class="num">卷${hanNum(num)}</span>
    <h2>${esc(title)}</h2>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</div>`;

const backBtn = (label, fallback) => `
  <button class="backlink" onclick="goBack('${fallback || "#/"}')">
    <svg viewBox="0 0 24 24"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    ${esc(label || "返回")}</button>`;

const searchboxHTML = (id, ph) => `
  <div class="searchbox">
    <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m15.3 15.3 4.9 4.9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    <input id="${id}" type="search" placeholder="${esc(ph)}" autocomplete="off">
  </div>`;

function poemRowHTML(row, subline) {
  const [id, t, a, d] = row;
  return `<a class="poem-row" href="#/poem/${encodeURIComponent(id)}">
      <span class="pr-t">${esc(t || "无题")}</span>
      <span class="pr-a">${esc(a)}</span>
      ${d ? `<span class="pr-d">${esc(d)}</span>` : ""}
    </a>${subline ? `<div class="poem-sub">${subline}</div>` : ""}`;
}

/* 渐进列表：一次渲染 chunk 条，末尾「再展一卷」 */
function progressiveList(container, items, renderItem, chunk = 60) {
  let n = 0;
  const step = () => {
    const frag = document.createElement("div");
    frag.innerHTML = items.slice(n, n + chunk).map(renderItem).join("");
    const more = container.querySelector(".list-more");
    if (more) more.remove();
    container.insertAdjacentHTML("beforeend", frag.innerHTML);
    n += chunk;
    if (n < items.length) {
      container.insertAdjacentHTML("beforeend",
        `<div class="list-more"><button class="btn">再展一卷 · 余 ${items.length - n} 条</button></div>`);
      container.querySelector(".list-more button").onclick = step;
    }
  };
  container.innerHTML = items.length ? "" : `<div class="empty">空 山 不 见 诗</div>`;
  if (items.length) step();
}

/* ── 视图：今日（首页） ────────────────────────────────────── */
route(/^\/$/, async () => {
  const stats = await getJSON("stats.json");
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const shard = await getJSON("poems/shard_" + String(seed % N_SHARDS).padStart(2, "0") + ".json");
  const nice = shard.filter(p => p.l.length >= 4 && p.l.length <= 10 && p.t && p.a !== "佚名");
  const pool = nice.length ? nice : shard;
  const poem = pool[(seed * 2654435761 % pool.length + pool.length) % pool.length];
  const dateStr = `${today.getFullYear()} 年 ${today.getMonth() + 1} 月 ${today.getDate()} 日`;

  $view.innerHTML = `
    <div class="masthead">
      <div><h1>墨一</h1><div class="sub">一墨藏万象 · 诗词档案馆</div></div>
      ${sealHTML("墨一", true)}
    </div>
    <hr class="rule-double">

    ${kicker(1, "今日一诗", "日日更新")}
    <a class="card daily tappable" href="#/poem/${encodeURIComponent(poem.id)}">
      <div class="d-date">${dateStr}</div>
      <div class="d-title">${esc(poem.t)}</div>
      <div class="d-meta">${esc(poem.d)} · ${esc(poem.a)} · ${esc(poem.b)}</div>
      <div class="d-lines">${poem.l.slice(0, 4).map(esc).join("，<br>")}${poem.l.length > 4 ? "……" : ""}</div>
      <div class="d-more">展卷细读 →</div>
    </a>

    <div class="stats-strip">
      <div class="st"><b>${stats.poems.toLocaleString()}</b><span>作品</span></div>
      <div class="st"><b>${stats.imagery}</b><span>意象</span></div>
      <div class="st"><b>${stats.authors}</b><span>诗人</span></div>
      <div class="st"><b>${stats.cipai}</b><span>词牌</span></div>
    </div>

    ${kicker(2, "馆藏四门")}
    <div class="entry-grid">
      <a class="entry" href="#/imagery"><b>意象档案</b><span>五十意象 · 情感光谱 · 全量例证</span><span class="e-glyph">月</span></a>
      <a class="entry" href="#/lib"><b>文库检索</b><span>题目 · 作者 · 全文逐字</span><span class="e-glyph">检</span></a>
      <a class="entry" href="#/poets"><b>诗人档案</b><span>小传 · 惯用意象 · 体裁分布</span><span class="e-glyph">人</span></a>
      <a class="entry" href="#/salon"><b>风雅集</b><span>词牌定格 · 题材九品 · 飞花令</span><span class="e-glyph">令</span></a>
    </div>

    ${kicker(3, "证据之约")}
    <div class="card about">
      <p>无原文，不成论断；无篇目，不成证据。本馆一切意象结论、情感联系、词牌定格，皆逐字回源至具体诗句 —— 点开即见原诗。</p>
      <p class="credit">语料：chinese-poetry 开源库 · 规则：CNPoetry-Hermes 自主挖掘流水线 · 医哲未来人工智能研究院（IMPF-AI）</p>
    </div>`;
});

/* ── 视图：意象档案（列表） ────────────────────────────────── */
route(/^\/imagery$/, async () => {
  const profiles = await getJSON("imagery_profiles.json");
  $view.innerHTML = `
    <div class="masthead">
      <div><h1>意象</h1><div class="sub">五十意象 · 皆可回源</div></div>
      ${sealHTML("意象档案")}
    </div>
    <hr class="rule-double">
    ${searchboxHTML("img-q", "寻一意象，如：月 / 孤舟 / 杜鹃")}
    <div class="img-grid" id="img-grid"></div>`;

  const grid = document.getElementById("img-grid");
  const draw = q => {
    const list = profiles.filter(p => !q || p.imagery.includes(q) ||
      (p.surface_forms || []).some(s => s.includes(q)));
    grid.innerHTML = list.map(p => {
      const emo = (p.emotion_associations || [])[0];
      return `<a class="img-cell" href="#/imagery/${encodeURIComponent(p.imagery)}">
          ${emo ? `<span class="e">${esc(emo.emotion.slice(0, 2))}</span>` : ""}
          <span class="g">${esc(p.imagery)}</span>
          <span class="n">${p.n_poems} 首</span>
        </a>`;
    }).join("") || `<div class="empty" style="grid-column:1/-1">未收此意象</div>`;
  };
  draw("");
  document.getElementById("img-q").oninput = e => draw(e.target.value.trim());
});

/* ── 视图：意象详情（档案 / 例证长卷） ─────────────────────── */
route(/^\/imagery\/([^/]+)(?:\/(evi))?$/, async (m) => {
  const name = m[1], tabEvi = m[2] === "evi";
  const profiles = await getJSON("imagery_profiles.json");
  const prof = profiles.find(p => p.imagery === name);
  if (!prof) { $view.innerHTML = `<div class="empty">未收此意象</div>`; return; }
  const exam = await getJSON("imagery/" + prof.ex);

  const maxSup = Math.max(1, ...(prof.emotion_associations || []).map(e => e.support));
  const dyn = Object.entries(prof.dynasty_distribution || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxDyn = Math.max(1, ...dyn.map(d => d[1]));

  $view.innerHTML = `
    <div class="reader-top">${backBtn("意象档案", "#/imagery")}${sealHTML(name)}</div>
    <div class="img-hero">
      <span class="big">${esc(name)}</span>
      <div class="facts">
        <div class="nums">见于 ${prof.n_poems} 首 · 例证 ${exam.n_listed} 条</div>
        <div class="forms">${(prof.surface_forms || []).map(s => `<span class="form-tag">${esc(s)}</span>`).join("")}</div>
      </div>
    </div>
    <div class="seg">
      <button id="seg-prof" class="${tabEvi ? "" : "on"}">档案</button>
      <button id="seg-evi" class="${tabEvi ? "on" : ""}">例证长卷 · ${exam.n_listed}</button>
    </div>
    <div id="img-body"></div>`;

  const body = document.getElementById("img-body");
  document.getElementById("seg-prof").onclick = () =>
    location.replace("#/imagery/" + encodeURIComponent(name));
  document.getElementById("seg-evi").onclick = () =>
    location.replace("#/imagery/" + encodeURIComponent(name) + "/evi");

  if (!tabEvi) {
    /* —— 档案页 —— */
    body.innerHTML = `
      ${kicker(1, "情感光谱", "支撑数为语料计量")}
      <div class="card">
        ${(prof.emotion_associations || []).map(e => `
          <div class="emo-row">
            <div class="emo-head"><span class="name">${esc(e.emotion)}</span>
              <span class="sup">${e.support} 处支撑</span></div>
            <div class="emo-bar"><i style="width:${Math.round(e.support / maxSup * 100)}%"></i></div>
            ${e.example ? `<a class="emo-quote" href="#/poem/${encodeURIComponent(e.example.poem_id)}?hl=${encodeURIComponent(e.example.quote)}">
                「<span class="q">${esc(e.example.quote)}</span>」<span class="src">·《${esc(e.example.title)}》→</span></a>` : ""}
          </div>`).join("") || `<div class="empty">暂无情感联系</div>`}
      </div>

      ${kicker(2, "常见并置", "同篇共现")}
      <div class="card">
        ${(prof.co_imagery || []).map(c =>
          `<a class="chip" href="#/imagery/${encodeURIComponent(c.imagery)}">${esc(c.imagery)} · ${c.count}</a>`).join("")
        || `<div class="empty">—</div>`}
      </div>

      ${kicker(3, "朝代分布")}
      <div class="card">
        <div class="dyn-bars">${dyn.map(([d, n]) => `
          <div class="db"><b>${n}</b><i style="height:${Math.max(4, Math.round(n / maxDyn * 100))}%"></i><span>${esc(d)}</span></div>`).join("")}
        </div>
      </div>
      <button class="btn primary block" onclick="location.replace('#/imagery/${encodeURIComponent(name)}/evi')">
        展开全部 ${exam.n_listed} 条例证长卷</button>`;
  } else {
    /* —— 例证长卷：全部例证可浏览、可过滤、逐条回源 —— */
    body.innerHTML = `
      ${searchboxHTML("evi-q", "于长卷中过滤：诗句 / 篇名 / 作者 / 朝代")}
      <div id="evi-list"></div>`;
    const listEl = document.getElementById("evi-list");
    const surfaces = [...(prof.surface_forms || [name])].sort((a, b) => b.length - a.length);
    const markQuote = q => {
      let out = esc(q);
      for (const s of surfaces) {
        if (q.includes(s)) { out = esc(q).split(esc(s)).join(`<mark>${esc(s)}</mark>`); break; }
      }
      return out;
    };
    const renderItem = ex => {
      const [pid, title, author, dynasty, quote] = ex;
      return `<a class="evi-item" href="#/poem/${encodeURIComponent(pid)}?hl=${encodeURIComponent(quote)}">
          <div class="quote">${markQuote(quote || "（全篇回源）")}</div>
          <div class="src">《${esc(title || "无题")}》 ${esc(dynasty)} · ${esc(author)}</div>
        </a>`;
    };
    const draw = q => progressiveList(listEl,
      exam.examples.filter(ex => !q || ex.some(f => String(f).includes(q))), renderItem, 80);
    draw("");
    document.getElementById("evi-q").oninput = e => draw(e.target.value.trim());
  }
});

/* ── 视图：文库（书架 + 检索） ─────────────────────────────── */
route(/^\/lib$/, async (_m, query) => {
  const stats = await getJSON("stats.json");
  $view.innerHTML = `
    <div class="masthead">
      <div><h1>文库</h1><div class="sub">${stats.poems.toLocaleString()} 首 · 逐字可检</div></div>
      ${sealHTML("文库")}
    </div>
    <hr class="rule-double">
    ${searchboxHTML("lib-q", "检索全文 / 题目 / 作者 …")}
    <div id="lib-mode" class="seg" style="display:none">
      <button data-m="text" class="on">全文</button>
      <button data-m="t">题目</button>
      <button data-m="a">作者</button>
    </div>
    <div id="lib-body"></div>`;

  const body = document.getElementById("lib-body");
  const modeSeg = document.getElementById("lib-mode");
  const input = document.getElementById("lib-q");
  let mode = "text";

  const shelves = () => {
    modeSeg.style.display = "none";
    body.innerHTML = `
      ${kicker(1, "集部书架")}
      ${Object.entries(stats.books).map(([b, n]) => `
        <a class="card tappable" style="display:flex;align-items:baseline;gap:12px;padding:14px 18px"
           href="#/lib?book=${encodeURIComponent(b)}">
          <b style="font-size:1.02rem;letter-spacing:.12em">${esc(b)}</b>
          <span style="margin-left:auto;color:var(--ink-3);font-size:.78rem">${n.toLocaleString()} 首 →</span>
        </a>`).join("")}`;
  };

  const listBook = async book => {
    modeSeg.style.display = "none";
    body.innerHTML = `<div class="loading">展 卷 中 …</div>`;
    const { rows } = await catalog();
    const hits = rows.filter(r => r[4] === book);
    body.innerHTML = `${kicker(1, book, hits.length.toLocaleString() + " 首")}<div id="bk"></div>`;
    progressiveList(document.getElementById("bk"), hits, r => poemRowHTML(r), 60);
  };

  let tok = 0;
  const search = async q => {
    modeSeg.style.display = "flex";
    const my = ++tok;
    body.innerHTML = `<div class="loading">逐 字 检 索 中 …</div>`;
    const { rows } = await catalog();
    if (my !== tok) return;
    const fq = fold(cjkOnly(q));
    if (!fq) { body.innerHTML = `<div class="empty">请以汉字检索</div>`; return; }
    const hits = [];
    for (const r of rows) {
      if (mode === "text" ? r[7].includes(fq)
        : mode === "t" ? fold(r[1]).includes(fq)
        : fold(r[2]).includes(fq)) hits.push(r);
      if (hits.length >= 2000) break;
    }
    if (my !== tok) return;
    body.innerHTML = `${kicker(1, "检得", hits.length + (hits.length >= 2000 ? "+" : "") + " 首")}<div id="sr"></div>`;
    progressiveList(document.getElementById("sr"), hits, r => poemRowHTML(r), 60);
  };

  modeSeg.querySelectorAll("button").forEach(b => b.onclick = () => {
    modeSeg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    mode = b.dataset.m;
    if (input.value.trim()) search(input.value.trim());
  });
  let timer = null;
  input.oninput = () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { shelves(); return; }
    timer = setTimeout(() => search(q), 260);
  };

  if (query.book) { await listBook(query.book); } else shelves();
});

/* ── 视图：诗人档案 ────────────────────────────────────────── */
route(/^\/poets$/, async () => {
  const authors = await getJSON("authors.json");
  await foldMap();
  $view.innerHTML = `
    <div class="masthead">
      <div><h1>诗人</h1><div class="sub">${authors.length} 位 · 档案与小传</div></div>
      ${sealHTML("诗人档案")}
    </div>
    <hr class="rule-double">
    ${searchboxHTML("poet-q", "寻一诗人，如：李白 / 苏轼 / 纳兰")}
    <div id="poet-list"></div>`;
  const listEl = document.getElementById("poet-list");
  const row = a => {
    const imgs = (a.top_imagery || []).slice(0, 3).map(i => i.imagery).join(" · ");
    return `<a class="person-row" href="#/poet/${encodeURIComponent(a.author)}">
        <span class="avatar">${esc([...a.author][0] || "佚")}</span>
        <span class="who"><b>${esc(a.author)}</b><span>${esc(a.dynasty || "—")}${imgs ? " · 常咏 " + esc(imgs) : ""}</span></span>
        <span class="cnt">${a.n_poems} 首</span>
      </a>`;
  };
  const draw = q => {
    const fq = fold(q);
    progressiveList(listEl,
      authors.filter(a => !fq || fold(a.author).includes(fq)), row, 60);
  };
  draw("");
  document.getElementById("poet-q").oninput = e => draw(e.target.value.trim());
});

route(/^\/poet\/([^/]+)$/, async m => {
  const name = m[1];
  const authors = await getJSON("authors.json");
  const a = authors.find(x => x.author === name);
  if (!a) { $view.innerHTML = `<div class="empty">未立此档</div>`; return; }
  const forms = Object.entries(a.form_distribution || {}).sort((x, y) => y[1] - x[1]).slice(0, 8);

  $view.innerHTML = `
    <div class="reader-top">${backBtn("诗人档案", "#/poets")}${sealHTML(a.author)}</div>
    <div class="img-hero">
      <span class="big" style="font-size:3rem">${esc(a.author)}</span>
      <div class="facts"><div class="nums">${esc(a.dynasty || "—")} · 存诗 ${a.n_poems} 首</div></div>
    </div>
    ${a.bio ? `${kicker(1, "小传", "集内旁证 · C 层")}<div class="card"><div class="bio">${esc(a.bio)}</div></div>` : ""}
    ${kicker(a.bio ? 2 : 1, "惯用意象")}
    <div class="card">
      ${(a.top_imagery || []).map(i => `<a class="chip" href="#/imagery/${encodeURIComponent(i.imagery)}">${esc(i.imagery)} · ${i.count}</a>`).join("") || "—"}
    </div>
    ${kicker(a.bio ? 3 : 2, "体裁分布")}
    <div class="card">${forms.map(([f, n]) => `<span class="chip">${esc(f)} · ${n}</span>`).join("") || "—"}</div>
    ${kicker(a.bio ? 4 : 3, "存世作品")}
    <div id="poet-poems"><div class="loading">展 卷 中 …</div></div>`;

  const { rows } = await catalog();
  const fname = fold(a.author);
  const hits = rows.filter(r => fold(r[2]) === fname);
  progressiveList(document.getElementById("poet-poems"), hits, r => poemRowHTML(r), 60);
});

/* ── 视图：风雅集 ──────────────────────────────────────────── */
route(/^\/salon$/, async () => {
  const stats = await getJSON("stats.json");
  $view.innerHTML = `
    <div class="masthead">
      <div><h1>雅集</h1><div class="sub">格律 · 题材 · 游艺</div></div>
      ${sealHTML("风雅集")}
    </div>
    <hr class="rule-double">
    <div class="entry-grid">
      <a class="entry" href="#/starmap"><b>意象星图</b><span>五十意象 · 同篇共现网络</span><span class="e-glyph">星</span></a>
      <a class="entry" href="#/fav"><b>收藏夹</b><span>${getFavs().length} 首 · 私藏诗笺</span><span class="e-glyph">藏</span></a>
      <a class="entry" href="#/cipai"><b>词牌定格</b><span>${stats.cipai} 牌 · 语料归纳句式</span><span class="e-glyph">词</span></a>
      <a class="entry" href="#/theme"><b>题材九品</b><span>${stats.themes} 品 · 咏史至闺怨</span><span class="e-glyph">品</span></a>
      <a class="entry" href="#/feihua"><b>飞花令</b><span>以字为令 · 语料实证应对</span><span class="e-glyph">飞</span></a>
      <a class="entry" href="#/about"><b>关于墨一</b><span>证据分级 · 语料出处</span><span class="e-glyph">印</span></a>
    </div>`;
});

/* ── 视图：意象星图 ────────────────────────────────────────── */
route(/^\/starmap$/, async () => {
  const net = (await getJSON("network.json")).imagery_network;
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("意象星图")}</div>
    <div class="starmap-wrap">
      <div class="starmap-hint">同 篇 共 现 · 点 选 一 星</div>
      <canvas id="star-cv"></canvas>
    </div>
    <div class="card star-info" id="star-info">
      <div class="si-head"><span class="g">五十意象</span>
        <span class="n">${net.edges.length} 条共现 · 点选星点查看</span></div>
      <div class="si-edges" style="color:var(--ink-2);font-size:.86rem">
        星点大小为该意象在 ${net.n_poems.toLocaleString()} 篇语料中的出现计量，
        连线粗细为两意象同篇共现之数 —— 皆为 B 层确定性计量，可回源复算。</div>
    </div>`;

  const cv = document.getElementById("star-cv");
  const info = document.getElementById("star-info");
  const css = getComputedStyle(document.documentElement);
  const C = name => css.getPropertyValue(name).trim();
  const W = cv.parentElement.clientWidth;
  const H = Math.min(Math.round(window.innerHeight * .62), W * 1.25);
  const dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.height = H + "px";
  const ctx = cv.getContext("2d");
  ctx.scale(dpr, dpr);

  /* 力导向布局（50 节点，一次性模拟） */
  const idx = new Map(net.nodes.map((n, i) => [n.imagery, i]));
  const maxCnt = Math.max(...net.nodes.map(n => n.count));
  const nodes = net.nodes.map((n, i) => {
    const ang = i * 2.399963;              // 黄金角散布
    const r0 = 30 + 5.2 * Math.sqrt(i) * 8;
    return { name: n.imagery, count: n.count,
      r: 9 + 17 * Math.sqrt(n.count / maxCnt),
      x: Math.cos(ang) * r0, y: Math.sin(ang) * r0, vx: 0, vy: 0 };
  });
  const maxW = Math.max(...net.edges.map(e => e.weight));
  const edges = net.edges
    .map(e => ({ a: idx.get(e.source), b: idx.get(e.target), w: e.weight }))
    .filter(e => e.a != null && e.b != null);
  for (let it = 0; it < 320; it++) {
    const k = it < 200 ? .9 : .45;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const A = nodes[i], B = nodes[j];
      let dx = B.x - A.x, dy = B.y - A.y;
      let d2 = dx * dx + dy * dy || 1, d = Math.sqrt(d2);
      const rep = 5200 / d2;
      dx /= d; dy /= d;
      A.vx -= dx * rep * k; A.vy -= dy * rep * k;
      B.vx += dx * rep * k; B.vy += dy * rep * k;
      const minD = A.r + B.r + 6;          // 防重叠
      if (d < minD) {
        const push = (minD - d) * .5;
        A.vx -= dx * push; A.vy -= dy * push;
        B.vx += dx * push; B.vy += dy * push;
      }
    }
    for (const e of edges) {
      const A = nodes[e.a], B = nodes[e.b];
      let dx = B.x - A.x, dy = B.y - A.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const pull = (d - 70) * .015 * (0.3 + e.w / maxW) * k;
      dx /= d; dy /= d;
      A.vx += dx * pull * d * .02; A.vy += dy * pull * d * .02;
      B.vx -= dx * pull * d * .02; B.vy -= dy * pull * d * .02;
    }
    for (const n of nodes) {
      n.vx -= n.x * .012; n.vy -= n.y * .012;   // 向心
      n.x += Math.max(-14, Math.min(14, n.vx));
      n.y += Math.max(-14, Math.min(14, n.vy));
      n.vx *= .5; n.vy *= .5;
    }
  }
  /* 归一化到画布 */
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const pad = 34;
  const sx = (W - pad * 2) / (Math.max(...xs) - Math.min(...xs));
  const sy = (H - pad * 2) / (Math.max(...ys) - Math.min(...ys));
  const s = Math.min(sx, sy), mx = Math.min(...xs), my = Math.min(...ys);
  const ox = (W - (Math.max(...xs) - mx) * s) / 2;
  const oy = (H - (Math.max(...ys) - my) * s) / 2;
  for (const n of nodes) { n.x = (n.x - mx) * s + ox; n.y = (n.y - my) * s + oy; }

  let selected = -1;
  const neighbors = i => {
    const out = [];
    for (const e of edges) {
      if (e.a === i) out.push({ n: e.b, w: e.w });
      else if (e.b === i) out.push({ n: e.a, w: e.w });
    }
    return out.sort((p, q) => q.w - p.w);
  };

  function draw() {
    const ink = C("--ink"), seal = C("--seal"), raise = C("--paper-raise");
    ctx.clearRect(0, 0, W, H);
    const nb = selected >= 0 ? new Set(neighbors(selected).map(o => o.n)) : null;
    for (const e of edges) {
      const active = selected < 0 || e.a === selected || e.b === selected;
      const A = nodes[e.a], B = nodes[e.b];
      ctx.beginPath();
      ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
      ctx.strokeStyle = (selected >= 0 && active) ? seal : ink;
      ctx.globalAlpha = active ? .10 + .5 * (e.w / maxW) * (selected >= 0 ? 1.4 : 1) : .04;
      ctx.lineWidth = .6 + 3.4 * (e.w / maxW);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const active = selected < 0 || i === selected || (nb && nb.has(i));
      ctx.globalAlpha = active ? 1 : .22;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = i === selected ? seal : raise;
      ctx.fill();
      ctx.strokeStyle = i === selected ? seal : ink;
      ctx.lineWidth = i === selected ? 2 : 1;
      ctx.globalAlpha = active ? (i === selected ? 1 : .55) : .18;
      ctx.stroke();
      ctx.globalAlpha = active ? 1 : .3;
      ctx.fillStyle = i === selected ? C("--seal-ink") : ink;
      ctx.font = `${Math.max(11, n.r * .92)}px "LXGW WenKai", serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(n.name, n.x, n.y + 1);
    }
    ctx.globalAlpha = 1;
  }
  draw();

  cv.addEventListener("click", ev => {
    const rect = cv.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    let hit = -1;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if ((x - n.x) ** 2 + (y - n.y) ** 2 <= (n.r + 6) ** 2) { hit = i; break; }
    }
    selected = hit === selected ? -1 : hit;
    draw();
    if (selected >= 0) {
      const n = nodes[selected];
      const nbs = neighbors(selected).slice(0, 8);
      info.innerHTML = `
        <div class="si-head"><span class="g">${esc(n.name)}</span>
          <span class="n">计量 ${n.count.toLocaleString()} 处</span>
          <a class="go" href="#/imagery/${encodeURIComponent(n.name)}">展开档案 →</a></div>
        <div class="si-edges">${nbs.map(o =>
          `<a class="chip" href="#/imagery/${encodeURIComponent(nodes[o.n].name)}">${esc(nodes[o.n].name)} · 共现 ${o.w}</a>`).join("")}</div>`;
    } else {
      info.innerHTML = `
        <div class="si-head"><span class="g">五十意象</span>
          <span class="n">${edges.length} 条共现 · 点选星点查看</span></div>`;
    }
  });
});

/* ── 视图：收藏夹 ──────────────────────────────────────────── */
route(/^\/fav$/, async () => {
  const favs = getFavs();
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("收藏夹")}</div>
    <div class="masthead"><div><h1>私藏</h1><div class="sub">${favs.length} 首 · 存于此机</div></div></div>
    <hr class="rule-double">
    <div id="fav-list"></div>`;
  const listEl = document.getElementById("fav-list");
  const drawList = () => {
    const cur = getFavs();
    listEl.innerHTML = cur.length ? cur.map(f => `
      <div class="fav-row" data-id="${esc(f.id)}">
        ${poemRowHTML([f.id, f.t, f.a, f.d])}
        <button class="rm" aria-label="移出收藏">✕</button>
      </div>`).join("")
      : `<div class="empty">笺 匣 尚 空<br><small style="letter-spacing:.1em">阅读时点「藏」即可收入</small></div>`;
    listEl.querySelectorAll(".fav-row .rm").forEach(btn => btn.onclick = () => {
      const id = btn.parentElement.dataset.id;
      toggleFav({ id });
      drawList();
    });
  };
  drawList();
});

/* ── 视图：词牌 ────────────────────────────────────────────── */
route(/^\/cipai$/, async () => {
  const cipai = await getJSON("cipai.json");
  await foldMap();
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("词牌定格")}</div>
    ${searchboxHTML("cp-q", "寻一词牌，如：水调歌头 / 浣溪沙")}
    <div id="cp-list"></div>`;
  const listEl = document.getElementById("cp-list");
  const row = c => `<a class="person-row" href="#/cipai/${encodeURIComponent(c.cipai)}">
      <span class="avatar">${esc([...c.cipai][0])}</span>
      <span class="who"><b>${esc(c.cipai)}</b><span>${c.char_pattern ? "句式 " + esc(c.char_pattern) : "句式不定"}</span></span>
      <span class="cnt">${c.n_poems} 首</span></a>`;
  const draw = q => progressiveList(listEl,
    cipai.filter(c => !q || fold(c.cipai).includes(fold(q))), row, 60);
  draw("");
  document.getElementById("cp-q").oninput = e => draw(e.target.value.trim());
});

route(/^\/cipai\/([^/]+)$/, async m => {
  const cipai = await getJSON("cipai.json");
  const c = cipai.find(x => x.cipai === m[1]);
  if (!c) { $view.innerHTML = `<div class="empty">未收此牌</div>`; return; }
  $view.innerHTML = `
    <div class="reader-top">${backBtn("词牌定格", "#/cipai")}${sealHTML(c.cipai)}</div>
    <div class="img-hero">
      <span class="big" style="font-size:3rem">${esc(c.cipai)}</span>
      <div class="facts"><div class="nums">语料 ${c.n_poems} 首 · 众数 ${c.line_count_mode || "—"} 句</div>
        ${c.char_pattern ? `<div class="forms"><span class="form-tag">句式 ${esc(c.char_pattern)}</span>
          <span class="form-tag">一致率 ${(100 * (c.pattern_consistency || 0)).toFixed(0)}%</span></div>` : ""}
      </div>
    </div>
    <div class="card about"><p class="credit">定格为语料归纳（众数句式），系 B 层计量结论，不冒称词谱权威；例词为语料全部支撑作品。</p></div>
    ${kicker(1, "例词", (c.supporting_poems || []).length + " 首")}
    <div id="cp-poems"><div class="loading">展 卷 中 …</div></div>`;
  const { byId } = await catalog();
  const hits = (c.supporting_poems || []).map(id => byId.get(id)).filter(Boolean);
  progressiveList(document.getElementById("cp-poems"), hits, r => poemRowHTML(r), 60);
});

/* ── 视图：题材九品 ────────────────────────────────────────── */
route(/^\/theme$/, async () => {
  const themes = await getJSON("themes.json");
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("题材九品")}</div>
    ${themes.map(t => `
      <a class="card tappable" href="#/theme/${encodeURIComponent(t.theme)}" style="display:block">
        <b style="font-size:1.05rem;letter-spacing:.2em">${esc(t.theme)}</b>
        <span style="float:right;color:var(--ink-3);font-size:.78rem">${t.n_poems} 首 →</span>
        <div style="color:var(--ink-2);font-size:.85rem;margin-top:4px">${esc(t.definition || "")}</div>
      </a>`).join("")}`;
});

route(/^\/theme\/([^/]+)$/, async m => {
  const themes = await getJSON("themes.json");
  const t = themes.find(x => x.theme === m[1]);
  if (!t) { $view.innerHTML = `<div class="empty">未立此品</div>`; return; }
  $view.innerHTML = `
    <div class="reader-top">${backBtn("题材九品", "#/theme")}${sealHTML(t.theme)}</div>
    <div class="img-hero"><span class="big" style="font-size:2.6rem">${esc(t.theme)}</span>
      <div class="facts"><div class="nums">${t.n_poems} 首归品</div></div></div>
    <div class="card about"><p>${esc(t.definition || "")}</p></div>
    ${kicker(1, "标志语汇")}
    <div class="card">${(t.marker_terms || []).map(w => `<span class="chip">${esc(w)}</span>`).join("")}</div>
    ${kicker(2, "常见意象")}
    <div class="card">${(t.top_imagery || []).map(i => `<a class="chip" href="#/imagery/${encodeURIComponent(i.imagery)}">${esc(i.imagery)} · ${i.count}</a>`).join("")}</div>
    ${kicker(3, "归品作品", (t.supporting_poems || []).length + " 首")}
    <div id="th-poems"><div class="loading">展 卷 中 …</div></div>`;
  const { byId } = await catalog();
  const hits = (t.supporting_poems || []).map(id => byId.get(id)).filter(Boolean);
  progressiveList(document.getElementById("th-poems"), hits, r => poemRowHTML(r), 60);
});

/* ── 视图：飞花令 ──────────────────────────────────────────── */
const fh = { char: "", used: new Set(), round: 0, candidates: [] };
route(/^\/feihua$/, async () => {
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("飞花令")}</div>
    <div class="fh-stage">
      <div class="fh-char" id="fh-char">花</div>
      <div class="fh-round" id="fh-round">以字为令 · 语料实证</div>
    </div>
    ${searchboxHTML("fh-q", "定一令字（单字），如：花 / 月 / 酒")}
    <div id="fh-log" class="fh-log"></div>
    <div id="fh-input" style="display:none">
      ${searchboxHTML("fh-line", "对一句含令字的古人诗（须语料实有）")}
      <button class="btn seal-btn block" id="fh-send">出 句</button>
      <button class="btn block" id="fh-pass">我认负，请墨一续令</button>
    </div>`;

  const log = document.getElementById("fh-log");
  const say = (who, line, cite) => {
    log.insertAdjacentHTML("beforeend", `
      <div class="fh-msg ${who}"><div class="bubble">${esc(line)}
        ${cite ? `<span class="cite">${cite}</span>` : ""}</div></div>`);
    log.lastElementChild.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  async function appTurn() {
    while (fh.candidates.length) {
      const r = fh.candidates.pop();
      if (fh.used.has(r[0])) continue;
      const p = await poemById(r[0]);
      if (!p) continue;
      const line = p.l.find(ln => fold(ln).includes(fh.char));
      if (!line) continue;
      fh.used.add(r[0]);
      fh.round += 1;
      document.getElementById("fh-round").textContent = `令字「${fh.char}」 · 第${hanNum(fh.round)}巡`;
      say("app", line,
        `《${esc(p.t || "无题")}》 ${esc(p.d)} · ${esc(p.a)} <a href="#/poem/${encodeURIComponent(p.id)}?hl=${encodeURIComponent(line)}" style="color:var(--seal)">回源→</a>`);
      return true;
    }
    say("app", `「${fh.char}」字之句，语料已尽 —— 此令你赢了。换一字再战？`);
    return false;
  }

  async function start(ch) {
    await foldMap();
    fh.char = fold(ch);
    fh.used.clear(); fh.round = 0;
    document.getElementById("fh-char").textContent = ch;
    log.innerHTML = "";
    say("app", `令字「${ch}」。凡出句须为语料实有之古人诗句，且含令字。墨一先行 ——`);
    const { rows } = await catalog();
    fh.candidates = rows.filter(r => r[7].includes(fh.char));
    // 洗牌
    for (let i = fh.candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [fh.candidates[i], fh.candidates[j]] = [fh.candidates[j], fh.candidates[i]];
    }
    if (fh.candidates.length > 400) fh.candidates.length = 400;
    document.getElementById("fh-input").style.display = "block";
    await appTurn();
  }

  document.getElementById("fh-q").addEventListener("change", e => {
    const ch = cjkOnly(e.target.value).slice(0, 1);
    if (ch) start(ch);
  });

  document.getElementById("fh-send").onclick = async () => {
    const inp = document.getElementById("fh-line");
    const raw = inp.value.trim();
    if (!raw || !fh.char) return;
    const folded = fold(cjkOnly(raw));
    say("me", raw);
    inp.value = "";
    if (!folded.includes(fh.char)) { say("app", `句中不见令字「${fh.char}」，此句不算，请再出。`); return; }
    if (folded.length < 4) { say("app", "句子过短（至少四字），请再出。"); return; }
    const { rows } = await catalog();
    const hit = rows.find(r => r[7].includes(folded) && !fh.used.has(r[0]));
    if (!hit) {
      const dup = rows.find(r => r[7].includes(folded));
      say("app", dup ? "此句本局已用过，不可重令，请另出一句。"
        : "遍检两万六千余篇，未见此句 —— 或非语料所收，或字句有出入。请再出。");
      return;
    }
    fh.used.add(hit[0]);
    say("app", `验讫 ——《${hit[1] || "无题"}》 ${hit[3]} · ${hit[2]}，此句实有。墨一应令：`);
    await appTurn();
  };
  document.getElementById("fh-pass").onclick = appTurn;
});

/* ── 视图：阅读器 ──────────────────────────────────────────── */
route(/^\/poem\/([^/]+)$/, async (m, query) => {
  const poem = await poemById(m[1]);
  if (!poem) { $view.innerHTML = `<div class="empty">此篇不在馆藏</div>`; return; }
  await foldMap();
  const hl = fold(cjkOnly(query.hl || ""));
  const meta = [poem.d, poem.a].filter(Boolean).join(" · ");
  const tags = [poem.b, poem.g, poem.c ? "词牌 · " + poem.c : "", poem.sec]
    .filter(Boolean);

  const linesHTML = poem.l.map((ln, i) => {
    const isHl = hl && fold(cjkOnly(ln)).includes(hl);
    const sep = i % 2 === 0 ? "，" : "。";
    return `<span class="ln${isHl ? " hl" : ""}">${esc(ln)}${i === poem.l.length - 1 ? "。" : sep}</span>${i % 2 === 1 ? "<br>" : ""}`;
  }).join("");

  const foldSec = (title, arr) => arr && arr.length ? `
    <details class="fold"><summary>${title}</summary>
      <div class="fold-body">${arr.map(esc).join("\n\n")}</div></details>` : "";

  $view.innerHTML = `
    <div class="reader">
      <div class="reader-top">${backBtn("返回")}
        <div class="r-tools">
          <button id="r-fav" class="${isFav(poem.id) ? "fav-on" : ""}">${isFav(poem.id) ? "已藏" : "藏"}</button>
          <button id="r-vert">竖排</button>
        </div>
      </div>
      <div class="poem-paper" id="paper">
        <div class="p-title">${esc(poem.t || "无题")}</div>
        <div class="p-meta">${esc(meta)}</div>
        <div class="p-tags">${tags.map(t => `<span class="t">${esc(t)}</span>`).join("")}</div>
        <div class="p-lines">${linesHTML}</div>
        <div class="p-seal">${sealHTML(poem.a && poem.a !== "佚名" ? [...cjkOnly(poem.a)].slice(0, 3).join("") : "墨一")}</div>
      </div>
      <div class="card" style="padding:4px 18px">
        ${foldSec("注　释", poem.notes)}
        ${foldSec("赏　析", poem.appr)}
        ${(poem.img && poem.img.length) ? `
          <details class="fold" open><summary>篇中意象</summary>
            <div class="fold-body">${poem.img.map(i =>
              `<a class="tag-link" href="#/imagery/${encodeURIComponent(i)}">${esc(i)}</a>`).join("")}
            </div></details>` : ""}
        ${(poem.emo && poem.emo.length) ? `
          <details class="fold"><summary>情感基调</summary>
            <div class="fold-body">${poem.emo.map(e => `<span class="chip">${esc(e)}</span>`).join("")}</div>
          </details>` : ""}
      </div>
      <div class="card about"><p class="credit">篇目 ${esc(poem.id)} · 出自《${esc(poem.b)}》 · A 层原文直录，未经改动。</p></div>
    </div>`;

  document.getElementById("r-vert").onclick = e => {
    document.getElementById("paper").classList.toggle("vertical");
    e.target.classList.toggle("on");
  };
  document.getElementById("r-fav").onclick = e => {
    const on = toggleFav({ id: poem.id, t: poem.t, a: poem.a, d: poem.d });
    e.target.classList.toggle("fav-on", on);
    e.target.textContent = on ? "已藏" : "藏";
  };
});

/* ── 视图：关于 ────────────────────────────────────────────── */
route(/^\/about$/, async () => {
  const stats = await getJSON("stats.json");
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("墨一", true)}</div>
    <div class="masthead"><div><h1>墨一</h1><div class="sub">一墨藏万象</div></div></div>
    <hr class="rule-double">
    <div class="card about">
      <p>墨一是一座随身的古典诗词档案馆：${stats.poems.toLocaleString()} 首作品、${stats.imagery} 个意象档案、${stats.authors} 位诗人、${stats.cipai} 个词牌，全部数据离线内置。</p>
      <p>馆藏规则由 CNPoetry-Hermes 自主规则挖掘流水线生成，恪守「无原文，不成论断；无篇目，不成证据」：每一条意象—情感联系、每一处例证，均逐字回源到具体诗句，点击即达原诗。</p>
      <p>证据分级 —— A 原文直录 / B 确定性计量 / C 集内旁证 / D 外部分析 / E 模型解释。本 App 只呈现 A、B、C 三层。</p>
      <p class="credit">语料：chinese-poetry（开源社区整理）· 简繁折叠：OpenCC 字表 · 字体：霞鹜文楷（OFL）· 研发：医哲未来人工智能研究院（IMPF-AI）· 遵循 MIT 许可</p>
    </div>`;
});

/* ── 启动 ─────────────────────────────────────────────────── */
/* 路由持久化：进程被系统回收后重新拉起时续读上次页面 */
window.addEventListener("hashchange", () => {
  try { localStorage.setItem("moyi_last_hash", location.hash); } catch { /* 忽略 */ }
});
try {
  const last = localStorage.getItem("moyi_last_hash");
  if ((!location.hash || location.hash === "#/") && last && last !== "#/") {
    location.replace(last);
  }
} catch { /* 忽略 */ }
render();

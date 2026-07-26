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
let _xhrFails = 0;
/* XHR 而非 fetch：file:///android_asset 主路径下 fetch 受 CORS 限制，
   XHR 配合 allowFileAccessFromFileURLs 可读同源资源（file:// 成功时
   status 为 0）。连续失败则通知宿主切换到环回服务器兜底。 */
function xhrJSON(path) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("GET", "data/" + path, true);
    x.onload = () => {
      const ok = (x.status === 200 || x.status === 0) && x.responseText;
      if (!ok) return fail(new Error(path + " → " + x.status));
      try { _xhrFails = 0; resolve(JSON.parse(x.responseText)); }
      catch (e) { fail(e); }
    };
    x.onerror = () => fail(new Error(path + " → 网络层失败"));
    const fail = e => {
      _xhrFails += 1;
      if (_xhrFails >= 2 && location.protocol === "file:" &&
          window.MoYiBridge && window.MoYiBridge.assetsUnreachable) {
        try { window.MoYiBridge.assetsUnreachable(); } catch { /* 忽略 */ }
      }
      reject(e);
    };
    x.send();
  });
}
function getJSON(path) {
  if (!_cache.has(path)) {
    _cache.set(path, xhrJSON(path).catch(e => { _cache.delete(path); throw e; }));
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

/* 目录分两层：轻元数据（常驻）+ 全文折叠索引分片（仅全文检索时载入），
   13 万首的单体目录逾 30 MB，一次性解析会明显卡顿。 */
const N_CTEXT = 16;
let _catalogP = null;
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

/* 全文检索：逐片扫描，每片就绪即回调（可边扫边出结果） */
async function scanFullText(matchFn, onBatch, limit = 3000) {
  const { rows } = await catalog();
  const hits = [];
  for (let s = 0; s < N_CTEXT; s++) {
    const part = await getJSON("ctext/ct_" + String(s).padStart(2, "0") + ".json");
    const batch = [];
    for (const [idx, text] of part) {
      if (matchFn(text, rows[idx])) {
        batch.push(rows[idx]);
        hits.push(rows[idx]);
        if (hits.length >= limit) break;
      }
    }
    if (batch.length && onBatch) onBatch(batch, hits.length, (s + 1) / N_CTEXT);
    if (hits.length >= limit) break;
  }
  return hits;
}
/* 单条全文（用于摘要/撞句核验时定位）——按需取所在分片 */
async function textOf(rowIndex) {
  const part = await getJSON("ctext/ct_" + String(rowIndex % N_CTEXT).padStart(2, "0") + ".json");
  const found = part.find(x => x[0] === rowIndex);
  return found ? found[1] : "";
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
      (t === "salon" && ["salon", "cipai", "theme", "feihua", "about", "starmap", "fav",
        "rhyme", "compose", "prose", "duike", "matrix", "fu", "famous", "allusion",
        "compare", "rhymeflow", "season", "pairflow"].includes(tab)) ||
      (t === "poets" && ["poet", "poets", "fingerprint"].includes(tab)) ||
      (t === "lib" && ["lib", "search", "cross"].includes(tab)) ||
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
      <a class="entry" href="#/lib"><b>文库检索</b><span>集部书架 · 全文逐字 · 高级检索</span><span class="e-glyph">检</span></a>
      <a class="entry" href="#/poets"><b>诗人档案</b><span>小传 · 惯用意象 · 体裁分布</span><span class="e-glyph">人</span></a>
      <a class="entry" href="#/salon"><b>风雅集</b><span>词牌定格 · 题材九品 · 飞花令</span><span class="e-glyph">令</span></a>
    </div>

    ${kicker(3, "证据之约")}
    <div class="card about">
      <p>无原文，不成论断；无篇目，不成证据。本馆一切意象结论、情感联系、词牌定格，皆逐字回源至具体诗句 —— 点开即见原诗。</p>
      <p class="credit">语料：chinese-poetry 开源库 · 规则：CNPoetry-Hermes 自主挖掘流水线 · 医哲未来人工智能研究院（IMPF-AI）</p>
    </div>`;
});

/* ── 视图：意象（档案 50 + 广谱 203，全库标注） ─────────────── */
route(/^\/imagery$/, async () => {
  const [profiles, wide] = await Promise.all([
    getJSON("imagery_profiles.json"), getJSON("imagery_wide.json"),
  ]);
  await foldMap();
  const archived = new Set(profiles.map(p => p.imagery));
  const cats = [...new Set(wide.items.map(i => i.cat))];
  $view.innerHTML = `
    <div class="masthead">
      <div><h1>意象</h1><div class="sub">${wide.items.length} 意象 · 覆盖 ${(wide.n_covered / wide.n_total * 100).toFixed(1)}% 作品</div></div>
      ${sealHTML("意象")}
    </div>
    <hr class="rule-double">
    ${searchboxHTML("img-q", "寻一意象，如：月 / 芭蕉 / 铁衣")}
    <div class="seg" id="img-seg">
      <button data-t="arch" class="on">档案 ${profiles.length}</button>
      <button data-t="all">全部 ${wide.items.length}</button>
    </div>
    <div id="img-cat" class="filter-row" style="display:none"></div>
    <div class="img-grid" id="img-grid"></div>
    <div class="card about" id="img-note"></div>`;

  const grid = document.getElementById("img-grid");
  const note = document.getElementById("img-note");
  const catRow = document.getElementById("img-cat");
  let tab = "arch", cat = "", q = "";

  const cellArch = p => {
    const emo = (p.emotion_associations || [])[0];
    return `<a class="img-cell" href="#/imagery/${encodeURIComponent(p.imagery)}">
        ${emo ? `<span class="e">${esc(emo.emotion.slice(0, 2))}</span>` : ""}
        <span class="g">${esc(p.imagery)}</span>
        <span class="n">${p.n_poems} 首</span></a>`;
  };
  const cellWide = it => `<a class="img-cell${it.archive ? "" : " wide-cell"}"
      href="${it.archive ? "#/imagery/" + encodeURIComponent(it.name)
        : "#/cross?img=" + encodeURIComponent(it.name) + "&wide=1"}">
      ${it.archive ? `<span class="e">档</span>` : ""}
      <span class="g" style="font-size:${[...it.name].length > 2 ? "1.5rem" : "2.5rem"}">${esc(it.name)}</span>
      <span class="n">${it.n.toLocaleString()} 首</span></a>`;

  const draw = () => {
    const fq = fold(q);
    if (tab === "arch") {
      catRow.style.display = "none";
      const list = profiles.filter(p => !fq || fold(p.imagery).includes(fq) ||
        (p.surface_forms || []).some(s => fold(s).includes(fq)));
      grid.innerHTML = list.map(cellArch).join("") ||
        `<div class="empty" style="grid-column:1/-1">档案中未收此意象，试「全部」</div>`;
      note.innerHTML = `<p class="credit">档案意象经规则挖掘与逐字回源审核，附情感光谱、
        共现网络与全量例证；点入即见完整档案。</p>`;
    } else {
      catRow.style.display = "flex";
      catRow.innerHTML = `<button class="chip ${cat ? "" : "on"}" data-c="">全部门类</button>` +
        cats.map(c => `<button class="chip ${c === cat ? "on" : ""}" data-c="${esc(c)}">${esc(c)}</button>`).join("");
      catRow.querySelectorAll("button").forEach(b => b.onclick = () => { cat = b.dataset.c; draw(); });
      const list = wide.items.filter(it =>
        (!cat || it.cat === cat) &&
        (!fq || fold(it.name).includes(fq) || (it.surfaces || []).some(s => fold(s).includes(fq))));
      grid.innerHTML = list.map(cellWide).join("") ||
        `<div class="empty" style="grid-column:1/-1">未收此意象</div>`;
      note.innerHTML = `<p class="credit">${esc(wide.note)}
        全库 ${wide.n_total.toLocaleString()} 首中 ${wide.n_covered.toLocaleString()} 首得标注
        （${(wide.n_covered / wide.n_total * 100).toFixed(1)}%）；标「档」者另有完整档案。</p>`;
    }
  };
  document.querySelectorAll("#img-seg button").forEach(b => b.onclick = () => {
    tab = b.dataset.t;
    document.querySelectorAll("#img-seg button").forEach(x => x.classList.toggle("on", x === b));
    draw();
  });
  document.getElementById("img-q").oninput = e => { q = e.target.value.trim(); draw(); };
  draw();
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
              <span class="sup">${e.support} 处支撑</span>
              <a class="go" style="margin-left:auto;font-size:.76rem;color:var(--seal)"
                 href="#/cross?emo=${encodeURIComponent(e.emotion)}&img=${encodeURIComponent(name)}">交叉 →</a></div>
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

/* ── 视图：文库（分层书架 + 专业检索） ─────────────────────── */
const SEARCH_HIST_KEY = "moyi_search_hist";
const searchHist = () => { try { return JSON.parse(localStorage.getItem(SEARCH_HIST_KEY) || "[]"); } catch { return []; } };
function pushHist(q) {
  if (!q) return;
  const h = searchHist().filter(x => x !== q);
  h.unshift(q);
  try { localStorage.setItem(SEARCH_HIST_KEY, JSON.stringify(h.slice(0, 12))); } catch { /* 忽略 */ }
}

route(/^\/lib$/, async (_m, query) => {
  const [stats, shelves] = await Promise.all([getJSON("stats.json"), getJSON("shelves.json")]);
  $view.innerHTML = `
    <div class="masthead">
      <div><h1>文库</h1><div class="sub">${stats.poems.toLocaleString()} 首 · 逐字可检</div></div>
      ${sealHTML("文库")}
    </div>
    <hr class="rule-double">
    ${searchboxHTML("lib-q", "检索全文 / 题目 / 作者 …")}
    <div class="compose-grid" style="grid-template-columns:1fr auto;align-items:center;margin-bottom:10px">
      <div id="lib-mode" class="seg" style="display:none;margin:0">
        <button data-m="text" class="on">全文</button>
        <button data-m="t">题目</button>
        <button data-m="a">作者</button>
      </div>
      <a class="btn" href="#/search" style="white-space:nowrap">高级检索 →</a>
    </div>
    <div id="lib-body"></div>`;

  const body = document.getElementById("lib-body");
  const modeSeg = document.getElementById("lib-mode");
  const input = document.getElementById("lib-q");
  let mode = "text";

  const drawShelves = () => {
    modeSeg.style.display = "none";
    const hist = searchHist();
    body.innerHTML = `
      ${hist.length ? `${kicker(1, "近期检索")}
        <div class="card">${hist.map(q =>
          `<button class="chip hist-q">${esc(q)}</button>`).join("")}</div>` : ""}
      ${kicker(hist.length ? 2 : 1, "集部书架", shelves.length + " 朝 · " +
        shelves.reduce((s, e) => s + e.books.length, 0) + " 集")}
      ${shelves.map(era => `
        <div class="era-block${era.transitional ? " era-trans" : ""}">
          <div class="era-head"><b>${esc(era.era)}</b>
            ${era.transitional ? `<em class="era-tag">跨代</em>` : ""}
            <span>${era.n.toLocaleString()} 首</span></div>
          ${era.books.map(b => `
            <a class="shelf-row" href="#/lib/book/${encodeURIComponent(b.book)}?era=${encodeURIComponent(era.era)}">
              <span class="sb-name">${esc(b.book)}</span>
              <span class="sb-meta">${b.genres.map(([g, n]) => esc(g) + " " + n).join(" · ")}</span>
              <span class="sb-n">${b.n.toLocaleString()} 首 →</span>
            </a>`).join("")}
        </div>`).join("")}
      <div class="card about"><p class="credit">朝代按时序排列；「跨代」为作者活动横跨两朝之标签
      （如元末明初），与主朝代并列而不重复计数 —— 同一集部在不同朝代下各按其朝代作品计。</p></div>`;
    body.querySelectorAll(".hist-q").forEach(b => b.onclick = () => {
      input.value = b.textContent; search(b.textContent);
    });
  };

  let tok = 0;
  async function search(q) {
    modeSeg.style.display = "flex";
    const my = ++tok;
    body.innerHTML = `<div class="loading">逐 字 检 索 中 …</div>`;
    const { rows } = await catalog();
    if (my !== tok) return;
    const fq = fold(cjkOnly(q));
    if (!fq) { body.innerHTML = `<div class="empty">请以汉字检索</div>`; return; }
    pushHist(q);
    let hits;
    if (mode === "text") {
      const texts = new Map();
      hits = await scanFullText((text, row) => {
        const ok = text.includes(fq);
        if (ok) texts.set(row[0], text);
        return ok;
      }, (_b, n, prog) => {
        if (my !== tok) return;
        body.innerHTML = `<div class="loading">已 检 得 ${n} 首 · ${Math.round(prog * 100)}%</div>`;
      });
      if (my !== tok) return;
      body.innerHTML = `${kicker(1, "检得", hits.length + (hits.length >= 3000 ? "+" : "") + " 首")}<div id="sr"></div>`;
      progressiveList(document.getElementById("sr"), hits,
        r => poemRowHTML(r, snippetOf(texts.get(r[0]) || "", fq)), 60);
      return;
    }
    hits = [];
    for (const r of rows) {
      if (mode === "t" ? fold(r[1]).includes(fq) : fold(r[2]).includes(fq)) hits.push(r);
      if (hits.length >= 3000) break;
    }
    if (my !== tok) return;
    body.innerHTML = `${kicker(1, "检得", hits.length + (hits.length >= 3000 ? "+" : "") + " 首")}
      <div id="sr"></div>`;
    progressiveList(document.getElementById("sr"), hits, r => poemRowHTML(r), 60);
  }

  modeSeg.querySelectorAll("button").forEach(b => b.onclick = () => {
    modeSeg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    mode = b.dataset.m;
    if (input.value.trim()) search(input.value.trim());
  });
  let timer = null;
  input.oninput = () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { drawShelves(); return; }
    timer = setTimeout(() => search(q), 260);
  };

  if (query.book) { location.replace("#/lib/book/" + encodeURIComponent(query.book)); return; }
  drawShelves();
});

/* 命中摘要：折叠索引里定位命中，回切近旁 20 字 */
function snippetOf(text, fq) {
  if (!text) return "";
  const i = text.indexOf(fq);
  if (i < 0) return "";
  const from = Math.max(0, i - 8), to = Math.min(text.length, i + fq.length + 12);
  const seg = text.slice(from, to);
  const k = seg.indexOf(fq);
  return `${from > 0 ? "…" : ""}${esc(seg.slice(0, k))}<span style="color:var(--seal)">${esc(fq)}</span>${esc(seg.slice(k + fq.length))}${to < text.length ? "…" : ""}`;
}

/* ── 视图：集部（子目筛选 / 体裁 / 作者）─────────────────────── */
route(/^\/lib\/book\/([^/]+)$/, async (m, query) => {
  const book = m[1], eraLimit = query.era || "";
  $view.innerHTML = `
    <div class="reader-top">${backBtn("文库", "#/lib")}${sealHTML(book)}</div>
    <div id="bk-body"><div class="loading">展 卷 中 …</div></div>`;
  const { rows } = await catalog();
  const all = rows.filter(r => r[4] === book && (!eraLimit || r[3] === eraLimit));
  if (!all.length) { document.getElementById("bk-body").innerHTML = `<div class="empty">此集空无一卷</div>`; return; }

  const isYuanqu = book === "元曲";
  const subOf = r => isYuanqu ? (r[1].includes("・") ? r[1].split("・")[0] : "") : r[2];
  const subCount = new Map();
  for (const r of all) {
    const s = subOf(r);
    if (s) subCount.set(s, (subCount.get(s) || 0) + 1);
  }
  const subs = [...subCount.entries()].sort((a, b) => b[1] - a[1]);
  const genres = [...all.reduce((mp, r) => mp.set(r[5], (mp.get(r[5]) || 0) + 1), new Map())]
    .sort((a, b) => b[1] - a[1]);

  let curSub = "", curGenre = "";
  const body = document.getElementById("bk-body");
  body.innerHTML = `
    <div class="masthead"><div><h1 style="font-size:1.7rem;letter-spacing:.2em">${esc(book)}</h1>
      <div class="sub">${eraLimit ? esc(eraLimit) + " · " : ""}${all.length.toLocaleString()} 首 · ${subs.length} ${isYuanqu ? "剧目/散套" : "作者"}</div></div>
      ${eraLimit ? `<a class="btn" href="#/lib/book/${encodeURIComponent(book)}" style="align-self:center">全朝代 →</a>` : ""}
    </div>
    <hr class="rule-double">
    ${genres.length > 1 ? `<div class="filter-row" id="g-row">
      <button class="chip on" data-g="">全部体裁</button>
      ${genres.map(([g, n]) => `<button class="chip" data-g="${esc(g)}">${esc(g)} ${n}</button>`).join("")}
    </div>` : ""}
    ${subs.length > 1 ? `
      ${searchboxHTML("sub-q", isYuanqu ? "寻剧目 / 散套…" : "寻作者…")}
      <div class="filter-row" id="s-row"></div>` : ""}
    <div id="bk-list"></div>`;

  const listEl = document.getElementById("bk-list");
  const drawSubs = q => {
    const el = document.getElementById("s-row");
    if (!el) return;
    const fq = fold(q || "");
    const shown = subs.filter(([s]) => !fq || fold(s).includes(fq)).slice(0, 60);
    el.innerHTML = `<button class="chip ${curSub ? "" : "on"}" data-s="">全部</button>` +
      shown.map(([s, n]) => `<button class="chip ${s === curSub ? "on" : ""}" data-s="${esc(s)}">${esc(s)} ${n}</button>`).join("");
    el.querySelectorAll("button").forEach(b => b.onclick = () => {
      curSub = b.dataset.s; drawSubs(document.getElementById("sub-q")?.value.trim() || ""); drawList();
    });
  };
  const drawList = () => {
    const hits = all.filter(r => (!curSub || subOf(r) === curSub) && (!curGenre || r[5] === curGenre));
    progressiveList(listEl, hits, r => poemRowHTML(r), 60);
  };
  document.querySelectorAll("#g-row button").forEach(b => b.onclick = () => {
    curGenre = b.dataset.g;
    document.querySelectorAll("#g-row button").forEach(x => x.classList.toggle("on", x === b));
    drawList();
  });
  const subQ = document.getElementById("sub-q");
  if (subQ) subQ.oninput = e => drawSubs(e.target.value.trim());
  drawSubs("");
  drawList();
});

/* ── 视图：高级检索（多条件组合 · 专业口径）───────────────── */
route(/^\/search$/, async () => {
  const [stats, shelves, profiles, themes] = await Promise.all([
    getJSON("stats.json"), getJSON("shelves.json"),
    getJSON("imagery_profiles.json"), getJSON("themes.json"),
  ]);
  await foldMap();
  const eras = shelves.map(s => s.era);
  const books = shelves.flatMap(s => s.books.map(b => b.book));
  const genres = [...new Set(shelves.flatMap(s => s.books.flatMap(b => b.genres.map(g => g[0]))))];

  $view.innerHTML = `
    <div class="reader-top">${backBtn("文库", "#/lib")}${sealHTML("高级检索")}</div>
    <div class="card">
      <div class="sf-row"><label>关键词</label>
        <input id="sf-q" type="search" placeholder="逐字检索（简繁通检）" autocomplete="off"></div>
      <div class="sf-row"><label>检索域</label>
        <div class="seg" id="sf-field" style="margin:0">
          <button data-f="text" class="on">全文</button>
          <button data-f="t">题目</button>
          <button data-f="a">作者</button>
        </div></div>
      <div class="sf-row"><label>句　位</label>
        <div class="seg" id="sf-pos" style="margin:0">
          <button data-p="any" class="on">任意</button>
          <button data-p="head">句首</button>
          <button data-p="foot">句脚</button>
        </div></div>
      <div class="sf-row"><label>排除字</label>
        <input id="sf-not" type="search" placeholder="含此字者不取（可空）" autocomplete="off"></div>
    </div>

    <details class="fold card" style="padding:4px 18px" open>
      <summary>朝代 · 集部 · 体裁</summary>
      <div class="fold-body" style="white-space:normal">
        <div class="sf-label">朝代</div>
        <div class="filter-row" id="sf-era">${eras.map(e => `<button class="chip" data-v="${esc(e)}">${esc(e)}</button>`).join("")}</div>
        <div class="sf-label">集部</div>
        <div class="filter-row" id="sf-book">${books.map(b => `<button class="chip" data-v="${esc(b)}">${esc(b)}</button>`).join("")}</div>
        <div class="sf-label">体裁</div>
        <div class="filter-row" id="sf-genre">${genres.map(g => `<button class="chip" data-v="${esc(g)}">${esc(g)}</button>`).join("")}</div>
      </div>
    </details>

    <details class="fold card" style="padding:4px 18px">
      <summary>意象 · 题材 · 篇幅</summary>
      <div class="fold-body" style="white-space:normal">
        <div class="sf-label">意象（篇中含）</div>
        <div class="filter-row" id="sf-img">${profiles.slice(0, 30).map(p =>
          `<button class="chip" data-v="${esc(p.imagery)}">${esc(p.imagery)}</button>`).join("")}</div>
        <div class="sf-label">题材</div>
        <div class="filter-row" id="sf-theme">${themes.map(t =>
          `<button class="chip" data-v="${esc(t.theme)}">${esc(t.theme)}</button>`).join("")}</div>
        <div class="sf-label">句数</div>
        <div class="sf-inline">
          <input id="sf-lmin" type="number" min="1" max="200" placeholder="最少"> —
          <input id="sf-lmax" type="number" min="1" max="200" placeholder="最多"> 句
        </div>
        <div class="sf-label">每句字数</div>
        <div class="filter-row" id="sf-cn">${[4, 5, 6, 7].map(n =>
          `<button class="chip" data-v="${n}">${n} 言齐言</button>`).join("")}</div>
      </div>
    </details>

    <button class="btn seal-btn block" id="sf-go">检　索</button>
    <button class="btn block" id="sf-clear">清空条件</button>
    <div id="sf-out" style="margin-top:12px"></div>`;

  const multi = {};
  ["era", "book", "genre", "img", "theme", "cn"].forEach(k => {
    multi[k] = new Set();
    document.querySelectorAll(`#sf-${k} button`).forEach(b => b.onclick = () => {
      const v = b.dataset.v;
      if (multi[k].has(v)) multi[k].delete(v); else multi[k].add(v);
      b.classList.toggle("on");
    });
  });
  let field = "text", posMode = "any";
  document.querySelectorAll("#sf-field button").forEach(b => b.onclick = () => {
    field = b.dataset.f;
    document.querySelectorAll("#sf-field button").forEach(x => x.classList.toggle("on", x === b));
  });
  document.querySelectorAll("#sf-pos button").forEach(b => b.onclick = () => {
    posMode = b.dataset.p;
    document.querySelectorAll("#sf-pos button").forEach(x => x.classList.toggle("on", x === b));
  });
  document.getElementById("sf-clear").onclick = () => location.reload();

  document.getElementById("sf-go").onclick = async () => {
    const out = document.getElementById("sf-out");
    out.innerHTML = `<div class="loading">逐 字 检 索 中 …</div>`;
    const q = fold(cjkOnly(document.getElementById("sf-q").value));
    const notQ = fold(cjkOnly(document.getElementById("sf-not").value));
    const lmin = Number(document.getElementById("sf-lmin").value) || 0;
    const lmax = Number(document.getElementById("sf-lmax").value) || 0;
    const cns = new Set([...multi.cn].map(Number));
    const needPoem = posMode !== "any" || lmin || lmax || cns.size ||
      multi.img.size || multi.theme.size;

    const { rows } = await catalog();
    const metaOk = r =>
      (!multi.era.size || multi.era.has(r[3])) &&
      (!multi.book.size || multi.book.has(r[4])) &&
      (!multi.genre.size || multi.genre.has(r[5]));
    const snippets = new Map();
    let cands;
    if ((q && field === "text") || notQ) {
      /* 需要全文的条件：逐片扫描全文索引 */
      cands = await scanFullText((text, row) => {
        if (!metaOk(row)) return false;
        if (notQ && text.includes(notQ)) return false;
        if (q && field === "text") {
          if (!text.includes(q)) return false;
          snippets.set(row[0], text);
        }
        return true;
      }, (_b, n, prog) => {
        out.innerHTML = `<div class="loading">已 检 得 ${n} 首 · ${Math.round(prog * 100)}%</div>`;
      }, 6000);
      if (q && field !== "text") {
        cands = cands.filter(r => field === "t" ? fold(r[1]).includes(q) : fold(r[2]).includes(q));
      }
    } else {
      cands = rows.filter(r => metaOk(r) &&
        (!q || (field === "t" ? fold(r[1]).includes(q) : fold(r[2]).includes(q))));
      if (cands.length > 6000) cands = cands.slice(0, 6000);
    }

    let hits = cands;
    if (needPoem) {
      /* 需要篇内结构的条件：按需取分片（受候选量限制，成本可控） */
      const byShard = new Map();
      for (const r of cands) {
        const s = shardOf(r[0]);
        if (!byShard.has(s)) byShard.set(s, []);
        byShard.get(s).push(r);
      }
      const keep = new Set();
      for (const [s, group] of byShard) {
        const shard = await getJSON("poems/shard_" + String(s).padStart(2, "0") + ".json");
        const idx = new Map(shard.map(p => [p.id, p]));
        for (const r of group) {
          const p = idx.get(r[0]);
          if (!p) continue;
          const lines = p.l || [];
          if (lmin && lines.length < lmin) continue;
          if (lmax && lines.length > lmax) continue;
          if (cns.size) {
            const lens = new Set(lines.map(l => cjkOnly(l).length));
            if (lens.size !== 1 || !cns.has([...lens][0])) continue;
          }
          if (multi.img.size && !(p.img || []).some(i => multi.img.has(i))) continue;
          if (multi.theme.size && !(p.thm || []).some(t => multi.theme.has(t))) continue;
          if (q && field === "text" && posMode !== "any") {
            const ok = lines.some(l => {
              const fl = fold(cjkOnly(l));
              return posMode === "head" ? fl.startsWith(q) : fl.endsWith(q);
            });
            if (!ok) continue;
          }
          keep.add(r[0]);
        }
      }
      hits = cands.filter(r => keep.has(r[0]));
    }

    const byEra = {}, byBook = {};
    for (const r of hits) {
      byEra[r[3]] = (byEra[r[3]] || 0) + 1;
      byBook[r[4]] = (byBook[r[4]] || 0) + 1;
    }
    out.innerHTML = `
      ${kicker(1, "检得", hits.length.toLocaleString() + " 首")}
      ${hits.length ? `<div class="card">
        <div class="sf-stat">${Object.entries(byEra).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
          `<span class="chip">${esc(k)} ${v}</span>`).join("")}</div>
        <div class="sf-stat">${Object.entries(byBook).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) =>
          `<span class="chip seal-chip">${esc(k)} ${v}</span>`).join("")}</div>
      </div>` : ""}
      <div id="sf-list"></div>`;
    progressiveList(document.getElementById("sf-list"), hits,
      r => poemRowHTML(r, q && field === "text" ? snippetOf(snippets.get(r[0]) || "", q) : ""), 60);
    if (q) pushHist(q);
  };
});

/* ── 视图：文苑（古文观止 · 含辞赋名篇）───────────────────── */
route(/^\/prose$/, async () => {
  const prose = await getJSON("prose.json");
  await foldMap();
  const eras = [...new Set(prose.map(p => p.era))];
  const genres = [...new Set(prose.map(p => p.g))];
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("文苑")}</div>
    <div class="masthead"><div><h1>文苑</h1><div class="sub">古文观止 · ${prose.length} 篇</div></div></div>
    <hr class="rule-double">
    ${searchboxHTML("pr-q", "寻一篇，如：赤壁赋 / 岳阳楼 / 苏轼")}
    <div class="filter-row" id="pr-era">
      <button class="chip on" data-v="">全部</button>
      ${eras.map(e => `<button class="chip" data-v="${esc(e)}">${esc(e)}</button>`).join("")}
    </div>
    <div class="filter-row" id="pr-genre">
      ${genres.map(g => `<button class="chip" data-v="${esc(g)}">${esc(g)}${g === "赋" ? " ✦" : ""}</button>`).join("")}
    </div>
    <div id="pr-list"></div>`;
  let era = "", gset = new Set(), q = "";
  const listEl = document.getElementById("pr-list");
  const row = p => `<a class="poem-row" href="#/prose/${encodeURIComponent(p.id)}">
      <span class="pr-t">${esc(p.t)}</span>
      <span class="pr-a">${esc(p.a)}</span>
      <span class="pr-d">${esc(p.g)}</span></a>`;
  const draw = () => {
    const fq = fold(q);
    progressiveList(listEl, prose.filter(p =>
      (!era || p.era === era) && (!gset.size || gset.has(p.g)) &&
      (!fq || fold(p.t).includes(fq) || fold(p.a).includes(fq))), row, 60);
  };
  document.querySelectorAll("#pr-era button").forEach(b => b.onclick = () => {
    era = b.dataset.v;
    document.querySelectorAll("#pr-era button").forEach(x => x.classList.toggle("on", x === b));
    draw();
  });
  document.querySelectorAll("#pr-genre button").forEach(b => b.onclick = () => {
    const v = b.dataset.v;
    if (gset.has(v)) gset.delete(v); else gset.add(v);
    b.classList.toggle("on");
    draw();
  });
  document.getElementById("pr-q").oninput = e => { q = e.target.value.trim(); draw(); };
  draw();
});

route(/^\/prose\/([^/]+)$/, async m => {
  const prose = await getJSON("prose.json");
  const p = prose.find(x => x.id === m[1]);
  if (!p) { $view.innerHTML = `<div class="empty">文苑未收此篇</div>`; return; }
  $view.innerHTML = `
    <div class="reader">
      <div class="reader-top">${backBtn("文苑", "#/prose")}
        <div class="r-tools"><button id="pr-vert">竖排</button></div></div>
      <div class="poem-paper" id="paper">
        <div class="p-title">${esc(p.t)}</div>
        <div class="p-meta">${esc([p.d, p.a].filter(Boolean).join(" · "))}</div>
        <div class="p-tags">
          <span class="t">${esc(p.juan)}</span>
          <span class="t">${esc(p.g)}</span>
          ${p.src ? `<span class="t">${esc(p.src)}</span>` : ""}
        </div>
        <div class="p-scroll"><div class="p-lines prose-body" id="p-lines">${p.p.map(x => `<p>${esc(x)}</p>`).join("")}</div></div>
        <div class="p-seal">${sealHTML(p.a ? [...cjkOnly(p.a)].slice(0, 3).join("") : "文苑")}</div>
      </div>
      <div class="card about"><p class="credit">《古文观止》${esc(p.juan)} · 原文直录（A 层）。散文不入格律计量层。</p></div>
    </div>`;
  document.getElementById("pr-vert").onclick = e => {
    document.getElementById("paper").classList.toggle("vertical");
    e.target.classList.toggle("on");
    const sc = document.querySelector(".p-scroll");
    if (document.getElementById("paper").classList.contains("vertical")) sc.scrollLeft = sc.scrollWidth;
  };
});

/* ── 视图：诗人风格指纹（多维计量 · 可两位对读）───────────── */
const FP_KEY = "moyi_fp_pick";
const getFpPick = () => { try { return JSON.parse(localStorage.getItem(FP_KEY) || "[]"); } catch { return []; } };
function toggleFpPick(name) {
  let arr = getFpPick().filter(x => x !== name);
  if (arr.length === getFpPick().length) arr.unshift(name);
  arr = arr.slice(0, 2);
  try { localStorage.setItem(FP_KEY, JSON.stringify(arr)); } catch { /* 忽略 */ }
  return arr;
}

route(/^\/fingerprint$/, async () => {
  const fps = await getJSON("fingerprints.json");
  await foldMap();
  const picked = getFpPick();
  $view.innerHTML = `
    <div class="reader-top">${backBtn("诗人档案", "#/poets")}${sealHTML("风格指纹")}</div>
    <div class="masthead"><div><h1>指纹</h1><div class="sub">${fps.length} 位 · 存诗二十首以上</div></div></div>
    <hr class="rule-double">
    <div class="card about"><p class="credit">风格指纹为多维计量：惯用意象（全库标注）、体裁偏好、
    用韵倾向（韵脚归平水韵部）、平均篇幅。皆为 B 层确定性统计，不作高下评断。</p></div>
    ${picked.length ? `<div class="filter-row" id="fp-picked"></div>` : ""}
    ${searchboxHTML("fp-q", "寻一诗人，如：李白 / 苏轼 / 纳兰")}
    <div id="fp-list"></div>`;
  const drawPicked = () => {
    const el = document.getElementById("fp-picked");
    if (!el) return;
    const cur = getFpPick();
    el.innerHTML = cur.map(n => `<button class="chip on" data-n="${esc(n)}">${esc(n)} ✕</button>`).join("") +
      (cur.length === 2 ? `<a class="chip seal-chip" href="#/fingerprint/${encodeURIComponent(cur[0])}/${encodeURIComponent(cur[1])}">对读二家 →</a>` : "");
    el.querySelectorAll("[data-n]").forEach(b => b.onclick = () => { toggleFpPick(b.dataset.n); render(); });
  };
  const listEl = document.getElementById("fp-list");
  const row = f => {
    const on = getFpPick().includes(f.author);
    return `<div class="person-row">
      <a class="avatar" href="#/fingerprint/${encodeURIComponent(f.author)}">${esc([...f.author][0])}</a>
      <a class="who" href="#/fingerprint/${encodeURIComponent(f.author)}"><b>${esc(f.author)}</b>
        <span>${esc(f.dynasty)} · 常咏 ${(f.img || []).slice(0, 4).map(x => x[0]).join(" ")}${
          f.dev != null ? ` · 韵偏 ${f.dev.toFixed(2)}` : ""}</span></a>
      <button class="chip ${on ? "on" : ""} fp-pick" data-n="${esc(f.author)}">${on ? "已择" : "择"}</button>
      <span class="cnt">${f.n}</span></div>`;
  };
  const draw = q => {
    const fq = fold(q);
    progressiveList(listEl, fps.filter(f => !fq || fold(f.author).includes(fq)), row, 50);
    listEl.querySelectorAll(".fp-pick").forEach(b => b.onclick = () => {
      toggleFpPick(b.dataset.n); render();
    });
  };
  drawPicked();
  draw("");
  document.getElementById("fp-q").oninput = e => draw(e.target.value.trim());
});

const fpBars = (items, max, hrefFn) => items.map(([k, v]) => `
  <div class="fp-bar"><span class="fp-k">${hrefFn ? `<a href="${hrefFn(k)}">${esc(k)}</a>` : esc(k)}</span>
    <i style="width:${Math.round(v / max * 100)}%"></i><b>${v}</b></div>`).join("");

route(/^\/fingerprint\/([^/]+)$/, async m => {
  const fps = await getJSON("fingerprints.json");
  const f = fps.find(x => x.author === m[1]);
  if (!f) { $view.innerHTML = `<div class="empty">此家存诗未足二十首，暂未立指纹</div>`; return; }
  const maxI = Math.max(...f.img.map(x => x[1]), 1);
  const maxG = Math.max(...f.genre.map(x => x[1]), 1);
  const maxY = Math.max(...f.yun.map(x => x[1]), 1);
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风格指纹", "#/fingerprint")}${sealHTML(f.author)}</div>
    <div class="img-hero"><span class="big" style="font-size:2.6rem">${esc(f.author)}</span>
      <div class="facts"><div class="nums">${esc(f.dynasty)} · 计 ${f.n} 首 · 平均 ${f.avg_lines} 句</div>
        <div class="forms">${(f.books || []).map(b => `<span class="form-tag">${esc(b)}</span>`).join("")}</div></div></div>
    <div class="filter-row">
      <a class="chip" href="#/poet/${encodeURIComponent(f.author)}">诗人档案 →</a>
      <button class="chip fp-pick2">择入对读</button>
    </div>
    <div class="card" style="text-align:center">
      ${radarSVG([{ f, color: "var(--seal)" }], radarPercentiles(fps))}
      <div class="legend" style="text-align:left">六维按全体 ${fps.length} 家分位归一：
      篇幅／象密（每首意象数）／象广（用象种数）／近体（律绝占比）／自然·人事（二类意象占比）。</div>
    </div>
    ${kicker(1, "惯用意象", "全库标注计量")}
    <div class="card">${fpBars(f.img, maxI, k => "#/cross?img=" + encodeURIComponent(k))}</div>
    ${kicker(2, "体裁偏好")}
    <div class="card">${fpBars(f.genre, maxG)}</div>
    ${kicker(3, "用韵倾向", "韵脚归平水韵部")}
    <div class="card">${f.yun.length ? fpBars(f.yun, maxY) : `<div class="empty">此家作品未标韵脚</div>`}</div>
    ${f.dev !== null && f.dev !== undefined ? `
      ${kicker(4, "用韵之偏", "较同代同体")}
      <div class="card">
        <div class="dev-gauge">
          <div class="dev-track"><i style="left:${Math.min(97, f.dev * 100).toFixed(1)}%"></i></div>
          <div class="dev-scale"><span>从众</span><span>独异</span></div>
        </div>
        <div class="cmp-row"><b>偏离度</b><span>${f.dev.toFixed(3)}　较「${esc(f.grp)}」${f.grp_n} 家之平均用韵（余弦距离，0 全同 ~ 1 全异）</span></div>
        ${(f.yun_pref || []).length ? `<div class="cmp-row"><b>相对偏爱</b><span>${
          f.yun_pref.map(([k, v]) => {
            const tier = v >= 10 ? "远多于侪辈" : v >= 3 ? "多于侪辈" : v >= 1.5 ? "略多" : "相当";
            return `<span class="chip" title="平滑后比率 ${v}×">${esc(k)}韵 · ${tier}</span>`;
          }).join("")}</span></div>` : ""}
        <div class="cmp-row"><b>韵脚样本</b><span>${f.n_feet} 处</span></div>
        <div class="legend" style="margin-top:8px">「相对偏爱」为此家用某韵之比率与同代同体平均之比（已作加性平滑）。
        冷僻韵在侪辈中基数近零时，比率虽巨而只示方向、不示精度，故此处分档而不列数字。
        分组按「朝代 × 体裁大类」——词多仄韵、诗多平韵，若混作一谈，所量者是体裁之别而非个人风格。</div>
      </div>` : ""}
    <div class="card about"><p class="credit">意象取全库表面标注，体裁与韵部取自计量层；
    统计仅及本馆所收之作，非其全集实况。${f.dev === null ? "此家韵脚样本未足二十处，或同组不足三家，故不判偏离度 —— 样本小则分布不稳，强判即成噪声。" : ""}</p></div>`;
  document.querySelector(".fp-pick2").onclick = () => {
    const arr = toggleFpPick(f.author);
    location.hash = arr.length === 2
      ? `#/fingerprint/${encodeURIComponent(arr[0])}/${encodeURIComponent(arr[1])}`
      : "#/fingerprint";
  };
});

/* 雷达图：六维按全体分位归一（绝对值量纲各异，分位方见其相对位置） */
const RADAR_DIMS = [
  { k: "avg_lines", label: "篇幅" },
  { k: "r_density", label: "象密" },
  { k: "r_variety", label: "象广" },
  { k: "r_jinti", label: "近体" },
  { k: "r_nature", label: "自然" },
  { k: "r_human", label: "人事" },
];
function radarPercentiles(fps) {
  const sorted = {};
  for (const d of RADAR_DIMS) {
    sorted[d.k] = fps.map(f => f[d.k] ?? 0).sort((x, y) => x - y);
  }
  return (k, v) => {
    const arr = sorted[k];
    if (!arr || !arr.length) return 0;
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
    return lo / arr.length;
  };
}
function radarSVG(series, pct, size = 260) {
  const cx = size / 2, cy = size / 2 + 6, R = size * 0.34;
  const n = RADAR_DIMS.length;
  const pt = (i, r) => {
    const ang = -Math.PI / 2 + i * 2 * Math.PI / n;
    return [cx + Math.cos(ang) * R * r, cy + Math.sin(ang) * R * r];
  };
  const rings = [0.25, 0.5, 0.75, 1].map(r =>
    `<polygon points="${RADAR_DIMS.map((_, i) => pt(i, r).map(v => v.toFixed(1)).join(",")).join(" ")}"
      fill="none" stroke="var(--hairline)" stroke-width="1"/>`).join("");
  const spokes = RADAR_DIMS.map((_, i) =>
    `<line x1="${cx}" y1="${cy}" x2="${pt(i, 1)[0].toFixed(1)}" y2="${pt(i, 1)[1].toFixed(1)}"
      stroke="var(--hairline)" stroke-width="1"/>`).join("");
  const labels = RADAR_DIMS.map((d, i) => {
    const [x, y] = pt(i, 1.24);
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle"
      font-size="11" fill="var(--ink-2)">${esc(d.label)}</text>`;
  }).join("");
  const shapes = series.map(s => {
    const pts = RADAR_DIMS.map((d, i) => pt(i, Math.max(0.04, pct(d.k, s.f[d.k] ?? 0))))
      .map(v => v.map(x => x.toFixed(1)).join(",")).join(" ");
    return `<polygon points="${pts}" fill="${s.color}" fill-opacity="0.16"
      stroke="${s.color}" stroke-width="1.8" stroke-linejoin="round"/>`;
  }).join("");
  return `<svg viewBox="0 0 ${size} ${size + 14}" class="radar">
    ${rings}${spokes}${shapes}${labels}</svg>`;
}

route(/^\/fingerprint\/([^/]+)\/([^/]+)$/, async m => {
  const fps = await getJSON("fingerprints.json");
  const a = fps.find(x => x.author === m[1]), b = fps.find(x => x.author === m[2]);
  if (!a || !b) { $view.innerHTML = `<div class="empty">二家之中有未立指纹者</div>`; return; }
  const pct = radarPercentiles(fps);
  const mapOf = arr => new Map(arr);
  const ia = mapOf(a.img), ib = mapOf(b.img);
  const allImg = [...new Set([...ia.keys(), ...ib.keys()])];
  const rate = (mp, n, k) => (mp.get(k) || 0) / n;      // 每首均次，消弭篇数差
  const rows = allImg.map(k => ({
    k, ra: rate(ia, a.n, k), rb: rate(ib, b.n, k),
    d: rate(ia, a.n, k) - rate(ib, b.n, k),
  })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const maxR = Math.max(...rows.map(r => Math.max(r.ra, r.rb)), 0.001);
  const shared = rows.filter(r => r.ra > 0 && r.rb > 0).sort((x, y) => (y.ra + y.rb) - (x.ra + x.rb));
  const ga = mapOf(a.genre), gb = mapOf(b.genre);
  const ya = mapOf(a.yun), yb = mapOf(b.yun);
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风格指纹", "#/fingerprint")}${sealHTML("二家对读")}</div>
    <div class="card cmp-wrap" style="padding:16px 10px">
      <div class="cmp-col"><div class="cmp-title">${esc(a.author)}</div>
        <div class="cmp-meta">${esc(a.dynasty)} · ${a.n} 首<br>均 ${a.avg_lines} 句</div></div>
      <div class="cmp-rule"></div>
      <div class="cmp-col"><div class="cmp-title">${esc(b.author)}</div>
        <div class="cmp-meta">${esc(b.dynasty)} · ${b.n} 首<br>均 ${b.avg_lines} 句</div></div>
    </div>
    ${kicker(1, "六维之形", "较全体分位")}
    <div class="card" style="text-align:center">
      ${radarSVG([{ f: a, color: "var(--ink)" }, { f: b, color: "var(--seal)" }], pct)}
      <div class="radar-legend">
        <span><i style="background:var(--ink)"></i>${esc(a.author)}</span>
        <span><i style="background:var(--seal)"></i>${esc(b.author)}</span>
      </div>
      <div class="cmp-row" style="text-align:left"><b>篇幅</b><span>${a.avg_lines} / ${b.avg_lines} 句</span></div>
      <div class="cmp-row" style="text-align:left"><b>象密</b><span>每首 ${a.r_density} / ${b.r_density} 象</span></div>
      <div class="cmp-row" style="text-align:left"><b>象广</b><span>用象 ${a.r_variety} / ${b.r_variety} 种</span></div>
      <div class="cmp-row" style="text-align:left"><b>近体</b><span>${(a.r_jinti * 100).toFixed(0)}% / ${(b.r_jinti * 100).toFixed(0)}%</span></div>
      <div class="cmp-row" style="text-align:left"><b>自然｜人事</b><span>${(a.r_nature * 100).toFixed(0)}%｜${(a.r_human * 100).toFixed(0)}%　对　${(b.r_nature * 100).toFixed(0)}%｜${(b.r_human * 100).toFixed(0)}%</span></div>
      <div class="legend" style="margin-top:8px;text-align:left">六维皆按全体 ${fps.length} 家之分位归一
      （量纲各异，绝对值不可径比）：篇幅＝平均句数，象密＝每首意象数，象广＝所用意象种数，
      近体＝律绝占比，自然/人事＝二类意象在其用象中之占比。</div>
    </div>
    ${kicker(2, "意象偏好之差", "每首均次")}
    <div class="card">${rows.slice(0, 12).map(r => `
      <div class="fp-duo">
        <span class="fp-a" style="width:${Math.round(r.ra / maxR * 46)}%"></span>
        <span class="fp-k2"><a href="#/cross?img=${encodeURIComponent(r.k)}">${esc(r.k)}</a></span>
        <span class="fp-b" style="width:${Math.round(r.rb / maxR * 46)}%"></span>
      </div>`).join("")}
      <div class="legend" style="margin-top:10px">左（墨）为 ${esc(a.author)}，右（胭）为 ${esc(b.author)}；
      条长为每首均次，按二家差异由大到小排列。</div>
    </div>
    ${kicker(3, "共好意象", shared.length + " 个")}
    <div class="card">${shared.slice(0, 16).map(r =>
      `<a class="chip" href="#/cross?img=${encodeURIComponent(r.k)}">${esc(r.k)}</a>`).join("") || "—"}</div>
    ${kicker(4, "体裁与用韵")}
    <div class="card">
      <div class="cmp-row"><b>${esc(a.author)}</b><span>${a.genre.slice(0, 4).map(x => x[0] + " " + x[1]).join(" · ")}
        ${ya.size ? "｜韵 " + a.yun.slice(0, 4).map(x => x[0]).join(" ") : ""}</span></div>
      <div class="cmp-row"><b>${esc(b.author)}</b><span>${b.genre.slice(0, 4).map(x => x[0] + " " + x[1]).join(" · ")}
        ${yb.size ? "｜韵 " + b.yun.slice(0, 4).map(x => x[0]).join(" ") : ""}</span></div>
      <div class="cmp-row"><b>同用体裁</b><span>${[...ga.keys()].filter(k => gb.has(k)).join(" · ") || "—"}</span></div>
      <div class="cmp-row"><b>同用韵部</b><span>${[...ya.keys()].filter(k => yb.has(k)).join(" · ") || "—"}</span></div>
      ${(a.dev != null || b.dev != null) ? `<div class="cmp-row"><b>用韵之偏</b><span>${
        [a, b].map(x => x.dev != null
          ? `${esc(x.author)} ${x.dev.toFixed(3)}（${esc(x.grp)}）`
          : `${esc(x.author)} 样本未足`).join("　｜　")}</span></div>` : ""}
    </div>
    <div class="card about"><p class="credit">差异以每首均次计，已消弭二家存诗多寡之影响；此为形式计量，
    不代作风格优劣与师承判断。</p></div>`;
});

/* ── 视图：意象共现的时代变迁 ─────────────────────────────── */
route(/^\/pairflow$/, async (_m, query) => {
  const d = await getJSON("pair_flow.json");
  const eras = d.eras;
  const sel = query.pair || "";
  const maxRate = Math.max(...d.pairs.flatMap(p => Object.values(p.rates)), 1);
  const spark = p => {
    const vs = eras.map(e => p.rates[e] || 0);
    const mx = Math.max(...vs, 0.01);
    return `<span class="spark">${vs.map((v, i) =>
      `<i style="height:${Math.max(6, v / mx * 100)}%" title="${esc(eras[i])} ${v}‰"></i>`).join("")}</span>`;
  };
  const rowHTML = p => {
    const [x, y] = p.pair.split("|");
    return `<a class="pair-row" href="#/pairflow?pair=${encodeURIComponent(p.pair)}">
      <span class="pr-pair">${esc(x)}<em>·</em>${esc(y)}</span>
      ${spark(p)}
      <span class="pr-trend ${p.trend >= 1.5 ? "up" : p.trend <= 0.67 ? "down" : ""}">${
        p.trend >= 1.5 ? "渐兴" : p.trend <= 0.67 ? "渐微" : "平稳"} ${p.trend.toFixed(1)}×</span>
      <span class="pr-peak">峰 ${esc(p.peak)}</span></a>`;
  };

  if (sel) {
    const p = d.pairs.find(x => x.pair === sel);
    if (!p) { $view.innerHTML = `<div class="empty">未收此搭配</div>`; return; }
    const [x, y] = p.pair.split("|");
    const mx = Math.max(...eras.map(e => p.rates[e] || 0), 0.01);
    $view.innerHTML = `
      <div class="reader-top">${backBtn("共现流变", "#/pairflow")}${sealHTML("共现")}</div>
      <div class="img-hero"><span class="big" style="font-size:2.4rem">${esc(x)}·${esc(y)}</span>
        <div class="facts"><div class="nums">共现 ${p.n.toLocaleString()} 篇 · 峰在${esc(p.peak)} ·
          ${p.trend >= 1.5 ? "渐兴" : p.trend <= 0.67 ? "渐微" : "平稳"}</div></div></div>
      ${kicker(1, "历代共现率", "千分比")}
      <div class="card">
        ${eras.map(e => {
          const v = p.rates[e] || 0;
          return `<div class="fp-bar"><span class="fp-k">${esc(e)}</span>
            <i style="width:${Math.round(v / mx * 100)}%"></i><b>${v}‰</b></div>`;
        }).join("")}
        <div class="legend" style="margin-top:8px">共现率＝二象同篇之数 ÷ 该朝作品数。
        各朝作品数：${eras.map(e => `${e} ${d.era_total[e].toLocaleString()}`).join(" · ")}。</div>
      </div>
      ${kicker(2, "分头查考")}
      <div class="filter-row">
        <a class="chip" href="#/cross?img=${encodeURIComponent(x)}">${esc(x)} 之作 →</a>
        <a class="chip" href="#/cross?img=${encodeURIComponent(y)}">${esc(y)} 之作 →</a>
        <a class="chip seal-chip" href="#/search">高级检索求交 →</a>
      </div>
      <div class="card about"><p class="credit">${esc(d.note)}</p></div>`;
    return;
  }

  const rise = [...d.pairs].sort((a, b) => b.trend - a.trend).slice(0, 20);
  const fall = [...d.pairs].sort((a, b) => a.trend - b.trend).slice(0, 20);
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("共现流变")}</div>
    <div class="masthead"><div><h1>流变</h1><div class="sub">意象搭配之兴替</div></div></div>
    <hr class="rule-double">
    <div class="card about"><p>以<b>共现率</b>（二象同篇之数 ÷ 该朝作品数）比较历代，
    故各代篇数悬殊不干扰判读。柱形自左而右为 ${eras.join("、")}。</p>
    <p class="credit">五代仅 ${d.era_total["五代"] || 0} 首且尽出花间、南唐二集，其率反映此二集之性，
    非一代之全貌；明清一层为网络汇编抽样，亦宜作参考。</p></div>
    ${searchboxHTML("pf-q", "寻一意象之搭配，如：梅 / 剑 / 帘")}
    <div id="pf-search"></div>
    ${kicker(1, "渐兴之配", "后世益盛")}
    <div class="card" style="padding:6px 14px">${rise.map(rowHTML).join("")}</div>
    ${kicker(2, "渐微之配", "后世益稀")}
    <div class="card" style="padding:6px 14px">${fall.map(rowHTML).join("")}</div>
    ${kicker(3, "共现之最", "同篇最多")}
    <div class="card" style="padding:6px 14px">${d.pairs.slice(0, 20).map(rowHTML).join("")}</div>`;
  await foldMap();
  document.getElementById("pf-q").oninput = e => {
    const q = fold(e.target.value.trim());
    const el = document.getElementById("pf-search");
    if (!q) { el.innerHTML = ""; return; }
    const hits = d.pairs.filter(p => fold(p.pair).includes(q)).slice(0, 30);
    el.innerHTML = hits.length
      ? `<div class="card" style="padding:6px 14px">${hits.map(rowHTML).join("")}</div>`
      : `<div class="empty">未见含此象之常见搭配</div>`;
  };
});

/* ── 视图：韵部时代流变 ────────────────────────────────────── */
route(/^\/rhymeflow$/, async () => {
  const data = await getJSON("rhyme_flow.json");
  const flow = data.flow || {};
  const eras = (data.eras || []).filter(e => Object.keys(flow[e] || {}).length);
  const totals = {};
  for (const e of eras) totals[e] = Object.values(flow[e]).reduce((s, v) => s + v, 0);
  /* 取各代占比前列的韵部并集 */
  const top = new Set();
  for (const e of eras) {
    Object.entries(flow[e]).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .forEach(([y]) => top.add(y));
  }
  const yuns = [...top];
  const share = (e, y) => (flow[e][y] || 0) / Math.max(1, totals[e]);
  yuns.sort((x, y) => share(eras[0], y) - share(eras[0], x));
  const maxShare = Math.max(...yuns.flatMap(y => eras.map(e => share(e, y))), 0.001);
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("韵部流变")}</div>
    <div class="masthead"><div><h1>韵变</h1><div class="sub">历代用韵之消长</div></div></div>
    <hr class="rule-double">
    <div class="card" style="overflow-x:auto">
      <table class="mx-table">
        <thead><tr><th></th>${eras.map(e => `<th>${esc(e)}</th>`).join("")}</tr></thead>
        <tbody>${yuns.map(y => `<tr>
          <th class="mx-emo"><a href="#/compose/yun">${esc(y)}</a></th>
          ${eras.map(e => {
            const s = share(e, y);
            return `<td><span class="mx-cell" style="--a:${(s / maxShare).toFixed(3)}"
              title="${esc(e)}·${esc(y)}韵：${flow[e][y] || 0} 处，占 ${(s * 100).toFixed(1)}%">${
              s > 0.005 ? (s * 100).toFixed(0) : ""}</span></td>`;
          }).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
    <div class="card">
      <div class="sf-label">各代韵脚计量</div>
      <div class="sf-stat">${eras.map(e =>
        `<span class="chip">${esc(e)} ${totals[e].toLocaleString()}</span>`).join("")}</div>
    </div>
    <div class="card about"><p class="credit">格值为该韵部在该朝韵脚中的百分比（色深同此），
    故各代篇数多寡不影响比较。${esc(data.note)}</p></div>`;
});

/* ── 视图：名句谱（跨代化用实证，非主观选录）──────────────── */
route(/^\/famous$/, async () => {
  const rows = await getJSON("famous.json");
  await foldMap();
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("名句谱")}</div>
    <div class="masthead"><div><h1>名句</h1><div class="sub">${rows.length} 条 · 被后世跨代化用</div></div></div>
    <hr class="rule-double">
    <div class="card about"><p>此谱不作主观选录，而以「<b>被后世跨朝代反复化用</b>」为客观度量：
    凡一语段在两个以上朝代的作品中重现者入谱，按跨代数与涉篇数排序。</p>
    <p class="credit">元杂剧的科介宾白（如「张千云理会的」）在集内高频重复却不跨代流传，已由跨代闸门自然滤除。</p></div>
    ${searchboxHTML("fm-q", "寻一名句，如：明月 / 阳关 / 白发")}
    <div id="fm-list"></div>`;
  const listEl = document.getElementById("fm-list");
  const row = r => `<a class="famous-row" href="#/famous/${encodeURIComponent(r.span)}">
      <div class="fm-span">${esc(r.span)}</div>
      <div class="fm-meta">${r.n_dyn} 朝 ${esc(r.dynasties.join("→"))} · 涉 ${r.n_poems} 篇
        · 最早见《${esc(r.src[1] || "无题")}》${esc(r.src[3])}·${esc(r.src[2])}</div>
    </a>`;
  const draw = q => {
    const fq = fold(q);
    progressiveList(listEl, rows.filter(r => !fq || fold(r.span).includes(fq)), row, 50);
  };
  draw("");
  document.getElementById("fm-q").oninput = e => draw(e.target.value.trim());
});

route(/^\/famous\/(.+)$/, async m => {
  const rows = await getJSON("famous.json");
  const r = rows.find(x => x.span === m[1]);
  if (!r) { $view.innerHTML = `<div class="empty">名句谱未收此语段</div>`; return; }
  const { byId } = await catalog();
  $view.innerHTML = `
    <div class="reader-top">${backBtn("名句谱", "#/famous")}${sealHTML("名句")}</div>
    <div class="poem-paper" style="padding:26px 22px">
      <div class="p-lines" style="font-size:1.3rem;line-height:2">${esc(r.span)}</div>
      <div class="p-meta" style="margin-top:10px">跨 ${r.n_dyn} 朝 · ${esc(r.dynasties.join(" → "))} · 涉 ${r.n_poems} 篇</div>
    </div>
    ${kicker(1, "最早见于", "按朝代时序")}
    <div id="fm-src"></div>
    ${kicker(2, "历代重现", r.poems.length + " 篇")}
    <div id="fm-poems"></div>
    <div class="card about"><p class="credit">重现关系由语料互文规则归纳（共享语段 ≥5 字）；
    化用、同源与偶合未加区分，先后仅按朝代时序排列，不作影响判定。</p></div>`;
  const src = byId.get(r.src[0]);
  document.getElementById("fm-src").innerHTML = src
    ? poemRowHTML(src, `「<span style="color:var(--seal)">${esc(r.span)}</span>」`)
    : `<div class="empty">—</div>`;
  const list = r.poems.map(p => byId.get(p[0])).filter(Boolean);
  progressiveList(document.getElementById("fm-poems"), list,
    x => poemRowHTML(x, ""), 40);
});

/* ── 视图：典故（种子表 + 语料表面命中，候选待辨）─────────── */
route(/^\/allusion$/, async () => {
  const rows = await getJSON("allusions.json");
  await foldMap();
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("典故")}</div>
    <div class="masthead"><div><h1>典故</h1><div class="sub">${rows.length} 则 · 出处与寓意</div></div></div>
    <hr class="rule-double">
    ${searchboxHTML("al-q", "寻一典，如：折柳 / 楼兰 / 南柯")}
    <div id="al-list"></div>
    <div class="card about"><p class="credit">典故为编辑精选种子（非穷举），出处指向公有领域典籍；
    语料命中系<b>表面字面匹配</b>，只作候选 —— 同一字面未必用典（如「楼兰」亦可实指西域政权），
    请据上下文自辨。</p></div>`;
  const listEl = document.getElementById("al-list");
  const row = a => `<a class="person-row" href="#/allusion/${encodeURIComponent(a.id)}">
      <span class="avatar">${esc([...a.name][0] || "典")}</span>
      <span class="who"><b>${esc(a.name)}</b><span>${esc(a.implies || "")}${a.ambiguity ? " · 有歧义" : ""}</span></span>
      <span class="cnt">${a.n_hits} 处</span></a>`;
  const draw = q => {
    const fq = fold(q);
    progressiveList(listEl, rows.filter(a => !fq || fold(a.name).includes(fq) ||
      (a.surfaces || []).some(s => fold(s).includes(fq))), row, 50);
  };
  draw("");
  document.getElementById("al-q").oninput = e => draw(e.target.value.trim());
});

route(/^\/allusion\/([^/]+)$/, async m => {
  const rows = await getJSON("allusions.json");
  const a = rows.find(x => x.id === m[1]);
  if (!a) { $view.innerHTML = `<div class="empty">未收此典</div>`; return; }
  const { rows: cat } = await catalog();
  $view.innerHTML = `
    <div class="reader-top">${backBtn("典故", "#/allusion")}${sealHTML(a.name)}</div>
    <div class="img-hero"><span class="big" style="font-size:2.6rem">${esc(a.name)}</span>
      <div class="facts"><div class="nums">表面命中 ${a.n_hits} 处</div>
        <div class="forms">${(a.surfaces || []).map(s => `<span class="form-tag">${esc(s)}</span>`).join("")}</div></div></div>
    <div class="card">
      <div class="sf-label">出　处</div><div class="bio">${esc(a.source || "—")}</div>
      <div class="sf-label">寓　意</div><div class="bio">${esc(a.implies || "—")}</div>
      ${a.ambiguity ? `<div class="sf-label">歧义辨析</div>
        <div class="bio" style="color:var(--seal)">${esc(a.ambiguity)}</div>` : ""}
      ${a.status ? `<div class="legend" style="margin-top:10px">审核状态：${esc(a.status)}</div>` : ""}
    </div>
    ${kicker(1, "语料命中", a.n_hits + " 处 · 候选待辨")}
    <div id="al-poems"></div>`;
  const list = (a.hits || []).map(i => cat[i]).filter(Boolean);
  progressiveList(document.getElementById("al-poems"), list, r => poemRowHTML(r), 50);
});

/* ── 视图：对读（两篇并置比对）──────────────────────────── */
const CMP_KEY = "moyi_compare";
const getCmp = () => { try { return JSON.parse(localStorage.getItem(CMP_KEY) || "[]"); } catch { return []; } };
function toggleCmp(id) {
  let arr = getCmp().filter(x => x !== id);
  if (arr.length === getCmp().length) arr.unshift(id);
  arr = arr.slice(0, 2);
  try { localStorage.setItem(CMP_KEY, JSON.stringify(arr)); } catch { /* 忽略 */ }
  return arr;
}
route(/^\/compare$/, async () => {
  const ids = getCmp();
  $view.innerHTML = `
    <div class="reader-top">${backBtn("返回")}${sealHTML("对读")}</div>
    <div id="cmp-body"><div class="loading">并 置 中 …</div></div>`;
  const body = document.getElementById("cmp-body");
  if (ids.length < 2) {
    body.innerHTML = `<div class="empty">尚未择定两篇<br>
      <small style="letter-spacing:.1em">阅读任一篇时点「对读」即可择入，满二篇自动并置</small></div>`;
    return;
  }
  const [a, b] = await Promise.all(ids.map(poemById));
  if (!a || !b) { body.innerHTML = `<div class="empty">所择篇目不在馆藏</div>`; return; }
  await foldMap();
  const setOf = p => new Set([...cjkOnly(fold(p.l.join("")))]);
  const sa = setOf(a), sb = setOf(b);
  const shared = [...sa].filter(c => sb.has(c));
  const imgA = new Set(a.img || []), imgB = new Set(b.img || []);
  const sharedImg = [...imgA].filter(i => imgB.has(i));
  const emoA = new Set(a.emo || []), emoB = new Set(b.emo || []);
  const sharedEmo = [...emoA].filter(e => emoB.has(e));
  const col = p => `
    <div class="cmp-col">
      <a class="cmp-title" href="#/poem/${encodeURIComponent(p.id)}">${esc(p.t || "无题")}</a>
      <div class="cmp-meta">${esc([p.d, p.a].filter(Boolean).join(" · "))}<br>${esc(p.b)}${p.g ? " · " + esc(p.g) : ""}</div>
      <div class="cmp-lines">${p.l.map(ln => `<div>${[...ln].map(c =>
        shared.includes(fold(c)) ? `<span class="sh">${esc(c)}</span>` : esc(c)).join("")}</div>`).join("")}</div>
    </div>`;
  body.innerHTML = `
    <div class="card cmp-wrap">${col(a)}<div class="cmp-rule"></div>${col(b)}</div>
    ${kicker(1, "同异", "计量比对")}
    <div class="card">
      <div class="cmp-row"><b>共用字</b><span>${shared.length} 字${shared.length ? "：" + esc(shared.slice(0, 24).join(" ")) : ""}</span></div>
      <div class="cmp-row"><b>共有意象</b><span>${sharedImg.length ? sharedImg.map(i =>
        `<a class="chip" href="#/imagery/${encodeURIComponent(i)}">${esc(i)}</a>`).join("") : "—"}</span></div>
      <div class="cmp-row"><b>共有情感</b><span>${sharedEmo.length ? sharedEmo.map(e =>
        `<a class="chip" href="#/cross?emo=${encodeURIComponent(e)}">${esc(e)}</a>`).join("") : "—"}</span></div>
      <div class="cmp-row"><b>篇幅</b><span>${a.l.length} 句 / ${b.l.length} 句</span></div>
      <div class="cmp-row"><b>体裁</b><span>${esc(a.g || "—")} / ${esc(b.g || "—")}</span></div>
    </div>
    <button class="btn block" id="cmp-clear">清空对读</button>
    <div class="card about"><p class="credit">共用字为逐字比对（简繁折叠后），朱砂标出；意象与情感取自规则挖掘层，
    明清补遗未参与挖掘故无标注。此为形式计量，不代作优劣与影响判断。</p></div>`;
  document.getElementById("cmp-clear").onclick = () => {
    try { localStorage.removeItem(CMP_KEY); } catch { /* 忽略 */ }
    render();
  };
});

/* ── 视图：辞赋（御定历代赋汇 3772 篇）────────────────────── */
route(/^\/fu$/, async () => {
  const idx = await getJSON("fu_index.json");
  await foldMap();
  const eras = [...new Set(idx.items.map(x => x[3]).filter(Boolean))];
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("辞赋")}</div>
    <div class="masthead"><div><h1>辞赋</h1><div class="sub">历代赋汇 · ${idx.n.toLocaleString()} 篇</div></div></div>
    <hr class="rule-double">
    ${searchboxHTML("fu-q", "寻一赋，如：赤壁 / 洛神 / 阿房宫 / 江淹")}
    <div class="filter-row" id="fu-era">
      <button class="chip on" data-v="">全部</button>
      ${eras.map(e => `<button class="chip" data-v="${esc(e)}">${esc(e)}</button>`).join("")}
    </div>
    <div id="fu-list"></div>
    <div class="card about"><p class="credit">${esc(idx.source)} · ${esc(idx.provider)}<br>${esc(idx.note)}</p></div>`;
  let era = "", q = "";
  const listEl = document.getElementById("fu-list");
  const row = it => `<a class="poem-row" href="#/fu/${encodeURIComponent(it[0])}">
      <span class="pr-t">${esc(it[1])}</span>
      <span class="pr-a">${esc(it[2])}</span>
      ${it[3] ? `<span class="pr-d">${esc(it[3])}</span>` : ""}</a>`;
  const draw = () => {
    const fq = fold(q);
    progressiveList(listEl, idx.items.filter(it =>
      (!era || it[3] === era) &&
      (!fq || fold(it[1]).includes(fq) || fold(it[2]).includes(fq))), row, 60);
  };
  document.querySelectorAll("#fu-era button").forEach(b => b.onclick = () => {
    era = b.dataset.v;
    document.querySelectorAll("#fu-era button").forEach(x => x.classList.toggle("on", x === b));
    draw();
  });
  document.getElementById("fu-q").oninput = e => { q = e.target.value.trim(); draw(); };
  draw();
});

route(/^\/fu\/(FU_\d+)$/, async m => {
  const id = m[1];
  const idx = await getJSON("fu_index.json");
  const shard = await getJSON("fu/fu_" + (Number(id.slice(3)) % idx.n_shards) + ".json");
  const p = shard.find(x => x.id === id);
  if (!p) { $view.innerHTML = `<div class="empty">赋汇未收此篇</div>`; return; }
  $view.innerHTML = `
    <div class="reader">
      <div class="reader-top">${backBtn("辞赋", "#/fu")}
        <div class="r-tools"><button id="fu-vert">竖排</button></div></div>
      <div class="poem-paper" id="paper">
        <div class="p-title">${esc(p.t)}</div>
        <div class="p-meta">${esc([p.d, p.a].filter(Boolean).join(" · "))}</div>
        <div class="p-tags">
          <span class="t">${esc(p.juan)}</span>
          ${p.page ? `<span class="t">四库 ${esc(p.page)}</span>` : ""}
          <span class="t">赋</span>
        </div>
        <div class="p-scroll"><div class="p-lines prose-body" id="p-lines">${p.p.map(x => `<p>${esc(x)}</p>`).join("")}</div></div>
        <div class="p-seal">${sealHTML(p.a ? [...cjkOnly(p.a)].slice(0, 3).join("") : "赋")}</div>
      </div>
      <div class="card about"><p class="credit">《御定历代赋汇》${esc(p.juan)}${p.page ? " · 四库本页 " + esc(p.page) : ""}
      · 繁体原文直录（A 层），可据卷次页码回四库本核校。</p></div>
    </div>`;
  document.getElementById("fu-vert").onclick = e => {
    document.getElementById("paper").classList.toggle("vertical");
    e.target.classList.toggle("on");
    const sc = document.querySelector(".p-scroll");
    if (document.getElementById("paper").classList.contains("vertical")) sc.scrollLeft = sc.scrollWidth;
  };
});

/* ── 视图：对课（声律启蒙 · 按平水三十平韵）──────────────── */
route(/^\/duike$/, async () => {
  const dk = await getJSON("duike.json");
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("对课")}</div>
    <div class="masthead"><div><h1>对课</h1><div class="sub">${esc(dk.title)} · ${esc(dk.author)}</div></div></div>
    <hr class="rule-double">
    <div class="card about"><p>${esc((dk.abstract || "").slice(0, 160))}…</p>
      <p class="credit">按平水三十平韵分编，与「韵表」「创作实验室」同一韵部口径。</p></div>
    ${dk.chapters.map((c, i) => `
      <details class="fold card" style="padding:4px 18px">
        <summary>${esc(c.chapter)}<span style="margin-left:auto;font-size:.72rem;color:var(--ink-3)">${esc(c.vol)}</span></summary>
        <div class="fold-body" style="white-space:normal">
          ${c.paras.map(p => `<p style="margin-bottom:10px;line-height:2.05">${esc(p)}</p>`).join("")}
          <a class="btn" href="#/compose/yun" style="margin-top:6px">查此韵字表 →</a>
        </div>
      </details>`).join("")}`;
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
    <a class="btn block" href="#/fingerprint">风格指纹 · 多维计量与二家对读 →</a>
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
    ${kicker(1, "创作")}
    <div class="entry-grid">
      <a class="entry" href="#/compose"><b>创作实验室</b><span>诗谱 · 龙谱 · 韵表 · 校验</span><span class="e-glyph">作</span></a>
      <a class="entry" href="#/duike"><b>对课</b><span>声律启蒙 · 三十平韵属对</span><span class="e-glyph">对</span></a>
      <a class="entry" href="#/cipai"><b>词牌定格</b><span>${stats.cipai} 牌 · 语料归纳句式</span><span class="e-glyph">词</span></a>
      <a class="entry" href="#/rhyme"><b>韵部聚类</b><span>53 组 · 查一字知其韵伴</span><span class="e-glyph">韵</span></a>
    </div>
    ${kicker(2, "探究")}
    <div class="entry-grid">
      <a class="entry" href="#/famous"><b>名句谱</b><span>跨代化用 · 实证度量</span><span class="e-glyph">名</span></a>
      <a class="entry" href="#/fingerprint"><b>风格指纹</b><span>意象 · 体裁 · 用韵 · 可对读</span><span class="e-glyph">纹</span></a>
      <a class="entry" href="#/rhymeflow"><b>韵部流变</b><span>历代用韵之消长</span><span class="e-glyph">韵</span></a>
      <a class="entry" href="#/season"><b>意象四时</b><span>明言某季 · 并用何象</span><span class="e-glyph">时</span></a>
      <a class="entry" href="#/pairflow"><b>共现流变</b><span>意象搭配之兴替</span><span class="e-glyph">变</span></a>
      <a class="entry" href="#/allusion"><b>典故</b><span>出处 · 寓意 · 歧义辨析</span><span class="e-glyph">典</span></a>
      <a class="entry" href="#/starmap"><b>意象星图</b><span>五十意象 · 同篇共现网络</span><span class="e-glyph">星</span></a>
      <a class="entry" href="#/matrix"><b>情象矩阵</b><span>情感 × 意象 · 点格入交叉</span><span class="e-glyph">矩</span></a>
      <a class="entry" href="#/theme"><b>题材九品</b><span>${stats.themes} 品 · 点词查作品</span><span class="e-glyph">品</span></a>
      <a class="entry" href="#/compare"><b>对读</b><span>两篇并置 · 同异计量</span><span class="e-glyph">对</span></a>
    </div>
    ${kicker(3, "文苑 · 游艺 · 私藏")}
    <div class="entry-grid">
      <a class="entry" href="#/fu"><b>辞赋</b><span>历代赋汇 · 三千七百篇</span><span class="e-glyph">赋</span></a>
      <a class="entry" href="#/prose"><b>文苑</b><span>古文观止 · 二百廿二篇</span><span class="e-glyph">文</span></a>
      <a class="entry" href="#/feihua"><b>飞花令</b><span>以字为令 · 语料实证应对</span><span class="e-glyph">飞</span></a>
      <a class="entry" href="#/fav"><b>收藏夹</b><span>${getFavs().length} 首 · 私藏诗笺</span><span class="e-glyph">藏</span></a>
      <a class="entry" href="#/search"><b>高级检索</b><span>多条件组合 · 专业口径</span><span class="e-glyph">检</span></a>
      <a class="entry" href="#/about"><b>关于墨一</b><span>证据分级 · 语料出处</span><span class="e-glyph">印</span></a>
    </div>`;
});

/* ── 视图：情感 × 意象矩阵（计量热力 · 处处可入）─────────── */
route(/^\/matrix$/, async (_m, query) => {
  const wideMode = query.layer === "wide";
  const net = wideMode ? await getJSON("wide_network.json") : await getJSON("network.json");
  const mx = (wideMode ? net.emotion_matrix : net.emotion_imagery_matrix) || {};
  const emotions = Object.keys(mx);
  const imgSet = new Map();
  for (const row of Object.values(mx)) {
    for (const [im, n] of Object.entries(row)) imgSet.set(im, (imgSet.get(im) || 0) + n);
  }
  const imgs = [...imgSet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]);
  const max = Math.max(...emotions.flatMap(e => imgs.map(i => mx[e][i] || 0)), 1);
  const xs = (e, i) => `#/cross?emo=${encodeURIComponent(e)}&img=${encodeURIComponent(i)}${wideMode ? "" : "&wide=0"}`;
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("情象矩阵")}</div>
    <div class="masthead"><div><h1>情象</h1><div class="sub">情感 × 意象 · 同篇计量</div></div></div>
    <hr class="rule-double">
    <div class="seg" id="mx-layer">
      <button data-l="" class="${wideMode ? "" : "on"}">档案层</button>
      <button data-l="wide" class="${wideMode ? "on" : ""}">广谱层</button>
    </div>
    <div class="card" style="overflow-x:auto">
      <table class="mx-table">
        <thead><tr><th></th>${imgs.map(i =>
          `<th><a href="#/cross?img=${encodeURIComponent(i)}">${esc(i)}</a></th>`).join("")}</tr></thead>
        <tbody>${emotions.map(e => `<tr>
          <th class="mx-emo"><a href="#/cross?emo=${encodeURIComponent(e)}">${esc(e)}</a></th>
          ${imgs.map(i => {
            const v = mx[e][i] || 0;
            const a = v / max;
            return `<td>${v
              ? `<a class="mx-cell" href="${xs(e, i)}" style="--a:${a.toFixed(3)}"
                   title="${esc(e)} × ${esc(i)}：${v} 篇 · 点开对读">${v}</a>`
              : `<span class="mx-cell" style="--a:0"></span>`}</td>`;
          }).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
    <div class="card about"><p class="credit">格值为该情感与该意象在同一作品中共现的篇数（B 层确定性计量，可回源复算）；
    色深与数值成正比。<b>点格进交叉作品，点行首情感、点表头意象各自成集</b>。
    ${wideMode ? "广谱层意象取全库表面标注，情感仅核心库有标注，故基数不同于档案层。" : ""}</p></div>`;
  document.querySelectorAll("#mx-layer button").forEach(b => b.onclick = () =>
    location.replace("#/matrix" + (b.dataset.l ? "?layer=wide" : "")));
});

/* ── 视图：意象四时（明言某季时并用之意象）────────────────── */
route(/^\/season$/, async () => {
  const d = await getJSON("season.json");
  const seasons = d.seasons.filter(s => (d.n[s] || 0) > 50);
  /* 以「该季中的占比 ÷ 全季平均占比」为倾向度，见其偏于何季 */
  const rate = (s, im) => (d.img[s][im] || 0) / Math.max(1, d.n[s]);
  const allImg = [...new Set(seasons.flatMap(s => Object.keys(d.img[s])))];
  const rows = allImg.map(im => {
    const rs = seasons.map(s => rate(s, im));
    const sum = rs.reduce((a, b) => a + b, 0);
    const total = seasons.reduce((a, s) => a + (d.img[s][im] || 0), 0);
    const best = rs.indexOf(Math.max(...rs));
    const skew = sum ? Math.max(...rs) / (sum / seasons.length) : 0;
    return { im, rs, total, best: seasons[best], skew };
  }).filter(r => r.total >= 60);
  rows.sort((a, b) => b.skew - a.skew);
  const maxR = Math.max(...rows.flatMap(r => r.rs), 0.001);
  const bySeason = {};
  for (const s of seasons) bySeason[s] = rows.filter(r => r.best === s).slice(0, 14);
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("意象四时")}</div>
    <div class="masthead"><div><h1>四时</h1><div class="sub">意象与季节之关联</div></div></div>
    <hr class="rule-double">
    <div class="card about"><p>季节由篇中<b>直接季节词</b>判定（如「秋风」「暮春」），兼含两季者不判。
    所示为「诗人明言某季时，同篇并用何种意象」—— 而非以物候反推季节，那将是循环论证。</p>
    <p class="credit">${seasons.map(s => `${s} ${d.n[s].toLocaleString()} 首`).join(" · ")}</p></div>
    ${seasons.map((s, si) => `
      ${kicker(si + 1, s + "之象", "偏此季者")}
      <div class="card">
        ${bySeason[s].map(r => `
          <div class="fp-bar"><span class="fp-k"><a href="#/cross?img=${encodeURIComponent(r.im)}">${esc(r.im)}</a></span>
            <i style="width:${Math.round(r.rs[si] / maxR * 100)}%"></i>
            <b>${(r.rs[si] * 100).toFixed(1)}%</b></div>`).join("") || `<div class="empty">—</div>`}
        <div class="legend" style="margin-top:8px">条长为该意象在${esc(s)}诗中的出现率；按四季倾向度择出偏于本季者。</div>
      </div>`).join("")}
    <div class="card" style="overflow-x:auto">
      <div class="sf-label">四时全览（出现率 ‰）</div>
      <table class="mx-table">
        <thead><tr><th></th>${seasons.map(s => `<th>${esc(s)}</th>`).join("")}</tr></thead>
        <tbody>${rows.slice(0, 26).map(r => `<tr>
          <th class="mx-emo"><a href="#/cross?img=${encodeURIComponent(r.im)}">${esc(r.im)}</a></th>
          ${r.rs.map(v => `<td><span class="mx-cell" style="--a:${(v / maxR).toFixed(3)}"
            title="${(v * 100).toFixed(1)}%">${(v * 1000).toFixed(0)}</span></td>`).join("")}
        </tr>`).join("")}</tbody>
      </table>
    </div>
    <div class="card about"><p class="credit">${esc(d.note)}</p></div>`;
});

/* ── 视图：交叉检索（意象 × 情感 × 题材 × 语词，处处可入）─── */
route(/^\/cross$/, async (_m, query) => {
  const want = {
    img: query.img || "", emo: query.emo || "",
    thm: query.thm || "", term: query.term || "",
  };
  const labels = [
    want.img && `意象「${want.img}」`, want.emo && `情感「${want.emo}」`,
    want.thm && `题材「${want.thm}」`, want.term && `语词「${want.term}」`,
  ].filter(Boolean);
  $view.innerHTML = `
    <div class="reader-top">${backBtn("返回")}${sealHTML("交叉")}</div>
    <div class="masthead"><div><h1 style="font-size:1.7rem;letter-spacing:.15em">${esc(labels.join(" × ") || "交叉检索")}</h1>
      <div class="sub" id="cross-sub">检 索 中 …</div></div></div>
    <hr class="rule-double">
    <div id="cross-body"><div class="loading">交 叉 求 集 中 …</div></div>`;

  const { rows } = await catalog();
  await foldMap();
  let idxSet = null;                       // 目录行号集合（求交）
  const intersect = arr => {
    const s = new Set(arr);
    idxSet = idxSet === null ? s : new Set([...idxSet].filter(x => s.has(x)));
  };
  try {
    if (want.img || want.emo || want.thm) {
      const ti = await getJSON("tag_index.json");
      /* 意象默认用全库广谱标注；wide=0 时限于档案层（经审核的规则挖掘结果） */
      if (want.img) {
        intersect(query.wide === "0" ? (ti.imagery[want.img] || [])
          : (ti.wide[want.img] || ti.imagery[want.img] || []));
      }
      if (want.emo) intersect(ti.emotion[want.emo] || []);
      if (want.thm) intersect(ti.theme[want.thm] || []);
    }
    if (want.term) {
      const tt = await getJSON("theme_terms.json");
      const key = fold(cjkOnly(want.term));
      if (tt[key]) intersect(tt[key]);
      else {                                // 索引外的词：全文扫描
        const hits = await scanFullText(text => text.includes(key), null, 2000);
        const idset = new Set(hits.map(r => r[0]));
        intersect(rows.map((r, i) => idset.has(r[0]) ? i : -1).filter(i => i >= 0));
      }
    }
  } catch { /* 索引缺失时留空 */ }

  const hits = idxSet ? [...idxSet].sort((a, b) => a - b).map(i => rows[i]).filter(Boolean) : [];
  const byEra = {}, byBook = {};
  for (const r of hits) {
    byEra[r[3]] = (byEra[r[3]] || 0) + 1;
    byBook[r[4]] = (byBook[r[4]] || 0) + 1;
  }
  document.getElementById("cross-sub").textContent = `${hits.length.toLocaleString()} 首交叉命中`;
  document.getElementById("cross-body").innerHTML = hits.length ? `
    <div class="card">
      <div class="sf-stat">${Object.entries(byEra).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
        `<span class="chip">${esc(k)} ${v}</span>`).join("")}</div>
      <div class="sf-stat">${Object.entries(byBook).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) =>
        `<span class="chip seal-chip">${esc(k)} ${v}</span>`).join("")}</div>
    </div>
    ${want.img || want.emo ? `<div class="filter-row">
      ${want.img ? `<a class="chip" href="#/imagery/${encodeURIComponent(want.img)}">意象档案 · ${esc(want.img)} →</a>` : ""}
      ${want.thm ? `<a class="chip" href="#/theme/${encodeURIComponent(want.thm)}">题材 · ${esc(want.thm)} →</a>` : ""}
      <a class="chip" href="#/matrix">情象矩阵 →</a>
    </div>` : ""}
    <div id="cross-list"></div>`
    : `<div class="empty">此交叉无作品<br><small style="letter-spacing:.1em">意象与情感的标注仅及核心库；明清补遗未参与规则挖掘</small></div>`;
  if (hits.length) {
    progressiveList(document.getElementById("cross-list"), hits, r => poemRowHTML(r), 60);
  }
});

/* ── 创作实验室：诗谱 / 词谱（龙谱）/ 韵表 / 校验 ──────────── */
/* 近体标准谱（王力通行口径；起式以首句第二字定名，五七言映射有别） */
const BASE5 = { A: "仄仄平平仄", B: "平平仄仄平", C: "平平平仄仄", D: "仄仄仄平平" };
const QISHI5 = {
  "仄起不入韵": "ABCD", "仄起入韵": "DBCD",
  "平起不入韵": "CDAB", "平起入韵": "BDAB",
};
const QISHI = Object.keys(QISHI5);
function tmplLines(qishi, charN, nLines) {
  let q = qishi;
  if (charN === 7) q = q.replace("平起", "@").replace("仄起", "平起").replace("@", "仄起");
  const seq = QISHI5[q].repeat(nLines === 8 ? 2 : 1);
  return [...seq].map(k => {
    let base = BASE5[k];
    if (charN === 7) base = ({ "平": "仄仄", "仄": "平平" })[base[0]] + base;
    return base;
  });
}
const PZ_SYM = { "平": "○", "仄": "●", "两": "⊙", "无考": "·" };
const symOf = t => PZ_SYM[t] || "·";

let _rbP = null;
const rhymebook = () => (_rbP ||= getJSON("rhymebook.json").then(rb => {
  rb.ps2cilin = {};
  for (const [bu, pss] of Object.entries(rb.cilin)) {
    for (const ps of pss) (rb.ps2cilin[ps] ||= []).push(bu);
  }
  return rb;
}));
/* 字 → 平水韵候选 [{ps, tone}]（经广韵读音映射） */
async function pingshuiOf(ch) {
  const [gy, rb] = await Promise.all([getJSON("guangyun.json"), rhymebook()]);
  const rec = gy[ch] || gy[fold(ch)];
  if (!rec) return [];
  const seen = new Set(), out = [];
  for (const [yun, tone] of rec[1]) {
    const ps = rb.gy2ps[yun];
    if (ps && !seen.has(ps + tone)) { seen.add(ps + tone); out.push({ ps, tone }); }
  }
  return out;
}

route(/^\/compose(?:\/(shipu|cipu|yun|check))?$/, async m => {
  const tab = m[1] || "shipu";
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("创作实验室")}</div>
    <div class="seg" id="cmp-seg">
      ${[["shipu", "诗谱"], ["cipu", "词谱"], ["yun", "韵表"], ["check", "校验"]].map(([k, lb]) =>
        `<button data-t="${k}" class="${k === tab ? "on" : ""}">${lb}</button>`).join("")}
    </div>
    <div id="cmp-body"></div>`;
  document.querySelectorAll("#cmp-seg button").forEach(b =>
    b.onclick = () => location.replace("#/compose/" + b.dataset.t));
  const body = document.getElementById("cmp-body");

  /* —— 诗谱 —— */
  if (tab === "shipu") {
    let genre = "七绝", qishi = "平起入韵";
    const draw = () => {
      const charN = genre.startsWith("七") ? 7 : 5;
      const nLines = genre.endsWith("律") ? 8 : 4;
      const tmpl = tmplLines(qishi, charN, nLines);
      document.getElementById("shipu-out").innerHTML = `
        <div class="card">
          ${tmpl.map((t, i) => {
            const rhyming = t[t.length - 1] === "平";
            return `<div class="pu-line"><span class="pu-no">${hanNum(i + 1)}</span>
              <span class="pu-sym">${[...t].map(c => c === "平" ? "○" : "●").join("")}${rhyming ? `<span class="yjiao">△</span>` : "，"}</span>
              <span class="pu-txt">${esc(t)}${rhyming ? " 韵" : ""}</span></div>`;
          }).join("")}
        </div>
        <div class="card about"><p class="credit">○平 ●仄 △押平韵。严格位为二四六与句脚，一三五通常可不论；
        邻联须「粘」（后联出句二字平仄同前联对句），联内须「对」。拗救与变格不在谱内，创作时可据《诗词格律》参酌。</p></div>`;
    };
    body.innerHTML = `
      <div class="compose-grid">
        <div class="seg" id="g-seg">${["五绝", "七绝", "五律", "七律"].map(g =>
          `<button class="${g === genre ? "on" : ""}">${g}</button>`).join("")}</div>
        <div class="seg" id="q-seg" style="grid-column:1/-1">${QISHI.map(q =>
          `<button class="${q === qishi ? "on" : ""}" style="letter-spacing:.06em">${q}</button>`).join("")}</div>
      </div>
      <div id="shipu-out"></div>`;
    document.querySelectorAll("#g-seg button").forEach(b => b.onclick = () => {
      genre = b.textContent;
      document.querySelectorAll("#g-seg button").forEach(x => x.classList.toggle("on", x === b));
      draw();
    });
    document.querySelectorAll("#q-seg button").forEach(b => b.onclick = () => {
      qishi = b.textContent;
      document.querySelectorAll("#q-seg button").forEach(x => x.classList.toggle("on", x === b));
      draw();
    });
    draw();
  }

  /* —— 词谱（龙榆生《唐宋词格律》）—— */
  if (tab === "cipu") {
    const cipu = await getJSON("cipu.json");
    await foldMap();
    body.innerHTML = `${searchboxHTML("pu-q", "寻一词牌谱，如：水调歌头 / 念奴娇")}
      <div class="card about" style="padding:10px 18px"><p class="credit" style="margin:0">谱据龙榆生《唐宋词格律》（词谱权威层），共 ${cipu.length} 调；与语料归纳定格互证。</p></div>
      <div id="pu-list"></div>`;
    const row = c => `<a class="person-row" href="#/compose/cipu/${encodeURIComponent(c.cipai)}">
        <span class="avatar">${esc([...c.cipai][0])}</span>
        <span class="who"><b>${esc(c.cipai)}</b><span>${esc(c.category || "")}${c.aliases && c.aliases.length ? " · 又名 " + esc(c.aliases.slice(0, 2).join("、")) : ""}</span></span>
        <span class="cnt">${(c.forms || []).length} 体</span></a>`;
    const draw = q => {
      const fq = fold(q);
      progressiveList(document.getElementById("pu-list"),
        cipu.filter(c => !fq || fold(c.cipai).includes(fq) ||
          (c.aliases || []).some(a => fold(a).includes(fq))), row, 60);
    };
    draw("");
    document.getElementById("pu-q").oninput = e => draw(e.target.value.trim());
  }

  /* —— 韵表（平水韵 / 词林正韵）—— */
  if (tab === "yun") {
    const rb = await rhymebook();
    await foldMap();
    body.innerHTML = `${searchboxHTML("yun-q", "查一字之归部，如：东 / 情 / 月")}
      <div id="yun-hit"></div>
      ${["上平", "下平", "上", "去", "入"].map(gname => `
        <details class="fold card" style="padding:4px 18px">
          <summary>${gname === "上" || gname === "去" || gname === "入" ? gname + "声" : gname + "声（平）"} · ${rb.pingshui.filter(r => r.group === gname).length} 韵</summary>
          <div class="fold-body" style="white-space:normal">
            ${rb.pingshui.filter(r => r.group === gname).map(r => `
              <div style="margin-bottom:10px"><div class="yun-head"><b>${esc(r.yun)}</b>
                <span>${(rb.ps2cilin[r.yun] || []).join(" / ")}</span></div>
                <div class="yun-chars">${esc(r.chars.slice(0, 60))}${r.chars.length > 60 ? "…" : ""}</div></div>`).join("")}
          </div>
        </details>`).join("")}
      <details class="fold card" style="padding:4px 18px">
        <summary>词林正韵 · 十九部</summary>
        <div class="fold-body" style="white-space:normal">
          ${Object.entries(rb.cilin).map(([bu, pss]) => `
            <div style="margin-bottom:8px"><b style="letter-spacing:.1em">${esc(bu)}</b>
              ${pss.map(p => `<span class="chip" style="margin-bottom:4px">${esc(p)}</span>`).join("")}</div>`).join("")}
          <div class="legend">${esc(rb.cilin_note)}</div>
        </div>
      </details>
      <div class="card about"><p class="credit">${esc(rb.note)}</p></div>`;
    document.getElementById("yun-q").oninput = async e => {
      const ch = cjkOnly(e.target.value).slice(0, 1);
      const hit = document.getElementById("yun-hit");
      if (!ch) { hit.innerHTML = ""; return; }
      const cands = await pingshuiOf(ch);
      hit.innerHTML = `<div class="card">
        <div class="yun-head"><b style="font-size:1.5rem">${esc(ch)}</b>
          ${cands.length ? cands.map(c => `<span class="chip seal-chip">${esc(c.ps)}韵 · ${esc(c.tone)}声${(rb.ps2cilin[c.ps] || []).length ? " · " + esc(rb.ps2cilin[c.ps].join("/")) : ""}</span>`).join("")
            : `<span style="color:var(--ink-3)">广韵未收，无从归部</span>`}
        </div></div>`;
    };
  }

  /* —— 校验（创作实验室核心）：近体自动判 / 依词谱点选校验 —— */
  if (tab === "check") {
    body.innerHTML = `
      <div class="seg" id="ck-mode" style="margin-bottom:12px">
        <button data-m="jinti" class="on">近体诗</button>
        <button data-m="ci">依词谱填词</button>
      </div>
      <div id="ck-pane"></div>`;
    const pane = document.getElementById("ck-pane");
    document.querySelectorAll("#ck-mode button").forEach(b => b.onclick = () => {
      document.querySelectorAll("#ck-mode button").forEach(x => x.classList.toggle("on", x === b));
      b.dataset.m === "ci" ? drawCiPane() : drawJintiPane();
    });

    /* —— 依词谱填词：点选词牌 → 逐位对谱校验 —— */
    async function drawCiPane() {
      pane.innerHTML = `
        <div class="card about" style="padding:10px 18px"><p class="credit" style="margin:0">
          先点选词牌（龙榆生《唐宋词格律》），再填入词句 —— 逐字对谱位校验平仄与韵位。</p></div>
        ${searchboxHTML("ci-pu-q", "点选词牌，如：浣溪沙 / 卜算子")}
        <div class="filter-row" id="ci-pu-row"></div>
        <div id="ci-form"></div>`;
      const cipu = await getJSON("cipu.json");
      await foldMap();
      let picked = null, formIdx = 0;
      const drawChips = q => {
        const fq = fold(q || "");
        const list = cipu.filter(c => !fq || fold(c.cipai).includes(fq) ||
          (c.aliases || []).some(a => fold(a).includes(fq))).slice(0, 40);
        document.getElementById("ci-pu-row").innerHTML = list.map(c =>
          `<button class="chip ${picked && c.cipai === picked.cipai ? "on" : ""}" data-c="${esc(c.cipai)}">${esc(c.cipai)}</button>`).join("")
          || `<span style="color:var(--ink-3);font-size:.84rem">龙谱未收此调</span>`;
        document.querySelectorAll("#ci-pu-row button").forEach(b => b.onclick = () => {
          picked = cipu.find(c => c.cipai === b.dataset.c);
          formIdx = 0;
          drawChips(document.getElementById("ci-pu-q").value.trim());
          drawForm();
        });
      };
      document.getElementById("ci-pu-q").oninput = e => drawChips(e.target.value.trim());
      drawChips("");

      /* 谱位序列。要点：△▲ 是韵标记，缀于韵脚字之后、本身不占字位
         （浣溪沙 47 符号实为 42 字 + 5 韵标）；韵标同时收紧该位平仄：
         △ 必押平、▲ 必押仄，即便该位本作 ⊙ 可平可仄。
         ｛｝［］（）、！～ˇ 等为对偶/叠韵/可省/豆/领格/衬字标注，不占字位。 */
      const parsePu = pattern => {
        const out = [];
        for (const ch of [...(pattern || "")]) {
          if ("○●⊙".includes(ch)) { out.push({ k: "pz", s: ch, want: ch }); continue; }
          if ("△▲".includes(ch)) {
            for (let i = out.length - 1; i >= 0; i--) {
              if (out[i].k === "pz") {
                out[i].k = "rhyme";
                out[i].mark = ch;
                out[i].want = ch === "△" ? "○" : "●";
                break;
              }
            }
            continue;
          }
          if (ch === "\n") { out.push({ k: "br" }); continue; }
          out.push({ k: "punc", s: ch });
        }
        return out;
      };

      function drawForm() {
        if (!picked) return;
        const forms = picked.forms || [];
        const pu = parsePu((forms[formIdx] || {}).pattern);
        const need = pu.filter(x => x.k === "pz" || x.k === "rhyme").length;
        document.getElementById("ci-form").innerHTML = `
          ${kicker(1, picked.cipai, need + " 字")}
          ${forms.length > 1 ? `<div class="filter-row" id="ci-form-sel">${forms.map((f, i) =>
            `<button class="chip ${i === formIdx ? "on" : ""}" data-i="${i}">${esc(f.label || "格" + (i + 1))}</button>`).join("")}</div>` : ""}
          <div class="card"><div class="pu-pattern" id="pu-live">${
            pu.map((x, i) => x.k === "br" ? "<br>"
              : x.k === "punc" ? `<span class="pu-punc">${esc(x.s)}</span>`
              : `<span class="pu-slot ${x.k === "rhyme" ? "rk" : ""}" data-i="${i}">${esc(x.k === "rhyme" ? x.mark : x.s)}</span>`).join("")
          }</div>
            <div class="legend" style="margin-top:8px">点谱位可查该位宜用之字（韵位给同韵常用字）。</div>
          </div>
          <div id="slot-tip"></div>
          <textarea class="draft-box" id="ci-draft" placeholder="填入词句（依谱换行，标点可有可无）"></textarea>
          <button class="btn seal-btn block" id="ci-go">依谱校验</button>
          <div id="ci-out" style="margin-top:12px"></div>`;
        document.querySelectorAll("#ci-form-sel button").forEach(b => b.onclick = () => {
          formIdx = Number(b.dataset.i); drawForm();
        });

        /* 点谱位 → 提示该位宜用之字（韵位按已押韵部给同韵常用字） */
        document.getElementById("pu-live").onclick = async ev => {
          const el = ev.target.closest(".pu-slot");
          if (!el) return;
          document.querySelectorAll("#pu-live .pu-slot").forEach(x => x.classList.toggle("sel", x === el));
          const slot = pu[Number(el.dataset.i)];
          const ordinal = pu.slice(0, Number(el.dataset.i) + 1)
            .filter(x => x.k === "pz" || x.k === "rhyme").length;
          const tip = document.getElementById("slot-tip");
          tip.innerHTML = `<div class="card"><div class="loading">检 字 中 …</div></div>`;
          const [gy, rb] = await Promise.all([getJSON("guangyun.json"), rhymebook()]);
          await foldMap();
          const want = slot.want;
          const isRhyme = slot.k === "rhyme";
          /* 已填词句里同一韵位的用字 → 推定本调韵部 */
          const filled = [...cjkOnly(document.getElementById("ci-draft").value)];
          const slots = pu.filter(x => x.k === "pz" || x.k === "rhyme");
          const rhymeUsed = [];
          slots.forEach((s, i) => { if (s.k === "rhyme" && filled[i]) rhymeUsed.push(filled[i]); });
          const psOf = c => new Set(((gy[c] || gy[fold(c)] || [null, []])[1] || [])
            .map(r => rb.gy2ps[r[0]]).filter(Boolean));
          let yunSet = null;
          for (const c of rhymeUsed) {
            const s = psOf(c);
            if (!s.size) continue;
            yunSet = yunSet === null ? s : new Set([...yunSet].filter(x => s.has(x)));
          }
          let chars = [], head;
          if (isRhyme && yunSet && yunSet.size) {
            head = `第 ${ordinal} 字 · ${slot.mark === "△" ? "平" : "仄"}韵位 · 依已押「${[...yunSet].join("/")}」韵`;
            for (const ps of yunSet) {
              const rec = rb.pingshui.find(r => r.yun === ps);
              if (rec) chars.push(...[...rec.chars].slice(0, 48));
            }
          } else if (isRhyme) {
            head = `第 ${ordinal} 字 · ${slot.mark === "△" ? "平" : "仄"}韵位 · 择一韵部起韵`;
            const want平 = slot.mark === "△";
            chars = rb.pingshui.filter(r => want平 ? r.tone === "平" : r.tone !== "平")
              .slice(0, 12).map(r => r.yun);
            tip.innerHTML = `<div class="card">
              <div class="yun-head"><b>${esc(head)}</b></div>
              <div class="sf-label">可选韵部（点选后即按该韵给字）</div>
              <div class="filter-row">${chars.map(y =>
                `<button class="chip" data-y="${esc(y)}">${esc(y)}韵</button>`).join("")}</div>
              <div id="yun-chars-slot"></div></div>`;
            tip.querySelectorAll("[data-y]").forEach(b => b.onclick = () => {
              const rec = rb.pingshui.find(r => r.yun === b.dataset.y);
              tip.querySelectorAll("[data-y]").forEach(x => x.classList.toggle("on", x === b));
              document.getElementById("yun-chars-slot").innerHTML =
                `<div class="yun-chars" style="margin-top:8px">${esc([...(rec ? rec.chars : "")].slice(0, 60).join(""))}</div>`;
            });
            return;
          } else {
            head = `第 ${ordinal} 字 · 谱作 ${slot.s === "○" ? "平声" : slot.s === "●" ? "仄声" : "可平可仄"}`;
            if (want === "⊙") {
              chars = [];
            } else {
              /* 按语料常用字给候选：取平水各部字表中合本位平仄者 */
              const wantPing = want === "○";
              for (const r of rb.pingshui) {
                if ((r.tone === "平") === wantPing) chars.push(...[...r.chars].slice(0, 6));
              }
            }
          }
          const uniq = [...new Set(chars)].slice(0, 90);
          tip.innerHTML = `<div class="card">
            <div class="yun-head"><b>${esc(head)}</b>
              <span>${uniq.length ? uniq.length + " 字备选 · 按语料常用度" : "此位可平可仄，不拘"}</span></div>
            ${uniq.length ? `<div class="yun-chars" style="margin-top:8px">${uniq.map(c =>
              `<span>${esc(c)}</span>`).join("")}</div>` : ""}
            <div class="legend" style="margin-top:8px">字表由《广韵》归部合并为平水韵后，按本馆语料频次排序；仅供择字参考。</div>
          </div>`;
        };
        document.getElementById("ci-go").onclick = async () => {
          const out = document.getElementById("ci-out");
          const text = document.getElementById("ci-draft").value;
          const chars = [...cjkOnly(text)];
          if (!chars.length) { out.innerHTML = `<div class="empty">请先落笔</div>`; return; }
          out.innerHTML = `<div class="loading">对 谱 中 …</div>`;
          const [gy, rb] = await Promise.all([getJSON("guangyun.json"), rhymebook()]);
          const slots = pu.filter(x => x.k === "pz" || x.k === "rhyme");
          const cells = [], rhymeChars = [];
          let bad = 0, unknown = 0;
          slots.forEach((slot, i) => {
            const ch = chars[i];
            if (!ch) { cells.push({ slot, ch: "", state: "miss" }); return; }
            const rec = gy[ch] || gy[fold(ch)];
            const t = rec ? rec[0] : null;
            let state = "ok";
            const want = slot.want;          // ⊙ 通配；韵位由韵标收紧
            if (!t) { state = "unknown"; unknown += 1; }
            else if (want === "○" && !(t === "平" || t === "两")) { state = "bad"; bad += 1; }
            else if (want === "●" && !(t === "仄" || t === "两")) { state = "bad"; bad += 1; }
            if (slot.k === "rhyme") rhymeChars.push(ch);
            cells.push({ slot, ch, state, tone: t });
          });
          const extra = chars.length - slots.length;
          /* 韵位归部一致性 */
          const psOf = c => new Set(((gy[c] || gy[fold(c)] || [null, []])[1] || [])
            .map(r => rb.gy2ps[r[0]]).filter(Boolean));
          let common = null;
          for (const c of rhymeChars) {
            const s = psOf(c);
            if (!s.size) continue;
            common = common === null ? s : new Set([...common].filter(x => s.has(x)));
          }
          const cilinCommon = common && common.size
            ? new Set([...common].flatMap(ps => rb.ps2cilin[ps] || [])) : null;
          let cilinAll = null;
          if (!(common && common.size)) {
            for (const c of rhymeChars) {
              const cs = new Set([...psOf(c)].flatMap(ps => rb.ps2cilin[ps] || []));
              if (!cs.size) continue;
              cilinAll = cilinAll === null ? cs : new Set([...cilinAll].filter(x => cs.has(x)));
            }
          }
          /* 撞句核验：依谱行切句，逐句比对语料（与近体校验同一口径） */
          const draftLines = text.split(/[\n，。、；：？！,.;:?!]+/)
            .map(s => cjkOnly(s)).filter(s => s.length >= 4);
          const needles = draftLines.map((l, i) => ({ i, l, fl: fold(l) }));
          const clashMap = new Map();
          if (needles.length) {
            await scanFullText((txt, row) => {
              for (const nd of needles) {
                if (!clashMap.has(nd.i) && txt.includes(nd.fl)) clashMap.set(nd.i, row);
              }
              return false;
            }, null, 1);
          }
          const ciClashes = [...clashMap.entries()].sort((a, b) => a[0] - b[0]);
          let ciFamous = [];
          try {
            const fl = await getJSON("famous.json");
            ciFamous = needles.map(nd => {
              const hit = fl.find(r => nd.fl.includes(r.span) || r.span.includes(nd.fl));
              return hit ? { i: nd.i, span: hit.span, n: hit.n_poems, dyn: hit.n_dyn, src: hit.src } : null;
            }).filter(Boolean);
          } catch { /* 名句谱缺失时略过 */ }

          /* 谱面渲染：按谱行分列 */
          let ci = 0;
          const rendered = pu.map(x => {
            if (x.k === "br") return "<br>";
            if (x.k === "punc") return `<span class="pu-punc">${esc(x.s)}</span>`;
            const cell = cells[ci++];
            const ch = cell.ch || "□";
            const sym = x.k === "rhyme" ? x.mark : x.s;
            return `<span class="pu-cell ${cell.state}${x.k === "rhyme" ? " rhyme" : ""}"
              title="${esc(x.s)}${x.k === "rhyme" ? "（韵）" : ""}${cell.tone ? " · 实为" + esc(cell.tone) : ""}">${esc(ch)}<i>${esc(sym)}</i></span>`;
          }).join("");
          out.innerHTML = `
            <div class="card"><div class="verdict">
              <span class="v ${bad === 0 ? "ok" : bad <= 3 ? "" : "bad"}">合谱 ${slots.length - bad - unknown}/${slots.length} 字 · 出律 ${bad} 处</span>
              ${chars.length < slots.length ? `<span class="v bad">尚缺 ${slots.length - chars.length} 字</span>` : ""}
              ${extra > 0 ? `<span class="v bad">多出 ${extra} 字</span>` : ""}
              ${unknown ? `<span class="v">${unknown} 字广韵无考</span>` : ""}
              ${rhymeChars.length ? (common && common.size
                ? `<span class="v ok">韵位同押平水「${esc([...common].join("/"))}」${cilinCommon && cilinCommon.size ? " · 词林" + esc([...cilinCommon].join("/")) : ""}</span>`
                : cilinAll && cilinAll.size
                  ? `<span class="v">平水异韵 · 词林正韵同部（${esc([...cilinAll].join("/"))}）</span>`
                  : `<span class="v bad">韵位归部不一</span>`) : ""}
              ${ciClashes.map(([i]) => {
                const fm = ciFamous.find(f => f.i === i);
                return `<span class="v bad">第${hanNum(i + 1)}句与古人撞句${
                  fm ? `（名句 · ${fm.dyn} 朝 ${fm.n} 家化用）` : ""}</span>`;
              }).join("")}
              ${!ciClashes.length && needles.length ? `<span class="v ok">未与语料撞句</span>` : ""}
            </div>
            ${ciClashes.length ? `<div class="legend" style="margin-top:8px">
              ${ciClashes.map(([i, row]) => {
                const fm = ciFamous.find(f => f.i === i);
                return `第${hanNum(i + 1)}句「${esc(needles.find(n => n.i === i).l)}」见于
                  <a href="#/poem/${encodeURIComponent(row[0])}?hl=${encodeURIComponent(needles.find(n => n.i === i).l)}"
                     style="color:var(--seal)">《${esc(row[1] || "无题")}》${esc(row[3])}·${esc(row[2])} →</a>${
                  fm ? `　此为名句，历代 ${fm.n} 家化用，跨 ${fm.dyn} 朝
                    <a href="#/famous/${encodeURIComponent(fm.span)}" style="color:var(--seal)">溯流 →</a>` : ""}`;
              }).join("<br>")}
              <br>填词多用成句本属常法（如集句词），惟须自知所本，勿掠美为己出。</div>` : ""}
            </div>
            <div class="card"><div class="pu-check">${rendered}</div>
              <div class="legend" style="margin-top:10px">格内小字为谱位：○平 ●仄 ⊙可平可仄 △平韵 ▲仄韵
              （韵标缀于韵脚字，不另占字位，并收紧该位平仄）；朱砂＝出律，青＝韵位，灰＝广韵无考。
              依《广韵》判定，两读按通配；｛｝对偶、［］叠韵、（）可省、、豆、！～领格、ˇ衬字等标注不占字位。</div></div>`;
        };
      }
    }

    function drawJintiPane() {
      pane.innerHTML = `
      <div class="card about" style="padding:10px 18px"><p class="credit" style="margin:0">
        每行一句（标点可有可无）。四句/八句且五七言者比对近体四起式；另检三平尾、韵脚归部与「与古人撞句」。</p></div>
      <textarea class="draft-box" id="draft" placeholder="月落乌啼霜满天&#10;江枫渔火对愁眠&#10;姑苏城外寒山寺&#10;夜半钟声到客船"></textarea>
      <button class="btn seal-btn block" id="check-go">校 验</button>
      <div id="check-out" style="margin-top:12px"></div>`;
      document.getElementById("check-go").onclick = async () => {
      const out = document.getElementById("check-out");
      const rawLines = document.getElementById("draft").value.split("\n")
        .map(s => s.trim()).filter(Boolean);
      if (!rawLines.length) { out.innerHTML = `<div class="empty">请先落笔</div>`; return; }
      out.innerHTML = `<div class="loading">推 敲 中 …</div>`;
      const [gy, rb] = await Promise.all([getJSON("guangyun.json"), rhymebook()]);
      await foldMap();
      const lines = rawLines.map(l => cjkOnly(l));
      const pats = lines.map(l => [...l].map(c => {
        const rec = gy[c] || gy[fold(c)];
        return rec ? rec[0] : "无考";
      }));
      const lens = lines.map(l => l.length);
      const uniform = new Set(lens).size === 1;
      const charN = lens[0], n = lines.length;
      const jinti = uniform && (n === 4 || n === 8) && (charN === 5 || charN === 7);

      /* 韵脚归部（平水；不齐则词林） */
      const psSet = ch => new Set((gy[ch] || gy[fold(ch)] || [null, []])[1]
        .map(r => rb.gy2ps[r[0]]).filter(Boolean));
      const evenFeet = lines.filter((_, i) => i % 2 === 1).map(l => l[l.length - 1]);
      const feetSets = evenFeet.map(psSet).filter(s => s.size);
      let common = null;
      for (const s of feetSets) common = common === null ? new Set(s) : new Set([...common].filter(x => s.has(x)));
      const cilinSet = s => new Set([...s].flatMap(ps => rb.ps2cilin[ps] || []));
      let cilinCommon = null;
      for (const s of feetSets) {
        const cs = cilinSet(s);
        cilinCommon = cilinCommon === null ? cs : new Set([...cilinCommon].filter(x => cs.has(x)));
      }

      /* 首句入韵 + 四起式比对（严格位二四六与句脚；两读/无考通配） */
      let fit = null, firstRhymes = null;
      if (jinti) {
        const fset = psSet(lines[0][lines[0].length - 1]);
        if (fset.size && common && common.size) {
          firstRhymes = [...fset].some(x => common.has(x));
        }
        const strict = charN === 7 ? [1, 3, 5, charN - 1] : [1, 3, charN - 1];
        const results = QISHI.map(q => {
          const tmpl = tmplLines(q, charN, n);
          const dev = [];
          pats.forEach((p, i) => strict.forEach(j => {
            if ((p[j] === "平" || p[j] === "仄") && p[j] !== tmpl[i][j]) {
              dev.push({ line: i, pos: j, expected: tmpl[i][j], got: p[j] });
            }
          }));
          let penalty = 0;
          if (firstRhymes === true && q.includes("不入韵")) penalty = 2;
          if (firstRhymes === false && q.endsWith("入韵") && !q.includes("不入韵")) penalty = 2;
          return { q, dev, score: dev.length + penalty };
        }).sort((a, b) => a.score - b.score);
        fit = results[0];
      }

      /* 三平尾 / 三仄尾 */
      const tails = pats.map((p, i) => {
        const last3 = p.slice(-3);
        if (last3.every(t => t === "平")) return { i, kind: "三平尾" };
        if (last3.every(t => t === "仄")) return { i, kind: "三仄尾" };
        return null;
      }).filter(Boolean);

      /* 粘对检测（近体）：联内「对」—— 出句与对句二四六相反；
         联间「粘」—— 后联出句与前联对句二字（七言并四字）相同。
         两读/无考不判（诚实边界）。 */
      const nianDui = [];
      if (jinti) {
        const key = charN === 7 ? [1, 3, 5] : [1, 3];
        const solid = (i, j) => pats[i][j] === "平" || pats[i][j] === "仄";
        for (let c = 0; c + 1 < n; c += 2) {          // 每联：出句 c、对句 c+1
          for (const j of key) {
            if (solid(c, j) && solid(c + 1, j) && pats[c][j] === pats[c + 1][j]) {
              nianDui.push({ kind: "失对", couplet: c / 2 + 1, line: c + 1, pos: j });
            }
          }
        }
        for (let c = 2; c < n; c += 2) {              // 联间：本联出句 c ↔ 前联对句 c-1
          const jj = charN === 7 ? [1, 3] : [1];
          for (const j of jj) {
            if (solid(c, j) && solid(c - 1, j) && pats[c][j] !== pats[c - 1][j]) {
              nianDui.push({ kind: "失粘", couplet: c / 2 + 1, line: c, pos: j });
            }
          }
        }
      }

      /* 拗救识别：把可解释为通行拗救格式的偏差从「违律」中区分出来。
         口径（王力《诗词格律》通行说）：
           · 孤平拗救：B 式「平平仄仄平」首字用仄（犯孤平），第三字改用平相救；
           · 特拗（四拗三救）：C 式「平平平仄仄」第四字用平、第三字用仄，
             成「平平仄平仄」，为唐宋习见变格；
           · 半拗可救可不救：A 式「仄仄平平仄」第四字用仄（五言第三字），
             对句第三字改平相救。
         识别到即标注为「拗救」而非「出律」，并如实说明未穷尽变格。 */
      const aojiu = [];
      if (jinti && fit) {
        const t5 = i => pats[i].slice(charN === 7 ? 2 : 0);   // 取五言核心五字
        const isP = t => t === "平" || t === "两";
        const isZ = t => t === "仄" || t === "两";
        for (let i = 0; i < n; i++) {
          const c = t5(i);
          if (c.length !== 5) continue;
          // 孤平拗救：核心作「仄平平仄平」（本应「平平仄仄平」）
          if (isZ(c[0]) && isP(c[1]) && isP(c[2]) && isZ(c[3]) && isP(c[4])) {
            aojiu.push({ i, kind: "孤平拗救", note: "首字用仄，第三字改平以救" });
            continue;
          }
          // 特拗：核心作「平平仄平仄」（本应「平平平仄仄」）
          if (isP(c[0]) && isP(c[1]) && isZ(c[2]) && isP(c[3]) && isZ(c[4])) {
            aojiu.push({ i, kind: "特拗（四拗三救）", note: "唐宋习见变格，不作出律论" });
            continue;
          }
          // 半拗对句救：本句核心「仄仄平仄仄」，且下句第三字为平
          if (i + 1 < n && isZ(c[0]) && isZ(c[1]) && isP(c[2]) && isZ(c[3]) && isZ(c[4])) {
            const nxt = t5(i + 1);
            if (nxt.length === 5 && isP(nxt[2])) {
              aojiu.push({ i, kind: "半拗对句救", note: "出句第三字拗，对句第三字改平相救" });
            }
          }
        }
      }
      const aoLines = new Set(aojiu.map(a => a.i));

      /* 撞句（语料实有核验）：一趟扫描比对全部句子 */
      const needles = lines.map((l, i) => ({ i, fl: fold(l) })).filter(x => x.fl.length >= 4);
      const clashMap = new Map();
      if (needles.length) {
        await scanFullText((text, row) => {
          for (const nd of needles) {
            if (!clashMap.has(nd.i) && text.includes(nd.fl)) clashMap.set(nd.i, row);
          }
          return false;                       // 只做副作用，不收集
        }, null, 1);
      }
      const clashes = [...clashMap.entries()]
        .sort((a, b) => a[0] - b[0]).map(([i, hit]) => ({ i, hit }));

      /* 撞句若属名句谱所收，另标其跨代化用之数 —— 撞名句与撞僻句轻重不同 */
      let famous = [];
      try {
        const fl = await getJSON("famous.json");
        famous = lines.map((l, i) => {
          const flf = fold(l);
          const hit = fl.find(r => flf.includes(r.span) || r.span.includes(flf));
          return hit ? { i, span: hit.span, n: hit.n_poems, dyn: hit.n_dyn,
                         src: hit.src } : null;
        }).filter(Boolean);
      } catch { /* 名句谱缺失时略过 */ }

      const violByLine = new Map();
      (fit ? fit.dev : []).forEach(d => {
        if (!violByLine.has(d.line)) violByLine.set(d.line, []);
        violByLine.get(d.line).push(d.pos);
      });
      const tmpl = fit ? tmplLines(fit.q, charN, n) : null;

      /* 四时之象：草稿若明言某季，示以此季常见之象（参考，非纠错） */
      let seasonTip = null;
      try {
        const sd = await getJSON("season.json");
        const allText = fold(lines.join(""));
        const hit = Object.entries(sd.words)
          .filter(([, ws]) => ws.some(w => allText.includes(fold(w))))
          .map(([s]) => s);
        if (hit.length === 1) {
          const s = hit[0];
          const used = new Set();
          const wideIdx = await getJSON("imagery_wide.json");
          for (const it of wideIdx.items) {
            if ((it.surfaces || []).some(sf => allText.includes(fold(sf)))) used.add(it.name);
          }
          const seasons = sd.seasons;
          const rate = (ss, im) => (sd.img[ss][im] || 0) / Math.max(1, sd.n[ss]);
          const cand = Object.keys(sd.img[s])
            .map(im => {
              const rs = seasons.map(x => rate(x, im));
              const sum = rs.reduce((p, q) => p + q, 0) || 1;
              return { im, r: rate(s, im), skew: rate(s, im) / (sum / seasons.length) };
            })
            .filter(c => c.r > 0.02 && c.skew > 1.15)
            .sort((x, y) => y.skew - x.skew);
          seasonTip = {
            season: s,
            used: [...used].filter(im => cand.some(c => c.im === im)).slice(0, 8),
            suggest: cand.filter(c => !used.has(c.im)).slice(0, 10).map(c => c.im),
          };
        }
      } catch { /* 四时数据缺失时略过 */ }

      /* 拗救所在句的偏差不计入「出律」计数 */
      const devHard = (fit ? fit.dev : []).filter(d => !aoLines.has(d.line));
      out.innerHTML = `
        <div class="card">
          <div class="verdict">
            ${jinti ? `<span class="v ${devHard.length === 0 ? "ok" : devHard.length <= 2 ? "" : "bad"}">最近谱式 · ${esc(charN === 5 ? "五言" : "七言")}${n === 8 ? "律" : "绝"} ${esc(fit.q)} · 出律 ${devHard.length} 处${aojiu.length ? "（另 " + aojiu.length + " 处属拗救）" : ""}</span>`
              : `<span class="v">非四/八句五七言，未作近体比对</span>`}
            ${firstRhymes !== null ? `<span class="v">首句${firstRhymes ? "入韵" : "不入韵"}</span>` : ""}
            ${common && common.size ? `<span class="v ok">韵脚同押平水「${esc([...common].join("/"))}」韵</span>`
              : cilinCommon && cilinCommon.size ? `<span class="v">平水异韵 · 词林正韵同部（${esc([...cilinCommon].join("/"))}）</span>`
              : feetSets.length > 1 ? `<span class="v bad">韵脚归部不一</span>` : ""}
            ${jinti && !nianDui.length ? `<span class="v ok">粘对无失</span>`
              : nianDui.map(x => `<span class="v bad">第${hanNum(x.couplet)}联${esc(x.kind)}（第${hanNum(x.line + 1)}句第${x.pos + 1}字）</span>`).join("")}
            ${aojiu.map(a => `<span class="v">第${hanNum(a.i + 1)}句 ${esc(a.kind)}</span>`).join("")}
            ${tails.map(t => `<span class="v bad">第${hanNum(t.i + 1)}句${esc(t.kind)}</span>`).join("")}
            ${clashes.map(c => {
              const fm = famous.find(f => f.i === c.i);
              return `<span class="v bad">第${hanNum(c.i + 1)}句与古人撞句${
                fm ? `（名句 · ${fm.dyn} 朝 ${fm.n} 家化用）` : ""}</span>`;
            }).join("")}
          </div>
          ${famous.length ? `<div class="legend" style="margin-top:8px">
            ${famous.map(f => `第${hanNum(f.i + 1)}句含名句「<b>${esc(f.span)}</b>」——
              最早见《${esc(f.src[1] || "无题")}》${esc(f.src[3])}·${esc(f.src[2])}，
              历代 ${f.n} 家化用，跨 ${f.dyn} 朝。
              <a href="#/famous/${encodeURIComponent(f.span)}" style="color:var(--seal)">溯流 →</a>`).join("<br>")}
            <br>用名句非病 —— 化用得当自成新意，惟须知其来历，勿掠美为己出。</div>` : ""}
          ${aojiu.length ? `<div class="legend" style="margin-top:8px">
            ${aojiu.map(a => `第${hanNum(a.i + 1)}句 ${esc(a.kind)}：${esc(a.note)}`).join("　")}</div>` : ""}
        </div>
        <div class="card">
          ${rawLines.map((raw, i) => {
            const viol = aoLines.has(i) ? new Set() : new Set(violByLine.get(i) || []);
            let ci = -1;
            const txt = [...raw].map(c => {
              if (!CJK1.test(c)) return esc(c);
              ci += 1;
              return `<span class="${viol.has(ci) ? "viol" : ""}">${esc(c)}</span>`;
            }).join("");
            const ao = aojiu.find(a => a.i === i);
            return `<div class="check-line">
              <div class="cl-text">${txt}${ao ? `<span class="ao-tag">${esc(ao.kind)}</span>` : ""}</div>
              <div class="cl-tmpl">${pats[i].map(symOf).join("")}${tmpl ? `　谱 ${[...tmpl[i]].map(c => c === "平" ? "○" : "●").join("")}` : ""}</div>
            </div>`;
          }).join("")}
        </div>
        ${seasonTip ? `<div class="card">
          <div class="yun-head"><b>${esc(seasonTip.season)}日之象</b>
            <span>此季常见者 · 仅供采择</span></div>
          ${seasonTip.used.length ? `<div class="cmp-row"><b>篇中已用</b><span>${
            seasonTip.used.map(im => `<a class="chip on" href="#/cross?img=${encodeURIComponent(im)}">${esc(im)}</a>`).join("")}</span></div>` : ""}
          <div class="cmp-row"><b>此季宜用</b><span>${
            seasonTip.suggest.map(im => `<a class="chip" href="#/cross?img=${encodeURIComponent(im)}">${esc(im)}</a>`).join("") || "—"}</span></div>
          <div class="legend" style="margin-top:8px">取古人明言${esc(seasonTip.season)}时并用之象（依四时统计）。
          <b>反季取象自古有之</b>（如「人间四月芳菲尽，山寺桃花始盛开」），此处只作采择之资，不作规矩之绳。
          <a href="#/season" style="color:var(--seal)">意象四时 →</a></div>
        </div>` : ""}
        ${clashes.length ? `<div class="card">${clashes.map(c => {
          const r = c.hit;
          return `<a class="evi-item" href="#/poem/${encodeURIComponent(r[0])}?hl=${encodeURIComponent(lines[c.i])}">
            <div class="quote">第${hanNum(c.i + 1)}句见于《${esc(r[1] || "无题")}》</div>
            <div class="src">${esc(r[3])} · ${esc(r[2])} → 回源对照</div></a>`;
        }).join("")}</div>` : ""}
        <div class="card about"><p class="credit">依《广韵》逐字判定（两读/无考按通配），严格位为二四六与句脚。
        粘对按联内相反、联间相同之通行口径判；拗救只识孤平救、特拗（四拗三救）与半拗对句救三式，
        其余变格未穷尽，出律仅作初筛提示。韵部按平水韵（广韵合并推导），词林正韵为填词口径。</p></div>`;
      };
    }
    drawJintiPane();
  }
});

/* —— 词谱详情（龙谱） —— */
route(/^\/compose\/cipu\/(.+)$/, async m => {
  const cipu = await getJSON("cipu.json");
  const c = cipu.find(x => x.cipai === m[1] || (x.aliases || []).includes(m[1]));
  if (!c) { $view.innerHTML = `<div class="empty">龙谱未收此调</div>`; return; }
  const corpus = await getJSON("cipai.json");
  const inCorpus = corpus.find(x => x.cipai === c.cipai);
  const decorate = p => esc(p).replace(/[△▲]/g, ch => `<span class="rk">${ch}</span>`);
  $view.innerHTML = `
    <div class="reader-top">${backBtn("词谱", "#/compose/cipu")}${sealHTML(c.cipai)}</div>
    <div class="img-hero">
      <span class="big" style="font-size:2.6rem">${esc(c.cipai)}</span>
      <div class="facts"><div class="nums">${esc(c.category || "")} · ${(c.forms || []).length} 体</div>
        ${c.aliases && c.aliases.length ? `<div class="forms">${c.aliases.map(a => `<span class="form-tag">${esc(a)}</span>`).join("")}</div>` : ""}
      </div>
    </div>
    ${c.intro ? `<div class="card about"><p>${esc(c.intro)}</p></div>` : ""}
    ${(c.forms || []).map((f, i) => `
      ${kicker(i + 1, f.label || "定格")}
      <div class="card"><div class="pu-pattern">${decorate(f.pattern || "")}</div></div>`).join("")}
    <details class="fold card" style="padding:4px 18px">
      <summary>符号例言</summary><div class="fold-body">${esc(c.legend || "")}</div>
    </details>
    ${inCorpus ? `<button class="btn primary block" onclick="location.hash='#/cipai/${encodeURIComponent(c.cipai)}'">语料定格与例词 · ${inCorpus.n_poems} 首 →</button>` : ""}
    <div class="card about"><p class="credit">谱据龙榆生《唐宋词格律》（longyusheng.org 整理本）· 词谱权威层。</p></div>`;
});

/* ── 视图：韵部聚类 ────────────────────────────────────────── */
route(/^\/rhyme$/, async () => {
  const groups = await getJSON("rhyme_groups.json");
  await foldMap();
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("韵部聚类")}</div>
    ${searchboxHTML("rh-q", "查一字之韵伴，如：情 / 秋 / 心")}
    <div class="card about" style="padding:12px 18px"><p class="credit" style="margin:0">韵伴聚类为语料实押归纳（B 层），非平水韵/广韵权威表；组内字曾在同诗互押。</p></div>
    <div id="rh-list"></div>`;
  const listEl = document.getElementById("rh-list");
  const draw = q => {
    const ch = fold(cjkOnly(q)).slice(0, 1);
    const list = ch ? groups.filter(g => g.members.includes(ch)) : groups;
    listEl.innerHTML = list.map(g => {
      const gi = groups.indexOf(g);
      return `<a class="person-row" href="#/rhyme/${gi}${ch ? "?c=" + encodeURIComponent(ch) : ""}">
        <span class="avatar">${esc([...g.label][0] || "韵")}</span>
        <span class="who"><b>${esc(g.label)}</b>
          <span>${g.members.slice(0, 10).join(" ")}${g.members.length > 10 ? " …" : ""}</span></span>
        <span class="cnt">${g.members.length} 字</span></a>`;
    }).join("") || `<div class="empty">未见「${esc(ch)}」之韵伴 —— 语料中此字未入互押聚类</div>`;
  };
  draw("");
  document.getElementById("rh-q").oninput = e => draw(e.target.value.trim());
});

route(/^\/rhyme\/(\d+)$/, async (m, query) => {
  const groups = await getJSON("rhyme_groups.json");
  const g = groups[Number(m[1])];
  if (!g) { $view.innerHTML = `<div class="empty">无此韵组</div>`; return; }
  await foldMap();
  const hit = fold(cjkOnly(query.c || "")).slice(0, 1);
  $view.innerHTML = `
    <div class="reader-top">${backBtn("韵部聚类", "#/rhyme")}${sealHTML(g.label)}</div>
    <div class="img-hero"><span class="big" style="font-size:2.4rem">${esc(g.label)}</span>
      <div class="facts"><div class="nums">${g.members.length} 字互押 · 支撑 ${g.n_poems} 诗</div></div></div>
    ${kicker(1, "韵伴", "同诗实押")}
    <div class="card"><div class="rhyme-members">${g.members.map(c =>
      `<span class="zc${c === hit ? " hitc" : ""}">${esc(c)}</span>`).join("")}</div></div>
    ${kicker(2, "支撑作品", g.supporting_poems.length + " 首")}
    <div id="rh-poems"><div class="loading">展 卷 中 …</div></div>`;
  const { byId } = await catalog();
  const rows = g.supporting_poems.map(id => byId.get(id)).filter(Boolean);
  progressiveList(document.getElementById("rh-poems"), rows, r => poemRowHTML(r), 60);
});

/* ── 视图：意象星图 ────────────────────────────────────────── */
route(/^\/starmap$/, async (_m, query) => {
  const wideMode = query.layer === "wide";
  const net = wideMode
    ? await getJSON("wide_network.json")
    : (await getJSON("network.json")).imagery_network;
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("意象星图")}</div>
    <div class="seg" id="star-layer">
      <button data-l="" class="${wideMode ? "" : "on"}">档案 50</button>
      <button data-l="wide" class="${wideMode ? "on" : ""}">广谱 ${wideMode ? net.nodes.length : 80}</button>
    </div>
    <div class="starmap-wrap">
      <div class="starmap-hint">拖 曳 平 移 · 双 指 缩 放 · 点 选 一 星</div>
      <canvas id="star-cv"></canvas>
      <div class="star-ctl">
        <button id="star-zin" aria-label="放大">＋</button>
        <button id="star-zout" aria-label="缩小">－</button>
        <button id="star-reset" aria-label="复位">⟳</button>
      </div>
    </div>
    <div class="card star-info" id="star-info">
      <div class="si-head"><span class="g">${net.nodes.length} 意象</span>
        <span class="n">${net.edges.length} 条共现 · 点选星点查看</span></div>
      <div class="si-edges" style="color:var(--ink-2);font-size:.86rem">
        星点大小为该意象在 ${net.n_poems.toLocaleString()} 篇语料中的出现计量，
        连线粗细为两意象同篇共现之数 —— 皆为 B 层确定性计量，可回源复算。
        ${wideMode ? "广谱层取全库表面标注（含未参与规则挖掘之作）。" : "档案层为规则挖掘所立之五十意象。"}</div>
    </div>`;

  document.querySelectorAll("#star-layer button").forEach(b => b.onclick = () =>
    location.replace("#/starmap" + (b.dataset.l ? "?layer=wide" : "")));
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
  const view = { s: 1, tx: 0, ty: 0 };   // 平移缩放视图态
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.tx, dpr * view.ty);
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

  function updateInfo() {
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
        <div class="si-head"><span class="g">${nodes.length} 意象</span>
          <span class="n">${edges.length} 条共现 · 点选星点查看</span></div>`;
    }
  }

  const selectAt = (x, y) => {          // 屏幕坐标 → 世界坐标命中
    const wx = (x - view.tx) / view.s, wy = (y - view.ty) / view.s;
    let hit = -1;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if ((wx - n.x) ** 2 + (wy - n.y) ** 2 <= (n.r + 6 / view.s) ** 2) { hit = i; break; }
    }
    selected = hit === selected ? -1 : hit;
    draw(); updateInfo();
  };

  const zoomAt = (x, y, factor) => {    // 以 (x,y) 为锚缩放
    const s2 = Math.min(5, Math.max(.5, view.s * factor));
    view.tx = x - (x - view.tx) * (s2 / view.s);
    view.ty = y - (y - view.ty) * (s2 / view.s);
    view.s = s2;
    draw();
  };

  /* 指针交互：单指拖曳平移 / 双指捏合缩放 / 原地抬起为点选 */
  const ptrs = new Map();
  let moved = false, pinch0 = null, down0 = null;
  const pos = ev => {
    const r = cv.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  cv.addEventListener("pointerdown", ev => {
    cv.setPointerCapture(ev.pointerId);
    ptrs.set(ev.pointerId, pos(ev));
    if (ptrs.size === 1) { moved = false; down0 = pos(ev); }
    else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: view.s };
    }
  });
  cv.addEventListener("pointermove", ev => {
    if (!ptrs.has(ev.pointerId)) return;
    const prev = ptrs.get(ev.pointerId), cur = pos(ev);
    ptrs.set(ev.pointerId, cur);
    if (ptrs.size === 1) {
      if (down0 && Math.hypot(cur.x - down0.x, cur.y - down0.y) > 6) moved = true;
      if (moved) { view.tx += cur.x - prev.x; view.ty += cur.y - prev.y; draw(); }
    } else if (ptrs.size === 2 && pinch0) {
      moved = true;
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      zoomAt(mid.x, mid.y, (pinch0.s * (d / pinch0.d)) / view.s);
    }
  });
  const lift = ev => {
    const was = ptrs.get(ev.pointerId);
    ptrs.delete(ev.pointerId);
    if (ptrs.size < 2) pinch0 = null;
    if (ptrs.size === 0 && was && !moved && ev.type === "pointerup") selectAt(was.x, was.y);
  };
  cv.addEventListener("pointerup", lift);
  cv.addEventListener("pointercancel", lift);
  cv.addEventListener("wheel", ev => {
    ev.preventDefault();
    const p = pos(ev);
    zoomAt(p.x, p.y, ev.deltaY < 0 ? 1.15 : .87);
  }, { passive: false });

  document.getElementById("star-zin").onclick = () => zoomAt(W / 2, H / 2, 1.3);
  document.getElementById("star-zout").onclick = () => zoomAt(W / 2, H / 2, .77);
  document.getElementById("star-reset").onclick = () => {
    view.s = 1; view.tx = 0; view.ty = 0; selected = -1; draw(); updateInfo();
  };
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
    <div id="cp-pu-link"></div>
    ${kicker(1, "例词", (c.supporting_poems || []).length + " 首")}
    <div id="cp-poems"><div class="loading">展 卷 中 …</div></div>`;
  const { byId } = await catalog();
  const hits = (c.supporting_poems || []).map(id => byId.get(id)).filter(Boolean);
  progressiveList(document.getElementById("cp-poems"), hits, r => poemRowHTML(r), 60);

  /* 龙谱互链：语料定格 ↔ 词谱权威层 */
  getJSON("cipu.json").then(cipu => {
    const pu = cipu.find(x => x.cipai === c.cipai || (x.aliases || []).includes(c.cipai));
    const slot = document.getElementById("cp-pu-link");
    if (pu && slot) {
      slot.innerHTML = `<button class="btn primary block"
        onclick="location.hash='#/compose/cipu/${encodeURIComponent(pu.cipai)}'">
        龙榆生词谱 · ${esc(pu.category || "")} · ${(pu.forms || []).length} 体 →</button>`;
    }
  }).catch(() => {});
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
    ${kicker(1, "标志语汇", "点词查作品")}
    <div class="card">${(t.marker_terms || []).map(w =>
      `<a class="chip" href="#/cross?term=${encodeURIComponent(w)}">${esc(w)}</a>`).join("")}
      <div class="legend" style="margin-top:8px">点一语汇即检出语料中含此词的全部作品；
      配合本品可作「词—题材」互证。</div></div>
    ${kicker(2, "常见意象", "点入交叉")}
    <div class="card">${(t.top_imagery || []).map(i =>
      `<a class="chip" href="#/cross?img=${encodeURIComponent(i.imagery)}&thm=${encodeURIComponent(t.theme)}">${esc(i.imagery)} · ${i.count}</a>`).join("")}
      <div class="legend" style="margin-top:8px">点入即得「此意象 × 本题材」的交叉作品。</div></div>
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
    fh.candidates = await scanFullText(text => text.includes(fh.char), null, 1200);
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
    const stats = await getJSON("stats.json");
    const found = await scanFullText(text => text.includes(folded), null, 8);
    const hit = found.find(r => !fh.used.has(r[0]));
    if (!hit) {
      say("app", found.length ? "此句本局已用过，不可重令，请另出一句。"
        : `遍检 ${stats.poems.toLocaleString()} 篇，未见此句 —— 或非语料所收，或字句有出入。请再出。`);
      return;
    }
    fh.used.add(hit[0]);
    say("app", `验讫 ——《${hit[1] || "无题"}》 ${hit[3]} · ${hit[2]}，此句实有。墨一应令：`);
    await appTurn();
  };
  document.getElementById("fh-pass").onclick = appTurn;
});

/* ── 视图：阅读器 ──────────────────────────────────────────── */
const CJK1 = /[㐀-鿿豈-﫿]/;

route(/^\/poem\/([^/]+)$/, async (m, query) => {
  const poem = await poemById(m[1]);
  if (!poem) { $view.innerHTML = `<div class="empty">此篇不在馆藏</div>`; return; }
  await foldMap();
  const hl = fold(cjkOnly(query.hl || ""));
  const meta = [poem.d, poem.a].filter(Boolean).join(" · ");
  const fm = (poem.m && poem.m.fm) || poem.g;
  const feet = new Set(((poem.m && poem.m.rf) || []).map(c => fold(c)));
  const tags = [poem.b, fm, poem.c ? "词牌 · " + poem.c : "", poem.sec].filter(Boolean);

  /* 每字包裹（可点释义）；律模式加 ruby 平仄注 */
  const charHTML = (ch, pz) => {
    if (!CJK1.test(ch)) return esc(ch);
    const isFoot = feet.size && feet.has(fold(ch));
    if (!pz) return `<span class="zc${isFoot ? " rf-foot" : ""}" data-c="${esc(ch)}">${esc(ch)}</span>`;
    const rec = pz[ch] || pz[fold(ch)];
    const t = rec ? rec[0] : null;
    const sym = t === "平" ? "○" : t === "仄" ? "●" : t === "两" ? "⊙" : "·";
    const tcls = t === "平" ? " rt-ping" : t === "仄" ? " rt-ze" : "";
    return `<ruby class="zc${isFoot ? " rf-foot" : ""}${tcls}" data-c="${esc(ch)}">${esc(ch)}<rt>${sym}</rt></ruby>`;
  };
  const linesHTML = pz => poem.l.map((ln, i) => {
    const isHl = hl && fold(cjkOnly(ln)).includes(hl);
    const sep = i === poem.l.length - 1 ? "。" : i % 2 === 0 ? "，" : "。";
    return `<span class="ln${isHl ? " hl" : ""}">${[...ln].map(c => charHTML(c, pz)).join("")}${sep}</span>${i % 2 === 1 ? "<br>" : ""}`;
  }).join("");

  const foldSec = (title, arr) => arr && arr.length ? `
    <details class="fold"><summary>${title}</summary>
      <div class="fold-body">${arr.map(esc).join("\n\n")}</div></details>` : "";

  const nChars = poem.l.reduce((s, ln) => s + cjkOnly(ln).length, 0);

  $view.innerHTML = `
    <div class="reader">
      <div class="reader-top">${backBtn("返回")}
        <div class="r-tools">
          <button id="r-fav" class="${isFav(poem.id) ? "fav-on" : ""}">${isFav(poem.id) ? "已藏" : "藏"}</button>
          <button id="r-cmp" class="${getCmp().includes(poem.id) ? "on" : ""}">对读</button>
          <button id="r-metric">律</button>
          <button id="r-vert">竖排</button>
        </div>
      </div>
      <div class="poem-paper" id="paper">
        <div class="p-title">${esc(poem.t || "无题")}</div>
        <div class="p-meta">${esc(meta)}</div>
        <div class="p-tags">${tags.map(t => `<span class="t">${esc(t)}</span>`).join("")}</div>
        <div class="p-scroll"><div class="p-lines" id="p-lines">${linesHTML(null)}</div></div>
        <div class="p-seal">${sealHTML(poem.a && poem.a !== "佚名" ? [...cjkOnly(poem.a)].slice(0, 3).join("") : "墨一")}</div>
      </div>
      <div class="card" style="padding:4px 18px">
        <details class="fold"><summary>格　律</summary>
          <div class="fold-body" id="metric-body">
            <div class="metric-sum" id="metric-sum">
              ${esc(fm || "—")} · ${poem.l.length} 句 · ${nChars} 字
              ${poem.l.length ? `<br>句式 ${poem.l.map(ln => cjkOnly(ln).length).join("-")}` : ""}
              <span id="metric-feet"></span>
            </div>
            <div class="legend" style="margin-top:8px">
              点右上「律」为全篇标注平仄：○ 平 · ● 仄 · ⊙ 两读 · · 广韵无考。
              依《广韵》逐字判定（B 层计量），多音不作语境消歧；韵脚字以青色示之。
            </div>
          </div>
        </details>
        ${foldSec("注　释", poem.notes)}
        ${foldSec("赏　析", poem.appr)}
        ${(() => {
          const arch = poem.img || [];
          const wide = (poem.wimg || []).filter(i => !arch.includes(i));
          if (!arch.length && !wide.length) return "";
          const links = arch.map(i =>
            `<a class="tag-link" href="#/imagery/${encodeURIComponent(i)}">${esc(i)}</a>`).join("")
            + wide.map(i =>
            `<a class="tag-link wide" href="#/cross?img=${encodeURIComponent(i)}">${esc(i)}</a>`).join("");
          const tip = arch.length && wide.length
            ? `<div class="legend" style="margin-top:8px">前者为档案意象（附完整档案），后者为广谱标注（表面计量）。</div>`
            : "";
          return `<details class="fold" open><summary>篇中意象</summary>`
            + `<div class="fold-body" style="white-space:normal">${links}${tip}</div></details>`;
        })()}
        ${(poem.emo && poem.emo.length) ? `
          <details class="fold"><summary>情感基调</summary>
            <div class="fold-body">${poem.emo.map(e => `<span class="chip">${esc(e)}</span>`).join("")}</div>
          </details>` : ""}
        <div id="itx-slot"></div>
      </div>
      <div class="card about"><p class="credit">篇目 ${esc(poem.id)} · 出自《${esc(poem.b)}》 · 原文直录（A 层）；平仄依《广韵》（B 层）；训诂出《说文》（C 层）。</p></div>
    </div>
    <div id="zi-slot"></div>`;

  document.getElementById("r-vert").onclick = e => {
    const paper = document.getElementById("paper");
    paper.classList.toggle("vertical");
    e.target.classList.toggle("on");
    if (paper.classList.contains("vertical")) {
      const sc = paper.querySelector(".p-scroll");
      sc.scrollLeft = sc.scrollWidth;   // 竖排自最右首列读起
    }
  };
  document.getElementById("r-fav").onclick = e => {
    const on = toggleFav({ id: poem.id, t: poem.t, a: poem.a, d: poem.d });
    e.target.classList.toggle("fav-on", on);
    e.target.textContent = on ? "已藏" : "藏";
  };
  document.getElementById("r-cmp").onclick = e => {
    const arr = toggleCmp(poem.id);
    e.target.classList.toggle("on", arr.includes(poem.id));
    if (arr.length === 2) location.hash = "#/compare";
  };

  /* 律：平仄注音开关（懒加载广韵表） */
  let metricOn = false;
  document.getElementById("r-metric").onclick = async e => {
    metricOn = !metricOn;
    e.target.classList.toggle("on", metricOn);
    const pz = metricOn ? await getJSON("guangyun.json") : null;
    document.getElementById("p-lines").innerHTML = linesHTML(pz);
  };

  /* 韵脚 + 韵目（广韵懒加载，填入格律摘要） */
  if (feet.size) {
    getJSON("guangyun.json").then(gy => {
      const el = document.getElementById("metric-feet");
      if (!el) return;
      const tags2 = [...((poem.m && poem.m.rf) || [])].map(c => {
        const rec = gy[c] || gy[fold(c)];
        const yuns = rec ? [...new Set(rec[1].map(r => r[0]))].join("/") : "无考";
        return `<span class="foot-tag">${esc(c)} · ${esc(yuns)}</span>`;
      }).join("");
      el.innerHTML = `<br>韵脚　${tags2}`;
    }).catch(() => {});
  }

  /* 互文关联（懒加载对应分片） */
  getJSON("intertext/itx_" + String(shardOf(poem.id)).padStart(2, "0") + ".json").then(async mp => {
    const links = mp[poem.id];
    const slot = document.getElementById("itx-slot");
    if (!links || !links.length || !slot) return;
    const { byId } = await catalog();
    const rows = links.map(([oid, span, mode]) => {
      const r = byId.get(oid);
      if (!r) return "";
      return `<a class="evi-item" href="#/poem/${encodeURIComponent(oid)}?hl=${encodeURIComponent(span)}">
          <div class="quote">「<mark>${esc(span)}</mark>」<span style="font-size:.76rem;color:var(--ink-3)"> · ${esc(mode)}</span></div>
          <div class="src">《${esc(r[1] || "无题")}》 ${esc(r[3])} · ${esc(r[2])}</div>
        </a>`;
    }).join("");
    slot.innerHTML = `
      <details class="fold"><summary>互文关联 · ${links.length}</summary>
        <div class="fold-body" style="white-space:normal">${rows}
          <div class="legend" style="margin-top:8px">语料归纳的共享语段（化用/同源待考），点击可回源对照。</div>
        </div>
      </details>`;
  }).catch(() => {});

  /* 点字释义：广韵读音 + 说文训诂 */
  document.getElementById("p-lines").addEventListener("click", async e => {
    const t = e.target.closest("[data-c]");
    if (!t) return;
    const ch = t.dataset.c;
    const slot = document.getElementById("zi-slot");
    slot.innerHTML = `<div class="sheet-mask"></div>
      <div class="sheet"><div class="zi-head">
        <span class="zi-big">${esc(ch)}</span>
        <div class="zi-meta">检 索 中 …</div></div></div>`;
    slot.querySelector(".sheet-mask").onclick = () => { slot.innerHTML = ""; };
    let gy = null, gl = null;
    try { [gy, gl] = await Promise.all([getJSON("guangyun.json"), getJSON("gloss.json")]); }
    catch { /* 数据缺失时仅展示占位 */ }
    const rec = gy && (gy[ch] || gy[fold(ch)]);
    const sw = gl && (gl[ch] || gl[fold(ch)]);
    const sheet = slot.querySelector(".sheet");
    if (!sheet) return;
    sheet.innerHTML = `
      <div class="zi-head">
        <span class="zi-big">${esc(ch)}</span>
        <div class="zi-meta">
          ${rec ? `平仄 <b>${esc(rec[0] === "两" ? "两读" : rec[0])}</b>` : "广韵未收"}
          ${sw && sw[1] ? ` · 拼音 <b>${esc(sw[1])}</b>` : ""}
          ${sw && sw[0] ? ` · ${esc(sw[0])}` : ""}
        </div>
      </div>
      ${rec ? `<h4>广韵读音</h4>${rec[1].map(r => `
        <div class="reading-row"><span class="yun">${esc(r[0])}韵</span>
          <span>${esc(r[1])}声</span><span>${esc(r[2])}</span></div>`).join("")}` : ""}
      ${sw && sw[3] ? `<h4>说文解字</h4><div class="zi-gloss">${esc(sw[3])}</div>` : ""}
      ${!rec && !sw ? `<div class="zi-gloss">此字广韵、说文均未收录。</div>` : ""}
      <div class="note">音韵依《广韵》（韵典网整理本，B 层）；释义出《说文解字》（C 层旁证）。</div>`;
  });
});

/* ── 视图：关于 ────────────────────────────────────────────── */
route(/^\/about$/, async () => {
  const [stats, mq] = await Promise.all([
    getJSON("stats.json"),
    getJSON("mingqing_meta.json").catch(() => null),
  ]);
  $view.innerHTML = `
    <div class="reader-top">${backBtn("风雅集", "#/salon")}${sealHTML("墨一", true)}</div>
    <div class="masthead"><div><h1>墨一</h1><div class="sub">一墨藏万象</div></div></div>
    <hr class="rule-double">
    <div class="card about">
      <p>墨一是一座随身的古典诗词档案馆：${stats.poems.toLocaleString()} 首诗词、3,772 篇辞赋、222 篇古文、${stats.imagery} 个意象档案、${stats.authors} 位诗人档案、${stats.cipai} 个词牌，全部数据离线内置。</p>
      <p>核心规则由 CNPoetry-Hermes 自主规则挖掘流水线生成，恪守「无原文，不成论断；无篇目，不成证据」：每一条意象—情感联系、每一处例证，均逐字回源到具体诗句，点击即达原诗。</p>
      <p>证据分级 —— A 原文直录 / B 确定性计量 / C 集内旁证 / D 外部分析 / E 模型解释。本 App 只呈现 A、B、C 三层。</p>
    </div>
    ${kicker(1, "语料分层", "来源与证据级别")}
    <div class="card about">
      <p><b>核心库</b>（26,720 首）—— chinese-poetry 开源整理本：诗经、楚辞、全唐诗、全宋诗词、元曲、花间集、纳兰词等。参与意象/情感/词牌等全部规则挖掘。</p>
      <p><b>明清补遗</b>（104,000 首）—— ${mq ? esc(mq.source_repo) : "Werneror/Poetry"}。
      <span style="color:var(--seal)">${mq ? esc(mq.evidence_level) : "网络汇编"}</span>：无底本、卷次与页码，
      <b>非《全明诗》《全清诗》权威底本</b>。按作者分层抽样（覆盖 13,659 位作者），仅供阅读、检索与格律计量，
      不参与意象与情感规则挖掘 —— 那些结论要求逐字回源到可信底本。</p>
      <p><b>辞赋</b>（3,772 篇）—— 《御定历代赋汇》清·陈元龙编，文渊阁四库全书本（Kanripo KR4h0139）。
      原典 1706 年成书，正文属公有领域；每篇随带卷次与四库页码，可回底本核校。</p>
      <p><b>文苑</b>（222 篇）—— 《古文观止》，含四篇辞赋名篇与明文。<b>对课</b> —— 《声律启蒙》清·车万育。</p>
      <p><b>音韵训诂</b> —— 《广韵》字音（韵典网整理本，21,940 键）、《说文解字》（11,179 键）、
      龙榆生《唐宋词格律》153 调；平水韵 106 部由广韵规范合并推导，词林正韵 19 部为其再合并。</p>
      <p class="credit">简繁折叠：OpenCC 字表 · 字体：霞鹜文楷（SIL OFL 1.1）· 研发：医哲未来人工智能研究院（IMPF-AI）
      · 本 App 代码遵循 MIT 许可；古代正文属公有领域，现代整理与注释之权利归各自作者所有。</p>
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

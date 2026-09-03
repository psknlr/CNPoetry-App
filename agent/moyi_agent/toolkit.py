"""墨一工具集：供 Anthropic 工具执行器与 MCP 服务器共用的领域工具。

每个函数即一个工具：签名生成参数 schema，docstring 生成工具说明，
返回值一律为 JSON 字符串（ensure_ascii=False）。实现只读语料，无副作用。
"""
from __future__ import annotations

import json
from pathlib import Path

from . import corpus, prosody

SKILL_DIR = Path(__file__).resolve().parent / "skills"


def _j(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _row(r: list) -> dict:
    return {"id": r[0], "title": r[1] or "无题", "author": r[2],
            "dynasty": r[3], "book": r[4], "genre": r[5],
            **({"cipai": r[6]} if len(r) > 6 and r[6] else {})}


# ── 检索与取篇 ────────────────────────────────────────────────

def search_works(query: str, dynasty: str = "", author: str = "",
                 genre: str = "", limit: int = 20) -> str:
    """按题名或作者检索作品目录（13 万篇，繁简通检）。

    Args:
        query: 题名或作者中的关键词，如「秋兴」「李商隐」；可为空（配合筛选用）。
        dynasty: 朝代筛选，如「唐」「宋」「明清补遗」；空为不限。
        author: 作者精确筛选；空为不限。
        genre: 体裁筛选，如「七律」「词」「曲」「赋」；空为不限。
        limit: 最多返回条数（默认 20，上限 100）。
    """
    fq = corpus.fold(query.strip())
    fa = corpus.fold(author.strip())
    limit = max(1, min(int(limit), 100))
    hits = []
    for r in corpus.catalog():
        if dynasty and r[3] != dynasty:
            continue
        if fa and corpus.fold(r[2]) != fa:
            continue
        if genre and genre not in (r[5] or ""):
            continue
        if fq and fq not in corpus.fold(r[1] or "") and fq not in corpus.fold(r[2] or ""):
            continue
        hits.append(_row(r))
        if len(hits) >= limit:
            break
    return _j({"n": len(hits), "works": hits,
               "hint": "取全文用 get_work(id)；检索诗句原文用 search_full_text。"})


def search_full_text(phrase: str, limit: int = 20) -> str:
    """全文检索：在 13 万篇折叠全文中找包含某成句/词语的作品（子串精确匹配）。

    Args:
        phrase: 要找的字句，如「大江东去」「杨柳岸」；繁简皆可，至少 2 字。
        limit: 最多返回条数（默认 20，上限 100）。
    """
    fl = corpus.fold(corpus.cjk_only(phrase))
    if len(fl) < 2:
        return _j({"error": "至少给出 2 个汉字。"})
    limit = max(1, min(int(limit), 100))
    hits = corpus.scan_full_text(lambda t, r: fl in t, limit=limit)
    return _j({"phrase": phrase, "n": len(hits), "works": [_row(r) for r in hits]})


def get_work(work_id: str) -> str:
    """取一篇作品全文与元数据（含意象标签与韵脚）。

    Args:
        work_id: 作品 id，如 CNP_TANG300_00010（由检索类工具获得）。
    """
    p = corpus.poem_by_id(work_id)
    if not p:
        return _j({"error": f"未见此 id：{work_id}"})
    return _j({
        "id": p["id"], "title": p.get("t") or "无题", "author": p.get("a"),
        "dynasty": p.get("d"), "book": p.get("b"), "section": p.get("sec"),
        "genre": p.get("g"), "cipai": p.get("cp"), "lines": p.get("l", []),
        "imagery": p.get("img", []), "imagery_wide": p.get("wimg", []),
        "rhyme_feet": (p.get("m") or {}).get("rf", []),
        "form": (p.get("m") or {}).get("fm"),
    })


# ── 韵书 ─────────────────────────────────────────────────────

def char_rhyme(char: str) -> str:
    """查一字之声调与韵部归属：广韵读音 → 平水韵 106 部 → 词林正韵 19 部。

    Args:
        char: 单个汉字，如「东」「月」「情」。
    """
    ch = corpus.cjk_only(char)[:1]
    if not ch:
        return _j({"error": "请给出一个汉字。"})
    cands = corpus.pingshui_of(ch)
    if not cands:
        return _j({"char": ch, "tone": "无考", "note": "广韵未收，无从归部。"})
    rb = corpus.rhymebook()
    return _j({
        "char": ch, "tone_class": corpus.tone_of(ch),
        "readings": [{**c, "cilin": rb["ps2cilin"].get(c["ps"], [])} for c in cands],
        "note": "tone_class「两」为两读字，格律校验时按通配。",
    })


def rhyme_group(category: str = "", tone: str = "") -> str:
    """列平水韵部：给定韵部名返回该部字表与词林归属；不给则列全部韵部名。

    Args:
        category: 平水韵部名，如「东」「支」「阳」；空则仅列目录。
        tone: 目录模式下按声调筛选：平 / 上 / 去 / 入；空为不限。
    """
    rb = corpus.rhymebook()
    if category:
        cat = corpus.fold(category.strip().rstrip("韵"))
        rec = next((r for r in rb["pingshui"] if r["yun"] == cat), None)
        if not rec:
            return _j({"error": f"平水韵无「{category}」部。"})
        return _j({"category": rec["yun"], "tone": rec["tone"], "group": rec["group"],
                   "cilin": rb["ps2cilin"].get(rec["yun"], []),
                   "chars": rec["chars"], "note": "字表按本馆语料常用度排序。"})
    cats = [{"yun": r["yun"], "tone": r["tone"], "group": r["group"]}
            for r in rb["pingshui"] if not tone or r["tone"] == tone or r["group"].startswith(tone)]
    return _j({"n": len(cats), "categories": cats,
               "cilin_note": rb.get("cilin_note", "")})


# ── 词谱（龙榆生《唐宋词格律》） ──────────────────────────────

def list_cipai(query: str = "") -> str:
    """检索龙榆生《唐宋词格律》153 调词牌（含别名）。

    Args:
        query: 词牌名关键词，如「浣溪」「念奴娇」；空则列全部。
    """
    fq = corpus.fold(query.strip())
    out = []
    for c in corpus.load("cipu.json"):
        if (not fq or fq in corpus.fold(c["cipai"])
                or any(fq in corpus.fold(a) for a in c.get("aliases", []))):
            out.append({"cipai": c["cipai"], "aliases": c.get("aliases", []),
                        "category": c.get("category", ""),
                        "n_forms": len(c.get("forms", []))})
    return _j({"n": len(out), "cipai": out})


def cipai_pattern(cipai: str, form_index: int = 0) -> str:
    """取某词牌某体之谱面（○平 ●仄 ⊙可平可仄 △平韵 ▲仄韵）与字数。

    Args:
        cipai: 词牌名或别名，如「浣溪沙」「卜算子」。
        form_index: 体式序号，0 起（一调多体时可换）。
    """
    c = corpus.find_cipai(cipai)
    if not c:
        return _j({"error": f"龙谱未收「{cipai}」；可用 list_cipai 检索。"})
    forms = c.get("forms", [])
    if not (0 <= form_index < len(forms)):
        return _j({"error": f"「{c['cipai']}」共 {len(forms)} 体。",
                   "forms": [f.get("label", f"格{i+1}") for i, f in enumerate(forms)]})
    f = forms[form_index]
    slots = prosody.slots_of(prosody.parse_pu(f.get("pattern", "")))
    return _j({
        "cipai": c["cipai"], "aliases": c.get("aliases", []),
        "category": c.get("category", ""), "intro": c.get("intro", ""),
        "form": f.get("label", f"格{form_index+1}"),
        "all_forms": [x.get("label", f"格{i+1}") for i, x in enumerate(forms)],
        "pattern": f.get("pattern", ""), "n_chars": len(slots),
        "n_rhyme_slots": sum(1 for s in slots if s["k"] == "rhyme"),
        "legend": c.get("legend", ""), "source": c.get("source", ""),
    })


# ── 校验（创作实验室） ────────────────────────────────────────

def check_jinti(text: str) -> str:
    """近体诗校验：四起式比对、粘对、拗救、三平/三仄尾、韵脚归部、撞句与名句核验。

    Args:
        text: 诗稿，每行一句（标点可有可无），如四句七言或八句五言。
    """
    return _j(prosody.check_jinti(text))


def check_ci(cipai: str, text: str, form_index: int = 0) -> str:
    """依龙谱填词校验：逐字对谱位判平仄与韵位，检韵部一致性与撞句。

    Args:
        cipai: 词牌名，如「水调歌头」。
        text: 词稿（换行与标点可有可无，按谱位顺序逐字比对）。
        form_index: 体式序号，0 起。
    """
    return _j(prosody.check_ci(cipai, text, form_index))


def suggest_slot(cipai: str, slot_ordinal: int, form_index: int = 0,
                 filled_text: str = "") -> str:
    """谱位择字提示：韵位按已押韵部给同韵常用字，平仄位按语料常用度给候选字。

    Args:
        cipai: 词牌名。
        slot_ordinal: 谱位序号（第几字，1 起）。
        form_index: 体式序号，0 起。
        filled_text: 已填词句（用于从已押韵位推定韵部）；可为空。
    """
    return _j(prosody.suggest_slot(cipai, form_index, slot_ordinal, filled_text))


def famous_line_check(line: str) -> str:
    """查一句是否与古人撞句/为历代名句：先比名句谱（跨代化用统计），再扫全文语料。

    Args:
        line: 一句诗文，至少 4 字，如「人生若只如初见」。
    """
    fl = corpus.fold(corpus.cjk_only(line))
    if len(fl) < 4:
        return _j({"error": "至少给出 4 个汉字。"})
    famous = None
    for r in corpus.load("famous.json"):
        if r["span"] in fl or fl in r["span"]:
            famous = {"span": r["span"], "n_poems": r["n_poems"],
                      "n_dynasties": r["n_dyn"], "dynasties": r.get("dynasties", []),
                      "earliest": r["src"],
                      "used_by": [{"id": p[0], "title": p[1], "author": p[2],
                                   "dynasty": p[3]} for p in r.get("poems", [])[:10]]}
            break
    hits = corpus.scan_full_text(lambda t, r: fl in t, limit=10)
    return _j({"line": line, "famous": famous,
               "corpus_hits": [_row(r) for r in hits],
               "verdict": ("名句（历代多家化用）" if famous
                           else "语料中实有此句" if hits else "未与语料撞句")})


# ── 意象·题材·作者 ────────────────────────────────────────────

def imagery_profile(name: str) -> str:
    """一个意象的完整档案：表层词形、情感关联（带例证）、共现、朝代分布、四时偏好、搭配流变。

    Args:
        name: 意象名，如「月」「杜鹃」「剑」。
    """
    nm = corpus.fold(name.strip())
    out: dict = {"imagery": nm}
    prof = next((p for p in corpus.load("imagery_profiles.json")
                 if p["imagery"] == nm), None)
    if prof:
        out["archive"] = {
            "surface_forms": prof["surface_forms"], "n_poems": prof["n_poems"],
            "dynasty_distribution": prof["dynasty_distribution"],
            "emotions": [{"emotion": e["emotion"], "support": e["support"],
                          "example": e.get("example")}
                         for e in prof.get("emotion_associations", [])],
            "co_imagery": prof.get("co_imagery", [])[:10],
        }
    wide = next((it for it in corpus.load("imagery_wide.json")["items"]
                 if it["name"] == nm), None)
    if wide:
        out["wide_layer"] = {"surfaces": wide["surfaces"], "n_poems": wide["n"],
                             "category": wide.get("cat")}
    sd = corpus.load("season.json")
    if any(nm in sd["img"][s] for s in sd["seasons"]):
        rates = {s: round((sd["img"][s].get(nm, 0)) / max(1, sd["n"][s]) * 100, 2)
                 for s in sd["seasons"]}
        out["season_rates_pct"] = rates
    pf = corpus.load("pair_flow.json")
    pairs = [p for p in pf["pairs"] if nm in p["pair"].split("|")]
    out["top_pairs"] = [{"pair": p["pair"], "n": p["n"], "peak_era": p["peak"],
                         "first_era": p["first_era"]}
                        for p in sorted(pairs, key=lambda x: -x["n"])[:10]]
    if not (prof or wide):
        return _j({"error": f"「{name}」不在意象档案（50 目）亦不在广谱意象（207 目）；"
                            "可用 search_full_text 直接检字句。"})
    out["note"] = ("档案层为严格例证口径，广谱层为 715 表层词形匹配口径，"
                   "两层计数不同源属设计使然。")
    return _j(out)


def works_by_tag(tag_type: str, name: str, dynasty: str = "",
                 limit: int = 20) -> str:
    """按标签取作品：意象/广谱意象/情感/题材/题材标志词/主韵部/季节 → 命中篇目。

    Args:
        tag_type: 标签类型，取 imagery|wide|emotion|theme|term|yun|season 之一。
        name: 标签名，如 imagery=「杜鹃」、emotion=「思念怀想」、yun=「支」、season=「秋」、term=「兴亡」。
        dynasty: 朝代筛选（如「唐」「清」「明清补遗」按典籍名匹配时用 book 字段）；空为不限。
        limit: 最多返回条数（默认 20，上限 100）。
    """
    nm = corpus.fold(name.strip())
    limit = max(1, min(int(limit), 100))
    if tag_type in ("imagery", "wide", "emotion", "theme"):
        idx = corpus.load("tag_index.json").get(tag_type, {})
        rows_i = idx.get(nm) or idx.get(name.strip())
    elif tag_type == "term":
        rows_i = corpus.load("theme_terms.json").get(nm)
    elif tag_type == "yun":
        rows_i = corpus.load("yun_index.json").get(nm.rstrip("韵"))
    elif tag_type == "season":
        rows_i = corpus.load("season_index.json").get(nm)
    else:
        return _j({"error": "tag_type 须为 imagery|wide|emotion|theme|term|yun|season。"})
    if not rows_i:
        return _j({"error": f"{tag_type} 无「{name}」或无命中。"})
    rows = corpus.catalog()
    out = []
    for i in rows_i:
        r = rows[i]
        if dynasty and dynasty != r[3] and dynasty != r[4]:
            continue
        out.append(_row(r))
        if len(out) >= limit:
            break
    total = (len(rows_i) if not dynasty
             else sum(1 for i in rows_i if dynasty in (rows[i][3], rows[i][4])))
    return _j({"tag": f"{tag_type}:{name}", "dynasty": dynasty or "不限",
               "n_total": total, "works": out})


def co_occurrence(first: str, second: str, dynasty: str = "",
                  limit: int = 20) -> str:
    """两个意象的共现作品（同篇并见），并附该搭配之时代流变与首用者（如有）。

    Args:
        first: 意象一，如「剑」。
        second: 意象二，如「酒」。
        dynasty: 朝代筛选；空为不限。
        limit: 最多返回条数（默认 20，上限 100）。
    """
    idx = corpus.load("tag_index.json")
    limit = max(1, min(int(limit), 100))

    def rows_of(nm):
        # 与 App 共现口径一致：广谱层（715 表层词形）优先，档案层兜底
        nm = corpus.fold(nm.strip())
        return set(idx["wide"].get(nm, []) or idx["imagery"].get(nm, []))

    a, b = rows_of(first), rows_of(second)
    if not a or not b:
        missing = first if not a else second
        return _j({"error": f"「{missing}」不在意象/广谱意象索引中。"})
    both = sorted(a & b)
    rows = corpus.catalog()
    out = []
    for i in both:
        r = rows[i]
        if dynasty and dynasty != r[3] and dynasty != r[4]:
            continue
        out.append(_row(r))
        if len(out) >= limit:
            break
    pf = corpus.load("pair_flow.json")
    key = {corpus.fold(first.strip()), corpus.fold(second.strip())}
    flow = next((p for p in pf["pairs"] if set(p["pair"].split("|")) == key), None)
    return _j({
        "pair": f"{first}·{second}", "n_total": len(both), "works": out,
        "layer": "广谱层（715 表层词形口径，与 App 共现页同源）",
        "flow": ({"per_10k_rate_by_era": flow["rates"], "peak_era": flow["peak"],
                  "first_era": flow["first_era"],
                  "first_who": flow.get("first_who", [])[:5]} if flow else None),
    })


def author_fingerprint(name: str) -> str:
    """诗人风格指纹：常用意象、体裁、韵部偏好、用韵与同代人之偏离度等。

    Args:
        name: 作者名，如「李白」「纳兰性德」；繁简皆可。
    """
    fn = corpus.fold(name.strip())
    fp = next((f for f in corpus.load("fingerprints.json")
               if corpus.fold(f["author"]) == fn), None)
    if not fp:
        return _j({"error": f"指纹库未收「{name}」（须有一定篇数方成指纹）。"})
    keep = {k: v for k, v in fp.items() if k != "radar"}
    return _j(keep)


def allusion_lookup(term: str = "") -> str:
    """查典故：典面 → 出处与寓意（人工复核层，28 目）；空参数列全部典目。

    Args:
        term: 典面词，如「阳关」「折柳」；空则列目录。
    """
    data = corpus.load("allusions.json")
    if not term.strip():
        return _j({"allusions": [{"name": a["name"], "implies": a["implies"]}
                                 for a in data]})
    tm = corpus.fold(term.strip())
    a = next((x for x in data
              if corpus.fold(x["name"]) == tm
              or any(corpus.fold(s) == tm for s in x.get("surfaces", []))), None)
    if not a:
        return _j({"error": f"典故表未收「{term}」（本表仅 28 目人工复核层）。"})
    rows = corpus.catalog()
    return _j({"name": a["name"], "source": a["source"], "implies": a["implies"],
               "ambiguity": a.get("ambiguity", ""), "n_hits": a.get("n_hits", 0),
               "examples": [_row(rows[i]) for i in a.get("hits", [])[:8]]})


# ── 技艺（skills）──────────────────────────────────────────────

def load_skill(name: str = "") -> str:
    """载入一门技艺（领域工作流程指南）；空参数列出全部技艺。

    Args:
        name: 技艺名（load_skill() 所列 name 字段）；空则列目录。
    """
    files = sorted(SKILL_DIR.glob("*.md"))
    if not name.strip():
        out = []
        for f in files:
            first = f.read_text(encoding="utf-8").strip().splitlines()[0]
            out.append({"name": f.stem, "summary": first.lstrip("# ").strip()})
        return _j({"skills": out, "hint": "以 load_skill(name) 取全文，照其流程行事。"})
    p = SKILL_DIR / f"{name.strip()}.md"
    if not p.is_file() or p.parent != SKILL_DIR:
        return _j({"error": f"无此技艺：{name}",
                   "available": [f.stem for f in files]})
    return p.read_text(encoding="utf-8")


ALL_TOOLS = [
    search_works, search_full_text, get_work,
    char_rhyme, rhyme_group,
    list_cipai, cipai_pattern,
    check_jinti, check_ci, suggest_slot, famous_line_check,
    imagery_profile, works_by_tag, co_occurrence,
    author_fingerprint, allusion_lookup,
    load_skill,
]

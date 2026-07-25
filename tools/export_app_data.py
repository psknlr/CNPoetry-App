#!/usr/bin/env python3
"""导出「墨一」App 静态数据。

从 CNPoetry-Hermes 流水线产物（data/poetry/**）导出 WebView 前端可直接
fetch 的 JSON：意象档案（含全量例证）、诗词分片、检索目录、诗人档案、
词牌、题材、意象网络与统计。

用法：
    python3 tools/export_app_data.py --hermes <CNPoetry-Hermes 根目录> \
        --out moyi/app/src/main/assets/www/data
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import OrderedDict
from pathlib import Path

N_SHARDS = 48

# 朝代时序（第二项为 1 表示跨代过渡期，前端另作样式，避免与主朝代平级）
DYN_SEQ = [
    ("先秦", 0), ("秦", 0), ("汉", 0), ("汉魏", 0), ("魏晋", 0),
    ("南北朝", 0), ("隋", 0), ("隋末唐初", 1), ("唐", 0), ("唐末宋初", 1),
    ("五代", 0), ("宋", 0), ("宋末金初", 1), ("金", 0), ("金末元初", 1),
    ("宋末元初", 1), ("元", 0), ("元末明初", 1), ("明", 0), ("明末清初", 1),
    ("清", 0), ("清末民国初", 1), ("清末近现代初", 1), ("近现代", 0), ("未知", 0),
]
ORDER = {name: i for i, (name, _) in enumerate(DYN_SEQ)}
TRANS = {name for name, t in DYN_SEQ if t}


def read_jsonl(path: Path):
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                yield json.loads(line)


def dump(path: Path, obj) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def shard_of(poem_id: str) -> int:
    h = 0
    for ch in poem_id:
        h = (h * 31 + ord(ch)) & 0x7FFFFFFF
    return h % N_SHARDS


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hermes", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    hermes = Path(args.hermes).resolve()
    out = Path(args.out).resolve()
    poetry = hermes / "data" / "poetry"
    if not (poetry / "poems" / "poems.jsonl").exists():
        print("找不到 poems.jsonl，请先运行: python3 -m hermes_poetry pipeline", file=sys.stderr)
        return 1

    sys.path.insert(0, str(hermes))
    from hermes_poetry.textutil import t2s  # noqa: E402

    total = 0

    # ── 明清补遗（网络汇编层，独立标注证据级别）──────────────────
    RE_CJK_ONLY = __import__("re").compile(r"[㐀-鿿豈-﫿]")
    mq_file = hermes / "data" / "raw" / "mingqing" / "mingqing.json"
    extra_poems = []
    if mq_file.exists():
        mq = json.loads(mq_file.read_text(encoding="utf-8"))
        for i, r in enumerate(mq.get("poems") or []):
            lines = r.get("paragraphs") or []
            text = "".join(lines)
            n = len(RE_CJK_ONLY.findall(text))
            lens = {len(RE_CJK_ONLY.findall(ln)) for ln in lines}
            uniform = len(lens) == 1
            cn = next(iter(lens)) if uniform else 0
            genre = ("五绝" if uniform and cn == 5 and len(lines) == 4
                     else "七绝" if uniform and cn == 7 and len(lines) == 4
                     else "五律" if uniform and cn == 5 and len(lines) == 8
                     else "七律" if uniform and cn == 7 and len(lines) == 8
                     else f"{cn}言齐言" if uniform and cn in (4, 5, 6, 7)
                     else "杂言")
            extra_poems.append({
                "poem_id": f"MQ_{i:06d}", "title": r.get("title", ""),
                "author": r.get("author", ""), "dynasty": r.get("dynasty", ""),
                "book": "明清补遗", "genre": genre, "lines": lines,
                "cipai": "", "section": "", "notes": [], "appreciation": "",
                "imagery": [], "emotions": [], "themes": [],
                "metrics": {"form_metric": genre},
                "layer": "网络汇编（待校）"})
        print(f"明清补遗 {len(extra_poems)} 首（{mq.get('evidence_level', '')}）")
        total += dump(out / "mingqing_meta.json",
                      {k: mq.get(k) for k in
                       ("source_repo", "license", "evidence_level", "note")})

    # ── 诗词分片 + 检索目录 ────────────────────────────────────────
    shards = [[] for _ in range(N_SHARDS)]
    catalog = []
    by_id = {}
    shards_flat = []      # 按目录顺序的全部作品（建倒排索引用）
    row_of = {}           # poem_id → 目录行号
    for p in list(read_jsonl(poetry / "poems" / "poems.jsonl")) + extra_poems:
        rec = OrderedDict()
        rec["id"] = p["poem_id"]
        rec["t"] = p.get("title", "")
        rec["a"] = p.get("author", "")
        rec["d"] = p.get("dynasty", "")
        rec["b"] = p.get("book", "")
        if p.get("cipai"):
            rec["c"] = p["cipai"]
        if p.get("section"):
            rec["sec"] = p["section"]
        rec["g"] = p.get("genre", "")
        rec["l"] = p.get("lines", [])
        for key, src in (("notes", "notes"), ("appr", "appreciation")):
            v = p.get(src)
            if v:
                rec[key] = v if isinstance(v, list) else [v]
        if p.get("imagery"):
            rec["img"] = p["imagery"]
        if p.get("emotions"):
            rec["emo"] = p["emotions"]
        if p.get("themes"):
            rec["thm"] = p["themes"]
        met = p.get("metrics") or {}
        if met.get("form_metric") or met.get("rhyme_feet"):
            rec["m"] = {k: v for k, v in
                        (("fm", met.get("form_metric")), ("rf", met.get("rhyme_feet")))
                        if v}
        shards[shard_of(rec["id"])].append(rec)
        by_id[rec["id"]] = rec
        shards_flat.append(rec)
        row_of[rec["id"]] = len(catalog)
        # 目录行：id|题|作者|朝代|集|体裁|词牌|检索文本(简体折叠)
        folded = t2s("".join(p.get("lines", [])))
        catalog.append([rec["id"], rec["t"], rec["a"], rec["d"], rec["b"],
                        rec["g"], p.get("cipai", ""), folded])

    for i, shard in enumerate(shards):
        total += dump(out / "poems" / f"shard_{i:02d}.json", shard)

    # 目录拆两层：轻元数据（常驻）+ 全文折叠索引分片（仅全文检索时载入）。
    # 13 万首的单体目录逾 30 MB，手机上一次性解析会明显卡顿。
    N_CTEXT = 16
    total += dump(out / "catalog.json", [r[:7] for r in catalog])
    ct_shards = [[] for _ in range(N_CTEXT)]
    for i, r in enumerate(catalog):
        ct_shards[i % N_CTEXT].append([i, r[7]])
    for i, sh in enumerate(ct_shards):
        total += dump(out / "ctext" / f"ct_{i:02d}.json", sh)
    print(f"诗词 {len(catalog)} 首 → {N_SHARDS} 分片 + 目录 + {N_CTEXT} 全文索引片")

    # ── 意象档案 + 全量例证 ────────────────────────────────────────
    profiles = list(read_jsonl(poetry / "rules_imagery" / "imagery_profiles.jsonl"))
    profiles.sort(key=lambda r: -(r.get("n_poems") or 0))
    slim_profiles = []
    # 注意：AAPT 不接受非 ASCII 的 asset 文件名，例证文件按序号命名，
    # 档案记录里以 ex 字段指向自己的例证文件。
    for idx, prof in enumerate(profiles):
        name = prof["imagery"]
        surfaces = sorted({t2s(s) for s in (prof.get("surface_forms") or [name])},
                          key=len, reverse=True)
        seen, pids = set(), []
        for rid in prof.get("supporting_initial_rules") or []:
            stem = rid.replace("IR_", "", 1).rsplit("_", 1)[0]
            if stem not in seen:
                seen.add(stem)
                pids.append(stem)
        examples = []
        for pid in pids:
            p = by_id.get(pid)
            if p is None:
                continue
            quote = next((ln for ln in p["l"] if any(s in t2s(ln) for s in surfaces)), "")
            examples.append([pid, p["t"], p["a"], p["d"], quote])
        ex_name = f"ex_{idx:02d}.json"
        total += dump(out / "imagery" / ex_name,
                      {"imagery": name, "n_total": prof.get("n_poems"),
                       "n_listed": len(examples), "examples": examples})
        slim = {k: prof.get(k) for k in
                ("imagery", "surface_forms", "emotion_associations",
                 "theme_associations", "co_imagery", "n_poems",
                 "dynasty_distribution")}
        slim["n_examples"] = len(examples)
        slim["ex"] = ex_name
        slim_profiles.append(slim)
    total += dump(out / "imagery_profiles.json", slim_profiles)
    print(f"意象档案 {len(slim_profiles)} 个（含全量例证）")

    # ── 诗人档案 ──────────────────────────────────────────────────
    authors = []
    for a in read_jsonl(poetry / "rules_author" / "author_profiles.jsonl"):
        authors.append({k: a.get(k) for k in
                        ("author", "dynasty", "n_poems", "top_imagery",
                         "top_themes", "form_distribution", "bio")})
    authors.sort(key=lambda r: -(r.get("n_poems") or 0))
    total += dump(out / "authors.json", authors)
    print(f"诗人档案 {len(authors)} 位")

    # ── 词牌定格 ──────────────────────────────────────────────────
    cipai = []
    for c in read_jsonl(poetry / "rules_cipai" / "cipai_profiles.jsonl"):
        cipai.append({k: c.get(k) for k in
                      ("cipai", "n_poems", "line_count_mode", "char_pattern",
                       "pattern_consistency", "supporting_poems")})
    cipai.sort(key=lambda r: -(r.get("n_poems") or 0))
    total += dump(out / "cipai.json", cipai)
    print(f"词牌定格 {len(cipai)} 个")

    # ── 题材 / 网络 / 统计 ────────────────────────────────────────
    themes = list(read_jsonl(poetry / "rules_theme" / "theme_profiles.jsonl"))
    total += dump(out / "themes.json", themes)

    network_dir = poetry / "network"
    network = {}
    for stem in ("imagery_network", "emotion_imagery_matrix", "dynasty_tables"):
        f = network_dir / f"{stem}.json"
        if f.exists():
            network[stem] = json.loads(f.read_text(encoding="utf-8"))
    total += dump(out / "network.json", network)

    # ── 广韵字音（平仄三值 + 读音候选，简繁双键）────────────────
    from hermes_poetry.extract.phonology import Phonology
    ph = Phonology()
    gy = {}
    for ch, rs in ph.readings.items():
        tones = {r["tone"] for r in rs}
        t = "两" if ("平" in tones and (tones - {"平"})) else ("平" if "平" in tones else "仄")
        gy[ch] = [t, [[r["yun"], r["tone"], r["fanqie"]] for r in rs[:4]]]
    total += dump(out / "guangyun.json", gy)
    print(f"广韵字音 {len(gy)} 键（含简繁双索引）")

    # ── 说文解字训诂（简繁双键；繁体原键优先）───────────────────
    shuowen = hermes / "data" / "raw" / "gujilab" / "shuowen.jsonl"
    gloss = {}
    if shuowen.exists():
        for r in read_jsonl(shuowen):
            entry = [r.get("radical", ""), r.get("pinyin", ""),
                     r.get("fanqie", ""), r.get("gloss", "")]
            ch = r.get("char", "")
            if not ch:
                continue
            gloss.setdefault(ch, entry)
            folded = t2s(ch)
            if folded != ch:
                gloss.setdefault(folded, entry)
        total += dump(out / "gloss.json", gloss)
    print(f"说文训诂 {len(gloss)} 键")

    # ── 韵伴聚类（语料归纳，非韵书权威）─────────────────────────
    rhyme_file = poetry / "rules_rhyme" / "rhyme_partners.jsonl"
    rhyme_groups = []
    if rhyme_file.exists():
        for g in read_jsonl(rhyme_file):
            rhyme_groups.append({
                "label": g.get("label", ""),
                "members": g.get("members") or [],
                "supporting_poems": (g.get("supporting_poems") or [])[:60],
                "n_poems": len(g.get("supporting_poems") or [])})
        rhyme_groups.sort(key=lambda r: -len(r["members"]))
        total += dump(out / "rhyme_groups.json", rhyme_groups)
    print(f"韵伴聚类 {len(rhyme_groups)} 组")

    # ── 互文索引（按诗分片，双向）────────────────────────────────
    itx_file = poetry / "rules_intertext" / "intertext_rules.jsonl"
    if itx_file.exists():
        itx_map: dict = {}
        for r in read_jsonl(itx_file):
            a, b = r.get("source_poem_id"), r.get("target_poem_id")
            span, mode = r.get("shared_span", ""), r.get("mode", "")
            if not a or not b:
                continue
            itx_map.setdefault(a, []).append([b, span, mode])
            itx_map.setdefault(b, []).append([a, span, mode])
        itx_shards = [dict() for _ in range(N_SHARDS)]
        for pid, links in itx_map.items():
            links.sort(key=lambda x: -len(x[1]))
            itx_shards[shard_of(pid)][pid] = links[:12]
        for i, sh in enumerate(itx_shards):
            total += dump(out / "intertext" / f"itx_{i:02d}.json", sh)
        print(f"互文索引 {len(itx_map)} 篇 → {N_SHARDS} 分片")

    # ── 龙榆生《唐宋词格律》词谱（权威层，153 调）────────────────
    cipu_file = hermes / "data" / "raw" / "longyusheng" / "cipu.jsonl"
    if cipu_file.exists():
        cipu_all = list(read_jsonl(cipu_file))
        total += dump(out / "cipu.json", cipu_all)
        print(f"龙谱词谱 {len(cipu_all)} 调")

    # ── 韵书（平水韵 106 部 / 词林正韵 19 部，常用字按语料频次）──
    from hermes_poetry.extract.phonology import (
        GY_TO_PINGSHUI, _CILIN, CILIN_NOTE)
    freq: dict = {}
    for row in catalog:
        for ch2 in row[7]:
            freq[ch2] = freq.get(ch2, 0) + 1
    ps_chars: dict = {}
    ps_tone: dict = {}
    for ch2, (t2, readings) in gy.items():
        folded_ch = t2s(ch2)
        if freq.get(folded_ch, 0) < 1:
            continue
        for yun, tone, _fq in readings:
            ps = GY_TO_PINGSHUI.get(yun)
            if not ps:
                continue
            ps_tone.setdefault(ps, tone)
            ps_chars.setdefault(ps, set()).add(folded_ch)
    SHANGPING = set("东冬江支微鱼虞齐佳灰真文元寒删")
    pingshui = []
    for ps, chars in ps_chars.items():
        tone = ps_tone.get(ps, "")
        group = ("上平" if ps in SHANGPING else "下平") if tone == "平" else tone
        ordered = sorted(chars, key=lambda c: -freq.get(c, 0))[:120]
        pingshui.append({"yun": ps, "tone": tone, "group": group,
                         "chars": "".join(ordered)})
    tone_order = {"平": 0, "上": 1, "去": 2, "入": 3}
    pingshui.sort(key=lambda r: (tone_order.get(r["tone"], 9), r["yun"]))
    total += dump(out / "rhymebook.json", {
        "gy2ps": GY_TO_PINGSHUI,
        "pingshui": pingshui,
        "cilin": {bu: list(pss) for bu, pss in _CILIN.items()},
        "cilin_note": CILIN_NOTE,
        "note": "平水韵由《广韵》206 韵规范合并推导；各韵常用字按本馆语料频次排序，"
                "多音字可入多韵（与「两读」同一诚实口径）。"})
    print(f"韵书：平水 {len(pingshui)} 韵 · 词林 {len(_CILIN)} 部")

    # ── 文苑：古文观止（含辞赋名篇；散文不入格律计量层）─────────
    extra = hermes / "data" / "raw" / "extra"
    gwgz_file = extra / "guwenguanzhi.json"
    if gwgz_file.exists():
        gw = json.loads(gwgz_file.read_text(encoding="utf-8"))
        prose, pid = [], 0
        for juan in gw.get("content") or []:
            jt = juan.get("title", "")
            era = jt.split("・")[-1] if "・" in jt else ""
            for art in juan.get("content") or []:
                pid += 1
                author_raw = (art.get("author") or "").strip()
                dyn, name = "", author_raw
                if "：" in author_raw:
                    dyn, name = [s.strip() for s in author_raw.split("：", 1)]
                title = art.get("chapter", "")
                genre = ("赋" if ("賦" in title or "赋" in title)
                         else "序" if title.endswith(("序",))
                         else "记" if title.endswith(("記", "记"))
                         else "论" if title.endswith(("論", "论"))
                         else "书" if title.endswith(("書", "书"))
                         else "文")
                prose.append({
                    "id": f"GWGZ_{pid:03d}", "t": title, "a": name, "d": dyn,
                    "juan": jt, "era": era, "g": genre,
                    "src": art.get("source", ""),
                    "p": art.get("paragraphs") or []})
        total += dump(out / "prose.json", prose)
        n_fu = sum(1 for r in prose if r["g"] == "赋")
        print(f"文苑（古文观止）{len(prose)} 篇 · 赋 {n_fu} 篇")

    # ── 辞赋：御定历代赋汇（清·陈元龙编，四库本；含卷次页码证据）──
    fh_file = hermes / "data" / "raw" / "fuhui" / "fuhui.json"
    if fh_file.exists():
        fh = json.loads(fh_file.read_text(encoding="utf-8"))
        fu = []
        for i, r in enumerate(fh):
            fu.append({"id": f"FU_{i:04d}", "t": r.get("title", ""),
                       "a": r.get("author", ""), "d": r.get("dynasty", ""),
                       "juan": r.get("juan", ""), "page": r.get("page", ""),
                       "p": r.get("paragraphs") or []})
        # 按朝代分片懒加载（全量 200 万字，避免一次载入）
        FU_SHARDS = 8
        fu_shards = [[] for _ in range(FU_SHARDS)]
        for r in fu:
            fu_shards[int(r["id"][3:]) % FU_SHARDS].append(r)
        for i, sh in enumerate(fu_shards):
            total += dump(out / "fu" / f"fu_{i}.json", sh)
        total += dump(out / "fu_index.json", {
            "n": len(fu), "n_shards": FU_SHARDS,
            "items": [[r["id"], r["t"], r["a"], r["d"], r["juan"]] for r in fu],
            "source": "御定历代赋汇（清·陈元龙编，文渊阁四库全书本）",
            "provider": "Kanripo KR4h0139（按卷繁体，保留四库页码）",
            "note": "原典 1706 年成书，正文属公有领域；卷次与页码随篇保留，可回四库本核校。"})
        print(f"辞赋（历代赋汇）{len(fu)} 篇 → {FU_SHARDS} 分片")

    # ── 对课：声律启蒙（按平水三十平韵分编）──────────────────────
    slqm_file = extra / "shenglvqimeng.json"
    if slqm_file.exists():
        sl = json.loads(slqm_file.read_text(encoding="utf-8"))
        duike = []
        for vol in sl.get("content") or []:
            for ch in vol.get("content") or []:
                chap = ch.get("chapter", "")
                yun = t2s(chap.split()[-1]) if chap else ""
                duike.append({"vol": vol.get("title", ""), "chapter": chap,
                              "yun": yun, "paras": ch.get("paragraphs") or []})
        total += dump(out / "duike.json", {
            "title": sl.get("title", "声律启蒙"), "author": sl.get("author", ""),
            "abstract": sl.get("abstract", ""), "chapters": duike})
        print(f"对课（声律启蒙）{len(duike)} 韵")

    # ── 名句谱：被后世跨代化用的语段（实证度量，非主观选录）──────
    # 领域要点：元杂剧的科介宾白（「张千云理会的」等）在集内高频重复，
    # 但不跨代流传；以「涉及≥2 个朝代」为闸门可自然滤除，留下真正被
    # 后世反复化用的句子。
    if itx_file.exists():
        from collections import defaultdict as _dd
        span_poems: dict = _dd(set)
        span_cnt: dict = {}
        for r in read_jsonl(itx_file):
            s = r.get("shared_span", "")
            if len(s) < 5:
                continue
            span_cnt[s] = span_cnt.get(s, 0) + 1
            for pid in (r.get("source_poem_id"), r.get("target_poem_id")):
                if pid in by_id:
                    span_poems[s].add(pid)
        famous = []
        for s, pids in span_poems.items():
            dyns = {by_id[p]["d"] for p in pids}
            if len(dyns) < 2:
                continue
            # 最早出处：按朝代时序取首篇
            ordered = sorted(pids, key=lambda p: ORDER.get(by_id[p]["d"], 990))
            src = by_id[ordered[0]]
            famous.append({
                "span": s, "n_poems": len(pids), "n_dyn": len(dyns),
                "dynasties": sorted(dyns, key=lambda d: ORDER.get(d, 990)),
                "cites": span_cnt.get(s, 0),
                "src": [src["id"], src["t"], src["a"], src["d"]],
                "poems": [[by_id[p]["id"], by_id[p]["t"], by_id[p]["a"], by_id[p]["d"]]
                          for p in ordered[:20]]})
        famous.sort(key=lambda r: (-r["n_dyn"], -r["n_poems"], -len(r["span"])))
        total += dump(out / "famous.json", famous)
        print(f"名句谱 {len(famous)} 条（跨代化用实证）")

    # ── 典故：种子表（含出处、寓意与歧义辨析）+ 语料命中索引 ──────
    allu_file = hermes / "data" / "raw" / "allusions" / "allusion_seeds.jsonl"
    if allu_file.exists():
        seeds = [r for r in read_jsonl(allu_file) if r.get("id")]
        allusions = []
        for a in seeds:
            surfaces = [t2s(s) for s in (a.get("surfaces") or [a.get("name", "")])]
            hits = []
            for i, row in enumerate(catalog):
                if any(s in row[7] for s in surfaces):
                    hits.append(i)
                if len(hits) >= 200:
                    break
            allusions.append({
                "id": a["id"], "name": a.get("name", ""), "surfaces": a.get("surfaces") or [],
                "source": a.get("source", ""), "implies": a.get("implies", ""),
                "status": a.get("status", ""), "ambiguity": a.get("ambiguity_note", ""),
                "n_hits": len(hits), "hits": hits})
        allusions.sort(key=lambda r: -r["n_hits"])
        total += dump(out / "allusions.json", allusions)
        print(f"典故 {len(allusions)} 则（表面命中 "
              f"{sum(r['n_hits'] for r in allusions)} 处，候选待辨）")

    # ── 标签倒排索引：意象/情感/题材 → 目录行号（供交叉检索秒查）──
    tag_index: dict = {"imagery": {}, "emotion": {}, "theme": {}}
    for i, p in enumerate(shards_flat):
        for key, field in (("imagery", "img"), ("emotion", "emo"), ("theme", "thm")):
            for v in (p.get(field) or []):
                tag_index[key].setdefault(v, []).append(row_of[p["id"]])
    for key in tag_index:
        for v in tag_index[key]:
            tag_index[key][v].sort()
    total += dump(out / "tag_index.json", tag_index)
    print(f"标签倒排：意象 {len(tag_index['imagery'])} · "
          f"情感 {len(tag_index['emotion'])} · 题材 {len(tag_index['theme'])}")

    # ── 题材：标志词汇 → 命中作品索引（供点词查作品）─────────────
    theme_hits = {}
    for t in themes:
        for w in (t.get("marker_terms") or []):
            wf = t2s(w)
            if wf in theme_hits:
                continue
            rows_hit = []
            for i, row in enumerate(catalog):
                if wf in row[7]:
                    rows_hit.append(i)
                if len(rows_hit) >= 300:
                    break
            theme_hits[wf] = rows_hit
    total += dump(out / "theme_terms.json", theme_hits)
    print(f"题材标志词索引 {len(theme_hits)} 词")

    # ── 简繁折叠表（前端检索归一用）──────────────────────────────
    from hermes_poetry.textutil import _t2s_table, _VARIANT_MAP
    fold = {chr(k): v for k, v in _t2s_table().items()}
    fold.update({chr(k): v for k, v in _VARIANT_MAP.items()})
    total += dump(out / "t2s.json", fold)
    print(f"简繁折叠表 {len(fold)} 字")

    # ── 分层书架：朝代（按时序，跨代过渡期附于前朝之后）→ 集部 ──
    # 「元末明初」「明末清初」这类跨代标签依作者活动年代排在两朝之间，
    # 并标记 transitional，前端另作样式，避免与主朝代平级造成范围重叠观感。
    shelf: dict = {}
    for row in catalog:
        d, b, g, a, t = row[3], row[4], row[5], row[2], row[1]
        e = shelf.setdefault(d, {}).setdefault(b, {"n": 0, "genres": {}, "subs": set()})
        e["n"] += 1
        e["genres"][g] = e["genres"].get(g, 0) + 1
        # 子目：元曲取剧目名（「剧目・曲牌」），其余取作者
        sub = t.split("・")[0] if ("・" in t and b == "元曲") else a
        if sub:
            e["subs"].add(sub)
    shelves = []
    for d in sorted(shelf, key=lambda x: (ORDER.get(x, 990), x)):
        books = [{"book": b, "n": v["n"], "n_subs": len(v["subs"]),
                  "genres": sorted(v["genres"].items(), key=lambda x: -x[1])[:4]}
                 for b, v in sorted(shelf[d].items(), key=lambda x: -x[1]["n"])]
        shelves.append({"era": d, "n": sum(b["n"] for b in books),
                        "transitional": d in TRANS, "books": books})
    total += dump(out / "shelves.json", shelves)
    print(f"分层书架 {len(shelves)} 朝代（含 {sum(1 for s in shelves if s['transitional'])} 跨代）· "
          f"{sum(len(s['books']) for s in shelves)} 集部")

    dyn_count, book_count = {}, {}
    for row in catalog:
        dyn_count[row[3]] = dyn_count.get(row[3], 0) + 1
        book_count[row[4]] = book_count.get(row[4], 0) + 1
    total += dump(out / "stats.json", {
        "poems": len(catalog), "imagery": len(slim_profiles),
        "authors": len(authors), "cipai": len(cipai), "themes": len(themes),
        "dynasties": dyn_count, "books": book_count, "n_shards": N_SHARDS})

    print(f"合计 {total / 1e6:.1f} MB → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

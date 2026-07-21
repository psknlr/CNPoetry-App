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

    # ── 诗词分片 + 检索目录 ────────────────────────────────────────
    shards = [[] for _ in range(N_SHARDS)]
    catalog = []
    by_id = {}
    for p in read_jsonl(poetry / "poems" / "poems.jsonl"):
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
        # 目录行：id|题|作者|朝代|集|体裁|词牌|检索文本(简体折叠)
        folded = t2s("".join(p.get("lines", [])))
        catalog.append([rec["id"], rec["t"], rec["a"], rec["d"], rec["b"],
                        rec["g"], p.get("cipai", ""), folded])

    for i, shard in enumerate(shards):
        total += dump(out / "poems" / f"shard_{i:02d}.json", shard)
    total += dump(out / "catalog.json", catalog)
    print(f"诗词 {len(catalog)} 首 → {N_SHARDS} 分片 + catalog")

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

    # ── 简繁折叠表（前端检索归一用）──────────────────────────────
    from hermes_poetry.textutil import _t2s_table, _VARIANT_MAP
    fold = {chr(k): v for k, v in _t2s_table().items()}
    fold.update({chr(k): v for k, v in _VARIANT_MAP.items()})
    total += dump(out / "t2s.json", fold)
    print(f"简繁折叠表 {len(fold)} 字")

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

"""墨一格律引擎：近体四起式、粘对、拗救、依龙谱校验、撞句核验。

与 App 端 app.js 校验逻辑同一口径（王力《诗词格律》通行说）：
  · 四起式以首句第二字定平仄起，七言起式命名与五言相反；
  · 严格位为二四六与句脚（五言二四与句脚），一三五通常不论；
  · 拗救只识孤平救、特拗（四拗三救）、半拗对句救三式，其余变格不穷尽；
  · 龙谱 △▲ 为韵标，缀于韵脚字之后不占字位，并收紧该位平仄；
  · 两读（广韵「两」）与无考字一律按通配处理（诚实边界）。
"""
from __future__ import annotations

import re

from . import corpus

BASE5 = {"A": "仄仄平平仄", "B": "平平仄仄平", "C": "平平平仄仄", "D": "仄仄仄平平"}
QISHI5 = {
    "仄起不入韵": "ABCD", "仄起入韵": "DBCD",
    "平起不入韵": "CDAB", "平起入韵": "BDAB",
}
QISHI = list(QISHI5)


def tmpl_lines(qishi: str, char_n: int, n_lines: int) -> list[str]:
    """近体标准谱：五言直查，七言起式名反转并前缀反向二字。"""
    q = qishi
    if char_n == 7:
        q = q.replace("平起", "@").replace("仄起", "平起").replace("@", "仄起")
    seq = QISHI5[q] * (2 if n_lines == 8 else 1)
    out = []
    for k in seq:
        base = BASE5[k]
        if char_n == 7:
            base = ("仄仄" if base[0] == "平" else "平平") + base
        out.append(base)
    return out


def _is_p(t: str) -> bool:
    return t in ("平", "两")


def _is_z(t: str) -> bool:
    return t in ("仄", "两")


def _common_ps(chars: list[str]) -> set | None:
    """诸字平水韵候选之交集；无广韵字跳过。空列表→None。"""
    common = None
    for ch in chars:
        s = corpus.ps_set(ch)
        if not s:
            continue
        common = set(s) if common is None else common & s
    return common


def _clash_scan(lines: list[str], limit_each: int = 1) -> dict:
    """撞句核验：折叠后逐片扫描语料，各句取首个命中。"""
    needles = [
        {"i": i, "raw": l, "fl": corpus.fold(l)}
        for i, l in enumerate(lines) if len(corpus.cjk_only(l)) >= 4
    ]
    found: dict = {}
    if not needles:
        return found

    def match(text, row):
        for nd in needles:
            if nd["i"] not in found and nd["fl"] in text:
                found[nd["i"]] = row
        return False  # 只做副作用

    corpus.scan_full_text(match, limit=1)
    return found


def _famous_hits(lines: list[str]) -> list[dict]:
    out = []
    for i, l in enumerate(lines):
        fl = corpus.fold(corpus.cjk_only(l))
        for r in corpus.load("famous.json"):
            if r["span"] in fl or fl in r["span"]:
                out.append({
                    "line": i + 1, "span": r["span"], "n_poems": r["n_poems"],
                    "n_dynasties": r["n_dyn"], "earliest": r["src"],
                })
                break
    return out


# ── 近体诗校验 ────────────────────────────────────────────────

def check_jinti(text: str) -> dict:
    raw_lines = [s.strip() for s in text.splitlines() if s.strip()]
    lines = [corpus.cjk_only(l) for l in raw_lines]
    if not lines:
        return {"error": "未见诗句"}
    pats = [[corpus.tone_of(c) for c in l] for l in lines]
    lens = {len(l) for l in lines}
    char_n, n = len(lines[0]), len(lines)
    jinti = len(lens) == 1 and n in (4, 8) and char_n in (5, 7)

    # 韵脚归部（偶数句句脚；平水交集，不齐则退词林）
    even_feet = [l[-1] for i, l in enumerate(lines) if i % 2 == 1]
    common = _common_ps(even_feet)
    cilin_common = None
    for ch in even_feet:
        s = corpus.ps_set(ch)
        if not s:
            continue
        cs = corpus.cilin_of(s)
        cilin_common = cs if cilin_common is None else cilin_common & cs

    result: dict = {
        "form": (f"{'五' if char_n == 5 else '七'}言{'律' if n == 8 else '绝'}"
                 if jinti else "非四/八句五七言，未作近体比对"),
        "is_jinti_shape": jinti,
        "rhyme": {
            "feet": even_feet,
            "pingshui_common": sorted(common) if common else [],
            "cilin_common": sorted(cilin_common) if (not common and cilin_common) else [],
            "consistent": bool(common) or bool(cilin_common),
        },
    }

    fit = None
    first_rhymes = None
    if jinti:
        fset = corpus.ps_set(lines[0][-1])
        if fset and common:
            first_rhymes = bool(fset & common)
        strict = [1, 3, 5, char_n - 1] if char_n == 7 else [1, 3, char_n - 1]
        cands = []
        for q in QISHI:
            tmpl = tmpl_lines(q, char_n, n)
            dev = [
                {"line": i + 1, "pos": j + 1, "expected": tmpl[i][j], "got": p[j]}
                for i, p in enumerate(pats) for j in strict
                if p[j] in ("平", "仄") and p[j] != tmpl[i][j]
            ]
            penalty = 0
            if first_rhymes is True and "不入韵" in q:
                penalty = 2
            if first_rhymes is False and q.endswith("入韵") and "不入韵" not in q:
                penalty = 2
            cands.append({"qishi": q, "dev": dev, "score": len(dev) + penalty})
        fit = min(cands, key=lambda x: x["score"])
        result["first_line_rhymes"] = first_rhymes

    # 三平尾 / 三仄尾
    tails = []
    for i, p in enumerate(pats):
        last3 = p[-3:]
        if len(last3) == 3 and all(t == "平" for t in last3):
            tails.append({"line": i + 1, "kind": "三平尾"})
        elif len(last3) == 3 and all(t == "仄" for t in last3):
            tails.append({"line": i + 1, "kind": "三仄尾"})
    result["tail_faults"] = tails

    # 粘对（两读/无考不判）
    nian_dui = []
    if jinti:
        key = [1, 3, 5] if char_n == 7 else [1, 3]
        solid = lambda i, j: pats[i][j] in ("平", "仄")
        for c in range(0, n - 1, 2):
            for j in key:
                if solid(c, j) and solid(c + 1, j) and pats[c][j] == pats[c + 1][j]:
                    nian_dui.append({"kind": "失对", "couplet": c // 2 + 1,
                                     "line": c + 2, "pos": j + 1})
        for c in range(2, n, 2):
            for j in ([1, 3] if char_n == 7 else [1]):
                if solid(c, j) and solid(c - 1, j) and pats[c][j] != pats[c - 1][j]:
                    nian_dui.append({"kind": "失粘", "couplet": c // 2 + 1,
                                     "line": c + 1, "pos": j + 1})
    result["nian_dui_faults"] = nian_dui

    # 拗救识别（三式）
    aojiu = []
    if jinti and fit:
        core = lambda i: pats[i][2:] if char_n == 7 else pats[i]
        for i in range(n):
            c = core(i)
            if len(c) != 5:
                continue
            if _is_z(c[0]) and _is_p(c[1]) and _is_p(c[2]) and _is_z(c[3]) and _is_p(c[4]):
                aojiu.append({"line": i + 1, "kind": "孤平拗救",
                              "note": "首字用仄，第三字改平以救"})
                continue
            if _is_p(c[0]) and _is_p(c[1]) and _is_z(c[2]) and _is_p(c[3]) and _is_z(c[4]):
                aojiu.append({"line": i + 1, "kind": "特拗（四拗三救）",
                              "note": "唐宋习见变格，不作出律论"})
                continue
            if (i + 1 < n and _is_z(c[0]) and _is_z(c[1]) and _is_p(c[2])
                    and _is_z(c[3]) and _is_z(c[4])):
                nxt = core(i + 1)
                if len(nxt) == 5 and _is_p(nxt[2]):
                    aojiu.append({"line": i + 1, "kind": "半拗对句救",
                                  "note": "出句第三字拗，对句第三字改平相救"})
    result["aojiu"] = aojiu
    ao_lines = {a["line"] for a in aojiu}

    if fit:
        dev_hard = [d for d in fit["dev"] if d["line"] not in ao_lines]
        result["best_pattern"] = {
            "qishi": fit["qishi"],
            "template": tmpl_lines(fit["qishi"], char_n, n),
            "violations": dev_hard,
            "n_violations": len(dev_hard),
            "n_excused_as_aojiu": len(fit["dev"]) - len(dev_hard),
        }

    result["tone_rows"] = ["".join(p) for p in pats]

    # 撞句 + 名句
    clash = _clash_scan(lines)
    result["clashes"] = [
        {"line": i + 1, "found_in": {"id": row[0], "title": row[1],
                                     "author": row[2], "dynasty": row[3]}}
        for i, row in sorted(clash.items())
    ]
    result["famous_lines"] = _famous_hits(lines)
    result["note"] = ("依《广韵》逐字判定，两读/无考按通配；严格位二四六与句脚；"
                      "拗救仅识三式，出律计数已剔除拗救句。")
    return result


# ── 龙谱解析与依谱校验 ────────────────────────────────────────

def parse_pu(pattern: str) -> list[dict]:
    """谱面 → 谱位序列。△▲ 韵标缀于前一字位并收紧其平仄；其余标注不占位。"""
    out: list[dict] = []
    for ch in pattern or "":
        if ch in "○●⊙":
            out.append({"k": "pz", "s": ch, "want": ch})
        elif ch in "△▲":
            for x in reversed(out):
                if x["k"] == "pz":
                    x["k"] = "rhyme"
                    x["mark"] = ch
                    x["want"] = "○" if ch == "△" else "●"
                    break
        elif ch == "\n":
            out.append({"k": "br"})
        else:
            out.append({"k": "punc", "s": ch})
    return out


def slots_of(pu: list[dict]) -> list[dict]:
    return [x for x in pu if x["k"] in ("pz", "rhyme")]


def check_ci(cipai: str, text: str, form_index: int = 0) -> dict:
    c = corpus.find_cipai(cipai)
    if not c:
        return {"error": f"龙谱未收「{cipai}」；可先用 list_cipai 检索词牌名。"}
    forms = c.get("forms", [])
    if not (0 <= form_index < len(forms)):
        return {"error": f"「{c['cipai']}」共 {len(forms)} 体，form_index 越界。",
                "forms": [f.get("label", f"格{i + 1}") for i, f in enumerate(forms)]}
    pu = parse_pu(forms[form_index].get("pattern", ""))
    slots = slots_of(pu)
    chars = list(corpus.cjk_only(text))

    cells, rhyme_chars = [], []
    bad = unknown = 0
    for i, slot in enumerate(slots):
        ch = chars[i] if i < len(chars) else ""
        if not ch:
            cells.append({"i": i + 1, "state": "缺"})
            continue
        t = corpus.tone_of(ch)
        state = "合"
        if t == "无考":
            state, unknown = "无考", unknown + 1
        elif slot["want"] == "○" and t not in ("平", "两"):
            state, bad = "出律", bad + 1
        elif slot["want"] == "●" and t not in ("仄", "两"):
            state, bad = "出律", bad + 1
        if slot["k"] == "rhyme":
            rhyme_chars.append(ch)
        cells.append({
            "i": i + 1, "char": ch, "tone": t, "slot": slot["s"],
            "rhyme_slot": slot["k"] == "rhyme", "state": state,
        })

    common = _common_ps(rhyme_chars)
    cilin_all = None
    if not common:
        for ch in rhyme_chars:
            s = corpus.ps_set(ch)
            if not s:
                continue
            cs = corpus.cilin_of(s)
            cilin_all = cs if cilin_all is None else cilin_all & cs

    draft_lines = [
        corpus.cjk_only(s) for s in re.split(r"[\n，。、；：？！,.;:?!]+", text)
        if len(corpus.cjk_only(s)) >= 4
    ]
    clash = _clash_scan(draft_lines)

    return {
        "cipai": c["cipai"],
        "form": forms[form_index].get("label", f"格{form_index + 1}"),
        "n_slots": len(slots), "n_filled": min(len(chars), len(slots)),
        "n_extra": max(0, len(chars) - len(slots)),
        "n_violations": bad, "n_unknown": unknown,
        "rhyme": {
            "chars": rhyme_chars,
            "pingshui_common": sorted(common) if common else [],
            "cilin_common": sorted(cilin_all) if (not common and cilin_all) else [],
            "consistent": bool(common) or bool(cilin_all),
        },
        "cells": [x for x in cells if x.get("state") != "合"] or "全部合谱",
        "clashes": [
            {"clause": draft_lines[i], "found_in": {
                "id": row[0], "title": row[1], "author": row[2], "dynasty": row[3]}}
            for i, row in sorted(clash.items())
        ],
        "famous_lines": _famous_hits(draft_lines),
        "note": ("依《广韵》判定，两读按通配；△平韵 ▲仄韵为韵标不占字位并收紧该位平仄；"
                 "cells 仅列不合/缺/无考各位。"),
    }


def suggest_slot(cipai: str, form_index: int, slot_ordinal: int,
                 filled_text: str = "") -> dict:
    """谱位择字：韵位按已押韵部给同韵常用字，平仄位按语料常用度给候选。"""
    c = corpus.find_cipai(cipai)
    if not c:
        return {"error": f"龙谱未收「{cipai}」。"}
    forms = c.get("forms", [])
    if not (0 <= form_index < len(forms)):
        return {"error": "form_index 越界。"}
    slots = slots_of(parse_pu(forms[form_index].get("pattern", "")))
    if not (1 <= slot_ordinal <= len(slots)):
        return {"error": f"谱位序号应在 1–{len(slots)}。"}
    slot = slots[slot_ordinal - 1]
    rb = corpus.rhymebook()
    filled = list(corpus.cjk_only(filled_text))
    rhyme_used = [filled[i] for i, s in enumerate(slots)
                  if s["k"] == "rhyme" and i < len(filled)]
    yun_set = _common_ps(rhyme_used)

    if slot["k"] == "rhyme":
        want_ping = slot["mark"] == "△"
        if yun_set:
            chars: list = []
            for ps in sorted(yun_set):
                rec = next((r for r in rb["pingshui"] if r["yun"] == ps), None)
                if rec:
                    chars.extend(rec["chars"][:48])
            return {"slot": slot_ordinal, "kind": f"{'平' if want_ping else '仄'}韵位",
                    "inferred_rhyme": sorted(yun_set),
                    "candidate_chars": "".join(dict.fromkeys(chars))[:90],
                    "note": "依已押韵位推定韵部；字表按语料常用度排序。"}
        cats = [r["yun"] for r in rb["pingshui"]
                if (r["tone"] == "平") == want_ping][:12]
        return {"slot": slot_ordinal, "kind": f"{'平' if want_ping else '仄'}韵位",
                "note": "尚未起韵，先择一韵部（列前 12 部）。",
                "candidate_categories": cats}

    if slot["want"] == "⊙":
        return {"slot": slot_ordinal, "kind": "可平可仄", "note": "此位不拘。"}
    want_ping = slot["want"] == "○"
    chars = []
    for r in rb["pingshui"]:
        if (r["tone"] == "平") == want_ping:
            chars.extend(r["chars"][:6])
    return {"slot": slot_ordinal, "kind": "平声位" if want_ping else "仄声位",
            "candidate_chars": "".join(dict.fromkeys(chars))[:90],
            "note": "取平水各部合本位平仄之常用字（按语料频次）。"}

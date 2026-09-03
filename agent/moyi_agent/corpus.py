"""墨一语料层：直接读取 App 内置的分片 JSON 数据（零重复导出）。

数据目录即 moyi/app/src/main/assets/www/data —— 与 Android 端同源同口径：
  · catalog.json      13 万篇轻元数据 [id, 题, 作者, 朝代, 典籍, 体裁, 词牌]
  · ctext/ct_NN.json  全文折叠索引 16 片（繁→简折叠后的连续文本）
  · poems/shard_NN.json  作品全文 48 片（按 id 哈希分桶）
  · guangyun.json / rhymebook.json  广韵字音 → 平水韵 106 部 → 词林正韵 19 部
  · cipu.json         龙榆生《唐宋词格律》153 调
  · tag_index.json    意象/情感/题材/广谱意象 → catalog 行号倒排
  · yun_index.json / season_index.json  主韵部 / 四时倒排
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

N_POEM_SHARDS = 48
N_CTEXT = 16


def data_dir() -> Path:
    """定位数据目录：环境变量 MOYI_DATA_DIR 优先，否则从本文件向上找仓库根。"""
    env = os.environ.get("MOYI_DATA_DIR")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    for base in [here.parent, *here.parents]:
        cand = base / "moyi" / "app" / "src" / "main" / "assets" / "www" / "data"
        if cand.is_dir():
            return cand
    raise FileNotFoundError(
        "未找到墨一数据目录；请设置环境变量 MOYI_DATA_DIR 指向 "
        "moyi/app/src/main/assets/www/data"
    )


@lru_cache(maxsize=96)
def load(name: str):
    """载入并缓存一个数据文件（相对数据目录）。"""
    with open(data_dir() / name, encoding="utf-8") as f:
        return json.load(f)


# ── 繁→简折叠（检索/比对统一口径） ──────────────────────────────

def fold(s: str) -> str:
    t2s = load("t2s.json")
    return "".join(t2s.get(ch, ch) for ch in str(s or ""))


def cjk_only(s: str) -> str:
    return "".join(ch for ch in str(s or "") if "㐀" <= ch <= "鿿" or "豈" <= ch <= "﫿")


# ── 目录与全文 ────────────────────────────────────────────────

def catalog() -> list:
    return load("catalog.json")


@lru_cache(maxsize=1)
def catalog_by_id() -> dict:
    return {r[0]: (i, r) for i, r in enumerate(catalog())}


def _shard_of(work_id: str) -> int:
    h = 0
    for ch in work_id:
        h = (h * 31 + ord(ch)) & 0x7FFFFFFF
    return h % N_POEM_SHARDS


def poem_by_id(work_id: str) -> dict | None:
    shard = load(f"poems/shard_{_shard_of(work_id):02d}.json")
    return next((p for p in shard if p["id"] == work_id), None)


def scan_full_text(match_fn, limit: int = 200) -> list:
    """逐片扫描折叠全文；match_fn(text, row) → bool。返回命中的 catalog 行。"""
    rows = catalog()
    hits = []
    for s in range(N_CTEXT):
        for idx, text in load(f"ctext/ct_{s:02d}.json"):
            if match_fn(text, rows[idx]):
                hits.append(rows[idx])
                if len(hits) >= limit:
                    return hits
    return hits


def text_of_row(row_index: int) -> str:
    part = load(f"ctext/ct_{row_index % N_CTEXT:02d}.json")
    return next((t for i, t in part if i == row_index), "")


# ── 韵书：广韵 → 平水 → 词林 ──────────────────────────────────

@lru_cache(maxsize=1)
def rhymebook() -> dict:
    rb = dict(load("rhymebook.json"))
    ps2cilin: dict = {}
    for bu, pss in rb["cilin"].items():
        for ps in pss:
            ps2cilin.setdefault(ps, []).append(bu)
    rb["ps2cilin"] = ps2cilin
    return rb


def guangyun_rec(ch: str):
    gy = load("guangyun.json")
    return gy.get(ch) or gy.get(fold(ch))


def tone_of(ch: str) -> str:
    """字的声调大类：平 / 仄 / 两（两读） / 无考。"""
    rec = guangyun_rec(ch)
    return rec[0] if rec else "无考"


def pingshui_of(ch: str) -> list:
    """字 → 平水韵候选 [{ps, tone}]（经广韵读音映射，去重）。"""
    rec = guangyun_rec(ch)
    if not rec:
        return []
    rb = rhymebook()
    seen, out = set(), []
    for yun, tone, *_ in rec[1]:
        ps = rb["gy2ps"].get(yun)
        if ps and (ps + tone) not in seen:
            seen.add(ps + tone)
            out.append({"ps": ps, "tone": tone})
    return out


def ps_set(ch: str) -> set:
    return {c["ps"] for c in pingshui_of(ch)}


def cilin_of(ps_names) -> set:
    rb = rhymebook()
    out: set = set()
    for ps in ps_names:
        out.update(rb["ps2cilin"].get(ps, []))
    return out


# ── 龙谱（词谱） ──────────────────────────────────────────────

def find_cipai(name: str) -> dict | None:
    fq = fold(name)
    for c in load("cipu.json"):
        if fold(c["cipai"]) == fq or any(fold(a) == fq for a in c.get("aliases", [])):
            return c
    for c in load("cipu.json"):
        if fq in fold(c["cipai"]) or any(fq in fold(a) for a in c.get("aliases", [])):
            return c
    return None

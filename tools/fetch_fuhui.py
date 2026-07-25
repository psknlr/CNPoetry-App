#!/usr/bin/env python3
"""抓取并解析《御定历代赋汇》（清·陈元龙编，文渊阁四库全书本）。

来源：Kanripo KR4h0139（按卷繁体 TXT，带四库页码标识）。
原典 1706 年成书，正文属公有领域；本脚本只取正文，保留卷次与页码
标识作为证据链（source_volume / page），供 App 的「辞赋」板块使用。

解析要点：
  * 卷首 `#+PROPERTY: JUAN 巻N 类目` 给出卷次与类目；目录卷（目錄上/下）跳过；
  * `<pb:KR4h0139_WYG_007-3a>` 为页码标识，转为 page 字段并从正文剔除；
  * 篇题行形如 `　　天地賦　　　　　晉成公綏` 或 `　　天地賦(晉成公綏/)`，
    以「賦」结尾且后接作者的行判为篇首；正文行以全角空格缩进；
  * `¶` 为原文换行符，`　` 为全角空格；小字注（/）保留原样。

用法：
    python3 tools/fetch_fuhui.py --out <CNPoetry-Hermes 根>/data/raw/fuhui
"""
from __future__ import annotations

import argparse
import json
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = "https://cdn.jsdelivr.net/gh/kanripo/KR4h0139@master"
N_JUAN = 189  # KR4h0139_000 … KR4h0139_189

RE_PB = re.compile(r"<pb:KR4h0139_WYG_(\d+)-(\w+)>")
RE_JUAN = re.compile(r"#\+PROPERTY:\s*JUAN\s*(.+)")
# 篇题行实际排版（四库本）：
#   「　　　天地賦(有序/)　　　　　　　(晉/)成公綏」
#   「　　　乾坤為天地賦　　　　　　　(唐/)陸肱」
# 即：题名含「賦」→ 可选小字注 →（≥2 全角空格）→ 作者（朝代在括注内）。
RE_TITLE = re.compile(
    r"^[　\s]*([^　\s(（]{1,24}[賦赋])"          # 题名（以賦收）
    r"(?:[(（][^)）]{0,60}[)）])?"                # 可选题下小注（有序/以…為韻）
    r"[　\s]{2,}"                                  # 题、作者间的大间隔
    r"(?:[(（]([^)）/／]{1,6})[/／]?[)）])?"        # 可选朝代括注
    r"[　\s]*([一-鿿豈-﫿](?:[　\s]*[一-鿿豈-﫿]){0,11})"  # 作者（名内可含全角空格）
    r"(?:[(（][^)）]{0,30}[)）])?[　\s]*$")


def fetch(idx: int) -> str:
    url = f"{BASE}/KR4h0139_{idx:03d}.txt"
    try:
        with urllib.request.urlopen(url, timeout=90) as r:
            return r.read().decode("utf-8", "replace")
    except Exception:
        return ""


def parse_juan(text: str):
    """把一卷文本切成篇：返回 (juan_label, [篇dict])。"""
    m = RE_JUAN.search(text)
    juan_label = m.group(1).strip() if m else ""
    if "目錄" in juan_label or "目录" in juan_label:
        return juan_label, []

    pieces, cur, page = [], None, ""
    for raw in text.splitlines():
        if raw.startswith("#"):
            continue
        pm = RE_PB.search(raw)
        if pm:
            page = f"{pm.group(1)}-{pm.group(2)}"
            raw = RE_PB.sub("", raw)
        line = raw.replace("¶", "").rstrip()
        if not line.strip() or line.strip() == "　":
            continue
        tm = RE_TITLE.match(line)
        if tm:
            if cur and cur["paragraphs"]:
                pieces.append(cur)
            dyn = (tm.group(2) or "").strip()
            author = re.sub(r"[　\s]+", "", tm.group(3)).rstrip("/／")
            if not dyn and author and author[0] in "漢汉魏晉晋宋齊齐梁陳陈隋唐周元明清":
                dyn, author = author[0], author[1:]
            cur = {"title": tm.group(1).strip(), "author": author, "dynasty": dyn,
                   "juan": juan_label, "page": page, "paragraphs": []}
            continue
        if cur is not None:
            cur["paragraphs"].append(line.strip("　 "))
    if cur and cur["paragraphs"]:
        pieces.append(cur)
    return juan_label, pieces


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    with ThreadPoolExecutor(max_workers=8) as ex:
        texts = list(ex.map(fetch, range(N_JUAN + 1)))
    ok = sum(1 for t in texts if t)
    print(f"取得 {ok}/{N_JUAN + 1} 卷")

    all_pieces = []
    for i, t in enumerate(texts):
        if not t:
            continue
        label, pieces = parse_juan(t)
        for p in pieces:
            p["file_juan"] = i
        all_pieces.extend(pieces)
    (out / "fuhui.json").write_text(
        json.dumps(all_pieces, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    chars = sum(len("".join(p["paragraphs"])) for p in all_pieces)
    print(f"解析赋篇 {len(all_pieces)} 篇 · {chars / 1e4:.1f} 万字 → {out / 'fuhui.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

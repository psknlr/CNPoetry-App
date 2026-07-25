#!/usr/bin/env python3
"""构建明清诗补充语料（分层抽样 + 清洗 + 来源标注）。

来源：Werneror/Poetry（CSV：题目/朝代/作者/内容）。该库为互联网汇编，
**不是**《全明诗》《全清诗》权威底本，无底本/卷次/页码信息，故：
  * 在 App 内单列「明清补遗」层并标注证据级别（网络汇编，待校）；
  * 不参与意象/情感规则挖掘（那些结论要求逐字回源到可信底本）；
  * 仅供阅读、检索与格律计量（格律由《广韵》逐字判定，与底本无关）。

清洗与抽样：
  * 去重：同作者 + 同题 + 同正文首 30 字；
  * 过滤：正文含替代符 `?` 过多、过短（< 8 字）、超长（> 800 字）；
  * 分层：按作者分组，每位作者最多取 cap 首（按篇幅适中优先），
    使抽样覆盖尽可能多的作者，而非集中于高产者。

用法：
    python3 tools/build_mingqing.py --src <Werneror/Poetry 目录> \
        --out <CNPoetry-Hermes 根>/data/raw/mingqing --per-era 40000
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

csv.field_size_limit(10 ** 8)

ERA_FILES = {
    "明": ["明_1.csv", "明_2.csv", "明_3.csv", "明_4.csv"],
    "清": ["清_1.csv", "清_2.csv"],
    "元末明初": ["元末明初.csv"],
    "明末清初": ["明末清初.csv"],
    "清末民国初": ["清末民国初.csv"],
}
RE_CJK = re.compile(r"[㐀-鿿豈-﫿]")
RE_SPLIT = re.compile(r"[，。、；：？！,.;:?!\s]+")


def clean_ok(text: str) -> bool:
    if not text:
        return False
    n = len(RE_CJK.findall(text))
    if n < 8 or n > 800:
        return False
    if text.count("?") + text.count("？") > 2:
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--per-era", type=int, default=40000)
    args = ap.parse_args()
    src, out = Path(args.src), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    result = []
    for era, files in ERA_FILES.items():
        quota = args.per_era if era in ("明", "清") else args.per_era // 5
        by_author: dict = {}
        seen = set()
        n_read = n_drop = 0
        for fn in files:
            path = src / fn
            if not path.exists():
                continue
            with path.open(encoding="utf-8") as fh:
                for row in csv.DictReader(fh):
                    n_read += 1
                    title = (row.get("题目") or "").strip()
                    author = (row.get("作者") or "").strip()
                    content = (row.get("内容") or "").strip()
                    if not clean_ok(content) or not author:
                        n_drop += 1
                        continue
                    key = (author, title, content[:30])
                    if key in seen:
                        n_drop += 1
                        continue
                    seen.add(key)
                    by_author.setdefault(author, []).append((title, content))

        # 分层：轮转取样，每轮每位作者取一首，直至配额满 —— 保证作者覆盖广度
        for lst in by_author.values():
            lst.sort(key=lambda x: abs(len(RE_CJK.findall(x[1])) - 56))  # 篇幅适中优先
        authors = sorted(by_author, key=lambda a: -len(by_author[a]))
        picked, rnd = [], 0
        while len(picked) < quota:
            added = 0
            for a in authors:
                lst = by_author[a]
                if rnd < len(lst):
                    picked.append((a, lst[rnd]))
                    added += 1
                    if len(picked) >= quota:
                        break
            if added == 0:
                break
            rnd += 1

        for author, (title, content) in picked:
            lines = [s for s in RE_SPLIT.split(content) if s]
            result.append({"title": title, "author": author, "dynasty": era,
                           "paragraphs": lines})
        print(f"{era}: 读 {n_read} · 弃 {n_drop} · 作者 {len(by_author)} · "
              f"取 {len(picked)}")

    meta = {
        "source_repo": "https://github.com/Werneror/Poetry",
        "license": "仓库未声明明确许可；古代正文属公有领域",
        "evidence_level": "网络汇编（无底本/卷次/页码），待校勘",
        "note": "非《全明诗》《全清诗》权威底本；不参与意象与情感规则挖掘。",
        "poems": result,
    }
    (out / "mingqing.json").write_text(
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"合计 {len(result)} 首 → {out / 'mingqing.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

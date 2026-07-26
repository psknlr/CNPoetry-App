#!/usr/bin/env python3
"""意象标注假阳性抽检：按门类抽样，输出命中句以供人工审阅。

标注为表面字面匹配，必有假阳性（如「玉」曾误收「玉人」之修饰用法）。
本脚本对每个意象抽若干命中句并高亮命中的表面形式，供维护者逐条判读；
判读结果反馈到 tools/imagery_lexicon.py 的词表修订。

用法：
    python3 tools/audit_imagery.py --data moyi/app/src/main/assets/www/data \
        --cat 器物 --per 4
    python3 tools/audit_imagery.py --data <…> --all --per 2 > audit.txt
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from imagery_lexicon import flat_lexicon  # noqa: E402

RE_SPLIT = re.compile(r"[，。、；：？！]")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--cat", default="")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--per", type=int, default=3)
    ap.add_argument("--seed", type=int, default=20260726)
    args = ap.parse_args()
    data = Path(args.data)
    random.seed(args.seed)

    catalog = json.loads((data / "catalog.json").read_text(encoding="utf-8"))
    tag = json.loads((data / "tag_index.json").read_text(encoding="utf-8"))
    texts = {}
    for f in sorted((data / "ctext").glob("ct_*.json")):
        for idx, t in json.loads(f.read_text(encoding="utf-8")):
            texts[idx] = t

    lex = flat_lexicon()
    wide = tag.get("wide", {})
    cats = ({args.cat} if args.cat else
            {v["category"] for v in lex.values()} if args.all else set())
    names = [n for n, v in lex.items() if not cats or v["category"] in cats]

    for name in names:
        ids = wide.get(name) or []
        if not ids:
            continue
        surfaces = lex[name]["surfaces"]
        print(f"\n══ {name}（{lex[name]['category']}）· 命中 {len(ids)} 首 "
              f"· 表面 {'/'.join(surfaces[:8])}")
        for idx in random.sample(ids, min(args.per, len(ids))):
            row = catalog[idx]
            text = texts.get(idx, "")
            hit_surf = next((s for s in surfaces if s in text), "")
            # 截取命中所在的一句
            sent = ""
            for piece in RE_SPLIT.split(text):
                if hit_surf and hit_surf in piece:
                    sent = piece
                    break
            sent = sent or text[:24]
            marked = sent.replace(hit_surf, f"【{hit_surf}】") if hit_surf else sent
            print(f"   · {marked}　　—《{row[1][:14]}》{row[3]}·{row[2]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""抓取 chinese-poetry 上游的补充语料（古文观止 · 声律启蒙）。

这两部不进诗词计量层（散文/蒙学对课与近体格律计量口径不同），
单独落盘供 App 的「文苑」与「对课」板块使用。

用法：
    python3 tools/fetch_extra_corpus.py --out <CNPoetry-Hermes 根>/data/raw/extra
"""
from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://cdn.jsdelivr.net/gh/chinese-poetry/chinese-poetry@master"
SOURCES = {
    "guwenguanzhi.json": "蒙学/guwenguanzhi.json",
    "shenglvqimeng.json": "蒙学/shenglvqimeng.json",
    "youxueqionglin.json": "蒙学/youxueqionglin.json",
}


def fetch(rel: str) -> bytes:
    url = BASE + "/" + urllib.parse.quote(rel)
    with urllib.request.urlopen(url, timeout=120) as resp:
        if resp.status != 200:
            raise RuntimeError(f"{rel} → HTTP {resp.status}")
        return resp.read()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    for name, rel in SOURCES.items():
        raw = fetch(rel)
        json.loads(raw.decode("utf-8"))          # 校验可解析
        (out / name).write_bytes(raw)
        print(f"{name}  {len(raw) / 1024:.0f} KB")
    print(f"→ {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

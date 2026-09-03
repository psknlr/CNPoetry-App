"""墨一·砚友 命令行：python -m moyi_agent [--once 问题]。

鉴权：ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / `ant auth login` 档案，
SDK 自动解析，无须在此配置。
"""
from __future__ import annotations

import argparse
import sys

import anthropic

from . import corpus
from .agent import DEFAULT_MODEL, run_turn

BANNER = """┌──────────────────────────────────────────┐
│  墨 一 · 砚 友    诗词语料智能体          │
│  :q 退出 · :new 清史 · 直接落笔即问        │
└──────────────────────────────────────────┘"""


def _on_event(kind: str, payload):
    if kind == "tool_call":
        args = ", ".join(f"{k}={v!r}" for k, v in payload["input"].items())
        print(f"  ⚒ {payload['name']}({args[:120]})", file=sys.stderr)
    elif kind == "text":
        print()
        print(payload)


def main() -> int:
    ap = argparse.ArgumentParser(prog="moyi_agent", description="墨一·砚友 诗词语料智能体")
    ap.add_argument("--once", metavar="问题", help="单问单答后退出")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--effort", default="high",
                    choices=["low", "medium", "high", "xhigh", "max"])
    ap.add_argument("--no-fallbacks", action="store_true",
                    help="关闭服务端拒答降级（fallbacks 参数）")
    args = ap.parse_args()

    try:
        corpus.data_dir()
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        return 2

    client = anthropic.Anthropic()
    messages: list = []

    def ask(q: str):
        messages.append({"role": "user", "content": q})
        try:
            run_turn(client, messages, model=args.model, effort=args.effort,
                     fallbacks=not args.no_fallbacks, on_event=_on_event)
        except anthropic.AuthenticationError:
            print("鉴权失败：请设 ANTHROPIC_API_KEY 或先 `ant auth login`。", file=sys.stderr)
            raise SystemExit(2)
        except anthropic.RateLimitError as e:
            wait = e.response.headers.get("retry-after", "60")
            print(f"限流：请 {wait}s 后再试。", file=sys.stderr)
        except anthropic.APIStatusError as e:
            print(f"API 错误（{e.status_code}）：{e.message}", file=sys.stderr)
        except anthropic.APIConnectionError:
            print("网络不通：请检查网络。", file=sys.stderr)

    if args.once:
        ask(args.once)
        return 0

    print(BANNER)
    while True:
        try:
            q = input("\n墨一> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if not q:
            continue
        if q in (":q", ":quit", "exit"):
            return 0
        if q == ":new":
            messages.clear()
            print("（已另起一卷）")
            continue
        ask(q)


if __name__ == "__main__":
    raise SystemExit(main())

"""墨一·砚友 命令行：python -m moyi_agent [--provider ...] [--once 问题]。

厂商：
  anthropic（默认） Anthropic 官方端点，工具执行器；ANTHROPIC_API_KEY /
                    ANTHROPIC_AUTH_TOKEN / `ant auth login` 档案自动解析。
                    配 --base-url 也可指向 Anthropic 兼容端点
                    （如 MiniMax https://api.minimax.io/anthropic + --model MiniMax-M2）。
  openrouter / poe / minimax / custom
                    OpenAI 兼容端点，手写工具循环；钥匙取自各家环境变量
                    （OPENROUTER_API_KEY / POE_API_KEY / MINIMAX_API_KEY），
                    custom 须给 --base-url，钥匙变量可用 --api-key-env 指定。
"""
from __future__ import annotations

import argparse
import os
import sys

from . import corpus

BANNER = """┌──────────────────────────────────────────┐
│  墨 一 · 砚 友    诗词语料智能体          │
│  :q 退出 · :new 清史 · 直接落笔即问        │
└──────────────────────────────────────────┘"""


def _on_event(kind: str, payload):
    if kind == "tool_call":
        inp = payload["input"]
        args = (", ".join(f"{k}={v!r}" for k, v in inp.items())
                if isinstance(inp, dict) else str(inp))
        print(f"  ⚒ {payload['name']}({args[:120]})", file=sys.stderr)
    elif kind == "text":
        print()
        print(payload)


def main() -> int:
    ap = argparse.ArgumentParser(prog="moyi_agent", description="墨一·砚友 诗词语料智能体")
    ap.add_argument("--once", metavar="问题", help="单问单答后退出")
    ap.add_argument("--provider", default="anthropic",
                    choices=["anthropic", "openrouter", "poe", "minimax", "custom"])
    ap.add_argument("--model", default="", help="模型 id；不给则用该厂商预设")
    ap.add_argument("--base-url", default="", help="端点覆盖（custom 必填）")
    ap.add_argument("--api-key-env", default="", help="钥匙所在环境变量名（覆盖预设）")
    ap.add_argument("--effort", default="high",
                    choices=["low", "medium", "high", "xhigh", "max"],
                    help="思考深度（仅 Anthropic claude 模型有效）")
    ap.add_argument("--no-fallbacks", action="store_true",
                    help="关闭服务端拒答降级（仅 Anthropic 端点有效）")
    args = ap.parse_args()

    try:
        corpus.data_dir()
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        return 2

    messages: list = []

    if args.provider == "anthropic":
        import anthropic
        from .agent import DEFAULT_MODEL, run_turn

        ckw: dict = {}
        if args.base_url:
            ckw["base_url"] = args.base_url
        if args.api_key_env:
            ckw["api_key"] = os.environ.get(args.api_key_env, "")
        client = anthropic.Anthropic(**ckw)
        model = args.model or DEFAULT_MODEL

        def turn():
            try:
                run_turn(client, messages, model=model, effort=args.effort,
                         fallbacks=not args.no_fallbacks, on_event=_on_event)
            except anthropic.AuthenticationError:
                print("鉴权失败：请设 ANTHROPIC_API_KEY 或先 `ant auth login`。",
                      file=sys.stderr)
                raise SystemExit(2)
            except anthropic.RateLimitError as e:
                wait = e.response.headers.get("retry-after", "60")
                print(f"限流：请 {wait}s 后再试。", file=sys.stderr)
            except anthropic.APIStatusError as e:
                print(f"API 错误（{e.status_code}）：{e.message}", file=sys.stderr)
            except anthropic.APIConnectionError:
                print("网络不通：请检查网络。", file=sys.stderr)
    else:
        from . import providers
        from .agent import build_system

        try:
            cfg = providers.resolve(args.provider, args.base_url,
                                    args.model, args.api_key_env)
        except ValueError as e:
            print(e, file=sys.stderr)
            return 2
        try:
            client = providers.make_client(cfg["base_url"], cfg["api_key"])
        except ModuleNotFoundError:
            print("走 OpenAI 兼容端点需要 openai 包：pip install openai",
                  file=sys.stderr)
            return 2
        if not cfg["model"]:
            print("custom 端点须给 --model。", file=sys.stderr)
            return 2
        system = build_system()
        import openai

        def turn():
            try:
                providers.run_turn(client, messages, model=cfg["model"],
                                   system=system, on_event=_on_event)
            except openai.AuthenticationError:
                print(f"鉴权失败：检查 {args.api_key_env or '对应'} 环境变量之钥匙。",
                      file=sys.stderr)
                raise SystemExit(2)
            except openai.RateLimitError:
                print("限流：稍候再试。", file=sys.stderr)
            except openai.APIStatusError as e:
                print(f"API 错误（{e.status_code}）：{e.message}", file=sys.stderr)
            except openai.APIConnectionError:
                print("网络不通：请检查网络。", file=sys.stderr)

    def ask(q: str):
        messages.append({"role": "user", "content": q})
        turn()

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

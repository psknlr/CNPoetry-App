"""墨一·砚友：基于 Anthropic 工具执行器（tool runner）的诗词语料智能体。

架构：Claude API + 自定义工具（方案二 · SDK 供循环、自host）。
  · 17 件语料工具（toolkit.py）——检索、韵书、龙谱、校验、意象、指纹；
  · 5 门技艺（skills/*.md）——按需以 load_skill 渐进披露，系统提示只列目录；
  · 系统提示与工具表置于缓存断点前，多轮对话享前缀缓存。
"""
from __future__ import annotations

import anthropic

from . import corpus, toolkit
from .tools import TOOLS

DEFAULT_MODEL = "claude-opus-5"


def _skill_roster() -> str:
    lines = []
    for f in sorted(toolkit.SKILL_DIR.glob("*.md")):
        first = f.read_text(encoding="utf-8").strip().splitlines()[0]
        lines.append(f"  · {f.stem} —— {first.lstrip('# ').strip()}")
    return "\n".join(lines)


def build_system() -> str:
    st = corpus.load("stats.json")
    return f"""你是「墨一·砚友」——墨一诗词馆的案头智能体，一位克己而渊博的古典文学研究员。

## 馆藏（与墨一 App 同源同口径）
藏 {st['poems']:,} 篇作品（先秦至清，含诗、词、曲、赋、蒙学与古文），{st['authors']:,} 位作者、
{st['cipai']} 词牌语料归纳、龙榆生《唐宋词格律》153 调、广韵→平水韵 106 部→词林正韵 19 部、
意象档案 {st['imagery']} 目（广谱 207 目）、题材九品、名句谱、诗人指纹 1,114 家。

## 行事三律
1. **工具先于记忆**。凡引诗句、报数字、判平仄，必经工具取证——你记忆中的文本可能与
   馆藏版本有异文，格律凭感觉判则必有错漏。校验诗词一律用 check_jinti / check_ci，
   不自行推演平仄；引用原文一律先 get_work / search_full_text 核对。
2. **知之为知之**。工具报「无考」「未收」即如实转告；统计数字注明口径与出处
   （work id 可核）；语料有存佚之偏，「今存所见最早」不说成「首创」。
3. **改稿必复核**。为用户改诗改词后，必再跑一次校验工具确认，不凭感觉宣布合律。

## 技艺（专项工作流程，按需载入）
遇下列专项任务，先以 load_skill(name) 取该技艺全文，照其流程行事：
{_skill_roster()}
简单查询（查一字之韵、取一篇全文）可直接用工具，不必载技艺。

## 谈吐
以典雅晓畅的中文应答，术语随文略释；先结论后证据，证据落到「《题》作者·朝代（id）：原句」。
用户以他语相询则随之。"""


def make_runner(client: anthropic.Anthropic, messages: list, *,
                model: str = DEFAULT_MODEL, effort: str = "high",
                fallbacks: bool = True, system: str | None = None):
    """构造一轮工具执行器。system/tools 置前、缓存断点在 system 尾，利于前缀缓存。"""
    kwargs: dict = {}
    if fallbacks and model in ("claude-opus-5", "claude-fable-5-1", "claude-fable-5"):
        # 安全分类器拒答时服务端按类别自动降级重跑（claude-api 技能建议默认开启）
        kwargs["betas"] = ["server-side-fallback-2026-07-01"]
        kwargs["fallbacks"] = "default"
    return client.beta.messages.tool_runner(
        model=model,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        output_config={"effort": effort},
        system=[{"type": "text", "text": system or build_system(),
                 "cache_control": {"type": "ephemeral"}}],
        tools=TOOLS,
        messages=messages,
        **kwargs,
    )


def run_turn(client: anthropic.Anthropic, messages: list, *,
             model: str = DEFAULT_MODEL, effort: str = "high",
             fallbacks: bool = True, on_event=None) -> str:
    """跑完一个用户回合（含全部工具往返），镜像历史入 messages，返回末次答文。

    on_event(kind, payload)：kind ∈ {"text", "tool_call"}，供 CLI 实时呈现。
    """
    system = build_system()
    final_text = ""
    max_restarts, restarts = 5, 0
    while True:
        runner = make_runner(client, messages, model=model, effort=effort,
                             fallbacks=fallbacks, system=system)
        last = None
        for message in runner:
            last = message
            # 镜像历史——runner 自持副本不外露（含 thinking 块原样回传）
            messages.append({"role": "assistant", "content": message.content})
            for block in message.content:
                if block.type == "text" and block.text:
                    final_text = block.text
                    if on_event:
                        on_event("text", block.text)
                elif block.type == "tool_use" and on_event:
                    on_event("tool_call", {"name": block.name, "input": block.input})
            tool_response = runner.generate_tool_call_response()
            if tool_response is not None:
                messages.append(tool_response)
        if last is None or last.stop_reason != "pause_turn":
            if last is not None and last.stop_reason == "refusal":
                final_text = final_text or "（此问经安全策略婉拒，未能作答。）"
            break
        restarts += 1
        if restarts > max_restarts:
            break  # 罕见：多次续跑仍悬置，交还已得内容
    return final_text

"""OpenAI 兼容端点驱动：OpenRouter / Poe / MiniMax / 任意自定义 base_url。

Anthropic 官方端点走 agent.py 的工具执行器；本模块给其余厂商提供同一套
工具的手写调用循环（chat.completions + function calling）。工具仍取自
toolkit.ALL_TOOLS —— schema 由签名与 docstring 独立生成，不依赖 anthropic 包。

所选模型须支持工具调用（function calling）；`openai` 包按需惰性导入。
"""
from __future__ import annotations

import inspect
import json
import os
import re

from . import toolkit

PRESETS: dict = {
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
        "model": "anthropic/claude-opus-4.5",
    },
    "poe": {
        "base_url": "https://api.poe.com/v1",
        "key_env": "POE_API_KEY",
        "model": "Claude-Opus-4.5",
    },
    "minimax": {
        "base_url": "https://api.minimax.io/v1",   # 中国大陆：https://api.minimaxi.com/v1
        "key_env": "MINIMAX_API_KEY",
        "model": "MiniMax-M2",
    },
}

_TYPES = {str: "string", int: "integer", float: "number", bool: "boolean"}


def _doc_parts(fn) -> tuple[str, dict]:
    """docstring → (工具说明, {参数: 说明})；与 toolkit 的 Google 风格约定配套。"""
    doc = inspect.getdoc(fn) or ""
    head, _, rest = doc.partition("Args:")
    params = {}
    for line in rest.splitlines():
        m = re.match(r"\s*(\w+):\s*(.+)", line)
        if m:
            params[m.group(1)] = m.group(2).strip()
    return head.strip(), params


def openai_tools() -> list[dict]:
    """toolkit.ALL_TOOLS → OpenAI function-calling 工具表。"""
    out = []
    for fn in toolkit.ALL_TOOLS:
        desc, pdesc = _doc_parts(fn)
        props, required = {}, []
        for name, p in inspect.signature(fn).parameters.items():
            props[name] = {"type": _TYPES.get(p.annotation, "string"),
                           "description": pdesc.get(name, "")}
            if p.default is inspect.Parameter.empty:
                required.append(name)
        out.append({"type": "function", "function": {
            "name": fn.__name__, "description": desc,
            "parameters": {"type": "object", "properties": props,
                           "required": required},
        }})
    return out


_FN = {fn.__name__: fn for fn in toolkit.ALL_TOOLS}


def call_tool(name: str, arguments_json: str) -> str:
    """执行一次工具调用；一切失败都折成 JSON 错误信息回给模型，不抛出。"""
    fn = _FN.get(name)
    if not fn:
        return json.dumps({"error": f"无此工具：{name}"}, ensure_ascii=False)
    try:
        args = json.loads(arguments_json or "{}")
    except json.JSONDecodeError:
        return json.dumps({"error": "工具参数不是合法 JSON。"}, ensure_ascii=False)
    try:
        return fn(**args)
    except TypeError as e:
        return json.dumps({"error": f"参数不符：{e}"}, ensure_ascii=False)
    except Exception as e:  # 工具内部意外，如实报回
        return json.dumps({"error": f"{type(e).__name__}: {e}"}, ensure_ascii=False)


def make_client(base_url: str, api_key: str):
    from openai import OpenAI  # 惰性导入：仅走兼容端点时需要
    return OpenAI(base_url=base_url, api_key=api_key)


def resolve(provider: str, base_url: str = "", model: str = "",
            api_key_env: str = "") -> dict:
    """预设 + 命令行覆盖 → {base_url, model, api_key}；缺钥匙时报可行动的错。"""
    preset = PRESETS.get(provider, {})
    if not preset and not base_url:
        raise ValueError(f"未知 provider「{provider}」且未给 --base-url；"
                         f"可选：{'/'.join(PRESETS)} 或 custom + --base-url。")
    key_env = api_key_env or preset.get("key_env", "OPENAI_API_KEY")
    api_key = os.environ.get(key_env, "")
    if not api_key:
        raise ValueError(f"未设环境变量 {key_env}（{provider} 的 API 钥匙）。")
    return {"base_url": base_url or preset["base_url"],
            "model": model or preset.get("model", ""),
            "api_key": api_key}


def run_turn(client, messages: list, *, model: str, system: str,
             on_event=None, max_rounds: int = 40) -> str:
    """跑完一个用户回合（含全部工具往返）；messages 为 OpenAI 报文格式。"""
    tools = openai_tools()
    final_text = ""
    for _ in range(max_rounds):
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, *messages],
            tools=tools,
        )
        msg = resp.choices[0].message
        entry: dict = {"role": "assistant", "content": msg.content or ""}
        if msg.tool_calls:
            entry["tool_calls"] = [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.function.name,
                              "arguments": tc.function.arguments}}
                for tc in msg.tool_calls]
        messages.append(entry)
        if msg.content:
            final_text = msg.content
            if on_event:
                on_event("text", msg.content)
        if not msg.tool_calls:
            break
        for tc in msg.tool_calls:
            if on_event:
                try:
                    shown = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    shown = tc.function.arguments
                on_event("tool_call", {"name": tc.function.name, "input": shown})
            messages.append({"role": "tool", "tool_call_id": tc.id,
                             "content": call_tool(tc.function.name,
                                                  tc.function.arguments)})
    return final_text

"""Anthropic 工具执行器（tool runner）用的工具封装。

@beta_tool 由函数签名与 docstring 自动生成 schema——toolkit 内每个函数
即一件工具，此处仅作装饰，保持单一事实来源。
"""
from __future__ import annotations

from anthropic import beta_tool

from . import toolkit

TOOLS = [beta_tool(fn) for fn in toolkit.ALL_TOOLS]

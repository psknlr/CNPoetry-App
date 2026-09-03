#!/usr/bin/env python3
"""moyi_mcp —— 墨一诗词语料 MCP 服务器（stdio）。

把 toolkit 内 17 件语料工具原样暴露给任何 MCP 客户端（Claude Code /
Claude Desktop / 其他智能体框架），与内置智能体共用同一实现：
schema 由函数签名生成、说明取自 docstring、返回 JSON 字符串。
全部工具只读本地语料，无网络、无副作用。

兼容 MCP Python SDK 1.x（FastMCP）与 2.x（MCPServer）。

用法：
    python -m moyi_agent.mcp_server
客户端配置（.mcp.json）：
    {"mcpServers": {"moyi": {"command": "python",
        "args": ["-m", "moyi_agent.mcp_server"],
        "env": {"MOYI_DATA_DIR": "<仓库>/moyi/app/src/main/assets/www/data"}}}}
"""
from __future__ import annotations

from mcp.types import ToolAnnotations

try:  # mcp 2.x
    from mcp.server.mcpserver import MCPServer as _Server
    _V2 = True
except ModuleNotFoundError:  # mcp 1.x：FastMCP 于 2.x 更名为 MCPServer
    from mcp.server.fastmcp import FastMCP as _Server
    _V2 = False

from . import toolkit

mcp = _Server(
    name="moyi_mcp",
    instructions=("墨一诗词馆语料工具：13 万篇先秦至清诗词曲赋的检索、广韵—平水—词林韵书、"
                  "龙榆生词谱、近体/依谱校验、意象档案与共现、诗人指纹。"
                  "全部只读。先 moyi_load_skill() 可取各专项工作流程。"),
)

# 只读本地语料，不触外网；1.x 字段为 camelCase，2.x 为 snake_case
_READONLY = ToolAnnotations(**(
    dict(read_only_hint=True, destructive_hint=False,
         idempotent_hint=True, open_world_hint=False) if _V2 else
    dict(readOnlyHint=True, destructiveHint=False,
         idempotentHint=True, openWorldHint=False)))

for _fn in toolkit.ALL_TOOLS:
    mcp.tool(name=f"moyi_{_fn.__name__}", annotations=_READONLY)(_fn)


def main() -> None:
    mcp.run("stdio")


if __name__ == "__main__":
    main()

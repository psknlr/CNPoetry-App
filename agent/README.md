# 墨一·砚友 —— 诗词语料智能体（工具增强 + 技艺分层）

墨一 App 的智能体版本：把馆藏 13 万篇语料、韵书、词谱与格律引擎做成
**17 件可调用工具 + 5 门领域技艺**，跑在 Anthropic 工具执行器（tool runner）上；
同一套工具亦以 **MCP 服务器** 暴露，可接入 Claude Code、Claude Desktop
或任何 MCP 客户端。全部工具只读本地数据（App 内置的同一份 JSON），无需联网取语料。

```
┌─ 智能体（自host） ────────────────────────────────────────┐
│  python -m moyi_agent            交互式对话（REPL）         │
│  默认 Anthropic（Claude Opus 5 · 自适应思考 · 前缀缓存 ·     │
│  服务端拒答降级）；--provider 换 OpenRouter/Poe/MiniMax     │
└──────┬───────────────────────────┬───────────────────────┘
       │ @beta_tool（工具执行器）     │ providers.py（OpenAI 兼容循环）
┌──────┴───────────────────────────┴───┐   ┌─ MCP 服务器（可选） ─────┐
│  toolkit.py  17 件语料工具（单一来源）  │←──│ python -m moyi_agent.   │
│  prosody.py  格律引擎                 │   │        mcp_server       │
│  corpus.py   语料层                   │   │ stdio · 17 件 moyi_* 工具│
└──────────────┬───────────────────────┘   └─────────────────────────┘
               │ 只读
   moyi/app/src/main/assets/www/data/（与 Android App 同源同口径）
```

## 快速开始

```bash
pip install -r agent/requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...     # 或先 `ant auth login`
cd agent
python -m moyi_agent                    # 交互对话
python -m moyi_agent --once "帮我校验：月落乌啼霜满天/江枫渔火对愁眠/姑苏城外寒山寺/夜半钟声到客船"
python test_offline.py                  # 离线自检（31 项，不触 API）
```

常用参数：`--model`（默认 claude-opus-5）、`--effort low|medium|high|xhigh|max`
（默认 high）、`--no-fallbacks`（关闭服务端拒答降级）。

数据目录默认自动定位（仓库内运行免配置）；单独部署时设
`MOYI_DATA_DIR=<仓库>/moyi/app/src/main/assets/www/data`。

## 换厂商：OpenRouter / Poe / MiniMax / 自定义端点

同一套工具与技艺可跑在任何支持工具调用的模型上（`providers.py`，
OpenAI 兼容 chat.completions + function calling 手写循环）：

```bash
export OPENROUTER_API_KEY=...
python -m moyi_agent --provider openrouter                     # 预设 anthropic/claude-opus-4.5
python -m moyi_agent --provider openrouter --model minimax/minimax-m2

export POE_API_KEY=...
python -m moyi_agent --provider poe --model Claude-Opus-4.5    # api.poe.com/v1

export MINIMAX_API_KEY=...
python -m moyi_agent --provider minimax                        # 预设 MiniMax-M2
# 大陆端点：--base-url https://api.minimaxi.com/v1

# 任意 OpenAI 兼容端点
python -m moyi_agent --provider custom --base-url https://... \
    --model <id> --api-key-env MY_KEY_ENV
```

MiniMax 另有 **Anthropic 兼容**端点，可直接复用工具执行器路径：

```bash
ANTHROPIC_API_KEY=<MiniMax钥匙> python -m moyi_agent \
    --base-url https://api.minimax.io/anthropic --model MiniMax-M2
```

注意：`--effort`、思考与拒答降级为 Anthropic 参数，非 claude 模型自动略去；
所选模型须支持工具调用，各家模型 id 以其官方目录为准（预设仅是缺省值）。

## 17 件工具

| 类别 | 工具 | 作用 |
|---|---|---|
| 检索 | `search_works` | 题名/作者检索（可按朝代、体裁、作者筛） |
| | `search_full_text` | 13 万篇折叠全文成句检索 |
| | `get_work` | 取一篇全文 + 意象标签 + 韵脚 |
| 韵书 | `char_rhyme` | 字 → 广韵声调 → 平水 106 部 → 词林 19 部 |
| | `rhyme_group` | 韵部字表（按语料常用度排序）与总目 |
| 词谱 | `list_cipai` | 龙榆生《唐宋词格律》153 调检索 |
| | `cipai_pattern` | 谱面（○●⊙△▲）、字数、体式 |
| 校验 | `check_jinti` | 近体：四起式、粘对、拗救三式、三平/仄尾、韵部、撞句、名句 |
| | `check_ci` | 依谱逐字校验 + 韵位一致性 + 撞句 |
| | `suggest_slot` | 谱位择字：韵位按已押韵部给同韵常用字 |
| | `famous_line_check` | 名句谱（跨代化用统计）+ 全语料撞句 |
| 意象 | `imagery_profile` | 档案：情感例证、共现、朝代分布、四时、搭配流变 |
| | `works_by_tag` | 意象/广谱/情感/题材/标志词/主韵部/季节 → 篇目 |
| | `co_occurrence` | 双意象共现（广谱层，与 App 同口径）+ 分代共现率 |
| 作者 | `author_fingerprint` | 风格指纹：意象、体裁、韵部偏好、偏离度 |
| 典故 | `allusion_lookup` | 28 目人工复核典故表 |
| 技艺 | `load_skill` | 载入专项工作流程（渐进披露） |

## 5 门技艺（skills/*.md）

系统提示只列目录，智能体按任务以 `load_skill` 取全文——渐进披露，省上下文：

- **jinti** —— 近体诗创作与校验（定式→选韵→起草→校验→改稿必复核）
- **tianci** —— 依谱填词（择调声情、△▲韵标口径、起韵、逐字对谱）
- **xuanyun** —— 选韵与检韵（诗平水/词词林双口径、宽窄韵、声情之说）
- **yixiang** —— 意象经营与溯源（档案层/广谱层分明、慎言首创、反季有据）
- **kaoju** —— 考据引用与证据分层（不背诵必检索、每数字有出处、A/B/C 层交代）

新增一门技艺 = 放一个 `.md` 进 `moyi_agent/skills/`，首行标题即目录摘要，零代码。

## 接入 MCP 客户端

```bash
python -m moyi_agent.mcp_server        # stdio 传输
```

Claude Code / Desktop 配置见 `mcp.json.example`（工具名带 `moyi_` 前缀，
全部标注 read-only/idempotent）。兼容 MCP Python SDK 1.x 与 2.x。

## 设计要点

- **单一事实来源**：每件工具只在 `toolkit.py` 定义一次——签名生成 schema、
  docstring 生成说明；`@beta_tool`（智能体）与 `mcp.tool`（MCP）只是两层薄封装。
- **格律引擎与 App 同口径**：`prosody.py` 是 `app.js` 校验逻辑的 Python 移植——
  四起式（七言起式命名与五言相反）、严格位二四六与句脚、拗救三式、
  △▲ 为韵标不占字位并收紧平仄、两读/无考按通配。离线自检以晏殊《浣溪沙》
  42/42 满谱 0 出律、枫桥夜泊判七绝仄起入韵 0 出律等为金标准。
- **诚实边界内置于工具**：无考如实报、层口径（档案/广谱）随数返回、
  `first_who` 标注为「今存所见最早」而非「首创」。
- **成本**：系统提示与工具表置于缓存断点前，多轮对话享前缀缓存；
  `claude-opus-5` + 自适应思考；按 claude-api 技能建议默认开启服务端拒答降级
  （`fallbacks="default"`，`--no-fallbacks` 可关）。

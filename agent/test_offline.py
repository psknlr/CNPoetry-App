"""墨一智能体离线自检：不触 API，逐项验证语料层、格律引擎与工具集。

运行：python agent/test_offline.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from moyi_agent import corpus, prosody, toolkit  # noqa: E402

FAILS: list[str] = []


def check(name: str, cond: bool, detail: str = ""):
    print(("  ✓ " if cond else "  ✗ ") + name + (f" — {detail}" if detail else ""))
    if not cond:
        FAILS.append(name)


def j(s: str) -> dict:
    return json.loads(s)


print("── 语料层 ──")
check("目录 130,720 篇", len(corpus.catalog()) == 130720, str(len(corpus.catalog())))
p = corpus.poem_by_id("CNP_TANG300_00010")
check("按 id 取篇（锦瑟）", bool(p) and "锦瑟" in corpus.fold(p["t"]), p["t"] if p else "None")
check("繁简折叠", corpus.fold("詩詞歌賦") == "诗词歌赋")

print("── 韵书 ──")
r = j(toolkit.char_rhyme("东"))
check("东 → 平水东部平声", any(x["ps"] == "东" and x["tone"] == "平" for x in r["readings"]))
check("东 → 词林第一部", any("第一部" in x["cilin"] for x in r["readings"]))
r = j(toolkit.rhyme_group("支"))
check("支部字表非空", len(r.get("chars", "")) > 50)
check("无考如实报", j(toolkit.char_rhyme("〇"))
      .get("tone", "") == "无考" or "error" in j(toolkit.char_rhyme("〇")))

print("── 近体谱式 ──")
check("五绝仄起不入韵", prosody.tmpl_lines("仄起不入韵", 5, 4) ==
      ["仄仄平平仄", "平平仄仄平", "平平平仄仄", "仄仄仄平平"])
check("七绝平起入韵首句", prosody.tmpl_lines("平起入韵", 7, 4)[0] == "平平仄仄仄平平")

print("── 近体校验（枫桥夜泊） ──")
res = prosody.check_jinti("月落乌啼霜满天\n江枫渔火对愁眠\n姑苏城外寒山寺\n夜半钟声到客船")
check("判为七绝", res["is_jinti_shape"] and res["form"] == "七言绝",
      res["form"])
check("韵脚同押平水", "先" in res["rhyme"]["pingshui_common"],
      "/".join(res["rhyme"]["pingshui_common"]))
check("出律 ≤ 1", res["best_pattern"]["n_violations"] <= 1,
      str(res["best_pattern"]["n_violations"]))
check("撞句检出（本诗在馆）", len(res["clashes"]) >= 1)

print("── 依谱填词（浣溪沙·晏殊） ──")
pat = j(toolkit.cipai_pattern("浣溪沙"))
check("浣溪沙 42 字", pat["n_chars"] == 42, str(pat["n_chars"]))
ci = prosody.check_ci("浣溪沙",
                      "一曲新词酒一杯，去年天气旧亭台。夕阳西下几时回。"
                      "无可奈何花落去，似曾相识燕归来。小园香径独徘徊。")
check("满填 42/42", ci["n_filled"] == 42 and ci["n_extra"] == 0,
      f"{ci['n_filled']}/{ci['n_slots']}")
check("出律 0 处", ci["n_violations"] == 0, str(ci["n_violations"]))
check("韵位平水灰部", "灰" in ci["rhyme"]["pingshui_common"],
      "/".join(ci["rhyme"]["pingshui_common"]))
sg = j(toolkit.suggest_slot("浣溪沙", 7, 0, "一曲新词酒一杯"))
check("谱位 7 为平韵位并推得灰韵",
      sg.get("kind") == "平韵位" and "灰" in sg.get("inferred_rhyme", []),
      json.dumps(sg, ensure_ascii=False)[:80])

print("── 名句与撞句 ──")
f = j(toolkit.famous_line_check("人生若只如初见"))
check("名句谱命中", bool(f["famous"]) or len(f["corpus_hits"]) > 0, f["verdict"])
f2 = j(toolkit.famous_line_check("量子纠缠不可及"))
check("杜撰句不撞", f2["verdict"] == "未与语料撞句", f2["verdict"])

print("── 意象·共现·标签 ──")
ip = j(toolkit.imagery_profile("杜鹃"))
check("杜鹃档案（含情感例证）", "archive" in ip and ip["archive"]["emotions"])
co = j(toolkit.co_occurrence("剑", "酒"))
check("剑·酒共现 668（广谱层，同 App）", co["n_total"] == 668, str(co["n_total"]))
wt = j(toolkit.works_by_tag("wide", "杜鹃", dynasty="清"))
check("杜鹃×清＝475（广谱层，同 App）", wt.get("n_total") == 475, str(wt.get("n_total")))
wt0 = j(toolkit.works_by_tag("imagery", "杜鹃"))
check("杜鹃档案层 140（两层口径分明）", wt0.get("n_total") == 140, str(wt0.get("n_total")))
wt2 = j(toolkit.works_by_tag("yun", "支", dynasty="先秦"))
check("支韵×先秦有作品", wt2.get("n_total", 0) > 0, str(wt2.get("n_total")))
wt3 = j(toolkit.works_by_tag("season", "秋"))
check("秋季倒排 6,204", wt3.get("n_total") == 6204, str(wt3.get("n_total")))

print("── 作者·典故·技艺 ──")
fp = j(toolkit.author_fingerprint("李白"))
check("李白指纹", fp.get("author") == "李白" and fp.get("n", 0) > 1000)
al = j(toolkit.allusion_lookup("阳关"))
check("典故阳关", al.get("implies") == "送别", str(al.get("implies")))
sk = j(toolkit.load_skill())
check("技艺目录 5 门", len(sk.get("skills", [])) == 5,
      str([s["name"] for s in sk.get("skills", [])]))
check("载入 jinti 技艺", "近体诗" in toolkit.load_skill("jinti"))
check("越权技艺名被拒", "error" in j(toolkit.load_skill("../secret")))

print("── OpenAI 兼容驱动（OpenRouter/Poe/MiniMax） ──")
from moyi_agent import providers  # noqa: E402

schemas = providers.openai_tools()
check("17 件工具 schema", len(schemas) == 17)
cr = next(s["function"] for s in schemas if s["function"]["name"] == "char_rhyme")
check("schema 含说明与必填", cr["description"].startswith("查一字")
      and cr["parameters"]["required"] == ["char"]
      and cr["parameters"]["properties"]["char"]["description"] != "")
check("默认参数不入必填",
      "limit" not in next(s["function"] for s in schemas
                          if s["function"]["name"] == "search_works")["parameters"]["required"])
check("坏参数折成 JSON 错误", "error" in j(providers.call_tool("char_rhyme", "{bad")))
check("未知工具折成 JSON 错误", "error" in j(providers.call_tool("nope", "{}")))


class _Stub:  # 两回合假端点：先要求调 char_rhyme，再作答
    class _F:  # function
        def __init__(s, n, a): s.name, s.arguments = n, a

    class _TC:
        def __init__(s, i, n, a): s.id, s.function = i, _Stub._F(n, a)

    class _Msg:
        def __init__(s, c, tc): s.content, s.tool_calls = c, tc

    class _Choice:
        def __init__(s, m): s.message = m

    class _Resp:
        def __init__(s, m): s.choices = [_Stub._Choice(m)]

    def __init__(s):
        s.calls = 0
        s.chat = s
        s.completions = s

    def create(s, *, model, messages, tools):
        s.calls += 1
        if s.calls == 1:
            return s._Resp(s._Msg(None, [s._TC("t1", "char_rhyme", '{"char":"东"}')]))
        tool_msgs = [m for m in messages if m.get("role") == "tool"]
        assert tool_msgs and "东" in tool_msgs[-1]["content"], "工具结果未回传"
        return s._Resp(s._Msg("东属上平一东。", None))


stub, msgs = _Stub(), [{"role": "user", "content": "东押什么韵"}]
out = providers.run_turn(stub, msgs, model="stub", system="s")
check("兼容循环两回合收敛", stub.calls == 2 and out == "东属上平一东。", out)
check("历史含 assistant/tool 报文",
      [m["role"] for m in msgs] == ["user", "assistant", "tool", "assistant"],
      str([m["role"] for m in msgs]))
check("预设三家齐备", set(providers.PRESETS) == {"openrouter", "poe", "minimax"})

print()
if FAILS:
    print(f"FAILED: {len(FAILS)} — {FAILS}")
    sys.exit(1)
print("ALL CHECKS PASSED")

# 墨一 · Mo Yi

**一墨藏万象** —— 基于 [CNPoetry-Hermes（诗海赫尔墨斯）](https://github.com/psknlr/CNPoetry-Hermes)
规则挖掘流水线的 **离线中华古典诗词档案馆 Android App**。

| | |
|---|---|
| 应用名 | 墨一（Mo Yi） |
| 包名 | `com.impfai.moyi` |
| 馆藏 | 26,720 首作品 · 50 个意象档案 · 487 位诗人 · 578 个词牌 · 9 品题材 |
| 权限 | 仅 `INTERNET`（供兜底环回服务器使用）—— App 不发起任何对外网络请求，全部数据离线内置 |
| 加载架构 | 主路径 `file:///android_asset` 直载（不经网络栈，免疫缓存/代理/VPN 干扰）；异常时自动切换进程内环回 HTTP 服务器兜底 |
| 最低系统 | Android 8.0（API 26） |

## 设计语言

宣纸 × 松烟墨 × 朱砂印。界面以宣纸暖底、松烟墨字、朱砂印章为骨，
文武线、卷号（卷一/卷二）、竖排印章等传统书籍装帧元素贯穿全 App；
内置霞鹜文楷（OFL 许可）按 unicode-range 懒加载；深浅双主题随系统切换。

## 功能

- **今日一诗** —— 按日期从馆藏轮换，展卷即读。
- **意象档案** —— 50 个意象：字形封面、异形词、情感光谱（支撑数计量 + 例句回源）、
  常见并置（可跳转）、朝代分布；**例证长卷**列出全部例证诗句，可过滤、
  逐条点击进入全诗并朱砂高亮命中句。
- **文库检索** —— 全文 / 题目 / 作者三种模式，简繁折叠（OpenCC 单字表）逐字检索；
  集部书架按 14 部集子浏览。
- **诗人档案** —— 小传（集内旁证 C 层）、惯用意象、体裁分布、存世作品全列表。
- **词牌定格** —— 语料归纳句式与一致率（B 层计量，不冒称词谱权威），例词全量可读。
- **题材九品** —— 定义、标志语汇、常见意象、归品作品。
- **格律** —— 阅读器一键全篇平仄注音（○平 ●仄 ⊙两读，依《广韵》逐字判定，
  多音不作语境消歧）；格律卡展示体裁计量、句式与韵脚归部；韵脚字青色标示。
- **点字释义** —— 诗中任意字一点即查：广韵读音（韵目/声调/反切）+
  《说文解字》训诂（部首/拼音/释义）。
- **韵部聚类** —— 53 组语料实押韵伴；查一字知其韵伴，组内支撑作品全量可读。
- **互文关联** —— 8,180 篇的共享语段网络（化用/同源待考），阅读器内点击对照回源。
- **意象星图** —— 50 意象同篇共现网络（canvas 力导向布局），支持拖曳平移与
  双指缩放，点选星点高亮邻接、查看共现计量并一键跳转意象档案。
- **收藏夹** —— 阅读器一键「藏」，私藏诗笺存于本机（localStorage）。
- **飞花令** —— 以字为令；用户出句逐字校验「语料实有」，墨一应令句句可回源。
- **阅读器** —— 宣纸双框卡片、竖排切换、注释/赏析折叠、篇中意象一键跳转意象档案。

一切结论遵循流水线的证据法则：**无原文，不成论断；无篇目，不成证据** ——
App 内每一条意象-情感联系、每一条例证、每一句飞花令应对，点击即达原诗。

## 目录结构

```
moyi/                     Android 工程（Kotlin + WebView + WebViewAssetLoader）
  app/src/main/assets/www/    前端（零依赖 SPA）+ 数据 + 字体
tools/export_app_data.py  从 CNPoetry-Hermes 流水线产物导出 App 静态数据
CNPoetry-Hermes-main (5).zip  原始流水线代码与语料
```

## 构建

```bash
# 1.（可选）重新生成数据：解压 zip 后运行流水线，再导出
python3 -m hermes_poetry pipeline          # 在 CNPoetry-Hermes 根目录
python3 tools/export_app_data.py --hermes <CNPoetry-Hermes 根目录> \
    --out moyi/app/src/main/assets/www/data

# 2. 构建 APK（或直接用 Android Studio 打开 moyi/）
cd moyi && ./gradlew assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
```

### Release 签名

`moyi/keystore.properties` 与 `*.jks` 均被 gitignore，不入库。首次签名：

```bash
cd moyi
keytool -genkeypair -keystore moyi-release.jks -alias moyi \
    -keyalg RSA -keysize 2048 -validity 10000
cat > keystore.properties <<'EOF'
storeFile=moyi-release.jks
storePassword=<你的密码>
keyAlias=moyi
keyPassword=<你的密码>
EOF
./gradlew assembleRelease   # 产物已签名：app/build/outputs/apk/release/app-release.apk
```

密钥库请妥善备份 —— 后续版本更新必须用同一把钥匙签名。

前端可脱离 Android 环境直接预览：

```bash
cd moyi/app/src/main/assets/www && python3 -m http.server 8765
# 打开 http://127.0.0.1:8765/index.html
```

## 致谢与许可

语料：[chinese-poetry](https://github.com/chinese-poetry/chinese-poetry) ·
规则：CNPoetry-Hermes（MIT）· 简繁折叠：OpenCC 字表 ·
字体：[霞鹜文楷](https://github.com/lxgw/LxgwWenKai)（SIL OFL 1.1）·
研发：医哲未来人工智能研究院（IMPF-AI）

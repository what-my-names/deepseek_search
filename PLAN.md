# DeepSeek 搜索插件 · 计划书

> **使用约定（每次动代码前必读本文件）**
> 1. 任何改动前，先读本文件，确认改动落在计划内；
> 2. 改完必须更新「当前状态」与「变更记录」；
> 3. 偏离计划的改动，先改计划、再改代码；
> 4. 文件写盘后必须读回校验，才可宣布成功。

---

## 1. 目标

把 DeepSeek 的 **Search / Fetch** 两个接口封成 Operit ToolPkg，让 AI 在对话里直接搜网页、抓正文。

不依赖宿主那条「Responses 端点 + `web_search` 工具」的链路——该链路在 Operit 1.12.2 上不生效（见踩坑记录）。

**形态**：ToolPkg，只注册**工具箱模块**，不注册侧边栏导航。

| 项 | 值 |
|---|---|
| toolpkg_id | `com.whatmynames.deepseek_search` |
| 版本 | `0.2.0` |
| 项目路径 | `/sdcard/x/deepseek_search/` |
| 分类 | Network |

---

## 2. 目录结构

目录规范对齐 open_api / on_air：根只放项目管理与产物，可打包源码全部进 `github/`。

```
/sdcard/x/deepseek_search/
├── PLAN.md                    # 计划书（不入包）
├── .gitignore                 # 忽略 dev/ *.bak *.log
├── github/                    # ← 可打包源码（装机指这里）
│   ├── manifest.json
│   ├── main.js
│   ├── packages/
│   │   ├── deepseek_search.js
│   │   ├── deepseek_fetch.js
│   │   ├── deepseek_research.js   # v0.2.0：搜索 + 抓前 N 篇
│   │   └── usage.js           # 用量记账
│   ├── ui/panel.ui.js
│   ├── tests/test_offline.js
│   └── README.md
├── releases/v0.1.0/           # 装机产物归档
└── dev/                       # 探针、临时文件（不入 git）
```

**git**：仓库在项目根，`.git` 是指向 `/root/git/deepseek_search` 的指针文件（`/sdcard` 是 FUSE，直接 init 写不了 objects）。

---

## 3. 接口契约（DeepSeek）

来源：`https://api-docs.deepseek.com/guides/search`（2026-10-19 抓取）

### 3.1 端点与认证

```
POST https://api.deepseek.com/v1/tools/search
POST https://api.deepseek.com/v1/tools/fetch

Authorization: Bearer <API Key>
Content-Type: application/json
```

### 3.2 Search 请求

| 字段 | 类型 | 必填 | 默认 | 约束 |
|---|---|---|---|---|
| `query` | string | 是 | - | 1–128 字符，不可全空白 |
| `count` | int | 否 | 10 | 1–50 |
| `ori_question` | string | 否 | - | 1–128 字符 |
| `localization` | string | 否 | "" | IP 地址 |
| `need_content` | bool | 否 | false | true 才返回正文 |

未知字段静默忽略。

**查询算子**：`site:` `-site:` `-词` `-"短语"` `"精确短语"` `lang:zh,en` `after:2025` `before:2026-06-01`

### 3.3 Search 响应

```json
{ "results": [ {
  "rerank_score": 2.4,
  "title": "...",
  "url": "...",
  "snippet": "100-200字，给UI",
  "summary": "600-800字，给模型",
  "content": "need_content=true 才有",
  "site_name": "...",
  "site_icon": "...",
  "date": "RFC3339 或 null",
  "authority": 3
} ] }
```

`rerank_score` 0–3（≥1.5 高质量）；`authority` 0–4（≥3 高权威，-1 未知）。

### 3.4 Fetch

```
请求: { "url": "https://..." }   // ≤8192 字符，必须 http/https，不可含账号密码
响应: { "title": "...", "content": "Markdown" }
```

### 3.5 错误码与重试（硬约束）

| 状态 | 含义 | 重试 |
|---|---|---|
| 400 | 请求非法 | 否 |
| 401 | key 缺失/无效 | 否 |
| 402 | 余额不足 | 否 |
| 403 | Fetch 被安全策略拒绝 | 否 |
| 404 | Fetch 拿不到可用内容 | 否 |
| 408 | 读请求体超时 | 是 |
| 413 | 请求体过大 | 否 |
| 429 | QPS 超限 | 是 |
| 500 / 504 | 服务端/下游错误 | 是 |

官方原文：408、429、5xx 才重试；402 先充值；其余 4xx 不改请求不要重试。

### 3.6 计费与限流

- 按**成功请求数**计费：$0.75 / 1000 次（约 5 元 / 1000 次）；
- 只有 HTTP 200 且真出结果才计费（Search 非空数组 / Fetch 有正文）；失败、空结果、超时不计费；
- `count` 不影响单价；
- 通过 Harness / Claude Code / Codex 的服务端调用，2026-11-01 00:00 起计费；
- QPS：Search 100，Fetch 25（账户级），Fetch 另有单域名限制，超限 429。

---

## 4. 工具契约（Operit 侧）

### 4.1 注册机制

| 层 | 位置 | 方式 |
|---|---|---|
| 子包声明 | `manifest.json` | `subpackages[]`：id + entry + 显示名 |
| 工具定义 | `packages/*.js` 文件头 | `/* METADATA {...} */` |
| 工具实现 | 同文件 | IIFE 内定义函数，`exports.<name> = ...` |
| UI 入口 | `main.js` 的 `registerToolPkg()` | `ToolPkg.registerToolboxUiModule(...)` |

**不注册** `registerNavigationEntry`（不出现在侧边栏）。

参考规范：
- `SandboxPackage_DEV/references/TOOLPKG_FORMAT_GUIDE.md` §3.2.5「Main 脚本注册」
- `SandboxPackage_DEV/references/SCRIPT_DEV_GUIDE.md` §3.1「脚本元数据 METADATA」
- `operit-plugin-dev-pro/references/COMPOSE_DSL_RULES.md`

### 4.2 `deepseek_search`

参数：`query`(必填) / `count` / `need_content` / `ori_question`

返回：
```json
{ "ok": true, "count": 5, "results": [ {"title","url","snippet","summary","date","authority","rerank_score","site_name"} ], "usage": {"billable": true, "note": "..."} }
```

`need_content=true` 时 results 内追加 `content`。

成功时额外带 `usage`（见 §5.4 记账结构）。

失败返回：`{ "ok": false, "status": <int>, "error": "<原始 message>", "retryable": <bool> }`，不编造结果。

### 4.3 `deepseek_fetch`

参数：`url`(必填)

返回：`{ "ok": true, "title": "...", "content": "...", "length": <int> }`

失败同上格式。

### 4.4 密钥

- 环境变量名：`DEEPSEEK_API_KEY`
- 读取：`Tools.SoftwareSettings.readEnvironmentVariable("DEEPSEEK_API_KEY")`
- 写入：`Tools.SoftwareSettings.writeEnvironmentVariable(...)`（面板内保存）
- 面板不回显明文，只显示「已配置 / 未配置」

### 4.5 网络调用

- 必须用 `Tools.Net.http({url, method, headers, body})`；
- **不能用** `Tools.Net.httpPost(url, body, headers)`——它的第三参是 `ignoreSsl`，不是 headers；
- **`Tools.Network` 不存在**，真实命名空间是 `Tools.Net`。

---

### 4.6 `deepseek_research`（v0.2.0）

一次调用完成「搜索 + 读前 N 篇」，减少往返。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `query` | string | 是 | - | 同 `deepseek_search`，支持算子 |
| `count` | int | 否 | 5 | 搜索条数，1–10 |
| `top` | int | 否 | 2 | 抓取前几条正文，0–5；0 表示只搜不抓 |

**流程**：先调 `deepseek_search`（count 条）→ 取前 top 条依次 `deepseek_fetch` → 汇总。

**返回**：
```json
{ "ok": true, "query": "...", "count": 5, "fetched": 2,
  "results": [ { "title", "url", "content", "truncated" } ],
  "failed": [ { "url", "status", "error" } ],
  "usage": { ... } }
```

- 单次可能计费 `1 + 成功抓取数` 次；
- 某条 fetch 失败不影响整体，记入 `failed`；
- 每条正文上限 8000 字符，超出标 `truncated:true`；
- search 本身失败则整体失败，不继续抓。

### 4.7 系统提示词注入（v0.2.0）

`main.js` 注册 `registerSystemPromptComposeHook`，在 `after_compose_system_prompt` 时向系统提示词追加一节，提醒模型何时该搜。

- 追加内容：需要实时信息（新闻 / 价格 / 版本号 / 文档细节）时先 `deepseek_search`，需要原文再 `deepseek_fetch`；不要凭记忆编时效性内容。
- 开关：环境变量 `DEEPSEEK_SEARCH_PROMPT`，`1`/空=开启，`0`=关闭。
- 注入失败必须静默（返回 `null`），不能影响主对话。

## 5.4 用量记账

- 模块：`github/packages/usage.js`
- 存储：`/sdcard/Download/Operit/plugins/deepseek_search/usage.json`
- 结构：`{calls, search_calls, fetch_calls, est_cost, first_at, last_at}`
- 记账时机：**仅当请求成功且真出结果才计**（Search 非空数组 / Fetch 有正文）；失败、空结果、超时不计
- 单价：5 元 / 1000 次 = `0.005` 元/次，`est_cost` 按调用次数累加并保留 4 位小数
- 展示：工具返回的 `usage` 字段 + 面板「用量统计」卡片（点「刷新用量」读取）
- 面板会写明「预估，实际以控制台账单为准」

## 5. UI 契约（工具箱面板）

注册：
```js
ToolPkg.registerToolboxUiModule({
  id: "deepseek_search_panel",
  runtime: "compose_dsl",
  screen: Panel,
  params: {},
  title: { zh: "DeepSeek 搜索", en: "DeepSeek Search" }
});
```

面板内容：

| 区块 | 内容 | 交互 |
|---|---|---|
| 状态 | 已配置 / 未配置密钥 | 只读 |
| 密钥 | 折叠式输入 + `••••••••` + 显示按钮 | 保存 → 写环境变量 → 重读校验 |
| 默认条数 | 1–50 | 保存 |
| 连接测试 | 发一次 `count=1` 的 search | 显示 HTTP 状态码与耗时 |
| 说明 | 计费：11-01 起按次计费；失败不计费 | 只读 |

约束：
- 渲染期不写文件、不调工具、不 setState；副作用放 `onLoad` 与按钮回调；
- 面板文件**顶层不可 require 其他业务包**；只在函数体内 require；
- 破坏性操作（重置密钥）用**弹窗二次确认**，不用抽屉。

---

## 6. 开发步骤

1. 写 `PLAN.md`（本文件）
2. 写 `manifest.json`（两个 subpackage）
3. 写 `packages/deepseek_search.js`
4. 写 `packages/deepseek_fetch.js`
5. 写 `main.js`（工具箱注册）
6. 写 `ui/panel.ui.js`
7. 写 `tests/test_offline.js` 并跑通
8. `debug_install_toolpkg` 装机
9. **真机验证**：真实对话调用两个工具 + 打开工具箱面板
10. 写 `README.md`

---

## 7. 验证标准

- [ ] 对话里 AI 能调 `deepseek_search`，返回真实结果并带 URL
- [ ] `deepseek_fetch` 能把指定页面抓成 Markdown
- [ ] 无密钥时返回明确错误，不静默失败
- [ ] `count` 越界在本地被拦，不发请求
- [ ] 401 / 402 / 429 返回对应提示，且不重试
- [ ] 408 / 429 / 5xx 才重试，且最多重试 2 次
- [ ] 工具箱里能看到面板，能存密钥、能测连通
- [ ] 面板不出现明文密钥

---

## 8. 已知风险 / 待验证

| # | 风险 | 验证方式 | 状态 |
|---|---|---|---|
| 1 | `main.js` 顶层 `require("./ui/panel.ui.js")` 是否可行（记忆里有「顶层 require 会报 ToolPkg container did not appear」的记录） | 装机后看是否加载成功 | 待验证 |
| 2 | `METADATA` 里 `env` 声明能否让宿主自动生成环境配置项 | 看设置界面是否出现 `DEEPSEEK_API_KEY` | **已验证：装机时报「requires environment variable: DEEPSEEK_API_KEY」，说明 env 声明被识别** |
| 3 | `Tools.Net.http` 默认超时，`need_content=true` 大页面是否截断 | 抓一个长页面测 | 待验证 |
| 4 | 面板 UI 首次部署可能需重启 Operit 才刷新 | 重启后复查 | 待验证 |
| 5 | `/sdcard` 直接 `git init` 后 `git add` 报 `unable to write file .git/objects/...: No such file or directory` | 已改用 `--separate-git-dir=/root/git/deepseek_search`，已解决 | **已验证** |

---

## 9. 当前状态

**阶段**：v0.2.0 已发布。新增 `deepseek_research`（真机验证通过）+ 系统提示词注入（已注册，运行期注入待下轮对话确认）。

已完成：
- v0.2.0：research 组合工具（搜索 + 抓前 N 篇）、系统提示词注入、manifest 三子包
- 单测 35/35 通过（新增 research 5 项）
- 真机：research 搜 3 条、抓 1 篇正文成功，usage 累计 8 次 / 0.04 元
- GitHub v0.2.0 源码 + Release

待确认：
- 系统提示词注入是否真的进了请求（看下一轮对话 AI 是否主动调用 `deepseek_search`）

---

## 10. 变更记录

| 时间 | 版本 | 内容 |
|---|---|---|
| 2026-10-19 21:42 | - | 立项，写入计划书（含 DeepSeek 接口契约、Operit 注册规范、UI 契约、风险表） |
| 2026-10-19 21:45 | 0.1.0 | 写完 manifest、两个工具、main.js、面板、单测（25/25） |
| 2026-10-19 21:50 | 0.1.0 | 装机成功，两个子包启用；env 声明被宿主识别，等待密钥 |
| 2026-10-19 21:47 | 0.1.0 | 真机验证通过：deepseek_search 返回 3 条真实结果，deepseek_fetch 抓回 2656 字符；README 完成 |
| 2026-10-19 21:52 | 0.1.0 | 目录重构：源码迁入 github/，新建 releases/v0.1.0 与 dev/；git 初始化（separate-git-dir） |
| 2026-10-19 21:58 | 0.1.0 | 新增 usage.js 用量记账；两个工具返回带 usage；面板加「用量统计」卡片；单测扩到 30 项全过 |
| 2026-10-19 23:00 | 0.1.1 | **修正认知错误**：web_search 不是「DeepSeek 不认」，而是**仅 v4-pro 支持、flash 忽略**；文案补「补的是哪一块」「Search / Fetch 怎么配合」；面板加用法卡片 |
| 2026-10-20 20:55 | 0.1.1 | GitHub 源码同步（13 文件）+ Release v0.1.1（id 418399001，资产 19406 B） |
| 2026-10-20 21:20 | 0.2.0 | 新增 `deepseek_research`（搜索 + 抓前 N 篇）+ `registerSystemPromptComposeHook` 提示词注入；单测 35/35；真机 research 通过 |
| 2026-10-20 21:22 | 0.2.0 | 参考同类项目 dsh-search（439436269-ctrl）补齐组合工具与提示词注入 |

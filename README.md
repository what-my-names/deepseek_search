# DeepSeek 搜索（Operit ToolPkg）

用 DeepSeek 自研搜索引擎搜网页、抓正文，不依赖模型自带的 `web_search` tool call。

## 为什么需要它

DeepSeek 的 Search / Fetch 是**两个独立的原始 JSON 接口**：

```
POST https://api.deepseek.com/v1/tools/search
POST https://api.deepseek.com/v1/tools/fetch
```

它们不是 `/v1/responses` 里的 `web_search` 工具。在 Responses 端点里声明 `tools:[{"type":"web_search"}]`，服务端会静默忽略，不报错也不搜。本插件直接调这两个独立接口。

## 两个工具

### `deepseek_search`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` | string | 是 | 1-128 字符，支持 `site:` `lang:` `after:` `before:` `"精确短语"` `-排除` |
| `count` | int | 否 | 1-50，默认 10 |
| `need_content` | bool | 否 | 是否带回正文，默认 false |
| `ori_question` | string | 否 | 原始问题，帮助理解意图 |

返回每条结果包含：`title` / `url` / `snippet` / `summary` / `date` / `authority`（0-4）/ `rerank_score`（0-3）/ `site_name`。

### `deepseek_fetch`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | string | 是 | http/https，≤8192 字符，不得含账号密码 |

返回 `{title, content, length, truncated}`，content 是 Markdown。

## 配置

1. 打开工具箱里的「DeepSeek 搜索」面板；
2. 粘贴 API Key（`sk-` 开头），保存；
3. 点「测试连通」，看到「连通正常」即可用。

密钥写入本机环境变量 `DEEPSEEK_API_KEY`，面板不回显明文、不上传。

## 错误与重试

| 状态 | 含义 | 重试 |
|---|---|---|
| 400 | 请求非法 | 否 |
| 401 | key 缺失/无效 | 否 |
| 402 | 余额不足 | 否 |
| 403 | Fetch 被安全策略拒绝 | 否 |
| 404 | Fetch 拿不到可用内容 | 否 |
| 408 / 429 / 5xx | 超时 / 限流 / 服务端错误 | 是（最多 2 次） |

失败时返回 `{ok:false, status, error, retryable, hint}`，不会编造结果。

## 计费

- 按**成功请求次数**计费：5 元 / 1000 次（$0.75）；
- 只有 HTTP 200 且真出结果才计费，失败/空结果/超时不收费；
- 2026-11-01 00:00 前，通过 Harness / Claude Code / Codex 的服务端调用不计费。

## 用量统计

每次成功计费的请求会记一笔，写到 `/sdcard/Download/Operit/plugins/deepseek_search/usage.json`：

```json
{ "calls": 2, "search_calls": 1, "fetch_calls": 1,
  "est_cost": 0.01, "first_at": "2026-10-19 21:50", "last_at": "2026-10-19 21:50" }
```

- 工具返回里的 `usage` 字段直接带这份数据；
- 工具箱面板底部「用量统计」卡片可随时刷新查看；
- **失败 / 空结果 / 超时不记账**；
- 金额按 5 元 / 1000 次估算，**实际以 DeepSeek 控制台账单为准**。

## 限流

Search 100 QPS，Fetch 25 QPS（账户级）；Fetch 另有单域名限制，超限返回 429。

## 已知限制

- 两个接口都是只读的；
- Fetch 受目标站点可用性、`robots` 与访问策略限制，403/404 属正常结果；
- `need_content=true` 时单条正文超过 20000 字符会截断；
- Fetch 正文超过 200000 字符会截断并标记 `truncated:true`。

## 开发

```
PLAN.md              计划书（改动前必读）
manifest.json        包声明
main.js              工具箱 UI 注册
packages/            两个工具
ui/panel.ui.js       工具箱面板（Compose DSL）
tests/test_offline.js 离线单测：node tests/test_offline.js
```

装机：

```
operit_editor:debug_install_toolpkg source_path=/sdcard/x/deepseek_search
```

## 更新日志

- **v0.1.0**：首版。搜索 + 抓取两个工具、工具箱面板、离线单测（25 项）、错误码与重试策略。

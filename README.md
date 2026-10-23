# DeepSeek 搜索（Operit ToolPkg）

用 DeepSeek 自研搜索引擎搜网页、抓正文。给非 v4-pro 模型（如 flash）补上联网能力。

## 为什么需要它

DeepSeek 的 Search / Fetch 是**两个独立的原始 JSON 接口**：

```
POST https://api.deepseek.com/v1/tools/search
POST https://api.deepseek.com/v1/tools/fetch
```

DeepSeek 有两种联网方式：

- Responses 端点的 `web_search`：模型在服务端自己搜，结果自动进上下文——**仅 deepseek-v4-pro 支持**，官方文档写明「deepseek-flash 下忽略」；
- 独立的 `/v1/tools/search` 与 `/v1/tools/fetch`：任何模型都能调，但要客户端显式发起。

所以 flash 等其他模型，开着宿主的「联网搜索」也不会真搜。**本插件补的就是这块**。

## 怎么用（示例）

```
deepseek_search    query="llama.cpp 安装" count=5
deepseek_search    query="DeepSeek 价格" site:github.com lang:zh
deepseek_fetch     url="https://example.com/a"
deepseek_research  query="DeepSeek V4 上下文长度" count=5 top=2
```

参数范围：

- search：`query`（≤128）· `count`（1-50，默认 10）· `need_content`（默认 false）· `ori_question` · `localization` · **`site` / `exclude_site` / `lang` / `after` / `before`（算子参数，插件自动拼进 query）**
- research：`query` · `count`（1-10，默认 5）· `top`（0-5，默认 2，0 = 只搜不抓）· 同样支持上面 5 个算子参数
- fetch：`url`（≤8192，http/https，不能带账号密码）

## Search 与 Fetch 怎么配合

| | Search | Fetch |
|---|---|---|
| 输入 | 关键词 / 查询式 | 一个 URL |
| 返回 | 多条结果的目录：标题、链接、摘要、权威度 | 打开那一页，返回全文 Markdown |
| 类比 | 搜索引擎结果页 | 点进某篇文章读全文 |

标准用法是两步：**先 Search 看哪几篇值得读，需要细节时再 Fetch 读全文**。多数问题靠 Search 的 `summary`（600-800 字）就够了。

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
- **搜索索引带内容过滤**：成人站点本体搜不到，只返回讨论它的媒体/科普/学术/百科页面（实测 `porn` → NHS 性健康教育站；`pornhub` → NYT、CBC、百度百科，无一条站点直链）；
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

- **v0.1.1**（当前）：文案补「补的是哪一块」与「Search / Fetch 怎么配合」；面板加用法说明
- **v0.1.0**：首版。搜索 + 抓取两个工具、用量记账、工具箱面板、离线单测 30 项、错误码与重试策略。

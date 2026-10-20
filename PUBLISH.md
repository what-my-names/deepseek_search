# 发布指南：DeepSeek 搜索 v0.1.0

两条线：**GitHub（源码 + Release 资产）** 和 **Operit 市场（上架条目）**。

---

## 一、发布前检查

| 项 | 要求 | 当前 |
|---|---|---|
| 版本号 | manifest / README / 变更记录 一致 | 0.1.0 ✅ |
| 单测 | `node github/tests/test_offline.js` 全过 | 30/30 ✅ |
| 语法 | `node --check` 四个 JS | ✅ |
| 装机 | `debug_install_toolpkg` 成功，子包 enabled | ✅ |
| 真机 | 两个工具实调成功 | ✅ |
| 产物 | `releases/v0.1.0/*.toolpkg` | 18K ✅ |
| 文案 | manifest.description + 市场-简介.txt + 市场-详情.md | ✅ |

**装机产物先用最新源码重新打一份**，不要拿旧包：

```
operit_editor:debug_install_toolpkg
  source_path=/sdcard/x/deepseek_search/github
  activate_subpackages=deepseek_search,deepseek_fetch
```

然后从 `/sdcard/Android/data/com.ai.assistance.operit/files/packages/com.whatmynames.deepseek_search.toolpkg` 拷到 `releases/v0.1.0/`。

---

## 二、GitHub 交付

### 2.1 建仓库

仓库名建议 `deepseek_search`，public。可用 GitHub MCP 的 `create_repository`（owner=what-my-names, name=deepseek_search, private=false）。

### 2.2 推送源码

本地 git 已就绪（`.git` 指向 `/root/git/deepseek_search`）。

```bash
cd /sdcard/x/deepseek_search
git remote add origin https://github.com/what-my-names/deepseek_search.git
git push -u origin master
```

令牌用 `/sdcard/x/github/.ghtok`，**不要写进命令里、不要写进 .git/config**：

```bash
git -c credential.helper='!f() { echo username=what-my-names; echo password=$(cat /sdcard/x/github/.ghtok); }; f' push -u origin master
```

### 2.3 打 Release

标签 `v0.1.0`，上传资产 `com.whatmynames.deepseek_search-v0.1.0.toolpkg`。

**关键坑**：上传必须用 Release 返回的 `upload_url`（`uploads.github.com`），拿 `api.github.com` 传会 404。

---

## 三、Operit 市场提交

入口：**市场面板 → 「发布」弹窗 → 「发布包」**

### 3.1 表单字段（大部分自动预填）

| 字段 | 来源 | 需做什么 |
|---|---|---|
| 本地条目名 | 自动 | — |
| 显示名称 | `manifest.display_name.zh` | — |
| 描述 | `manifest.description.zh` | — |
| 详情 | `manifest.description.zh` | — |
| 版本 | `manifest.version` | — |
| ToolPkg API 版本 | 自动 | — |
| **分类** | ❗需手选 | 选「网络」或留空（留空归 Other） |
| **两个开关** | ❗需手选 | 按需打开 |
| **资源来源** | ❗需手选 | 二选一（见下） |

### 3.2 资源来源二选一

- **上传当前本地包** — 直接把 `.toolpkg` 传给市场，适合不想公开仓库；
- **引用 GitHub Release 资产** — 自动从 Release 拉，后续升级只需发新 Release。

推荐第二种，跟已有的 jev 两个包一致。

### 3.3 文案三处同步

市场表单的内容是从**包内 manifest.json 的 description** 读出来预填的，所以三处必须一致：

| 位置 | 文件 |
|---|---|
| 源头（决定表单预填） | `github/manifest.json` → `description.zh` |
| 市场简介 | `市场-简介.txt` |
| 市场详情 | `市场-详情.md` |
| 插件 README | `github/README.md` |

改文案时先改 manifest，再重生 `市场-详情.md`，最后同步 README。

### 3.4 提交

最后一步「提交」需在 App 内手动点。

---

## 四、常见坑

| 坑 | 处理 |
|---|---|
| Release 上传 404 | 必须用 `upload_url`（uploads.github.com） |
| 重装后子包被禁用 | `reset_subpackage_states=true` 的副作用；装完各开一次 `set_sandbox_package_enabled` |
| 令牌失效 401 | 先按「令牌到期/被撤销」处理，去要新令牌；诊断时不要 `od` 看令牌文件 |
| 分类栏空白 | 留空不会报错，归到 Other |
| 市场文案改了但表单没变 | 表单读的是包内 manifest，不是本地文件；必须重新装机或重新上传包 |

---

## 五、当前状态

- [x] 源码 / 单测 / 装机 / 真机 均就绪
- [x] 市场简介 + 详情文案
- [x] GitHub 仓库创建 + 推送（2026-10-19 21:56，commit ed4675a）
- [x] Release v0.1.0 + 上传资产（id 417358293，资产 17689 B）
- [x] v0.1.1：修正 web_search 适用模型 + 补 Search/Fetch 说明 + 面板用法卡片 + Release（id 418399001，资产 19406 B）
- [ ] 市场表单提交（主人在 App 内完成）

### 仓库与资产地址

- 仓库：https://github.com/what-my-names/deepseek_search
- Release：https://github.com/what-my-names/deepseek_search/releases/tag/v0.1.0
- 资产：https://github.com/what-my-names/deepseek_search/releases/download/v0.1.0/com.whatmynames.deepseek_search-v0.1.0.toolpkg

### 网络限制（重要）

本机 **`github.com:443` 连不上**（connect 超时），但 **`api.github.com` 和 `uploads.github.com` 都可达**。

所以：
- 推送/建 Release/传资产都走 API + `/sdcard/x/github/.ghtok`；
- 本地 `git push` 会卡死，不要试；
- 本地 git 三条 commit 是开发历史（保留在 `/root/git/deepseek_search`），远端两条 commit 是 API 建的，两边**内容一致、历史不同**；
- 以后更新文档/代码，要么走 Contents API 逐个文件覆盖，要么等网络能连 github.com 再 `push -f` 对齐。

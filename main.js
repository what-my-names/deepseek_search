/* main.js — 注册工具箱 UI 模块 + 系统提示词注入（v0.2.0） */
"use strict";

var PanelScreen = null;
var loadError = "";
try {
    var mod = require("./ui/panel.ui.js");
    PanelScreen = (mod && mod.default) ? mod.default : mod;
} catch (e) {
    PanelScreen = null;
    loadError = String((e && e.message) || e);
}

var PROMPT_ENV = "DEEPSEEK_SEARCH_PROMPT";

var PROMPT_ADDON = [
    "## 联网搜索（deepseek_search 插件）",
    "",
    "- 需要实时或时效性信息（新闻、价格、版本号、发布日期、文档细节、API 字段）时，先调用 `deepseek_search`，不要凭记忆作答。",
    "- 需要核对某个页面的原文时，用 `deepseek_fetch` 抓成 Markdown。",
    "- 一次要读多篇来源时，用 `deepseek_research`（搜索 + 抓前 N 篇正文，一次返回）。",
    "- 搜索结果自带 `authority`（0-4）与 `rerank_score`（0-3）：≥1.5 视为优质，≥3 为高权威。引用时给出原始 URL。",
    "- 搜不到或接口报错时如实说明，不要编造来源。"
].join("\n");

function promptEnabled() {
    try {
        if (typeof getEnv !== "function") return true;
        var v = getEnv(PROMPT_ENV);
        if (v === null || v === undefined) return true;
        v = String(v).trim();
        return v !== "0";
    } catch (e) {
        return true;
    }
}

function onSystemPromptCompose(params) {
    try {
        if (!promptEnabled()) return null;
        var ev = params && (params.eventName || params.event || params.name);
        if (ev !== "after_compose_system_prompt") return null;
        var payload = (params && (params.eventPayload || params.payload)) || {};
        var sp = payload.systemPrompt !== undefined ? payload.systemPrompt : payload.system_prompt;
        if (sp === null || sp === undefined) return null;
        var text = String(sp);
        if (!text) return null;
        if (text.indexOf("## 联网搜索（deepseek_search 插件）") >= 0) return null;
        return text + "\n\n" + PROMPT_ADDON;
    } catch (e) {
        return null;
    }
}

function registerToolPkg() {
    if (PanelScreen) {
        ToolPkg.registerToolboxUiModule({
            id: "deepseek_search_panel",
            runtime: "compose_dsl",
            screen: PanelScreen,
            params: {},
            title: { zh: "DeepSeek 搜索", en: "DeepSeek Search" }
        });
    }
    try {
        ToolPkg.registerSystemPromptComposeHook({
            id: "deepseek_search_prompt",
            "function": onSystemPromptCompose
        });
    } catch (e) { /* 宿主不支持时静默 */ }
    return true;
}

exports.registerToolPkg = registerToolPkg;
exports.onSystemPromptCompose = onSystemPromptCompose;
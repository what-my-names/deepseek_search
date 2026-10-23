/* METADATA
{
    "name": "deepseek_search",
    "display_name": { "zh": "DeepSeek 搜索", "en": "DeepSeek Search" },
    "description": {
        "zh": "用 DeepSeek 自研搜索引擎搜索网页。query 支持 site:/lang:/after:/before:/\"精确短语\"/-排除 等算子，返回 title/url/snippet/summary/date/authority/rerank_score。",
        "en": "Search the web with DeepSeek's own search engine. Supports site:/lang:/after:/before:, quoted phrases and negative terms."
    },
    "author": ["what-my-names"],
    "category": "Network",
    "env": ["DEEPSEEK_API_KEY"],
    "tools": [
        {
            "name": "deepseek_search",
            "description": {
                "zh": "搜索网页。返回结构化结果（含 url、摘要、发布时间、权威度）。适合查事实、最新情况与需要来源的内容。",
                "en": "Search the web and return structured results with url, summary, date and authority."
            },
            "parameters": [
                { "name": "query", "type": "string", "required": true, "description": { "zh": "搜索词，1-128 字符，支持 site:/lang:/after:/before: 与引号精确匹配", "en": "Query, 1-128 chars, supports operators" } },
                { "name": "count", "type": "integer", "required": false, "description": { "zh": "返回条数，1-50，默认 10", "en": "Number of results, 1-50, default 10" } },
                { "name": "need_content", "type": "boolean", "required": false, "description": { "zh": "是否返回网页正文（体积大，默认 false）", "en": "Whether to include page content, default false" } },
                { "name": "localization", "type": "string", "required": false, "description": { "zh": "IP 地址，用于本地化搜索结果（可选，一般不用填）", "en": "Optional IP address used to localize results" } },
                { "name": "ori_question", "type": "string", "required": false, "description": { "zh": "触发本次搜索的用户原问题，帮助理解意图", "en": "Original user question that triggered this search" } },
                { "name": "site", "type": "string", "required": false, "description": { "zh": "只搜指定站点，等价于在 query 里加 site:xxx（多个用逗号）", "en": "Restrict to this site, same as site: operator" } },
                { "name": "exclude_site", "type": "string", "required": false, "description": { "zh": "排除指定站点，等价于 -site:xxx", "en": "Exclude this site, same as -site: operator" } },
                { "name": "lang", "type": "string", "required": false, "description": { "zh": "语言过滤，如 zh、en，或 zh,en", "en": "Language filter, e.g. zh, en, or zh,en" } },
                { "name": "after", "type": "string", "required": false, "description": { "zh": "只返回此日期之后的内容，如 2025 或 2025-01-01", "en": "Only results published after this date" } },
                { "name": "before", "type": "string", "required": false, "description": { "zh": "只返回此日期之前的内容，如 2026 或 2026-06-01", "en": "Only results published before this date" } }
            ]
        }
    ]
}
*/
"use strict";

var usageMod = require("./usage.js");

var ENDPOINT = "https://api.deepseek.com/v1/tools/search";
var KEY_NAME = "DEEPSEEK_API_KEY";
var MAX_RETRY = 2;
var RETRYABLE = { 408: 1, 429: 1, 500: 1, 502: 1, 503: 1, 504: 1 };
var CONTENT_LIMIT = 20000;

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function toInt(v, dft) {
    if (v === null || v === undefined || v === "") return dft;
    var n = parseInt(v, 10);
    return isNaN(n) ? dft : n;
}

async function readKey() {
    try {
        var r = await Tools.SoftwareSettings.readEnvironmentVariable(KEY_NAME);
        if (r === null || r === undefined) return "";
        if (typeof r === "string") return r.trim();
        if (typeof r === "object") {
            var v = r.value !== undefined ? r.value : (r.content !== undefined ? r.content : r.result);
            return v === null || v === undefined ? "" : String(v).trim();
        }
    } catch (e) { /* ignore */ }
    return "";
}

function parseError(status, content) {
    var msg = "";
    try {
        var j = JSON.parse(content);
        msg = (j && j.error && j.error.message) ? j.error.message : String(content);
    } catch (e) { msg = String(content || ""); }
    return String(msg).slice(0, 500);
}

function hintOf(status) {
    switch (status) {
        case 400: return "请求参数非法";
        case 401: return "API Key 缺失或无效，请在工具箱面板填入 DEEPSEEK_API_KEY";
        case 402: return "账户余额不足，请充值后再试";
        case 403: return "请求被安全策略拒绝";
        case 408: return "读取请求体超时";
        case 413: return "请求体过大";
        case 429: return "触发 QPS 限流（Search 100/s），请稍后再试";
        case 500: return "DeepSeek 服务端内部错误";
        case 504: return "上游请求超时";
        default: return status ? ("HTTP " + status) : "网络请求失败";
    }
}

async function postJson(url, body) {
    var key = await readKey();
    if (!key) {
        return { ok: false, status: 401, error: "未配置密钥：请在工具箱面板填入 DEEPSEEK_API_KEY", retryable: false };
    }
    var headers = { "Content-Type": "application/json", "Authorization": "Bearer " + key };
    var lastErr = null;
    for (var attempt = 0; attempt <= MAX_RETRY; attempt++) {
        var res = null;
        var status = 0;
        var content = "";
        try {
            res = await Tools.Net.http({ url: url, method: "POST", headers: headers, body: body });
            status = Number((res && (res.statusCode || res.status)) || 0);
            content = String((res && res.content) || "");
        } catch (e) {
            lastErr = (e && e.message) || e;
            if (attempt < MAX_RETRY) { await sleep(400 * (attempt + 1)); continue; }
            break;
        }
        if (status === 200) return { ok: true, status: status, content: content };
        var retryable = !!RETRYABLE[status];
        if (!retryable || attempt >= MAX_RETRY) {
            return { ok: false, status: status, error: parseError(status, content), retryable: retryable };
        }
        await sleep(400 * (attempt + 1));
    }
    return { ok: false, status: 0, error: "网络请求失败：" + String(lastErr || "unknown"), retryable: true };
}

function buildQuery(base, params) {
    var q = base;
    function add(op, val) {
        if (val === null || val === undefined || val === "") return;
        q += " " + op + String(val).trim();
    }
    add("site:", params.site);
    if (params.exclude_site) q += " -site:" + String(params.exclude_site).trim();
    add("lang:", params.lang);
    add("after:", params.after);
    add("before:", params.before);
    if (q.length > 128) {
        throw new Error("拼接算子后 query 超过 128 字符（当前 " + q.length + "），请缩短 query 或减少算子");
    }
    return q;
}

function trimResults(list, withContent) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
        var r = list[i] || {};
        var item = {
            title: r.title || "",
            url: r.url || "",
            snippet: r.snippet || "",
            summary: r.summary || "",
            date: r.date || null,
            authority: (r.authority === undefined ? null : r.authority),
            rerank_score: (r.rerank_score === undefined ? null : r.rerank_score),
            site_name: r.site_name || null,
            site_icon: r.site_icon || null
        };
        if (withContent) {
            var c = String(r.content || "");
            item.content = c.length > CONTENT_LIMIT ? c.slice(0, CONTENT_LIMIT) + "\n...[已截断]" : c;
        }
        out.push(item);
    }
    return out;
}

async function deepseek_search(params) {
    params = params || {};
    var raw = params.query === null || params.query === undefined ? "" : String(params.query).trim();
    if (!raw) throw new Error("query 不能为空");
    if (raw.length > 128) throw new Error("query 不能超过 128 字符（当前 " + raw.length + "）");
    var query = buildQuery(raw, params);

    var count = toInt(params.count, 10);
    if (count < 1 || count > 50) throw new Error("count 必须在 1-50 之间（当前 " + count + "）");

    var needContent = params.need_content === true;
    var body = { query: query, count: count, need_content: needContent };
    if (params.ori_question) body.ori_question = String(params.ori_question).slice(0, 128);
    if (params.localization) body.localization = String(params.localization).slice(0, 64);

    var r = await postJson(ENDPOINT, body);
    if (!r.ok) {
        return {
            ok: false,
            success: false,
            message: r.error,
            error: r.error,
            status: r.status,
            retryable: !!r.retryable,
            hint: hintOf(r.status)
        };
    }

    var parsed = null;
    try { parsed = JSON.parse(r.content); } catch (e) {
        return { ok: false, status: 200, error: "响应不是合法 JSON：" + String(r.content).slice(0, 200), retryable: false };
    }
    var list = (parsed && parsed.results) ? parsed.results : [];
    var billable = list.length > 0;
    var usage = billable ? await usageMod.record("search") : await usageMod.peek();
    return {
        ok: true,
        success: true,
        message: "OK",
        query: query,
        count: list.length,
        billable: billable,
        usage: usage,
        results: trimResults(list, needContent)
    };
}

exports.deepseek_search = deepseek_search;

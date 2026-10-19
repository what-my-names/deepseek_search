/* METADATA
{
    "name": "deepseek_fetch",
    "display_name": { "zh": "DeepSeek 抓页", "en": "DeepSeek Fetch" },
    "description": {
        "zh": "抓取单个网页并返回 Markdown 正文。适合在搜索后深入阅读某一篇结果。",
        "en": "Fetch a single page and return its content as Markdown."
    },
    "author": ["what-my-names"],
    "category": "Network",
    "env": ["DEEPSEEK_API_KEY"],
    "tools": [
        {
            "name": "deepseek_fetch",
            "description": {
                "zh": "把指定 URL 抓成 Markdown 正文，返回 title 与 content。受目标站点可用性与访问策略限制，403/404 属正常结果。",
                "en": "Fetch a URL and return its content as Markdown, subject to the target site's availability and access policy."
            },
            "parameters": [
                { "name": "url", "type": "string", "required": true, "description": { "zh": "要抓取的页面地址，必须 http/https，不超过 8192 字符，不得含账号密码", "en": "Page URL, http/https, max 8192 chars, no embedded credentials" } }
            ]
        }
    ]
}
*/
"use strict";

var usageMod = require("./usage.js");

var ENDPOINT = "https://api.deepseek.com/v1/tools/fetch";
var KEY_NAME = "DEEPSEEK_API_KEY";
var MAX_RETRY = 2;
var RETRYABLE = { 408: 1, 429: 1, 500: 1, 502: 1, 503: 1, 504: 1 };
var URL_LIMIT = 8192;
var CONTENT_LIMIT = 200000;

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

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
        case 400: return "URL 或请求体非法";
        case 401: return "API Key 缺失或无效，请在工具箱面板填入 DEEPSEEK_API_KEY";
        case 402: return "账户余额不足，请充值后再试";
        case 403: return "该 URL 被安全策略拒绝";
        case 404: return "拿不到可用正文（页面不存在、被站禁、类型不支持或正文不可提取）";
        case 408: return "读取请求体超时";
        case 413: return "请求体过大";
        case 429: return "触发 QPS 限流（Fetch 25/s 或单域名限制），请稍后再试";
        case 500: return "DeepSeek 服务端内部错误";
        case 504: return "上游请求超时";
        default: return status ? ("HTTP " + status) : "网络请求失败";
    }
}

function validateUrl(raw) {
    var url = raw === null || raw === undefined ? "" : String(raw).trim();
    if (!url) throw new Error("url 不能为空");
    if (url.length > URL_LIMIT) throw new Error("url 不能超过 " + URL_LIMIT + " 字符（当前 " + url.length + "）");
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error("url 必须是 http 或 https 地址");
    var host = url.replace(/^https?:\/\//i, "").split("/")[0];
    if (!host) throw new Error("url 缺少主机名");
    if (host.indexOf("@") >= 0) throw new Error("url 不得包含账号密码");
    return url;
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

async function deepseek_fetch(params) {
    params = params || {};
    var url = validateUrl(params.url);

    var r = await postJson(ENDPOINT, { url: url });
    if (!r.ok) {
        return {
            ok: false,
            status: r.status,
            error: r.error,
            retryable: !!r.retryable,
            hint: hintOf(r.status)
        };
    }

    var parsed = null;
    try { parsed = JSON.parse(r.content); } catch (e) {
        return { ok: false, status: 200, error: "响应不是合法 JSON：" + String(r.content).slice(0, 200), retryable: false };
    }

    var title = String((parsed && parsed.title) || "");
    var content = String((parsed && parsed.content) || "");
    if (!content) {
        return { ok: false, status: 200, error: "响应中没有正文内容（该页面可能无可提取的 Markdown）", retryable: false, hint: hintOf(404) };
    }

    var truncated = false;
    if (content.length > CONTENT_LIMIT) {
        content = content.slice(0, CONTENT_LIMIT) + "\n...[已截断]";
        truncated = true;
    }

    var usage = await usageMod.record("fetch");
    return {
        ok: true,
        url: url,
        title: title,
        length: content.length,
        truncated: truncated,
        billable: true,
        usage: usage,
        content: content
    };
}

exports.deepseek_fetch = deepseek_fetch;

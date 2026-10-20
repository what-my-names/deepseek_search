/* METADATA
{
    "name": "deepseek_research",
    "display_name": { "zh": "DeepSeek 研究", "en": "DeepSeek Research" },
    "description": {
        "zh": "一次调用完成「搜索 + 读前 N 篇正文」：先搜，再抓排名靠前的几篇，直接给可用材料。适合需要多来源核对的问题。",
        "en": "One-call research: search, then fetch the top N pages and return their content together."
    },
    "author": ["what-my-names"],
    "category": "Network",
    "env": ["DEEPSEEK_API_KEY"],
    "tools": [
        {
            "name": "deepseek_research",
            "description": {
                "zh": "搜索并抓取前 N 篇正文，一次返回多条来源的完整内容。会按 1 + 成功抓取数 计费。",
                "en": "Search and fetch the top N pages in one call. Billed as 1 + number of successful fetches."
            },
            "parameters": [
                { "name": "query", "type": "string", "required": true, "description": { "zh": "搜索词，1-128 字符，支持 site:/lang:/after:/before: 等算子", "en": "Query, 1-128 chars, supports operators" } },
                { "name": "count", "type": "integer", "required": false, "description": { "zh": "先搜几条，1-10，默认 5", "en": "How many results to search, 1-10, default 5" } },
                { "name": "top", "type": "integer", "required": false, "description": { "zh": "抓前几篇正文，0-5，默认 2；0 表示只搜不抓", "en": "How many pages to fetch, 0-5, default 2; 0 means search only" } }
            ]
        }
    ]
}
*/
"use strict";

var searchMod = require("./deepseek_search.js");
var fetchMod = require("./deepseek_fetch.js");
var usageMod = require("./usage.js");

var CONTENT_LIMIT = 8000;

function clampInt(v, dft, min, max) {
    if (v === null || v === undefined || v === "") return dft;
    var n = parseInt(v, 10);
    if (isNaN(n)) return dft;
    if (n < min) return min;
    if (n > max) return max;
    return n;
}

async function deepseek_research(params) {
    params = params || {};

    var query = params.query === null || params.query === undefined ? "" : String(params.query).trim();
    if (!query) throw new Error("query 不能为空");
    if (query.length > 128) throw new Error("query 不能超过 128 字符（当前 " + query.length + "）");

    var count = clampInt(params.count, 5, 1, 10);
    var top = clampInt(params.top, 2, 0, 5);

    var sr = await searchMod.deepseek_search({ query: query, count: count });
    if (!sr || !sr.ok) {
        return {
            ok: false,
            stage: "search",
            status: (sr && sr.status) || 0,
            error: (sr && sr.error) || "搜索失败",
            hint: (sr && sr.hint) || "",
            retryable: !!(sr && sr.retryable)
        };
    }

    var results = [];
    var failed = [];
    var picked = (sr.results || []).slice(0, top);

    for (var i = 0; i < picked.length; i++) {
        var item = picked[i] || {};
        var url = item.url || "";
        if (!url) continue;
        try {
            var fr = await fetchMod.deepseek_fetch({ url: url });
            if (fr && fr.ok) {
                var c = String(fr.content || "");
                var cut = c.length > CONTENT_LIMIT;
                results.push({
                    title: fr.title || item.title || "",
                    url: url,
                    authority: (item.authority === undefined ? null : item.authority),
                    rerank_score: (item.rerank_score === undefined ? null : item.rerank_score),
                    date: item.date || null,
                    truncated: cut,
                    content: cut ? c.slice(0, CONTENT_LIMIT) + "\n...[已截断]" : c
                });
            } else {
                failed.push({ url: url, status: (fr && fr.status) || 0, error: (fr && fr.error) || "抓取失败" });
            }
        } catch (e) {
            failed.push({ url: url, status: 0, error: String((e && e.message) || e) });
        }
    }

    var usage = null;
    try { usage = await usageMod.peek(); } catch (e) { usage = null; }

    return {
        ok: true,
        query: query,
        count: (sr.results || []).length,
        fetched: results.length,
        requested_top: top,
        results: results,
        failed: failed,
        usage: usage
    };
}

exports.deepseek_research = deepseek_research;

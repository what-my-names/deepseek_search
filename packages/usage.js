/* usage.js — 用量记账（本地文件，不上传）
 * 每次成功计费的请求记一笔；失败/空结果不记。
 * 文件：/sdcard/Download/Operit/plugins/deepseek_search/usage.json
 */
"use strict";

var DIR = "/sdcard/Download/Operit/plugins/deepseek_search";
var FILE = DIR + "/usage.json";
var COST_PER_CALL = 0.005; // 5 元 / 1000 次成功请求

function emptyUsage() {
    return {
        calls: 0,
        search_calls: 0,
        fetch_calls: 0,
        est_cost: 0,
        first_at: null,
        last_at: null
    };
}

function normalize(u) {
    var base = emptyUsage();
    if (!u || typeof u !== "object") return base;
    base.calls = Number(u.calls) || 0;
    base.search_calls = Number(u.search_calls) || 0;
    base.fetch_calls = Number(u.fetch_calls) || 0;
    base.est_cost = Number(u.est_cost) || 0;
    base.first_at = u.first_at || null;
    base.last_at = u.last_at || null;
    return base;
}

function nowText() {
    var d = new Date();
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
        " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

async function readText(path) {
    try {
        var r = await Tools.Files.read(path);
        if (r === null || r === undefined) return "";
        if (typeof r === "string") return r;
        if (typeof r === "object") return String(r.content || r.text || "");
    } catch (e) { /* ignore */ }
    return "";
}

async function peek() {
    var txt = await readText(FILE);
    if (!txt) return emptyUsage();
    try { return normalize(JSON.parse(txt)); } catch (e) { return emptyUsage(); }
}

async function record(kind) {
    var u = await peek();
    var ts = nowText();
    u.calls += 1;
    if (kind === "fetch") u.fetch_calls += 1;
    else u.search_calls += 1;
    u.est_cost = Math.round(u.calls * COST_PER_CALL * 10000) / 10000;
    if (!u.first_at) u.first_at = ts;
    u.last_at = ts;
    try {
        try { await Tools.Files.mkdir(DIR, true, "android"); } catch (e) { }
        await Tools.Files.write(FILE, JSON.stringify(u, null, 2));
    } catch (e) { /* 记账失败不影响主流程 */ }
    return u;
}

function summaryText(u) {
    u = normalize(u);
    if (!u.calls) return "暂无调用记录";
    return "累计 " + u.calls + " 次（搜索 " + u.search_calls + " / 抓取 " + u.fetch_calls +
        "）· 预估 " + u.est_cost.toFixed(3) + " 元 · 最后 " + (u.last_at || "-");
}

module.exports = {
    peek: peek,
    record: record,
    summaryText: summaryText,
    COST_PER_CALL: COST_PER_CALL,
    FILE: FILE
};

/* test_offline.js — 离线单测，不联网。node tests/test_offline.js */
"use strict";

var path = require("path");
var results = [];

function ok(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || "" });
}

async function expectThrow(name, fn, keyword) {
    try {
        await fn();
        ok(name, false, "预期抛错但没有");
    } catch (e) {
        var msg = String((e && e.message) || e);
        ok(name, msg.indexOf(keyword) >= 0, msg);
    }
}

// ---- mock 环境 ----
var envStore = {};
var httpCalls = [];
var httpBehaviors = [];
var FILES = {};

global.Tools = {
    SoftwareSettings: {
        readEnvironmentVariable: async function (k) { return envStore[k] || ""; },
        writeEnvironmentVariable: async function (k, v) { envStore[k] = v; return { ok: true }; }
    },
    Net: {
        http: async function (opts) {
            httpCalls.push({ url: opts.url, headers: opts.headers, body: opts.body });
            var b = httpBehaviors.length ? httpBehaviors.shift() : { statusCode: 200, content: "{\"results\":[]}" };
            if (b.throwError) throw new Error(b.throwError);
            return b;
        }
    },
    System: { sleep: async function () {} },
    Files: {
        read: async function (p) {
            return Object.prototype.hasOwnProperty.call(FILES, p) ? { content: FILES[p] } : null;
        },
        write: async function (p, c) { FILES[p] = String(c); return { ok: true }; },
        mkdir: async function () { return { ok: true }; }
    }
};

var S = require(path.join(__dirname, "..", "packages", "deepseek_search.js"));
var F = require(path.join(__dirname, "..", "packages", "deepseek_fetch.js"));

function reset() { httpCalls.length = 0; httpBehaviors.length = 0; }

(async function () {
    // 1. 参数校验
    await expectThrow("空 query 报错", function () { return S.deepseek_search({}); }, "不能为空");
    await expectThrow("query 超 128 报错", function () { return S.deepseek_search({ query: "a".repeat(129) }); }, "128");
    await expectThrow("count=0 报错", function () { return S.deepseek_search({ query: "x", count: 0 }); }, "1-50");
    await expectThrow("count=51 报错", function () { return S.deepseek_search({ query: "x", count: 51 }); }, "1-50");
    ok("参数校验不发出请求", httpCalls.length === 0, "httpCalls=" + httpCalls.length);

    // 2. 无 key
    reset(); envStore = {};
    var r = await S.deepseek_search({ query: "x" });
    ok("无 key 返回 401", r.ok === false && r.status === 401, JSON.stringify(r).slice(0, 120));
    ok("无 key 不发请求", httpCalls.length === 0, "httpCalls=" + httpCalls.length);
    ok("无 key 不重试", r.retryable === false, String(r.retryable));

    // 3. 正常返回 + 字段裁剪
    reset(); envStore = { DEEPSEEK_API_KEY: "sk-test-1234567890" };
    httpBehaviors = [{
        statusCode: 200,
        content: JSON.stringify({ results: [{
            title: "T", url: "https://e.com", snippet: "S", summary: "M",
            date: "2026-10-19T00:00:00Z", authority: 3, rerank_score: 2.4,
            site_name: "E", site_icon: "i", content: "BODY"
        }] })
    }];
    var r2 = await S.deepseek_search({ query: "x", count: 1 });
    ok("200 解析成功", r2.ok === true && r2.count === 1, JSON.stringify(r2).slice(0, 120));
    ok("未请求正文时不返回 content", r2.results[0].content === undefined, JSON.stringify(r2.results[0]));
    ok("保留 authority/rerank_score", r2.results[0].authority === 3 && r2.results[0].rerank_score === 2.4, "");
    ok("请求头带 Bearer", String((httpCalls[0] || {}).headers && httpCalls[0].headers.Authorization).indexOf("Bearer sk-test") === 0, JSON.stringify(httpCalls[0] && httpCalls[0].headers));
    ok("body 是对象且字段正确", httpCalls[0].body.query === "x" && httpCalls[0].body.count === 1, JSON.stringify(httpCalls[0].body));

    // 4. 401 不重试
    reset();
    httpBehaviors = [
        { statusCode: 401, content: "{\"error\":{\"message\":\"bad key\"}}" },
        { statusCode: 200, content: "{\"results\":[]}" }
    ];
    var r3 = await S.deepseek_search({ query: "x" });
    ok("401 不重试", httpCalls.length === 1, "httpCalls=" + httpCalls.length);
    ok("401 返回原始信息", String(r3.error).indexOf("bad key") >= 0, String(r3.error));
    ok("401 retryable=false", r3.retryable === false, String(r3.retryable));

    // 5. 429 重试两次后成功
    reset();
    httpBehaviors = [
        { statusCode: 429, content: "{}" },
        { statusCode: 429, content: "{}" },
        { statusCode: 200, content: "{\"results\":[]}" }
    ];
    var r4 = await S.deepseek_search({ query: "x" });
    ok("429 重试后成功", r4.ok === true && httpCalls.length === 3, "httpCalls=" + httpCalls.length);

    // 6. 462 不存在的码 → 不重试
    reset();
    httpBehaviors = [{ statusCode: 400, content: "{}" }, { statusCode: 200, content: "{\"results\":[]}" }];
    await S.deepseek_search({ query: "x" });
    ok("400 不重试", httpCalls.length === 1, "httpCalls=" + httpCalls.length);

    // 7. fetch url 校验
    await expectThrow("fetch 空 url 报错", function () { return F.deepseek_fetch({}); }, "不能为空");
    await expectThrow("fetch 非 http 报错", function () { return F.deepseek_fetch({ url: "ftp://x.com" }); }, "http");
    await expectThrow("fetch 带账号密码报错", function () { return F.deepseek_fetch({ url: "https://a:b@x.com" }); }, "账号密码");

    // 8. fetch 正常
    reset();
    httpBehaviors = [{ statusCode: 200, content: JSON.stringify({ title: "标题", content: "# 正文" }) }];
    var r5 = await F.deepseek_fetch({ url: "https://e.com/a" });
    ok("fetch 成功", r5.ok === true && r5.title === "标题" && r5.length === 4, JSON.stringify(r5).slice(0, 120));

    // 9. fetch 404 不重试 + 给 hint
    reset();
    httpBehaviors = [{ statusCode: 404, content: "{}" }, { statusCode: 200, content: "{\"content\":\"x\"}" }];
    var r6 = await F.deepseek_fetch({ url: "https://e.com/a" });
    ok("fetch 404 不重试", httpCalls.length === 1, "httpCalls=" + httpCalls.length);
    ok("fetch 404 有 hint", !!(r6.hint && r6.hint.length > 5), String(r6.hint));

    // 10. 网络异常重试后返回错误，不抛死
    reset();
    httpBehaviors = [
        { throwError: "boom" }, { throwError: "boom" }, { throwError: "boom" }
    ];
    var r7 = await S.deepseek_search({ query: "x" });
    ok("网络异常重试 3 次后返回错误", httpCalls.length === 3 && r7.ok === false, "httpCalls=" + httpCalls.length);

    // 11. 用量记账
    reset(); FILES = {}; envStore = { DEEPSEEK_API_KEY: "sk-test-1234567890" };
    httpBehaviors = [
        { statusCode: 200, content: JSON.stringify({ results: [{ title: "A", url: "u" }] }) },
        { statusCode: 200, content: JSON.stringify({ results: [{ title: "B", url: "u" }] }) }
    ];
    var u1 = await S.deepseek_search({ query: "a" });
    var u2 = await S.deepseek_search({ query: "b" });
    ok("首次调用记账 calls=1", !!(u1.usage && u1.usage.calls === 1), JSON.stringify(u1.usage));
    ok("二次调用记账 calls=2", !!(u2.usage && u2.usage.calls === 2), JSON.stringify(u2.usage));
    ok("预估花费 0.010 元", !!(u2.usage && Math.abs(u2.usage.est_cost - 0.01) < 1e-9), String(u2.usage && u2.usage.est_cost));

    // 12. 失败不记账
    reset();
    httpBehaviors = [{ statusCode: 401, content: "{}" }];
    var u3 = await S.deepseek_search({ query: "c" });
    ok("失败不记账（无 usage 字段）", u3.usage === undefined, JSON.stringify(u3.usage));
    ok("失败后总量不变", FILES[Object.keys(FILES)[0]] && JSON.parse(FILES[Object.keys(FILES)[0]]).calls === 2, Object.keys(FILES).join(","));

    // 输出
    var pass = 0, fail = 0;
    for (var i = 0; i < results.length; i++) {
        var t = results[i];
        if (t.pass) { pass++; console.log("PASS  " + t.name); }
        else { fail++; console.log("FAIL  " + t.name + "  ->  " + t.detail); }
    }
    console.log("\n结果：" + pass + " 通过 / " + fail + " 失败 / 共 " + results.length);
    process.exit(fail === 0 ? 0 : 1);
})();

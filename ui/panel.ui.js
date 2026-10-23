/*
 * ui/panel.ui.js — DeepSeek 搜索 · 工具箱面板
 * 遵循 COMPOSE_DSL_RULES.md：渲染期只做同步读，不写文件、不调工具；
 * 所有异步副作用放在按钮回调里，并返回 Promise。
 */
"use strict";

var KEY_NAME = "DEEPSEEK_API_KEY";
var COUNT_KEY = "DEEPSEEK_DEFAULT_COUNT";

function readEnvSync(key) {
    try {
        if (typeof getEnv !== "function") return null;
        var v = getEnv(key);
        return (v === null || v === undefined) ? "" : String(v).trim();
    } catch (e) { return null; }
}

function statusOf(v) {
    if (v === null || v === undefined) return "unknown";
    return String(v).trim() ? "set" : "missing";
}

async function readEnvAsync(key) {
    try {
        var r = await Tools.SoftwareSettings.readEnvironmentVariable(key);
        if (r === null || r === undefined) return "";
        if (typeof r === "string") return r.trim();
        if (typeof r === "object") {
            var v = r.value !== undefined ? r.value : (r.content !== undefined ? r.content : r.result);
            return v === null || v === undefined ? "" : String(v).trim();
        }
    } catch (e) { /* ignore */ }
    return "";
}

function Screen(ctx) {
    var UI = ctx.UI;
    var C = ctx.MaterialTheme.colorScheme;

    var s1 = ctx.useState("ds_key_status", statusOf(readEnvSync(KEY_NAME)));
    var keyStatus = s1[0], setKeyStatus = s1[1];

    var s2 = ctx.useState("ds_key_open", false);
    var keyOpen = s2[0], setKeyOpen = s2[1];

    var s3 = ctx.useState("ds_key_input", "");
    var keyInput = s3[0], setKeyInput = s3[1];

    var s4 = ctx.useState("ds_count", readEnvSync(COUNT_KEY) || "10");
    var countText = s4[0], setCountText = s4[1];

    var s5 = ctx.useState("ds_msg", "");
    var msg = s5[0], setMsg = s5[1];

    var s6 = ctx.useState("ds_busy", false);
    var busy = s6[0], setBusy = s6[1];

    var s7 = ctx.useState("ds_usage_text", "点「刷新用量」查看已记录的调用次数与预估花费");
    var usageText = s7[0], setUsageText = s7[1];

    var statusText = keyStatus === "set"
        ? "已配置密钥"
        : (keyStatus === "missing" ? "未配置密钥" : "状态未知，点「刷新状态」查看");
    var statusColor = keyStatus === "set" ? C.primary : C.error;

    function saveKey() {
        return (async function () {
            var v = String(keyInput || "").trim();
            if (!v) { setMsg("请先粘贴密钥再保存"); return; }
            if (v.length < 10) { setMsg("密钥长度看起来不对，请检查"); return; }
            setBusy(true);
            try {
                await Tools.SoftwareSettings.writeEnvironmentVariable(KEY_NAME, v);
                var back = await readEnvAsync(KEY_NAME);
                if (back !== v) {
                    setMsg("写入后读回不一致，请重启 Operit 后再试");
                    setKeyStatus(statusOf(back));
                } else {
                    setMsg("密钥已保存（已读回校验）");
                    setKeyStatus("set");
                }
                setKeyInput("");
                setKeyOpen(false);
            } catch (e) {
                setMsg("保存失败：" + String((e && e.message) || e));
            } finally {
                setBusy(false);
            }
        })();
    }

    function saveCount() {
        return (async function () {
            var n = parseInt(String(countText || "").trim(), 10);
            if (isNaN(n) || n < 1 || n > 50) { setMsg("默认条数必须是 1-50 的整数"); return; }
            try {
                await Tools.SoftwareSettings.writeEnvironmentVariable(COUNT_KEY, String(n));
                setMsg("默认条数已保存：" + n);
            } catch (e) {
                setMsg("保存失败：" + String((e && e.message) || e));
            }
        })();
    }

    function refreshStatus() {
        return (async function () {
            setBusy(true);
            try {
                var v = await readEnvAsync(KEY_NAME);
                setKeyStatus(statusOf(v));
                setMsg(v ? "密钥已就绪" : "未读到密钥");
            } catch (e) {
                setMsg("读取失败：" + String((e && e.message) || e));
            } finally {
                setBusy(false);
            }
        })();
    }

    function testConnection() {
        return (async function () {
            setBusy(true);
            setMsg("正在测试…");
            try {
                var mod = require("../packages/deepseek_search.js");
                var t0 = Date.now();
                var r = await mod.deepseek_search({ query: "DeepSeek", count: 1 });
                var cost = Date.now() - t0;
                if (r && r.ok) {
                    setMsg("连通正常 · HTTP 200 · " + cost + "ms · 命中 " + r.count + " 条");
                    setKeyStatus("set");
                } else if (r) {
                    setMsg("失败 · HTTP " + r.status + " · " + (r.hint || r.error || "未知错误"));
                } else {
                    setMsg("失败 · 无返回");
                }
            } catch (e) {
                setMsg("测试失败：" + String((e && e.message) || e));
            } finally {
                setBusy(false);
            }
        })();
    }

    function refreshUsage() {
        return (async function () {
            try {
                var mod = require("../packages/usage.js");
                var u = await mod.peek();
                setUsageText(mod.summaryText(u));
            } catch (e) {
                setUsageText("读取用量失败：" + String((e && e.message) || e));
            }
        })();
    }

    return UI.Column({ padding: { horizontal: 16, vertical: 12 }, spacing: 10 }, [
        UI.Row({ verticalAlignment: "center", spacing: 8 }, [
            UI.Icon({ name: "search", tint: "primary", size: 22 }),
            UI.Text({ text: "DeepSeek 搜索", style: "titleMedium", fontWeight: "bold" })
        ]),
        UI.Text({
            text: "直接调 DeepSeek 的 Search / Fetch 接口。非 v4-pro 模型（如 flash）打开宿主「联网搜索」不会真搜，这里把这块补上。",
            style: "bodySmall",
            color: C.onSurfaceVariant.copy({ alpha: 0.85 })
        }),
        UI.Card({ containerColor: C.surfaceVariant.copy({ alpha: 0.3 }), shape: { cornerRadius: 12 }, elevation: 0 }, [
            UI.Column({ padding: { horizontal: 14, vertical: 12 }, spacing: 6 }, [
                UI.Text({ text: "两个工具怎么配合", style: "bodyMedium", fontWeight: "semibold" }),
                UI.Text({ text: "Search → 给关键词，返回多条结果的目录（标题、链接、摘要、权威度），不打开网页。", style: "bodySmall", color: C.onSurfaceVariant.copy({ alpha: 0.85 }) }),
                UI.Text({ text: "Fetch → 给一个 URL，打开那一页，返回全文 Markdown。", style: "bodySmall", color: C.onSurfaceVariant.copy({ alpha: 0.85 }) }),
                UI.Text({ text: "标准用法：先 Search 看哪几篇值得读，需要原文细节时再对其中一两篇 Fetch。多数问题靠 summary（600-800 字）就够了。", style: "bodySmall", color: C.onSurfaceVariant.copy({ alpha: 0.7 }) }),
                UI.Text({ text: "筛选用算子：可直接写进 query（site: / -site: / lang: / after: / before:），也可用同名参数传给工具，插件会自动拼好。", style: "bodySmall", color: C.onSurfaceVariant.copy({ alpha: 0.7 }) })
            ])
        ]),
        UI.Card({ containerColor: C.surfaceVariant.copy({ alpha: 0.45 }), shape: { cornerRadius: 12 }, elevation: 0 }, [
            UI.Column({ padding: { horizontal: 14, vertical: 12 }, spacing: 8 }, [
                UI.Row({ verticalAlignment: "center", horizontalArrangement: "spaceBetween" }, [
                    UI.Text({ text: "API 密钥", style: "bodyMedium", fontWeight: "semibold" }),
                    UI.Text({ text: statusText, style: "bodySmall", color: statusColor })
                ]),
                UI.Text({
                    text: "密钥只写入本机环境变量 " + KEY_NAME + "，面板不回显明文，也不上传。",
                    style: "bodySmall",
                    color: C.onSurfaceVariant.copy({ alpha: 0.75 })
                }),
                UI.Row({ horizontalArrangement: "end", spacing: 4 }, [
                    UI.TextButton({ text: "刷新状态", onClick: function () { return refreshStatus(); } }),
                    UI.TextButton({
                        text: keyOpen ? "收起" : (keyStatus === "set" ? "更换密钥" : "填写密钥"),
                        onClick: function () { setKeyInput(""); setKeyOpen(!keyOpen); }
                    })
                ]),
                keyOpen ? UI.Column({ spacing: 6 }, [
                    UI.TextField({
                        value: keyInput,
                        onValueChange: function (v) { setKeyInput(v); },
                        label: "粘贴 DeepSeek API Key（sk-…）",
                        singleLine: true
                    }),
                    UI.Row({ horizontalArrangement: "end" }, [
                        UI.TextButton({ text: "取消", onClick: function () { setKeyInput(""); setKeyOpen(false); } }),
                        UI.TextButton({ text: busy ? "保存中…" : "保存", onClick: function () { return saveKey(); } })
                    ])
                ]) : UI.Spacer({})
            ])
        ]),
        UI.Card({ containerColor: C.surfaceVariant.copy({ alpha: 0.35 }), shape: { cornerRadius: 12 }, elevation: 0 }, [
            UI.Column({ padding: { horizontal: 14, vertical: 12 }, spacing: 8 }, [
                UI.Text({ text: "默认结果条数", style: "bodyMedium", fontWeight: "semibold" }),
                UI.Text({
                    text: "1-50，不传 count 时使用。条数不影响计费单价。",
                    style: "bodySmall",
                    color: C.onSurfaceVariant.copy({ alpha: 0.75 })
                }),
                UI.TextField({
                    value: countText,
                    onValueChange: function (v) { setCountText(v); },
                    label: "10",
                    singleLine: true
                }),
                UI.Row({ horizontalArrangement: "end" }, [
                    UI.TextButton({ text: "保存", onClick: function () { return saveCount(); } })
                ])
            ])
        ]),
        UI.Card({ containerColor: C.surfaceVariant.copy({ alpha: 0.35 }), shape: { cornerRadius: 12 }, elevation: 0 }, [
            UI.Column({ padding: { horizontal: 14, vertical: 12 }, spacing: 8 }, [
                UI.Text({ text: "连接测试", style: "bodyMedium", fontWeight: "semibold" }),
                UI.Text({
                    text: "发一次 count=1 的真实搜索，看能不能通。当前阶段免费，2026-11-01 00:00 起每 1000 次成功请求 5 元。",
                    style: "bodySmall",
                    color: C.onSurfaceVariant.copy({ alpha: 0.75 })
                }),
                UI.Row({ horizontalArrangement: "end" }, [
                    UI.TextButton({ text: busy ? "测试中…" : "测试连通", onClick: function () { return testConnection(); } })
                ])
            ])
        ]),
        UI.Card({ containerColor: C.surfaceVariant.copy({ alpha: 0.35 }), shape: { cornerRadius: 12 }, elevation: 0 }, [
            UI.Column({ padding: { horizontal: 14, vertical: 12 }, spacing: 8 }, [
                UI.Text({ text: "用量统计", style: "bodyMedium", fontWeight: "semibold" }),
                UI.Text({
                    text: "只记成功计费的请求（失败 / 空结果 / 超时不记）。金额按 5 元 / 1000 次估算，实际以控制台账单为准。",
                    style: "bodySmall",
                    color: C.onSurfaceVariant.copy({ alpha: 0.75 })
                }),
                UI.Text({ text: usageText, style: "bodySmall", color: C.onSurfaceVariant.copy({ alpha: 0.9 }) }),
                UI.Row({ horizontalArrangement: "end" }, [
                    UI.TextButton({ text: "刷新用量", onClick: function () { return refreshUsage(); } })
                ])
            ])
        ]),
        UI.Text({ text: msg || " ", style: "bodySmall", color: C.primary }),
        UI.Text({
            text: "工具：deepseek_search（搜网页）、deepseek_fetch（抓正文）。失败时返回状态码与原因，不编造结果。",
            style: "bodySmall",
            color: C.onSurfaceVariant.copy({ alpha: 0.7 })
        })
    ]);
}

exports.default = Screen;

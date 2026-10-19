/* main.js — 只注册工具箱 UI 模块，不注册侧边栏导航 */
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
    return true;
}

exports.registerToolPkg = registerToolPkg;

import { setupAlarm } from "./alarm";
import { runQuizLogic } from "./quiz";
import { registerMessageHandler } from "./messageHandler";

// --- Chrome Extension Listeners ---

chrome.runtime.onInstalled.addListener(async () => {
    chrome.contextMenus.create({
        id: "addWord",
        title: "Thêm '%s' vào danh sách học",
        contexts: ["selection"]
    });
    await setupAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
    await setupAlarm();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "addWord" && info.selectionText && tab?.id) {
        chrome.tabs
            .sendMessage(tab.id, { action: "OPEN_ADD_MODAL", text: info.selectionText })
            .catch((err) => console.log("SendMessage failed:", err));
    }
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "quizAlarm") runQuizLogic();
});

// Register message handler
registerMessageHandler();

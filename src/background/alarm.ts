import { getAuthMaybe, getUserSettings } from "../firebase";

const DEFAULT_INTERVAL = 10;

export async function setupAlarm() {
    try {
        const auth = await getAuthMaybe();
        if (!auth) {
            await chrome.alarms.clear("quizAlarm");
            return;
        }

        const settingsDoc = await getUserSettings();
        const interval = settingsDoc?.quizInterval || DEFAULT_INTERVAL;

        await chrome.alarms.clear("quizAlarm");
        chrome.alarms.create("quizAlarm", { periodInMinutes: parseFloat(interval.toString()) });
    } catch (e) {
        console.log("setupAlarm error:", e);
        await chrome.alarms.clear("quizAlarm");
    }
}

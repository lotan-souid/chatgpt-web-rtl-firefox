"use strict";

/**
 * Keeps the toolbar button in sync with the master switch and handles the
 * keyboard shortcut. All state lives in `storage.local`, which the content
 * script already watches, so there is no messaging to keep alive.
 */
(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const settingsApi = globalThis.ChatGptRtlSettings;
  const action = extensionApi.action ?? extensionApi.browserAction;

  async function syncBadge() {
    if (!action?.setBadgeText) {
      return;
    }

    const { enabled } = await settingsApi.read();

    await action.setBadgeText({ text: enabled ? "" : "off" });
    await action.setTitle?.({
      title: enabled
        ? "ChatGPT Web RTL — פעיל"
        : "ChatGPT Web RTL — מושבת"
    });
  }

  async function toggleEnabled() {
    const { enabled } = await settingsApi.read();
    await settingsApi.write({ enabled: !enabled });
  }

  extensionApi.commands?.onCommand?.addListener((command) => {
    if (command !== "toggle-rtl") {
      return;
    }

    toggleEnabled().catch((error) => {
      console.warn("ChatGPT Web RTL could not toggle its state.", error);
    });
  });

  extensionApi.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes.enabled) {
      syncBadge().catch(() => {});
    }
  });

  action?.setBadgeBackgroundColor?.({ color: "#6b7280" });
  syncBadge().catch(() => {});
})();

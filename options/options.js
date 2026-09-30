"use strict";

(() => {
  const settingsApi = globalThis.ChatGptRtlSettings;

  const controls = {
    enabled: document.querySelector("#enabled"),
    mode: document.querySelector("#mode"),
    patchComposer: document.querySelector("#patch-composer"),
    patchSidebar: document.querySelector("#patch-sidebar"),
    smartCodeBlocks: document.querySelector("#smart-code-blocks"),
    floatingToggle: document.querySelector("#floating-toggle"),
    hebrewFont: document.querySelector("#hebrew-font")
  };

  const details = document.querySelector("#details");
  const typography = document.querySelector("#typography");
  const status = document.querySelector("#status");
  let statusTimer;

  function announce(message) {
    status.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      status.textContent = "";
    }, 1500);
  }

  function render(settings) {
    controls.enabled.checked = settings.enabled;
    controls.mode.value = settings.mode;
    controls.patchComposer.checked = settings.patchComposer;
    controls.patchSidebar.checked = settings.patchSidebar;
    controls.smartCodeBlocks.checked = settings.smartCodeBlocks;
    controls.floatingToggle.checked = settings.floatingToggle;
    controls.hebrewFont.value = settings.hebrewFont;
    setDisabled(!settings.enabled);
  }

  /**
   * Greys out the settings that only mean anything while the extension is on.
   * The on-page button is deliberately not among them: it sits outside these
   * fieldsets because it stays available when the extension is off, which is
   * what makes it possible to switch it back on from the page.
   */
  function setDisabled(disabled) {
    details.disabled = disabled;
    typography.disabled = disabled;
  }

  async function save() {
    await settingsApi.write({
      enabled: controls.enabled.checked,
      mode: controls.mode.value,
      patchComposer: controls.patchComposer.checked,
      patchSidebar: controls.patchSidebar.checked,
      smartCodeBlocks: controls.smartCodeBlocks.checked,
      floatingToggle: controls.floatingToggle.checked,
      hebrewFont: controls.hebrewFont.value
    });

    setDisabled(!controls.enabled.checked);
    announce("ההגדרה נשמרה.");
  }

  for (const control of Object.values(controls)) {
    control.addEventListener("change", () => {
      save().catch((error) => {
        status.textContent = `שמירת ההגדרה נכשלה: ${error.message}`;
      });
    });
  }

  document.querySelector("#reset").addEventListener("click", () => {
    settingsApi
      .write({ ...settingsApi.DEFAULTS })
      .then(() => {
        render(settingsApi.DEFAULTS);
        announce("ההגדרות שוחזרו.");
      })
      .catch((error) => {
        status.textContent = `שחזור ההגדרות נכשל: ${error.message}`;
      });
  });

  settingsApi
    .read()
    .then(render)
    .catch((error) => {
      status.textContent = `טעינת ההגדרות נכשלה: ${error.message}`;
    });
})();

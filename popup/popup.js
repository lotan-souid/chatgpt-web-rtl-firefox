"use strict";

(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const settingsApi = globalThis.ChatGptRtlSettings;

  const controls = {
    enabled: document.querySelector("#enabled"),
    forceRtl: document.querySelector("#force-rtl"),
    patchComposer: document.querySelector("#patch-composer"),
    patchSidebar: document.querySelector("#patch-sidebar")
  };

  const details = document.querySelector("#details");
  const status = document.querySelector("#status");

  function render(settings) {
    controls.enabled.checked = settings.enabled;
    controls.forceRtl.checked = settings.mode === "rtl";
    controls.patchComposer.checked = settings.patchComposer;
    controls.patchSidebar.checked = settings.patchSidebar;
    details.disabled = !settings.enabled;
  }

  function currentPatch() {
    return {
      enabled: controls.enabled.checked,
      mode: controls.forceRtl.checked ? "rtl" : "auto",
      patchComposer: controls.patchComposer.checked,
      patchSidebar: controls.patchSidebar.checked
    };
  }

  async function save() {
    const patch = currentPatch();
    await settingsApi.write(patch);
    details.disabled = !patch.enabled;
    status.textContent = "נשמר.";
  }

  for (const control of Object.values(controls)) {
    control.addEventListener("change", () => {
      save().catch((error) => {
        status.textContent = `השמירה נכשלה: ${error.message}`;
      });
    });
  }

  document.querySelector("#options").addEventListener("click", (event) => {
    event.preventDefault();
    extensionApi.runtime.openOptionsPage();
    globalThis.close();
  });

  settingsApi
    .read()
    .then(render)
    .catch((error) => {
      status.textContent = `טעינת ההגדרות נכשלה: ${error.message}`;
    });
})();

"use strict";

(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const settingsApi = globalThis.ChatGptRtlSettings;

  const controls = {
    enabled: document.querySelector("#enabled"),
    mode: document.querySelector("#mode"),
    patchComposer: document.querySelector("#patch-composer"),
    patchSidebar: document.querySelector("#patch-sidebar"),
    floatingToggle: document.querySelector("#floating-toggle")
  };

  const details = document.querySelector("#details");
  const status = document.querySelector("#status");

  function render(settings) {
    controls.enabled.checked = settings.enabled;
    controls.mode.value = settings.mode;
    controls.patchComposer.checked = settings.patchComposer;
    controls.patchSidebar.checked = settings.patchSidebar;
    controls.floatingToggle.checked = settings.floatingToggle;
    details.disabled = !settings.enabled;
  }

  function currentPatch() {
    return {
      enabled: controls.enabled.checked,
      mode: controls.mode.value,
      patchComposer: controls.patchComposer.checked,
      patchSidebar: controls.patchSidebar.checked,
      floatingToggle: controls.floatingToggle.checked
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

"use strict";

const extensionApi = globalThis.browser ?? globalThis.chrome;
const checkbox = document.querySelector("#patch-composer");
const status = document.querySelector("#status");
let statusTimer;

async function restoreOptions() {
  const settings = await extensionApi.storage.local.get({
    patchComposer: true
  });
  checkbox.checked = settings.patchComposer !== false;
}

async function saveOptions() {
  await extensionApi.storage.local.set({
    patchComposer: checkbox.checked
  });

  status.textContent = "ההגדרה נשמרה.";
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    status.textContent = "";
  }, 1500);
}

checkbox.addEventListener("change", () => {
  saveOptions().catch((error) => {
    status.textContent = `שמירת ההגדרה נכשלה: ${error.message}`;
  });
});

restoreOptions().catch((error) => {
  status.textContent = `טעינת ההגדרה נכשלה: ${error.message}`;
});

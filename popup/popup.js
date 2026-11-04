"use strict";

globalThis.browser ??= globalThis.chrome;

const enabledInput = document.getElementById("enabled");
const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
const layerInputs = [...document.querySelectorAll("input[data-layer]")];
const errorBox = document.getElementById("error");

let tabId = null;

// Les erreurs du background arrivent sous forme { error } (voir background.js).
async function send(msg) {
  const res = await browser.runtime.sendMessage(msg);
  if (res && res.error) throw new Error(res.error);
  return res;
}

function render(prefs, enabled) {
  enabledInput.checked = enabled;
  for (const input of modeInputs) input.checked = input.value === prefs.mode;
  for (const input of layerInputs)
    input.checked = !!prefs.layers[input.dataset.layer];
}

function showError(err) {
  console.warn("[Layout Shower]", err);
  errorBox.textContent =
    "Impossible d'agir sur cette page (pages internes du navigateur, boutiques d'extensions, lecteur PDF…).";
  errorBox.hidden = false;
}

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  tabId = tab ? tab.id : null;
  const { prefs, state } = await send({
    type: "popup:get",
    tabId,
  });
  render(prefs, !!(state && state.enabled));
}

enabledInput.addEventListener("change", async () => {
  errorBox.hidden = true;
  try {
    const state = await send({
      type: "popup:toggle",
      tabId,
      enabled: enabledInput.checked,
    });
    enabledInput.checked = !!state.enabled;
  } catch (err) {
    enabledInput.checked = false;
    showError(err);
  }
});

for (const input of modeInputs) {
  input.addEventListener("change", () => {
    send({
      type: "popup:prefs",
      prefs: { mode: input.value },
    }).catch(showError);
  });
}

for (const input of layerInputs) {
  input.addEventListener("change", () => {
    send({
      type: "popup:prefs",
      prefs: { layers: { [input.dataset.layer]: input.checked } },
    }).catch(showError);
  });
}

init().catch(showError);

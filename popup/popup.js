"use strict";

const enabledInput = document.getElementById("enabled");
const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
const layerInputs = [...document.querySelectorAll("input[data-layer]")];
const errorBox = document.getElementById("error");

let tabId = null;

function render(prefs, enabled) {
  enabledInput.checked = enabled;
  for (const input of modeInputs) input.checked = input.value === prefs.mode;
  for (const input of layerInputs)
    input.checked = !!prefs.layers[input.dataset.layer];
}

function showError(err) {
  console.warn("[Layout Shower]", err);
  errorBox.textContent =
    "Impossible d'agir sur cette page (pages internes de Firefox, addons.mozilla.org, lecteur PDF…).";
  errorBox.hidden = false;
}

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  tabId = tab ? tab.id : null;
  const { prefs, state } = await browser.runtime.sendMessage({
    type: "popup:get",
    tabId,
  });
  render(prefs, !!(state && state.enabled));
}

enabledInput.addEventListener("change", async () => {
  errorBox.hidden = true;
  try {
    const state = await browser.runtime.sendMessage({
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
    browser.runtime.sendMessage({
      type: "popup:prefs",
      prefs: { mode: input.value },
    });
  });
}

for (const input of layerInputs) {
  input.addEventListener("change", () => {
    browser.runtime.sendMessage({
      type: "popup:prefs",
      prefs: { layers: { [input.dataset.layer]: input.checked } },
    });
  });
}

init().catch(showError);

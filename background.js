// Layout Shower — script d'arrière-plan : injection, état par onglet, badge, raccourcis.
'use strict';

const DEFAULT_PREFS = {
  mode: 'hover',
  layers: { margin: true, border: true, padding: true, content: true },
};

browser.action.setBadgeBackgroundColor({ color: '#e8883a' });
if (browser.action.setBadgeTextColor) browser.action.setBadgeTextColor({ color: '#ffffff' });

async function getPrefs() {
  const { prefs } = await browser.storage.local.get('prefs');
  return {
    ...DEFAULT_PREFS,
    ...prefs,
    layers: { ...DEFAULT_PREFS.layers, ...(prefs && prefs.layers) },
  };
}

async function savePrefs(patch) {
  const current = await getPrefs();
  const prefs = {
    ...current,
    ...patch,
    layers: { ...current.layers, ...(patch.layers || {}) },
  };
  await browser.storage.local.set({ prefs });
  // Propage aux onglets où le script est déjà injecté (les autres ignorent l'erreur).
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map((t) => sendToTab(t.id, { type: 'ls:set', state: prefs }).catch(() => {})));
  return prefs;
}

function sendToTab(tabId, msg) {
  return browser.tabs.sendMessage(tabId, msg);
}

// État de l'overlay dans l'onglet, ou null s'il n'est pas injecté.
async function getTabState(tabId) {
  try {
    const res = await sendToTab(tabId, { type: 'ls:ping' });
    return res ? res.state : null;
  } catch (_) {
    return null;
  }
}

async function setEnabled(tabId, enabled) {
  const prefs = await getPrefs();
  const current = await getTabState(tabId);
  if (!current) {
    if (!enabled) return { enabled: false, ...prefs };
    await browser.scripting.executeScript({ target: { tabId }, files: ['content/overlay.js'] });
  }
  const res = await sendToTab(tabId, { type: 'ls:set', state: { ...prefs, enabled } });
  await setBadge(tabId, res.state.enabled);
  return res.state;
}

function setBadge(tabId, enabled) {
  return browser.action.setBadgeText({ tabId, text: enabled ? 'ON' : '' }).catch(() => {});
}

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

browser.runtime.onMessage.addListener((msg, sender) => {
  if (!msg) return undefined;
  switch (msg.type) {
    case 'popup:get':
      return Promise.all([getPrefs(), getTabState(msg.tabId)]).then(([prefs, state]) => ({ prefs, state }));
    case 'popup:toggle':
      return setEnabled(msg.tabId, msg.enabled);
    case 'popup:prefs':
      return savePrefs(msg.prefs);
    case 'ls:disabled':
      if (sender.tab) setBadge(sender.tab.id, false);
      return undefined;
    default:
      return undefined;
  }
});

browser.commands.onCommand.addListener(async (command, tab) => {
  const target = tab || (await activeTab());
  if (!target) return;
  try {
    if (command === 'toggle-overlay') {
      const state = await getTabState(target.id);
      await setEnabled(target.id, !(state && state.enabled));
    } else if (command === 'cycle-mode') {
      const prefs = await getPrefs();
      await savePrefs({ mode: prefs.mode === 'hover' ? 'all' : 'hover' });
      await setEnabled(target.id, true);
    }
  } catch (err) {
    console.warn('[Layout Shower]', err);
  }
});

// La page se recharge / navigue : le script injecté disparaît, on remet le badge à zéro.
browser.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') setBadge(tabId, false);
});

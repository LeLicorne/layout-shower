# Layout Shower — extension Firefox

Affiche directement sur la page les **margins**, **borders**, **paddings** et la **zone de contenu** de chaque élément, à la manière du panneau _Mise en page_ des DevTools. Chaque valeur est affichée en px dans une étiquette noire, reliée par un trait à la zone qu'elle mesure.

| Couche  | Couleur |
| ------- | ------- |
| Margin  | orange  |
| Border  | jaune   |
| Padding | vert    |
| Contenu | bleu    |

## Modes

- **Survol** : l'élément sous la souris est annoté en détail (toutes les valeurs, taille du contenu, infobulle `tag#id.classes  L × H`).
- **Tout afficher** : tous les éléments visibles sont colorés ; les valeurs ≥ 4 px sont étiquetées (les étiquettes qui se chevauchent sont masquées pour rester lisible).

## Utilisation

- Clic sur l'icône de la barre d'outils → interrupteur, choix du mode, couches à afficher.
- `Alt+Shift+L` : activer / désactiver sur l'onglet courant.
- `Alt+Shift+M` : basculer Survol ⇄ Tout afficher.
- `Échap` : désactiver sur la page.
- Le badge **ON** indique que l'overlay est actif dans l'onglet. Il se désactive au rechargement de la page.

Les raccourcis se modifient dans `about:addons` → ⚙ → _Gérer les raccourcis d'extensions_.

## Installation

### Temporaire (développement)

1. Ouvrir `about:debugging#/runtime/this-firefox`
2. _Charger un module complémentaire temporaire…_ → choisir `manifest.json`

### Permanente

Firefox (version stable) n'installe que les extensions signées :

```sh
npx web-ext build --ignore-files "test/**"     # crée web-ext-artifacts/layout_shower-1.0.0.zip
npx web-ext sign --channel=unlisted --api-key=... --api-secret=...   # signature AMO (clés sur addons.mozilla.org)
```

Le `.xpi` signé s'installe ensuite par glisser-déposer dans Firefox.
Sur Firefox Developer Edition / Nightly, on peut aussi passer `xpinstall.signatures.required` à `false` dans `about:config` et installer directement `layout-shower.xpi`.

## Permissions

`activeTab` + `scripting` (injection uniquement dans l'onglet où vous l'activez), `storage` (préférences). Aucune donnée collectée.

## Limites

Ne fonctionne pas sur les pages internes de Firefox (`about:*`), sur addons.mozilla.org ni dans le lecteur PDF (restriction de Firefox).

## Développement

- `content/overlay.js` : rendu sur un canvas plein écran dans un Shadow DOM, aucun impact sur le style de la page.
- `test/index.html` : page de test (`python3 -m http.server`, puis activer l'extension dessus).
- `npx web-ext lint --ignore-files "test/**"`

## Licence

[MIT](LICENSE)

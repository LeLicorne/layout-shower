# Layout Shower — extension Firefox & Chrome

Affiche directement sur la page les **margins**, **borders**, **paddings** et la **zone de contenu** de chaque élément, à la manière du panneau _Mise en page_ des DevTools. Chaque valeur est affichée en px dans une étiquette noire, reliée par un trait à la zone qu'elle mesure.

| Couche  | Couleur |
| ------- | ------- |
| Margin  | orange  |
| Border  | jaune   |
| Padding | vert    |
| Contenu | bleu    |

### Flex, grid et gaps

| Élément | Couleur | Affichage |
| ------- | ------- | --------- |
| Flex    | violet  | contour pointillé du conteneur et des items, flèche = axe principal, badge `flex row wrap` |
| Grid    | rose    | lignes de pistes, taille de chaque colonne / ligne (survol), badge `grid 3×2` |
| Gap     | turquoise hachuré | zone du gap avec sa taille en px (flex : entre items et entre lignes ; grid : entre pistes) |

En survol, l'infobulle ajoute `direction · wrap · justify · align`, les `gap` (row / col) et, pour un item flex, `grow · shrink · basis`.
Chacun s'active séparément dans la section _Mise en page_ du popup.

## Modes

- **Survol** : l'élément sous la souris est annoté en détail (toutes les valeurs, taille du contenu, infobulle `tag#id.classes  L × H`).
- **Tout afficher** : tous les éléments visibles sont colorés ; les valeurs ≥ 4 px sont étiquetées (les étiquettes qui se chevauchent sont masquées pour rester lisible).

## Utilisation

- Clic sur l'icône de la barre d'outils → interrupteur, choix du mode, couches à afficher.
- `Alt+Shift+L` : activer / désactiver sur l'onglet courant.
- `Alt+Shift+M` : basculer Survol ⇄ Tout afficher.
- `Échap` : désactiver sur la page.
- Le badge **ON** indique que l'overlay est actif dans l'onglet. Il se désactive au rechargement de la page.

Les raccourcis se modifient dans `about:addons` → ⚙ → _Gérer les raccourcis d'extensions_ (Firefox) ou `chrome://extensions/shortcuts` (Chrome).

## Installation

### Temporaire (développement)

Construire d'abord : `npm ci && npm run build` (produit `dist/firefox`, `dist/chrome` et les zips dans `web-ext-artifacts/`).

**Firefox** :

1. Ouvrir `about:debugging#/runtime/this-firefox`
2. _Charger un module complémentaire temporaire…_ → choisir `dist/firefox/manifest.json`

**Chrome** : ouvrir `chrome://extensions`, activer le _Mode développeur_, _Charger l'extension non empaquetée_ → choisir `dist/chrome`.

### Permanente

Firefox (version stable) n'installe que les extensions signées :

```sh
npx web-ext build --ignore-files "test/**"     # crée web-ext-artifacts/layout_shower-1.1.1.zip
npx web-ext sign --channel=unlisted --api-key=... --api-secret=...   # signature AMO (clés sur addons.mozilla.org)
```

Le `.xpi` signé s'installe ensuite par glisser-déposer dans Firefox.
Sur Firefox Developer Edition / Nightly, on peut aussi passer `xpinstall.signatures.required` à `false` dans `about:config` et installer directement `layout-shower.xpi`.

## Permissions

`activeTab` + `scripting` (injection uniquement dans l'onglet où vous l'activez), `storage` (préférences). Aucune donnée collectée.

## Limites

Ne fonctionne pas sur les pages internes du navigateur (`about:*`, `chrome://*`), sur les boutiques d'extensions ni dans le lecteur PDF (restriction des navigateurs).

Sous Chrome, les pistes de grille sont calculées à partir des valeurs CSS calculées (l'API `getGridFragments()` n'existe que dans Firefox) : elles peuvent être légèrement moins précises.

## Développement

- `content/overlay.js` : rendu sur un canvas plein écran dans un Shadow DOM, aucun impact sur le style de la page.
- `test/index.html` : page de test (`python3 -m http.server`, puis activer l'extension dessus).
- `npm run build` : génère `dist/firefox` et `dist/chrome` (le manifest Chrome est dérivé de `manifest.json`, qui reste le manifest Firefox) + les zips.
- `npm run check` : vérifie la cohérence des deux builds ; `npm run lint` : `web-ext lint` des deux builds.

### Release automatique

Les commits suivent [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`…). Sur `main`, [release-please](https://github.com/googleapis/release-please) maintient une PR « chore(main): release x.y.z » (bump de `manifest.json` / `package.json`, `CHANGELOG.md`). La fusionner crée le tag et la GitHub Release, puis le workflow `release.yml` :

1. construit et vérifie les deux zips, les joint à la release ;
2. publie sur AMO (`web-ext sign --channel=listed`) ;
3. publie sur le Chrome Web Store (`chrome-webstore-upload-cli --auto-publish`).

Secrets GitHub requis pour Firefox : `WEB_EXT_API_KEY`, `WEB_EXT_API_SECRET`. La publication Chrome est **optionnelle** : elle est ignorée tant que les secrets `CHROME_*` ne sont pas définis. Pour l'activer : `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`. Pour republier un tag à la main : _Actions → Release → Run workflow_.

## Licence

[MIT](LICENSE)

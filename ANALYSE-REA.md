# Analyse avec REA (Reverse Engineer Anything)

Outil : [`rea-agents` 6.5.0](https://github.com/morluto/rea), commandes `inspect-web-page` et `analyze-web-bundle`. Elles s'attachent à un Chromium via le Chrome DevTools Protocol (port 9222).

## 1. Cible demandée : https://jarvisapp.in/ → non analysable

| Essai | Résultat |
|---|---|
| `curl https://jarvisapp.in/` | `CONNECT tunnel failed, response 403` (le proxy de sortie de l'environnement cloud refuse ce domaine) |
| Récupération côté serveur (WebFetch) | `getaddrinfo ENOTFOUND jarvisapp.in` (le domaine ne se résout pas) |
| Chromium + CDP sur l'URL | page d'erreur `ERR_TUNNEL_CONNECTION_FAILED` |
| `rea inspect-web-page` sur cet onglet | `target_unavailable` / `target_not_allowed` : REA refuse d'analyser la page d'erreur interne `chrome-error://` |

Aucune preuve n'a donc été collectée sur le code réel de jarvisapp.in. Une recherche web ne renvoie pas non plus ce domaine, seulement des applis homonymes « Jarvis » sur l'App Store. Les explications du README décrivent la façon standard de construire ces trois briques dans un navigateur. Ce sont des **déductions**, pas des observations du site.

Pour l'analyser vous-même sur votre machine :

```bash
npx rea-agents@latest setup          # ou : npm i -g rea-agents
chrome --remote-debugging-port=9222 --user-data-dir=/tmp/rea https://jarvisapp.in/
rea list-browser-targets http://127.0.0.1:9222
rea inspect-web-page http://127.0.0.1:9222 <targetId> --observation-ms 3000 --include-script-sources
rea analyze-web-bundle http://127.0.0.1:9222 <targetId>
```

Dans les résultats, cherchez `SpeechRecognition`, `speechSynthesis`, `<canvas>`/`requestAnimationFrame` ou des `@keyframes` CSS, ainsi que les *endpoints* `fetch` vers l'API d'IA.

## 2. Contrôle : REA sur le clone (http://localhost:3000)

`inspect-web-page` (preuve `ev_f3e5fa91…`) :
- 3 scripts non-module : `app.js`, `commands.js`, `reactor.js`. Tous sont réconciliés `exact` avec les ressources réseau. Aucun source map, aucune dépendance tierce.
- 102 nœuds DOM, 1 seule frame, aucune connexion WebSocket ni worker.

`analyze-web-bundle` :
- Points d'accès détectés de façon statique : `/api/chat` (`fetch`, `app.js` l.453) et `/api/status` (`fetch`, l.511).
- Aucun *vendor* reconnu ni route SPA : c'est cohérent avec du JavaScript natif sans framework.

REA retrouve donc l'architecture du clone sans lire son code source : une page statique, trois scripts, et un backend joint par `fetch` qui porte l'IA.

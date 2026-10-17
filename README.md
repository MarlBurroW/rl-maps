# RL Maps

Market et loader de maps custom pour **Rocket League** (Epic Games et Steam), sans BakkesMod.

Tu parcours le catalogue, tu cliques sur **Installer** puis sur **Jouer**, et la map t'attend dans
Free Play.

## Télécharger

Dernière version : **[Releases](https://github.com/MarlBurroW/rl-maps/releases/latest)**
- `RL-Maps-Setup-x.y.z.exe` : installeur (raccourci, désinstallation propre)
- `RL-Maps-x.y.z-portable.exe` : version portable, sans installation

L'app se met ensuite à jour toute seule (installeur) : la nouvelle version se télécharge en arrière-plan et s'installe
au redémarrage. La version portable signale simplement qu'une nouvelle version est disponible.

> L'exécutable n'est pas signé : au premier lancement, Windows SmartScreen peut afficher
> « Windows a protégé votre ordinateur ». Clique sur **Informations complémentaires → Exécuter quand même**.

## Fonctionnalités

- **Market** : plus de 400 maps, issues de [lethamyr.com](https://lethamyr.com/maps), de
  [BakkesPlugins](https://bakkesplugins.com/maps) (la bibliothèque de maps de BakkesMod) et de
  [VGM](https://videogamemods.com/vgm/rocketleague/mods). Recherche, filtres par
  catégorie et par source, fiches détaillées. Installation en un clic, avec suivi de la progression.
- **Doublons fusionnés** : une map publiée sur les deux sources n'apparaît qu'une fois, et si un lien ne marche pas
  (quota Google Drive, par exemple), le téléchargement bascule automatiquement sur l'autre source.
- **Bibliothèque** : tes maps installées, avec recherche, favoris, tri (ajoutées ou jouées récemment, nom, taille),
  espace disque occupé et bouton « Au hasard ». Glisse-dépose un `.upk`, `.udk` ou `.zip` n'importe où dans la fenêtre pour en ajouter.
- **Mises à jour des maps** : quand un auteur publie une nouvelle version, l'app la propose (badge et bouton) ou
  l'installe d'office (réglage).
- **Reste en arrière-plan** : fermer la fenêtre garde l'app près de l'horloge (clic pour rouvrir, clic droit pour
  restaurer l'original ou quitter).
- **Chargement sûr** : l'original est sauvegardé une seule fois (`Labs_Underpass_P.upk.bak`), chaque écriture passe
  par un fichier temporaire, et l'original peut être restauré automatiquement à la fermeture.
- **Compatibilité affichée** : chaque map est comparée aux fichiers de **ton** jeu. Celles qui dépendent de paquets
  absents (souvent supprimés par une mise à jour de Rocket League) portent un badge « Rendu incomplet », la fiche détaille
  ce qui manque, et le filtre « Rendu complet » ne montre que les maps sans souci.
- **Maps en plusieurs paquets** : les paquets annexes (niveaux secondaires, assets) sont copiés à côté de la map,
  sans jamais remplacer un fichier du jeu, et retirés à la restauration.
- **Arène choisie selon la map** : l'app lit les dépendances de chaque map. Celles qui réutilisent des éléments
  d'Underpass (sol, bordures…) sont chargées dans **Utopia Retro**, pour ne pas perdre ces éléments en remplaçant Underpass.
- **Compatible avec les anciens loaders** : un backup laissé par [marzeq/rl-map-loader](https://github.com/marzeq/rl-map-loader)
  ou [nikosleft/rl-map-loader](https://github.com/nikosleft/rl-map-loader) est reconnu et peut être restauré.
- **Détection automatique** de l'installation (Epic, Steam, Heroic) et du jeu lancé.
- **Pas de droits admin** quand le dossier du jeu est accessible en écriture (c'est le cas par défaut avec Epic).
  Sinon, une seule invite UAC au moment de l'écriture.
- **Registres ouverts** : chaque source est un fichier JSON dans [`registry/sources/`](registry/README.md), mis à jour
  chaque semaine par la CI. On ajoute une map par PR, et on peut brancher d'autres registres dans les réglages.

## Jouer

1. **Jouer** sur une map de la bibliothèque.
2. Sur Epic : Bibliothèque → Rocket League → **⋯ → Lancer sans anti-triche**.
3. Entraînement → Free Play → l'arène indiquée en bas de l'app (**Underpass** le plus souvent, **Utopia Retro** pour certaines maps).
4. Avant de rejouer en ligne : **Restaurer l'original** (automatique en quittant l'app si l'option est active).

Textures roses ou manquantes ? Installe une fois pour toutes le
[pack de textures Workshop](https://videogamemods.com/vgm/rocketleague/mods/workshop-textures) dans `TAGame/CookedPCConsole`.
Si une map reste incomplète malgré le pack, sa fiche dans l'app indique les paquets manquants : en général des paquets
que Rocket League a supprimés depuis (`grass_textures`, `PostProcess`, `PhysicalMaterials`…). Seul son auteur peut la corriger.

> Projet non affilié à Psyonix ni à Epic Games. N'utilise jamais une map custom en partie en ligne.

## Développement

```bash
npm install
npm run dev          # app en mode dev (HMR)
npm test             # tests unitaires
npm run typecheck
npm run dist         # installeur + version portable Windows dans dist/
```

### Publier une version

Les releases sont automatiques (`.github/workflows/release.yml`) : à chaque push sur `main`, si la version de
`package.json` n'a pas encore de release, la CI teste, construit l'installeur et la version portable, puis publie
la release GitHub avec des notes générées.

```bash
npm version patch        # ou minor / major : met à jour package.json et crée le commit
git push --follow-tags
```

Test bout-en-bout avec téléchargement réel : `RLMAPS_NET=1 npx vitest run tests/integration.test.ts`.

Pour lancer une instance isolée (données et réglages séparés) : `RLMAPS_USER_DATA=/un/dossier npm run dev`.

> Depuis le terminal intégré de VS Code, la variable `ELECTRON_RUN_AS_NODE=1` est héritée et empêche
> Electron de démarrer : lance avec `env -u ELECTRON_RUN_AS_NODE npm run dev`.

### Architecture

```
src/
  main/                 process principal (Node)
    game/slot.ts        swap des arènes Labs (Underpass, Utopia Retro) <-> map, backups, état
    game/upk.ts         lecture des dépendances d'une map (en-tête des paquets UE3)
    game/packages.ts    inventaire des paquets du jeu installé
    game/fsops.ts       écritures atomiques + repli UAC
    game/detect.ts      détection Epic / Steam / Heroic
    library/            bibliothèque locale (+ extraction zip)
    market/             registres (réseau -> cache -> copie embarquée) et téléchargements
    index.ts            fenêtre, IPC, protocole rlmaps:// pour les miniatures
  preload/              pont IPC typé (contextIsolation + sandbox)
  renderer/             UI React + Tailwind
  shared/               types et config partagés
registry/
  sources/              un registre JSON par source (lethamyr, bakkesplugins, vgm, community)
  scripts/              importeurs et validation
```

Les données de l'app sont dans `%APPDATA%/RL Maps` : `library/` (maps), `cache/` (registres) et `settings.json`.

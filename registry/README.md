# Registres de maps

Le **Market** de RL Maps agrège plusieurs registres. Chaque registre est un simple fichier JSON public
(format décrit par [`schema.json`](schema.json)). L'app télécharge les registres au démarrage, garde une
copie locale pour fonctionner hors ligne, et embarque la version de ce dossier comme dernier recours.

Les fichiers de maps ne sont **pas** hébergés ici : chaque entrée pointe vers le lien publié par l'auteur
ou par la plateforme d'origine.

## Sources intégrées

| Fichier | Origine | Mise à jour |
| --- | --- | --- |
| [`sources/lethamyr.json`](sources/lethamyr.json) | [lethamyr.com](https://lethamyr.com/maps), liens Google Drive de l'auteur | `scripts/import-lethamyr.mjs` |
| [`sources/bakkesplugins.json`](sources/bakkesplugins.json) | [bakkesplugins.com/maps](https://bakkesplugins.com/maps), la bibliothèque de maps de BakkesMod (fichiers sur `cdn.bakkesplugins.com`) | `scripts/import-bakkesplugins.mjs` |
| [`sources/community.json`](sources/community.json) | Ajouts manuels par PR | à la main |

Les deux premiers fichiers sont régénérés chaque lundi par [`.github/workflows/registry.yml`](../.github/workflows/registry.yml)
(`npm run registry:import` en local). N'édite pas ces fichiers à la main, tes changements seraient écrasés.

### Doublons entre sources

Beaucoup de maps sont publiées à la fois sur lethamyr.com et sur BakkesPlugins. L'app les fusionne quand le
titre et l'auteur correspondent (casse, accents et ponctuation ignorés) : la première source de la liste
fournit la fiche, et les liens des autres deviennent des **miroirs**. Si Google Drive refuse un
téléchargement (quota dépassé), l'app bascule automatiquement sur le CDN de BakkesPlugins.

## Ajouter une map

1. Ajoute une entrée dans `sources/community.json` :

   ```json
   {
     "id": "monpseudo-ma-map",
     "name": "Ma Map",
     "author": "MonPseudo",
     "summary": "Une phrase qui donne envie.",
     "description": "Description complète, règles, conseils…",
     "recommendedSettings": "Boost: Unlimited",
     "tags": ["Race"],
     "thumbnail": "https://…/cover.jpg",
     "homepage": "https://…",
     "source": "manual",
     "download": {
       "url": "https://github.com/moi/ma-map/releases/download/v1/MaMap.zip",
       "filename": "MaMap.zip",
       "size": 12345678
     }
   }
   ```

2. Vérifie : `npm run registry:validate` (ajoute `-- --check-links` pour tester les liens).
3. Ouvre une PR. La CI valide les fichiers automatiquement.

### Règles

- `id` : unique dans tous les registres et stable (lettres, chiffres, `-`, `_`, `.`). Il sert à reconnaître une map déjà installée.
- `download.url` : en `https`, vers un `.zip` contenant un `.udk`/`.upk`, ou directement vers le `.udk`/`.upk`.
  Les liens de partage Google Drive (`/file/d/<id>/view`) et Dropbox sont convertis automatiquement.
  `download.mirrors` (optionnel) liste d'autres liens vers le même fichier.
- `thumbnail` : image 16:9 en `https`, idéalement moins de 500 Ko.
- Dans un zip, l'app prend le plus gros `.udk`/`.upk`, une image comme miniature, et lit `info.json`
  (`{ "author": "…", "desc": "Titre" }`) s'il est présent.
- N'ajoute que des maps dont l'auteur autorise la diffusion.

## Ajouter un autre registre

N'importe quelle URL `https` qui renvoie ce format peut servir de registre : dans l'app,
**Réglages → Sources du market → Ajouter**.

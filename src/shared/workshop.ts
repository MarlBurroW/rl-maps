// Sans dépendance : importé aussi directement par Node dans les scripts du registre.

/**
 * Paquets du pack « Workshop textures » (moteur et éditeur UDK). Certains zips de maps les embarquent :
 * ce ne sont jamais la map elle-même.
 */
export const WORKSHOP_TEXTURE_PACKAGES = new Set([
  'editorlandscaperesources',
  'editormaterials',
  'editormeshes',
  'editorresources',
  'enginedebugmaterials',
  'enginematerials',
  'engineresources',
  'maptemplateindex',
  'maptemplates',
  'nodebuddies',
  'engine_mi_shaders',
  'enginevolumetrics',
  'enginebuildings',
  'mods'
])

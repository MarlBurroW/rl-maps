import { CircleCheck, TriangleAlert } from 'lucide-react'
import { describeDependency } from '../../../shared/compat'

/** Petit badge sur la miniature quand des dépendances de la map manquent dans le jeu. */
export function CompatBadge({ missing, className = '' }: { missing?: string[]; className?: string }) {
  if (!missing?.length) return null
  return (
    <span
      title={`Rendu possiblement incomplet : ${missing.join(', ')} absent${missing.length > 1 ? 's' : ''} du jeu`}
      className={`inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-warn backdrop-blur ${className}`}
    >
      <TriangleAlert className="size-3" /> Rendu incomplet
    </span>
  )
}

/** Section de la fiche : ce qui manque et ce que ça change en jeu. */
export function CompatSection({ missing }: { missing?: string[] }) {
  if (missing === undefined) return null

  if (missing.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-ok">
        <CircleCheck className="size-4" /> Toutes les dépendances de cette map sont présentes dans ton jeu.
      </p>
    )
  }

  return (
    <div className="rounded-xl border border-warn/30 bg-warn/5 p-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-warn uppercase">
        <TriangleAlert className="size-4" /> Rendu possiblement incomplet
      </h3>
      <p className="mt-2 text-[13px] text-muted">
        La map reste jouable, mais elle utilise des éléments absents de ton jeu. Aucun loader ne peut les recréer : seul son auteur peut
        la mettre à jour.
      </p>
      <ul className="mt-3 space-y-2">
        {missing.map((pkg) => {
          const info = describeDependency(pkg)
          return (
            <li key={pkg} className="text-sm">
              <span className="font-mono text-[12px] text-fg">{pkg}</span>
              <span className="text-muted"> — {info.effect}</span>
              <span className="block text-[12px] text-faint">{info.reason}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

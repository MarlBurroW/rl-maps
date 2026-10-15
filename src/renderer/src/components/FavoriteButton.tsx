import { Heart } from 'lucide-react'
import { useApp, type Item } from '../state'

/** Petit cœur pour ajouter/retirer une map des favoris. */
export function FavoriteButton({ item, className = '' }: { item: Item; className?: string }) {
  const { favorites, toggleFavorite } = useApp()
  const on = favorites.has(item.favId)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        toggleFavorite(item)
      }}
      aria-pressed={on}
      aria-label={on ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      title={on ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      className={`rounded-full bg-black/50 p-1.5 backdrop-blur transition hover:scale-110 active:scale-95 ${
        on ? 'text-rose-500' : 'text-white/80 hover:text-white'
      } ${className}`}
    >
      <Heart className={`size-4 ${on ? 'fill-current' : ''}`} />
    </button>
  )
}

import { useState } from 'react'
import { Gamepad2 } from 'lucide-react'

/** Miniature (16:9 par défaut) avec repli propre si l'image manque ou ne charge pas. */
export function Thumb({ src, alt, className = '', ratio = true }: { src?: string | null; alt: string; className?: string; ratio?: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`relative overflow-hidden bg-surface-2 ${ratio ? 'aspect-video' : ''} ${className}`}>
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center bg-gradient-to-br from-blue/15 via-surface-2 to-orange/15">
          <Gamepad2 className="size-10 text-faint" />
        </div>
      )}
    </div>
  )
}

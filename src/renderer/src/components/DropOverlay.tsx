import { useEffect, useState } from 'react'
import { Upload } from 'lucide-react'

/** Glisser-déposer de fichiers n'importe où dans la fenêtre. */
export function DropOverlay({ onFiles }: { onFiles: (paths: string[]) => void }) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setActive(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setActive(false)
    }
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setActive(false)
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => window.api.getPathForFile(f)).filter(Boolean)
      if (paths.length) onFiles(paths)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [onFiles])

  if (!active) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-6 backdrop-blur-sm">
      <div className="flex size-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-blue/60 bg-blue/5">
        <Upload className="size-10 text-blue" />
        <p className="font-display text-xl font-semibold">Dépose tes maps ici</p>
        <p className="text-sm text-muted">Fichiers .upk, .udk ou .zip</p>
      </div>
    </div>
  )
}

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react'

type Tone = 'success' | 'error' | 'info'
interface Toast {
  id: number
  tone: Tone
  title: string
  body?: string
}

const ToastContext = createContext<(tone: Tone, title: string, body?: string) => void>(() => {})

export const useToast = () => useContext(ToastContext)

const icons = {
  success: <CircleCheck className="size-5 text-ok" />,
  error: <TriangleAlert className="size-5 text-danger" />,
  info: <Info className="size-5 text-blue" />
}

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const push = useCallback(
    (tone: Tone, title: string, body?: string) => {
      const id = nextId++
      setToasts((t) => [...t.slice(-3), { id, tone, title, body }])
      setTimeout(() => dismiss(id), tone === 'error' ? 9000 : 6000)
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-5 bottom-24 z-50 flex w-96 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="animate-fade-up pointer-events-auto flex gap-3 rounded-xl border border-line bg-surface-2/95 p-4 shadow-2xl shadow-black/40 backdrop-blur"
          >
            <div className="mt-0.5 shrink-0">{icons[t.tone]}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.body && <p className="selectable mt-1 text-[13px] leading-snug whitespace-pre-line text-muted">{t.body}</p>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="-mt-1 -mr-1 h-fit rounded-md p-1 text-faint hover:bg-white/5 hover:text-fg"
              aria-label="Fermer"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

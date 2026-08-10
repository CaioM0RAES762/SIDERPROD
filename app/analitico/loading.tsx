export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-[#0f1117] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent animate-spin" />
        <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-400 dark:text-white/28">Carregando…</p>
      </div>
    </div>
  )
}

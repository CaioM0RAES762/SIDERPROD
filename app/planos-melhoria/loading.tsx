export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
        <p className="text-slate-600 text-sm">Carregando...</p>
      </div>
    </div>
  )
}

// app/logistica-ordens/page.tsx
"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ElementType, ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header"
import { EMPRESA_ID as DEMO_EMPRESA_ID } from "@/lib/demo/catalog";

import {
  Activity,
  AlertCircle,
  BarChart3,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock,
  Copy,
  Download,
  Filter,
  Info,
  LayoutGrid,
  List,
  Loader2,
  Package,
  Play,
  PlayCircle,
  Plus,
  Printer,
  RefreshCw,
  Search,
  SkipForward,
  SlidersHorizontal,
  StopCircle,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wrench,
  X,
  Zap,
  CheckCheck,
  Timer,
} from "lucide-react";

import {
  agruparOrdensPorStatus,
  colorStatusItem,
  getDiasSemana,
  inicioSemanaAtual,
  fimSemanaAtual,
  labelStatusItem,
  type AdicionarItemPlanejadoInput,
  type AtualizarStatusExecucaoItemInput,
  type CriarExecucaoInput,
  type CriarTemplateInput,
  type CTFiltro,
  type Execucao,
  type ExecucaoItem,
  type FiltrosExecutadasUI,
  type FiltrosFilaUI,
  type FiltrosKanbanUI,
  type ItemPlanejado,
  type MaterializarExecucaoInput,
  type OrdemExecutada,
  type OrdemResumo,
  type FilaPorCT,
  type FilaItem,
  type PlanoCT,
  type ProdutoFiltro,
  type RemoverItemPlanejadoInput,
  type SlotPlano,
  type StatusLogisticaItem,
  type StatusUi,
  type Template,
  type TurnoFiltro,
  useCentrosTrabalhoFiltro,
  useFilaCompleta,
  useItensPlanejados,
  useKanbanCompleto,
  useKanbanOrdens,
  useOrdensExecutadasCompleto,
  usePlanejamentoCompleto,
  useTemplates,
  useTurnosFiltro,
} from "@/hooks/logistica-ordem/use-api";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
type TabType = "kanban" | "fila" | "executadas" | "planejamento";

interface ProdutoOpt {
  id: string;
  codigo: string;
  nome: string;
}

interface CentroOpt {
  id: string;
  nome: string;
}

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────
// Na demonstração a empresa é sempre a fábrica fictícia gerada pela semente.
const EMPRESA_ID = process.env.NEXT_PUBLIC_EMPRESA_ID ?? DEMO_EMPRESA_ID;

const STATUS_CONFIG: Record<
  StatusUi,
  { label: string; color: string; bg: string; dot: string; border: string; ring: string; icon: ElementType }
> = {
  Liberada: {
    label: "Liberada",
    color: "text-sky-700",
    bg: "bg-sky-50 border-sky-200",
    dot: "bg-sky-500",
    border: "border-l-sky-400",
    ring: "ring-sky-200",
    icon: Circle,
  },
  "Em Execução": {
    label: "Em Execução",
    color: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-200",
    dot: "bg-emerald-500",
    border: "border-l-emerald-400",
    ring: "ring-emerald-200",
    icon: Play,
  },
  Interrompida: {
    label: "Interrompida",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-200",
    dot: "bg-amber-500",
    border: "border-l-amber-400",
    ring: "ring-amber-200",
    icon: StopCircle,
  },
  Encerrada: {
    label: "Encerrada",
    color: "text-slate-600",
    bg: "bg-slate-50 border-slate-200",
    dot: "bg-slate-400",
    border: "border-l-slate-300",
    ring: "ring-slate-200",
    icon: CheckCircle2,
  },
  Planejada: {
    label: "Planejada",
    color: "text-violet-700",
    bg: "bg-violet-50 border-violet-200",
    dot: "bg-violet-500",
    border: "border-l-violet-300",
    ring: "ring-violet-200",
    icon: CalendarDays,
  },
};

const DIAS_SEMANA_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const STATUS_ITEM_ICONS: Record<StatusLogisticaItem, ElementType> = {
  PLANNED: Circle,
  RELEASED: PlayCircle,
  RUNNING: Play,
  INTERRUPTED: StopCircle,
  FINISHED: CheckCircle2,
  SKIPPED: SkipForward,
};

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────
function cn(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}
function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
function fmtNum(n?: number | null) {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return v.toLocaleString("pt-BR");
}
function fmtPct(concluida?: number | null, planejada?: number | null): number {
  const c = toNum(concluida);
  const p = toNum(planejada);
  if (!p) return 0;
  return Math.round((c / p) * 100);
}
function getProgressColor(pct: number) {
  if (pct > 100) return "bg-rose-500";
  if (pct >= 75) return "bg-emerald-500";
  if (pct >= 40) return "bg-amber-400";
  return "bg-sky-400";
}
function getOrdemCodigo(o: unknown): string {
  const obj = o as Record<string, unknown>;
  return String(obj?.ordem_codigo ?? obj?.ordem_public_id ?? obj?.codigo ?? obj?.id ?? "—");
}
function getOrdemProdutoLinha(o: unknown): string {
  const obj = o as Record<string, unknown>;
  return String(obj?.produto_descricao ?? obj?.descricao_produto ?? obj?.produto_codigo ?? "—");
}
function getCtNome(ct: unknown): string {
  const obj = ct as Record<string, unknown>;
  return String(obj?.ct_nome ?? obj?.nome ?? "—");
}
function getOrdemKey(o: unknown, idx: number): string {
  const obj = o as Record<string, unknown>;
  return String(obj?.fila_item_id ?? obj?.ordem_public_id ?? obj?.ordem_id ?? obj?.id ?? `${idx}`);
}
function asStatusUi(v: unknown): StatusUi {
  const valid: StatusUi[] = ["Liberada", "Em Execução", "Interrompida", "Encerrada", "Planejada"];
  if (typeof v === "string" && (valid as string[]).includes(v)) return v as StatusUi;
  return "Liberada";
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function fmtDateLocalInput(d: Date): string {
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDateInput(d: Date): string {
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDateCell(v: unknown): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtDateShort(v: unknown): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
function fmtDateTimeCompact(v: unknown): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtTimeOnly(v: unknown): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// ─────────────────────────────────────────────────────────────
// UI PRIMITIVES
// ─────────────────────────────────────────────────────────────
function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("bg-white border border-slate-100 rounded-2xl shadow-sm", className)}>
      {children}
    </div>
  );
}

function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px bg-slate-100", className)} />;
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={cn("animate-pulse bg-slate-100 rounded-xl", className)} />;
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "slate",
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ElementType;
  tone?: "slate" | "sky" | "emerald" | "amber" | "rose" | "violet";
  trend?: "up" | "down" | "neutral";
}) {
  const toneMap: Record<string, { icon: string; value: string; bg: string; iconBg: string }> = {
    slate: { icon: "text-slate-500", value: "text-slate-900", bg: "bg-white", iconBg: "bg-slate-50 border-slate-200" },
    sky: { icon: "text-sky-600", value: "text-sky-900", bg: "bg-white", iconBg: "bg-sky-50 border-sky-200" },
    emerald: { icon: "text-emerald-600", value: "text-emerald-900", bg: "bg-white", iconBg: "bg-emerald-50 border-emerald-200" },
    amber: { icon: "text-amber-600", value: "text-amber-900", bg: "bg-white", iconBg: "bg-amber-50 border-amber-200" },
    rose: { icon: "text-rose-600", value: "text-rose-900", bg: "bg-white", iconBg: "bg-rose-50 border-rose-200" },
    violet: { icon: "text-violet-600", value: "text-violet-900", bg: "bg-white", iconBg: "bg-violet-50 border-violet-200" },
  };
  const t = toneMap[tone] ?? toneMap["slate"]!;
  return (
    <Card className={cn("p-5 hover:shadow-md transition-shadow", t.bg)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-2">{label}</p>
          <p className={cn("font-mono text-2xl font-bold leading-none", t.value)}>{value}</p>
          {sub && <p className="mt-1.5 text-xs text-slate-400">{sub}</p>}
        </div>
        <div className={cn("shrink-0 rounded-xl border p-2.5", t.iconBg)}>
          <Icon className={cn("h-4 w-4", t.icon)} />
        </div>
      </div>
      {trend && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className={cn("flex items-center gap-1 text-[11px] font-medium",
            trend === "up" ? "text-emerald-600" : trend === "down" ? "text-rose-600" : "text-slate-500")}>
            {trend === "up" && <TrendingUp className="w-3 h-3" />}
            {trend === "down" && <TrendingDown className="w-3 h-3" />}
          </div>
        </div>
      )}
    </Card>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="p-10">
      <div className="flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center border border-rose-100">
          <AlertCircle className="w-6 h-6 text-rose-500" />
        </div>
        <div className="text-center">
          <p className="text-slate-800 font-semibold text-sm">Falha ao carregar dados</p>
          <p className="text-slate-400 text-xs mt-1 max-w-xs">{message}</p>
        </div>
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center gap-2 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
        </button>
      </div>
    </Card>
  );
}

function EmptyState({ label, sub, action }: { label: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center border border-slate-200">
        <Package className="w-4 h-4 text-slate-300" />
      </div>
      <div className="text-center">
        <p className="text-slate-500 text-sm font-medium">{label}</p>
        {sub && <p className="text-slate-400 text-xs mt-1 max-w-[180px] leading-relaxed">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function IconBtn({
  icon: Icon,
  label,
  onClick,
  active = false,
  badge,
  disabled = false,
  variant = "ghost",
}: {
  icon: ElementType;
  label: string;
  onClick?: () => void;
  active?: boolean;
  badge?: number;
  disabled?: boolean;
  variant?: "ghost" | "solid";
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative inline-flex items-center justify-center rounded-xl p-2 transition-all disabled:opacity-40",
        variant === "solid"
          ? "bg-slate-900 text-white hover:bg-slate-800"
          : active
            ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
            : "text-slate-400 hover:text-slate-700 hover:bg-slate-100",
      )}
    >
      <Icon className={cn("h-4 w-4", Icon === Loader2 ? "animate-spin" : "")} />
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-sky-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder = "Buscar...",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-300 pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-sky-200 focus:border-sky-300 transition-all"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function ProgressBar({
  concluida,
  planejada,
  showValues = true,
  size = "md",
}: {
  concluida: number;
  planejada: number;
  showValues?: boolean;
  size?: "sm" | "md";
}) {
  const pct = fmtPct(concluida, planejada);
  const clampedPct = clamp(pct, 0, 100);
  const color = getProgressColor(pct);
  return (
    <div className="space-y-1.5">
      {showValues && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400 font-mono">{fmtNum(concluida)}</span>
          <span className={cn("font-bold font-mono", pct > 100 ? "text-rose-600" : pct >= 75 ? "text-emerald-600" : pct >= 40 ? "text-amber-600" : "text-slate-500")}>
            {pct}%
          </span>
          <span className="text-slate-400 font-mono">{fmtNum(planejada)}</span>
        </div>
      )}
      <div className={cn("bg-slate-100 rounded-full overflow-hidden", size === "sm" ? "h-1" : "h-1.5")}>
        <div
          className={cn("h-full rounded-full transition-all duration-700", color)}
          style={{ width: `${clampedPct}%` }}
        />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: StatusUi }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG["Liberada"]!;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-semibold border", cfg.bg, cfg.color)}>
      <Icon className={cn("w-2.5 h-2.5", status === "Em Execução" ? "animate-pulse" : "")} />
      {cfg.label}
    </span>
  );
}

function StatusItemBadge({ status }: { status: StatusLogisticaItem }) {
  const Icon = STATUS_ITEM_ICONS[status] ?? Circle;
  const cls = colorStatusItem(status);
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-semibold border", cls)}>
      <Icon className="w-2.5 h-2.5" />
      {labelStatusItem(status)}
    </span>
  );
}

function OrdemCard({
  ordem,
  compact = false,
  onInfo,
}: {
  ordem: OrdemResumo;
  compact?: boolean;
  onInfo?: (o: OrdemResumo) => void;
}) {
  const status = asStatusUi(ordem?.status_ui ?? "Liberada");
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG["Liberada"]!;
  const good = toNum(ordem?.total_good);
  const meta = toNum(ordem?.meta_planejada);
  const scrap = toNum(ordem?.total_scrap);
  const rework = toNum(ordem?.total_rework);
  const pct = fmtPct(good, meta);

  const ctsExec = Array.isArray(ordem?.cts_executando) ? ordem.cts_executando : [];
  const ctExecAgora = ordem?.ct_executando_agora ?? ctsExec[0] ?? null;

  return (
    <div
      className={cn(
        "group relative bg-white border border-slate-100 rounded-xl hover:border-slate-200 hover:shadow-md transition-all border-l-4",
        cfg.border,
        compact ? "p-3" : "p-4",
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono font-bold text-slate-900 text-sm">{getOrdemCodigo(ordem)}</span>
            <StatusBadge status={status} />
          </div>
          {!compact && (
            <p className="text-slate-400 text-xs leading-snug line-clamp-2">{getOrdemProdutoLinha(ordem)}</p>
          )}
          {ctExecAgora && !compact && (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-emerald-700">
              <Wrench className="w-3 h-3" />
              <span className="font-medium">{ctExecAgora.nome}</span>
            </div>
          )}
        </div>
        {onInfo && (
          <button
            type="button"
            onClick={() => onInfo(ordem)}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-sky-600 flex-shrink-0"
            title="Detalhes"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <ProgressBar concluida={good} planejada={meta} showValues={!compact} />
      {!compact && (
        <div className="mt-3 pt-3 border-t border-slate-50 flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            <span className="font-mono">{fmtNum(scrap)}</span>
            <span className="text-slate-300">scrap</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="font-mono">{fmtNum(rework)}</span>
            <span className="text-slate-300">rework</span>
          </div>
          {pct > 100 && (
            <div className="ml-auto flex items-center gap-1 text-xs text-rose-500 font-semibold">
              <TrendingUp className="w-3 h-3" />
              +{pct - 100}%
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FILTER MODAL
// ─────────────────────────────────────────────────────────────
interface FilterModalProps {
  produtos: ProdutoOpt[];
  centros: CentroOpt[];
  selectedProdutos: string[];
  selectedCTs: string[];
  selectedStatus: StatusUi[];
  onChangeProdutos: (v: string[]) => void;
  onChangeCTs: (v: string[]) => void;
  onChangeStatus: (v: StatusUi[]) => void;
  onClose: () => void;
  hideProdutos?: boolean;
  hideStatus?: boolean;
  title?: string;
}

function FilterModal({
  produtos,
  centros,
  selectedProdutos,
  selectedCTs,
  selectedStatus,
  onChangeProdutos,
  onChangeCTs,
  onChangeStatus,
  onClose,
  hideProdutos,
  hideStatus,
  title = "Filtros",
}: FilterModalProps) {
  const [localProdutos, setLocalProdutos] = useState(selectedProdutos);
  const [localCTs, setLocalCTs] = useState(selectedCTs);
  const [localStatus, setLocalStatus] = useState(selectedStatus);
  const [qProduto, setQProduto] = useState("");
  const [qCT, setQCT] = useState("");

  const toggle = <T,>(arr: T[], setArr: (a: T[]) => void, val: T) =>
    setArr(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);

  const apply = () => {
    onChangeProdutos(localProdutos);
    onChangeCTs(localCTs);
    onChangeStatus(localStatus);
    onClose();
  };
  const clear = () => {
    setLocalProdutos([]);
    setLocalCTs([]);
    setLocalStatus([]);
  };

  const produtosFiltered = useMemo(() => {
    const q = qProduto.trim().toLowerCase();
    if (!q) return produtos;
    return produtos.filter((p) => `${p.codigo} ${p.nome}`.toLowerCase().includes(q));
  }, [produtos, qProduto]);

  const centrosFiltered = useMemo(() => {
    const q = qCT.trim().toLowerCase();
    if (!q) return centros;
    return centros.filter((c) => (c?.nome ?? "").toLowerCase().includes(q));
  }, [centros, qCT]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const totalActive = localProdutos.length + localCTs.length + localStatus.length;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-slate-900 flex items-center justify-center">
              <SlidersHorizontal className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900 text-sm">{title}</h2>
              {totalActive > 0 && (
                <p className="text-[11px] text-sky-600 font-medium">{totalActive} filtro(s) ativo(s)</p>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 max-h-[65vh] overflow-y-auto space-y-6">
          {!hideStatus && (
            <section className="space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Estado</h3>
              <div className="flex flex-wrap gap-2">
                {(["Liberada", "Em Execução", "Interrompida", "Encerrada"] as StatusUi[]).map((st) => {
                  const cfg = STATUS_CONFIG[st]!;
                  const active = localStatus.includes(st);
                  return (
                    <button
                      type="button"
                      key={st}
                      onClick={() => toggle(localStatus, setLocalStatus, st)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all",
                        active
                          ? cn(cfg.bg, cfg.color, "ring-1", cfg.ring)
                          : "bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300",
                      )}
                    >
                      <span className={cn("w-1.5 h-1.5 rounded-full", active ? cfg.dot : "bg-slate-300")} />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {centros.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Centros de Trabalho</h3>
                <div className="w-64">
                  <SearchInput value={qCT} onChange={setQCT} placeholder="Filtrar CTs..." />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {centrosFiltered.map((ct) => {
                  const active = localCTs.includes(ct.id);
                  return (
                    <button
                      type="button"
                      key={ct.id}
                      onClick={() => toggle(localCTs, setLocalCTs, ct.id)}
                      className={cn(
                        "px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all",
                        active
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700 ring-1 ring-emerald-200"
                          : "bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300",
                      )}
                    >
                      {ct.nome}
                    </button>
                  );
                })}
                {centrosFiltered.length === 0 && (
                  <p className="text-sm text-slate-400">Nenhum CT encontrado.</p>
                )}
              </div>
            </section>
          )}
          {!hideProdutos && produtos.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Produto</h3>
                <div className="w-64">
                  <SearchInput value={qProduto} onChange={setQProduto} placeholder="Filtrar produtos..." />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {produtosFiltered.map((p) => {
                  const active = localProdutos.includes(p.id);
                  const label = p.codigo || p.nome || p.id;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => toggle(localProdutos, setLocalProdutos, p.id)}
                      className={cn(
                        "px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all",
                        active
                          ? "bg-sky-50 border-sky-200 text-sky-700 ring-1 ring-sky-200"
                          : "bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <button type="button" onClick={clear} className="text-xs text-slate-500 hover:text-slate-800 font-medium">
            Limpar tudo
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50">
              Cancelar
            </button>
            <button type="button" onClick={apply} className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold">
              Aplicar filtros
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ORDER DETAIL DRAWER
// ─────────────────────────────────────────────────────────────
function OrdemDetailDrawer({ ordem, onClose }: { ordem: OrdemResumo; onClose: () => void }) {
  const good = toNum(ordem?.total_good);
  const meta = toNum(ordem?.meta_planejada);
  const pct = fmtPct(good, meta);
  const st = asStatusUi(ordem?.status_ui);
  const cfg = STATUS_CONFIG[st] ?? STATUS_CONFIG["Liberada"]!;

  const ctsExec = Array.isArray(ordem?.cts_executando) ? ordem.cts_executando : [];
  const ctsInter = Array.isArray(ordem?.cts_interrompidos) ? ordem.cts_interrompidos : [];

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white border-l border-slate-100 h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", cfg.dot)} />
            <div className="min-w-0">
              <p className="font-mono font-bold text-slate-900 truncate text-sm">{getOrdemCodigo(ordem)}</p>
              <p className="text-xs text-slate-400 truncate">{getOrdemProdutoLinha(ordem)}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-xl text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-5">
          <div className="flex items-center justify-between">
            <StatusBadge status={st} />
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(getOrdemCodigo(ordem))}
              className="text-xs text-slate-400 hover:text-slate-700 flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" /> Copiar código
            </button>
          </div>

          {ctsExec.length > 0 && (
            <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-600 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Executando em
              </p>
              {ctsExec.map((ct, i) => (
                <div key={ct.public_id || String(i)} className="flex items-center gap-2 text-xs text-emerald-800">
                  <Wrench className="w-3 h-3" />
                  <span className="font-medium">{ct.nome}</span>
                </div>
              ))}
            </div>
          )}

          {ctsInter.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-amber-600 flex items-center gap-1.5">
                <StopCircle className="w-3 h-3" />
                Interrompido em
              </p>
              {ctsInter.map((ct, i) => (
                <div key={ct.public_id || String(i)} className="flex items-center gap-2 text-xs text-amber-800">
                  <Wrench className="w-3 h-3" />
                  <span className="font-medium">{ct.nome}</span>
                </div>
              ))}
            </div>
          )}

          <Card className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">Progresso</p>
            <div className="flex items-end justify-between mb-3">
              <div className={cn("text-4xl font-mono font-bold", pct >= 100 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-slate-800")}>
                {pct}%
              </div>
              <div className="text-right text-xs text-slate-400">
                <div className="font-mono">{fmtNum(good)} / {fmtNum(meta)}</div>
                <div className="mt-0.5">good / meta</div>
              </div>
            </div>
            <ProgressBar concluida={good} planejada={meta} />
          </Card>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Good", value: fmtNum(toNum(ordem?.total_good)), tone: "emerald" },
              { label: "Meta", value: fmtNum(toNum(ordem?.meta_planejada)), tone: "slate" },
              { label: "Scrap", value: fmtNum(toNum(ordem?.total_scrap)), tone: "rose" },
              { label: "Rework", value: fmtNum(toNum(ordem?.total_rework)), tone: "amber" },
            ].map((stat) => {
              const styles: Record<string, { box: string; val: string }> = {
                emerald: { box: "bg-emerald-50 border-emerald-100", val: "text-emerald-800" },
                rose: { box: "bg-rose-50 border-rose-100", val: "text-rose-800" },
                amber: { box: "bg-amber-50 border-amber-100", val: "text-amber-900" },
                slate: { box: "bg-slate-50 border-slate-200", val: "text-slate-900" },
              };
              const s = styles[stat.tone] ?? styles["slate"]!;
              return (
                <div key={stat.label} className={cn("rounded-xl border p-3.5", s.box)}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{stat.label}</p>
                  <p className={cn("mt-1.5 font-mono font-bold text-lg", s.val)}>{stat.value}</p>
                </div>
              );
            })}
          </div>
          <Card className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Produto</p>
            <p className="font-mono font-semibold text-slate-900 text-sm">{String(ordem?.produto_codigo ?? "—")}</p>
            {Boolean(ordem?.produto_descricao) && (
              <p className="text-sm text-slate-500 mt-1">{String(ordem.produto_descricao)}</p>
            )}
          </Card>

          {(ordem?.inicio_planejado_utc || ordem?.inicio_real_utc) && (
            <Card className="p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">Datas</p>
              <div className="space-y-2 text-xs">
                {ordem?.inicio_planejado_utc && (
                  <div className="flex justify-between text-slate-500">
                    <span>Início planejado</span>
                    <span className="font-mono font-medium text-slate-700">{fmtDateTimeCompact(ordem.inicio_planejado_utc)}</span>
                  </div>
                )}
                {ordem?.fim_planejado_utc && (
                  <div className="flex justify-between text-slate-500">
                    <span>Fim planejado</span>
                    <span className="font-mono font-medium text-slate-700">{fmtDateTimeCompact(ordem.fim_planejado_utc)}</span>
                  </div>
                )}
                {ordem?.inicio_real_utc && (
                  <div className="flex justify-between text-slate-500">
                    <span>Início real</span>
                    <span className="font-mono font-medium text-emerald-700">{fmtDateTimeCompact(ordem.inicio_real_utc)}</span>
                  </div>
                )}
                {ordem?.fim_real_utc && (
                  <div className="flex justify-between text-slate-500">
                    <span>Fim real</span>
                    <span className="font-mono font-medium text-slate-700">{fmtDateTimeCompact(ordem.fim_real_utc)}</span>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// KANBAN TAB
// ─────────────────────────────────────────────────────────────
function KanbanTab({ empresaId }: { empresaId: string }) {
  const [search, setSearch] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [selectedProdutos, setSelectedProdutos] = useState<string[]>([]);
  const [selectedCTs, setSelectedCTs] = useState<string[]>([]);
  const [selectedStatusUi, setSelectedStatusUi] = useState<StatusUi[]>([]);
  const [detailOrdem, setDetailOrdem] = useState<OrdemResumo | null>(null);
  const [compact, setCompact] = useState(false);

  const filtros: FiltrosKanbanUI = useMemo(
    () => ({
      search: search || undefined,
      produto_ids: selectedProdutos.length ? selectedProdutos : undefined,
      centro_trabalho_ids: selectedCTs.length ? selectedCTs : undefined,
      status: selectedStatusUi.length ? selectedStatusUi : undefined,
    }),
    [search, selectedProdutos, selectedCTs, selectedStatusUi],
  );

  const { ordens, produtos, centros, invalidate } = useKanbanCompleto(empresaId, filtros, {
    refreshInterval: 30_000,
  });

  const produtosList: ProdutoOpt[] = useMemo(
    () =>
      (produtos?.data ?? []).map((p: ProdutoFiltro) => ({
        id: String(p?.produto_id ?? p?.public_id ?? ""),
        codigo: String(p?.codigo ?? ""),
        nome: String(p?.descricao ?? ""),
      })),
    [produtos?.data],
  );

  const centrosList: CentroOpt[] = useMemo(
    () =>
      (centros?.data ?? [])
        .map((c) => ({
          id: c.centro_trabalho_id || c.public_id,
          nome: c.nome,
        }))
        .filter((c) => c.id && c.nome),
    [centros?.data],
  );

  const grupos = useMemo(() => {
    const list = (ordens.data ?? []) as OrdemResumo[];
    const base: Record<StatusUi, OrdemResumo[]> = {
      Liberada: [],
      "Em Execução": [],
      Interrompida: [],
      Encerrada: [],
      Planejada: [],
    };
    if (!list.length) return base;
    return agruparOrdensPorStatus(list) ?? base;
  }, [ordens.data]);

  const totalOrdens = ordens.data?.length ?? 0;
  const totalGood = (ordens.data ?? []).reduce((s, o) => s + toNum(o?.total_good), 0);
  const totalMeta = (ordens.data ?? []).reduce((s, o) => s + toNum(o?.meta_planejada), 0);
  const totalScrap = (ordens.data ?? []).reduce((s, o) => s + toNum(o?.total_scrap), 0);
  const eff = totalMeta ? fmtPct(totalGood, totalMeta) : 0;
  const activeFiltersCount = selectedProdutos.length + selectedCTs.length + selectedStatusUi.length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard label="Ordens ativas" value={fmtNum(totalOrdens)} sub="total visível" icon={LayoutGrid} tone="sky" />
        <KpiCard label="Produção good" value={fmtNum(totalGood)} sub={`meta: ${fmtNum(totalMeta)}`} icon={TrendingUp} tone="emerald" />
        <KpiCard
          label="Refugo total"
          value={fmtNum(totalScrap)}
          sub={totalMeta ? `${((totalScrap / totalMeta) * 100).toFixed(1)}% da meta` : "—"}
          icon={TrendingDown}
          tone="rose"
        />
        <KpiCard
          label="Eficiência"
          value={totalMeta ? `${eff}%` : "—"}
          sub="good / meta"
          icon={Activity}
          tone={eff >= 75 ? "emerald" : eff >= 40 ? "amber" : "rose"}
        />
      </div>

      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar por código ou produto…" />
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
            <IconBtn
              icon={Filter}
              label="Filtros"
              onClick={() => setShowFilter(true)}
              active={showFilter || activeFiltersCount > 0}
              badge={activeFiltersCount}
            />
            <IconBtn
              icon={compact ? LayoutGrid : List}
              label={compact ? "Expandir cards" : "Compactar cards"}
              onClick={() => setCompact(!compact)}
              active={compact}
            />
            <IconBtn icon={Printer} label="Imprimir" onClick={() => window.print()} />
            <IconBtn
              icon={ordens.isValidating ? Loader2 : RefreshCw}
              label="Atualizar"
              onClick={() => invalidate()}
            />
          </div>
          {activeFiltersCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelectedProdutos([]);
                setSelectedCTs([]);
                setSelectedStatusUi([]);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold hover:bg-amber-100"
            >
              <X className="w-3 h-3" />
              Limpar ({activeFiltersCount})
            </button>
          )}
        </div>
      </Card>

      {ordens.error && <ErrorState message={String(ordens.error)} onRetry={invalidate} />}
      {!ordens.error && (
        <div className="overflow-x-auto pb-2 -mx-1 px-1">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 min-w-[320px]">
          {(["Liberada", "Em Execução", "Interrompida", "Encerrada"] as const).map((status) => {
            const cfg = STATUS_CONFIG[status]!;
            const items = (grupos[status] ?? []) as OrdemResumo[];
            const isLoading = ordens.isLoading;
            const sumGood = items.reduce((s, o) => s + toNum(o?.total_good), 0);
            const sumMeta = items.reduce((s, o) => s + toNum(o?.meta_planejada), 0);
            return (
              <Card key={status} className="overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className={cn("w-2 h-2 rounded-full flex-shrink-0", cfg.dot, status === "Em Execução" ? "animate-pulse" : "")} />
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{cfg.label}</p>
                      <p className="text-[11px] text-slate-400">
                        {isLoading ? "..." : `${items.length ?? 0} ordem(ns)`}
                      </p>
                    </div>
                  </div>
                  {status === "Em Execução" && (
                    <Activity className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                  )}
                </div>
                <div className="p-2.5 space-y-2 overflow-y-auto max-h-[600px]">
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)
                  ) : !items.length ? (
                    <EmptyState label="Sem ordens" />
                  ) : (
                    items.map((ordem, idx) => (
                      <OrdemCard
                        key={getOrdemKey(ordem, idx)}
                        ordem={ordem}
                        compact={compact}
                        onInfo={(o) => setDetailOrdem(o)}
                      />
                    ))
                  )}
                </div>
                {!!items.length && !isLoading && (
                  <>
                    <Divider />
                    <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <div className="text-xs text-slate-500 font-mono">
                        <span className="text-slate-400">G:</span> {fmtNum(sumGood)}{" "}
                        <span className="text-slate-300">·</span>{" "}
                        <span className="text-slate-400">M:</span> {fmtNum(sumMeta)}
                      </div>
                      <div className="w-24">
                        <ProgressBar concluida={sumGood} planejada={sumMeta} showValues={false} size="sm" />
                      </div>
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </div>
        </div>
      )}

      {showFilter && (
        <FilterModal
          title="Filtros do Kanban"
          produtos={produtosList}
          centros={centrosList}
          selectedProdutos={selectedProdutos}
          selectedCTs={selectedCTs}
          selectedStatus={selectedStatusUi}
          onChangeProdutos={setSelectedProdutos}
          onChangeCTs={setSelectedCTs}
          onChangeStatus={setSelectedStatusUi}
          onClose={() => setShowFilter(false)}
        />
      )}
      {detailOrdem && (
        <OrdemDetailDrawer ordem={detailOrdem} onClose={() => setDetailOrdem(null)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FILA TAB
// ─────────────────────────────────────────────────────────────

function OrdemEmExecucaoCard({ item }: { item: FilaItem }) {
  const good = toNum(item.total_good);
  const meta = toNum(item.meta_planejada);
  const pct = fmtPct(good, meta);

  return (
    <div className="relative overflow-hidden rounded-xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-50 to-white p-4 shadow-sm">
      <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 text-white text-[10px] font-bold rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        EM EXECUÇÃO
      </div>
      <div className="flex items-start gap-4 pr-20 sm:pr-28">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center flex-shrink-0">
          <Play className="w-4 h-4 text-emerald-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono font-bold text-slate-900 text-base">{item.ordem_codigo}</span>
          </div>
          <p className="text-sm text-slate-500 truncate">{String(item.produto_descricao ?? "—")}</p>
          <div className="flex items-center gap-4 mt-2">
            {item.inicio_real_utc && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700">
                <Timer className="w-3 h-3" />
                <span>Iniciado {fmtDateTimeCompact(item.inicio_real_utc)}</span>
              </div>
            )}
            {item.fim_planejado_utc && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Clock className="w-3 h-3" />
                <span>Prev. término {fmtDateTimeCompact(item.fim_planejado_utc)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-slate-500 font-mono">{fmtNum(good)} peças produzidas</span>
          <span className="font-mono font-bold text-slate-700">meta: {fmtNum(meta)}</span>
          <span className={cn("font-bold font-mono", pct >= 75 ? "text-emerald-600" : pct >= 40 ? "text-amber-600" : "text-slate-500")}>
            {pct}%
          </span>
        </div>
        <div className="h-2 bg-emerald-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-700"
            style={{ width: `${clamp(pct, 0, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function FilaEsperaRow({ item, posicao }: { item: FilaItem; posicao: number }) {
  const good = toNum(item.total_good);
  const meta = toNum(item.meta_planejada);
  const pct = fmtPct(good, meta);
  const status = asStatusUi(item.status_ui);
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG["Liberada"]!;
  const hasPlannedDates = item.inicio_planejado_utc || item.fim_planejado_utc;

  return (
    <div className={cn(
      "flex items-center gap-3 p-3.5 bg-white rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all border-l-4",
      cfg.border,
    )}>
      <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-slate-500">{posicao}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono font-bold text-slate-900 text-sm">{item.ordem_codigo}</span>
          <StatusBadge status={status} />
        </div>
        <p className="text-xs text-slate-400 truncate">{String(item.produto_descricao ?? "—")}</p>
        {hasPlannedDates && (
          <div className="flex items-center gap-4 mt-1.5">
            {item.inicio_planejado_utc && (
              <div className="flex items-center gap-1 text-[11px] text-slate-400">
                <CalendarDays className="w-3 h-3 text-sky-400" />
                <span>Início: <span className="font-medium text-slate-600">{fmtDateTimeCompact(item.inicio_planejado_utc)}</span></span>
              </div>
            )}
            {item.fim_planejado_utc && (
              <div className="flex items-center gap-1 text-[11px] text-slate-400">
                <Clock className="w-3 h-3 text-amber-400" />
                <span>Fim: <span className="font-medium text-slate-600">{fmtDateTimeCompact(item.fim_planejado_utc)}</span></span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 w-32">
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-slate-400 font-mono">{fmtNum(good)}</span>
          <span className="font-bold text-slate-500 font-mono">{fmtNum(meta)}</span>
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full", getProgressColor(pct))} style={{ width: `${clamp(pct, 0, 100)}%` }} />
        </div>
        <p className={cn("text-right text-[10px] font-bold font-mono mt-0.5", pct >= 75 ? "text-emerald-600" : pct >= 40 ? "text-amber-600" : "text-slate-400")}>
          {pct}%
        </p>
      </div>
    </div>
  );
}

function CTFilaCard({ ct }: { ct: FilaPorCT }) {
  const [expanded, setExpanded] = useState(true);
  const itens = (ct?.itens ?? []) as FilaItem[];

  const emExecucao = useMemo(
    () => itens.filter((i) => i.is_executando_agora || asStatusUi(i.status_ui) === "Em Execução"),
    [itens],
  );
  const naFila = useMemo(
    () => itens.filter((i) => !i.is_executando_agora && asStatusUi(i.status_ui) !== "Em Execução"),
    [itens],
  );

  const contagens = useMemo(() => ({
    "Em Execução": emExecucao.length,
    Liberada: naFila.filter((i) => asStatusUi(i.status_ui) === "Liberada").length,
    Interrompida: naFila.filter((i) => asStatusUi(i.status_ui) === "Interrompida").length,
    Encerrada: naFila.filter((i) => asStatusUi(i.status_ui) === "Encerrada").length,
  }), [emExecucao, naFila]);

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        className="w-full text-left px-5 py-4 hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn(
              "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0",
              emExecucao.length > 0 ? "bg-emerald-100 border border-emerald-200" : "bg-slate-100",
            )}>
              <Wrench className={cn("w-4 h-4", emExecucao.length > 0 ? "text-emerald-600" : "text-slate-500")} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 text-sm truncate">{getCtNome(ct)}</p>
              <p className="text-slate-400 text-xs mt-0.5">{itens.length} ordem(ns) total</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1.5">
              {(Object.entries(contagens) as Array<[StatusUi, number]>).map(([st, count]) => {
                if (!count) return null;
                const cfg = STATUS_CONFIG[st];
                if (!cfg) return null;
                return (
                  <span key={st} className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-lg border", cfg.bg, cfg.color)} title={st}>
                    {count}
                  </span>
                );
              })}
            </div>
            <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", expanded ? "rotate-180" : "")} />
          </div>
        </div>
      </button>

      {expanded && (
        <>
          <Divider />
          <div className="p-4 space-y-4">
            {emExecucao.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-600 mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Produzindo agora
                </p>
                <div className="space-y-2">
                  {emExecucao.map((item) => (
                    <OrdemEmExecucaoCard key={item.fila_item_id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {naFila.length > 0 && (
              <div>
                {emExecucao.length > 0 && (
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                    <List className="w-3 h-3" />
                    Fila de espera · {naFila.length} ordem(ns)
                  </p>
                )}
                <div className="space-y-2">
                  {naFila.map((item, idx) => (
                    <FilaEsperaRow key={item.fila_item_id} item={item} posicao={idx + 1} />
                  ))}
                </div>
              </div>
            )}

            {itens.length === 0 && <EmptyState label="Sem ordens neste CT" />}
          </div>
        </>
      )}
    </Card>
  );
}

function FilaTab({ empresaId }: { empresaId: string }) {
  const [search, setSearch] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [selectedCTs, setSelectedCTs] = useState<string[]>([]);

  const filtros: FiltrosFilaUI = useMemo(
    () => ({
      search: search || undefined,
      centro_trabalho_ids: selectedCTs.length ? selectedCTs : undefined,
    }),
    [search, selectedCTs],
  );

  const { fila, centros } = useFilaCompleta(empresaId, filtros, { refreshInterval: 15_000 });
  const filaPorCT = (fila.data ?? []) as FilaPorCT[];

  const totalOrdens = filaPorCT.reduce((s, ct) => s + (ct?.itens?.length ?? 0), 0);
  const totalEmExecucao = filaPorCT.reduce(
    (s, ct) => s + (ct?.itens ?? []).filter((i) => i.is_executando_agora || asStatusUi(i.status_ui) === "Em Execução").length,
    0,
  );

  const centrosList: CentroOpt[] = useMemo(
    () =>
      (centros?.data ?? [])
        .map((c) => ({
          id: c.centro_trabalho_id || c.public_id,
          nome: c.nome,
        }))
        .filter((c) => c.id && c.nome),
    [centros?.data],
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Total na fila" value={fmtNum(totalOrdens)} sub="todas as CTs" icon={List} tone="sky" />
        <KpiCard label="Em execução" value={fmtNum(totalEmExecucao)} sub="produzindo agora" icon={Play} tone="emerald" />
      </div>

      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar por código da ordem…" />
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
            <IconBtn
              icon={Filter}
              label="Filtros"
              onClick={() => setShowFilter(true)}
              active={showFilter || selectedCTs.length > 0}
              badge={selectedCTs.length}
            />
            <IconBtn icon={Printer} label="Imprimir" onClick={() => window.print()} />
            <IconBtn
              icon={fila.isValidating ? Loader2 : RefreshCw}
              label="Atualizar"
              onClick={() => fila.mutate()}
            />
          </div>
          <span className="ml-auto text-slate-400 text-xs font-mono">{totalOrdens} ordem(ns)</span>
        </div>
      </Card>

      {fila.error && <ErrorState message={String(fila.error)} onRetry={() => fila.mutate()} />}
      {!fila.error && (
        <div className="space-y-3">
          {fila.isLoading
            ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48" />)
            : filaPorCT.length === 0
              ? <EmptyState label="Nenhuma fila encontrada" sub="Não há ordens em fila no momento" />
              : filaPorCT.map((ct, idx) => (
                <CTFilaCard
                  key={ct?.centro_trabalho_id ?? String(idx)}
                  ct={ct}
                />
              ))}
        </div>
      )}

      {showFilter && (
        <FilterModal
          title="Filtros da Fila"
          produtos={[]}
          centros={centrosList}
          selectedProdutos={[]}
          selectedCTs={selectedCTs}
          selectedStatus={[]}
          onChangeProdutos={() => { }}
          onChangeCTs={setSelectedCTs}
          onChangeStatus={() => { }}
          onClose={() => setShowFilter(false)}
          hideProdutos
          hideStatus
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// EXECUTADAS TAB
// ─────────────────────────────────────────────────────────────
function ExecutadasTab({ empresaId }: { empresaId: string }) {
  const now = useMemo(() => new Date(), []);
  const dayAgo = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; }, []);

  const [periodoInicio, setPeriodoInicio] = useState<Date>(dayAgo);
  const [periodoFim, setPeriodoFim] = useState<Date>(now);
  const [ordemCodigo, setOrdemCodigo] = useState("");
  const [selectedCTs, setSelectedCTs] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string[]>([]);
  const [sortField, setSortField] = useState<keyof OrdemExecutada>("ordem_codigo");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showCTDropdown, setShowCTDropdown] = useState(false);
  const [ctFilter, setCTFilter] = useState("");
  const [agrupado, setAgrupado] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const filtros: FiltrosExecutadasUI = useMemo(
    () => ({
      periodo_inicio: periodoInicio,
      periodo_fim: periodoFim,
      ordem_codigo: ordemCodigo || undefined,
      centro_trabalho_ids: selectedCTs.length ? selectedCTs : undefined,
      status_item: selectedStatus.length ? selectedStatus : undefined,
    }),
    [periodoInicio, periodoFim, ordemCodigo, selectedCTs, selectedStatus],
  );

  const { executadas, centros } = useOrdensExecutadasCompleto(empresaId, filtros);
  const rows: OrdemExecutada[] = executadas.data ?? [];

  const rowsUnicos = useMemo(() => {
    const seen = new Set<string>();
    return rows.filter((r) => {
      const key = String(
        r?.execucao_item_id ??
        `${r?.ordem_codigo ?? ""}_${r?.centro_trabalho_id ?? ""}_${r?.turno_id ?? ""}`
      );
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [rows]);

  const sortedRows = useMemo((): OrdemExecutada[] => {
    const arr = [...rowsUnicos];
    arr.sort((a, b) => {
      const va = a[sortField];
      const vb = b[sortField];
      const na = typeof va === "number" ? va : Number.NaN;
      const nb = typeof vb === "number" ? vb : Number.NaN;
      let cmp = 0;
      if (Number.isFinite(na) && Number.isFinite(nb)) {
        cmp = na < nb ? -1 : na > nb ? 1 : 0;
      } else {
        cmp = String(va ?? "").localeCompare(String(vb ?? ""), "pt-BR");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rowsUnicos, sortField, sortDir]);

  const rowsAgrupados = useMemo(() => {
    const map = new Map<string, { rows: OrdemExecutada[]; totalGood: number; totalMeta: number; totalScrap: number }>();
    for (const r of sortedRows) {
      const key = r.ordem_codigo ?? "—";
      if (!map.has(key)) map.set(key, { rows: [], totalGood: 0, totalMeta: 0, totalScrap: 0 });
      const g = map.get(key)!;
      g.rows.push(r);
      g.totalGood += toNum(r.realizado);
      g.totalMeta = Math.max(g.totalMeta, toNum(r.planejado ?? r.meta_planejada ?? 0));
      g.totalScrap += toNum(r.total_scrap ?? 0);
    }
    return Array.from(map.entries()).map(([codigo, data]) => ({ codigo, ...data }));
  }, [sortedRows]);

  const handleSort = (field: keyof OrdemExecutada) => {
    if (sortField === field) {
      setSortDir((prev) => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const exportCSV = () => {
    const headers = ["Código", "CT", "Turno", "Concluída", "Planejada", "Dif.", "% Completa", "Estado", "Início", "Fim"];
    const lines = sortedRows.map((r) => {
      const good = toNum(r?.realizado ?? 0);
      const meta = toNum(r?.planejado ?? r?.meta_planejada ?? 0);
      return [
        r?.ordem_codigo ?? "",
        r?.ct_codigo ?? "",
        r?.turno_nome ?? "",
        good,
        meta,
        good - meta,
        fmtPct(good, meta),
        r?.status_item ?? "",
        fmtDateCell(r?.inicio_real_utc),
        fmtDateCell(r?.fim_real_utc),
      ].join(",");
    });
    const csv = [headers.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ordens-executadas.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const centrosOpt: CentroOpt[] = useMemo(
    () =>
      (centros?.data ?? [])
        .map((c) => ({
          id: c.centro_trabalho_id || c.public_id,
          nome: c.nome,
        }))
        .filter((c) => c.id && c.nome),
    [centros?.data],
  );

  const filteredCTs = useMemo(() => {
    const q = ctFilter.toLowerCase();
    return centrosOpt.filter((c) => (c?.nome ?? "").toLowerCase().includes(q));
  }, [centrosOpt, ctFilter]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!showCTDropdown) return;
      const el = dropdownRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setShowCTDropdown(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showCTDropdown]);

  const cols: { key: keyof OrdemExecutada; label: string }[] = [
    { key: "ordem_codigo", label: "Ordem" },
    { key: "ct_codigo", label: "CT" },
    { key: "turno_nome", label: "Turno" },
    { key: "realizado", label: "Concluída / Planejada" },
    { key: "diferenca", label: "Dif." },
    { key: "pct_completa", label: "%" },
    { key: "status_item", label: "Estado" },
    { key: "inicio_real_utc", label: "Início Real" },
    { key: "fim_real_utc", label: "Fim Real" },
  ];

  const totalGood = sortedRows.reduce((s, r) => s + toNum(r?.realizado ?? 0), 0);
  const totalMeta = sortedRows.reduce((s, r) => s + toNum(r?.planejado ?? r?.meta_planejada ?? 0), 0);
  const totalScrap = sortedRows.reduce((s, r) => s + toNum(r?.total_scrap ?? 0), 0);
  const effPct = fmtPct(totalGood, totalMeta);

  const statusItemToUi = (s?: string): StatusUi | null => {
    if (s === "RUNNING") return "Em Execução";
    if (s === "FINISHED") return "Encerrada";
    if (s === "INTERRUPTED") return "Interrompida";
    if (s === "RELEASED") return "Liberada";
    return null;
  };

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5">
            <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Período de execução</label>
            <div className="grid grid-cols-2 gap-2">
              <input type="datetime-local" value={fmtDateLocalInput(periodoInicio)} onChange={(e) => setPeriodoInicio(new Date(e.target.value))}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:bg-white" />
              <input type="datetime-local" value={fmtDateLocalInput(periodoFim)} onChange={(e) => setPeriodoFim(new Date(e.target.value))}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:bg-white" />
            </div>
          </div>
          <div className="lg:col-span-3">
            <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Código da ordem</label>
            <input type="text" placeholder="Ex: OP-USN-12345" value={ordemCodigo} onChange={(e) => setOrdemCodigo(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:bg-white" />
          </div>
          <div className="lg:col-span-2 relative" ref={dropdownRef}>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Centro de trabalho</label>
            <button type="button" onClick={() => setShowCTDropdown(!showCTDropdown)}
              className="w-full flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 hover:border-slate-300">
              <span className="truncate">{selectedCTs.length === 0 ? "Todos" : `${selectedCTs.length} selecionado(s)`}</span>
              <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", showCTDropdown ? "rotate-180" : "")} />
            </button>
            {showCTDropdown && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl z-30 overflow-hidden">
                <div className="p-2.5 border-b border-slate-100">
                  <SearchInput value={ctFilter} onChange={setCTFilter} placeholder="Filtrar CTs…" />
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {filteredCTs.map((ct) => (
                    <label key={ct.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={selectedCTs.includes(ct.id)}
                        onChange={() => setSelectedCTs((prev) => prev.includes(ct.id) ? prev.filter((x) => x !== ct.id) : [...prev, ct.id])}
                        className="w-4 h-4 rounded accent-sky-600" />
                      <span className="text-sm text-slate-700">{ct.nome}</span>
                    </label>
                  ))}
                  {filteredCTs.length === 0 && <div className="px-4 py-6 text-sm text-slate-400 text-center">Nenhum CT.</div>}
                </div>
                <div className="p-2.5 border-t border-slate-100 flex items-center justify-between">
                  <button type="button" onClick={() => setSelectedCTs([])} className="text-xs text-slate-500">Limpar</button>
                  <button type="button" onClick={() => setShowCTDropdown(false)} className="text-xs font-semibold text-sky-600">Fechar</button>
                </div>
              </div>
            )}
          </div>
          <div className="lg:col-span-2">
            <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Estado</label>
            <select value={selectedStatus[0] ?? ""} onChange={(e) => setSelectedStatus(e.target.value ? [e.target.value] : [])}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:bg-white appearance-none">
              <option value="">Todos</option>
              <option value="RUNNING">Em Execução</option>
              <option value="FINISHED">Encerrada</option>
              <option value="INTERRUPTED">Interrompida</option>
              <option value="RELEASED">Liberada</option>
            </select>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-slate-400 text-xs font-mono">
            {executadas.isLoading ? "Carregando…" : `${sortedRows.length} registro(s) · ${rowsAgrupados.length} ordens únicas`}
          </span>
          <button type="button" onClick={() => setAgrupado(!agrupado)}
            className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all",
              agrupado ? "bg-violet-50 border-violet-200 text-violet-700" : "bg-white border-slate-200 text-slate-600 hover:border-slate-300")}>
            <BarChart3 className="w-3 h-3" />
            {agrupado ? "Visão agrupada" : "Agrupar por ordem"}
          </button>
        </div>
        <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
          <IconBtn icon={Copy} label="Copiar (TSV)" onClick={() => {
            const text = sortedRows.map((r) => {
              const good = toNum(r?.realizado ?? 0);
              const meta = toNum(r?.planejado ?? r?.meta_planejada ?? 0);
              return `${r?.ordem_codigo ?? ""}\t${r?.ct_codigo ?? ""}\t${good}\t${meta}\t${r?.status_item ?? ""}`;
            }).join("\n");
            navigator.clipboard.writeText(text);
          }} />
          <IconBtn icon={Download} label="Exportar CSV" onClick={exportCSV} />
          <IconBtn icon={Printer} label="Imprimir" onClick={() => window.print()} />
          <IconBtn icon={executadas.isValidating ? Loader2 : RefreshCw} label="Atualizar" onClick={() => executadas.mutate()} />
        </div>
      </div>

      {executadas.error && <ErrorState message={String(executadas.error)} onRetry={() => executadas.mutate()} />}

      {!executadas.error && (
        <>
          {agrupado ? (
            <div className="space-y-2">
              {executadas.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)
              ) : rowsAgrupados.length === 0 ? (
                <Card className="p-12"><EmptyState label="Nenhuma ordem executada no período" /></Card>
              ) : (
                rowsAgrupados.map((grupo) => {
                  const pct = fmtPct(grupo.totalGood, grupo.totalMeta);
                  const firstRow = grupo.rows[0];
                  const stUi = statusItemToUi(firstRow?.status_item) ?? "Liberada";
                  return (
                    <Card key={grupo.codigo} className="overflow-hidden">
                      <div className="p-4">
                        <div className="flex items-center justify-between gap-4 mb-3">
                          <div>
                            <span className="font-mono font-bold text-slate-900">{grupo.codigo}</span>
                            <p className="text-xs text-slate-400 truncate mt-0.5">{firstRow?.produto_descricao ?? "—"}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-slate-400 font-mono">{grupo.rows.length} registro(s)</span>
                            <StatusBadge status={asStatusUi(stUi)} />
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-slate-500 font-mono">
                            <span className="text-emerald-600 font-bold">{fmtNum(grupo.totalGood)}</span> / {fmtNum(grupo.totalMeta)}
                          </span>
                          <span className={cn("font-bold font-mono", pct >= 75 ? "text-emerald-600" : pct >= 40 ? "text-amber-600" : "text-rose-600")}>
                            {pct}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={cn("h-full rounded-full", getProgressColor(pct))} style={{ width: `${clamp(pct, 0, 100)}%` }} />
                        </div>
                        {grupo.rows.length > 1 && (
                          <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                            {grupo.rows.map((r, i) => {
                              const rGood = toNum(r.realizado);
                              const rMeta = toNum(r.planejado ?? r.meta_planejada ?? 0);
                              const rPct = fmtPct(rGood, rMeta);
                              return (
                                <div key={r.execucao_item_id ?? String(i)} className="flex items-center gap-3 text-xs text-slate-500">
                                  <span className="font-medium text-slate-600 min-w-[100px]">{r.ct_codigo ?? "—"}</span>
                                  <span className="text-slate-400">{r.turno_nome ?? "—"}</span>
                                  <span className="font-mono ml-auto">
                                    <span className="text-emerald-600">{fmtNum(rGood)}</span>/{fmtNum(rMeta)}
                                  </span>
                                  <span className={cn("font-bold font-mono w-10 text-right", rPct >= 75 ? "text-emerald-600" : "text-amber-600")}>{rPct}%</span>
                                  <span className="text-slate-400">{fmtDateCell(r.inicio_real_utc)}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[750px] text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-slate-100 bg-slate-50">
                      {cols.map((col) => (
                        <th key={col.key} onClick={() => handleSort(col.key)}
                          className="px-4 py-3 text-left text-slate-500 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-slate-800 select-none">
                          <div className="flex items-center gap-1.5">
                            {col.label}
                            <span className="flex flex-col">
                              <ChevronUp className={cn("w-3 h-3 -mb-1", sortField === col.key && sortDir === "asc" ? "text-sky-600" : "text-slate-300")} />
                              <ChevronDown className={cn("w-3 h-3", sortField === col.key && sortDir === "desc" ? "text-sky-600" : "text-slate-300")} />
                            </span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {executadas.isLoading ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i} className="border-b border-slate-50">
                          {cols.map((c) => (<td key={c.key} className="px-4 py-4"><Skeleton className="h-4" /></td>))}
                        </tr>
                      ))
                    ) : sortedRows.length === 0 ? (
                      <tr><td colSpan={cols.length} className="py-16"><EmptyState label="Nenhuma ordem executada no período" sub="Ajuste o período ou os filtros" /></td></tr>
                    ) : (
                      sortedRows.map((row, idx) => {
                        const good = toNum(row?.realizado ?? 0);
                        const meta = toNum(row?.planejado ?? row?.meta_planejada ?? 0);
                        const pct = fmtPct(good, meta);
                        const diff = good - meta;
                        const stUi = statusItemToUi(row?.status_item);
                        const rowKey = String(
                          row?.execucao_item_id ??
                          `${row?.ordem_codigo ?? ""}_${row?.centro_trabalho_id ?? ""}_${row?.turno_id ?? ""}_${idx}`
                        );
                        return (
                          <tr key={rowKey} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-3.5">
                              <div className="min-w-[160px]">
                                <p className="font-mono font-bold text-slate-900 text-sm">{row?.ordem_codigo ?? "—"}</p>
                                <p className="text-slate-400 text-xs line-clamp-1">{row?.produto_descricao ?? "—"}</p>
                              </div>
                            </td>
                            <td className="px-4 py-3.5"><span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded-lg">{row?.ct_codigo ?? "—"}</span></td>
                            <td className="px-4 py-3.5 text-xs text-slate-500 whitespace-nowrap">{row?.turno_nome ?? "—"}</td>
                            <td className="px-4 py-3.5">
                              <div className="min-w-[130px]">
                                <div className="flex items-center justify-between text-[11px] mb-1.5">
                                  <span className="font-mono text-slate-700 font-semibold">{fmtNum(good)}</span>
                                  <span className="font-mono text-slate-400">{fmtNum(meta)}</span>
                                </div>
                                <ProgressBar concluida={good} planejada={meta} showValues={false} size="sm" />
                              </div>
                            </td>
                            <td className="px-4 py-3.5 font-mono">
                              <span className={cn("font-bold text-sm", diff >= 0 ? "text-emerald-600" : "text-rose-600")}>
                                {diff >= 0 ? "+" : ""}{fmtNum(diff)}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 font-mono">
                              <span className={cn("font-bold text-sm", pct >= 100 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-rose-600")}>{pct}%</span>
                            </td>
                            <td className="px-4 py-3.5">
                              {stUi ? <StatusBadge status={asStatusUi(stUi)} /> : <span className="text-xs text-slate-500">{row?.status_item ?? "—"}</span>}
                            </td>
                            <td className="px-4 py-3.5 text-slate-500 text-xs font-mono whitespace-nowrap">{fmtDateCell(row?.inicio_real_utc)}</td>
                            <td className="px-4 py-3.5 text-slate-500 text-xs font-mono whitespace-nowrap">{fmtDateCell(row?.fim_real_utc)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {sortedRows.length > 0 && !executadas.isLoading && (
                <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center gap-6 text-xs flex-wrap">
                  <span className="font-semibold text-slate-700">{sortedRows.length} registro(s)</span>
                  <span className="text-slate-500">Good: <span className="font-bold text-emerald-600 font-mono">{fmtNum(totalGood)}</span></span>
                  <span className="text-slate-500">Meta: <span className="font-bold text-slate-700 font-mono">{fmtNum(totalMeta)}</span></span>
                  <span className="text-slate-500">Refugo: <span className="font-bold text-rose-600 font-mono">{fmtNum(totalScrap)}</span></span>
                  <span className="text-slate-500">Efic.: <span className={cn("font-bold font-mono", effPct >= 75 ? "text-emerald-600" : "text-amber-600")}>{effPct}%</span></span>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PLANEJAMENTO — MODAIS
// ═══════════════════════════════════════════════════════════════

function ModalCriarTemplate({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (input: CriarTemplateInput) => Promise<unknown>;
}) {
  const [nome, setNome] = useState("");
  const [recorrencia, setRecorrencia] = useState("FREQ=WEEKLY");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const handleConfirm = async () => {
    if (!nome.trim()) return;
    setSaving(true);
    setErro(null);
    try {
      await onConfirm({ empresa_id: EMPRESA_ID, nome: nome.trim(), regra_recorrencia: recorrencia });
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao criar template.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-5 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
              <CalendarDays className="w-4 h-4 text-emerald-700" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900 text-sm">Novo Template</h2>
              <p className="text-[11px] text-slate-400">Crie um plano reutilizável de produção.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Nome *</label>
            <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Semana 10 — Linha A"
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }} autoFocus
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:bg-white" />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Recorrência</label>
            <select value={recorrencia} onChange={(e) => setRecorrencia(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 focus:bg-white appearance-none">
              <option value="FREQ=ONCE">Único</option>
              <option value="FREQ=DAILY">Diário</option>
              <option value="FREQ=WEEKLY">Semanal</option>
              <option value="FREQ=MONTHLY">Mensal</option>
            </select>
          </div>
          {erro && <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-2 text-xs text-rose-700"><AlertCircle className="w-3.5 h-3.5" />{erro}</div>}
        </div>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold">Cancelar</button>
          <button type="button" disabled={!nome.trim() || saving} onClick={handleConfirm}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {saving ? "Criando..." : "Criar Template"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalCriarExecucao({ template, onClose, onConfirm }: {
  template: Template;
  onClose: () => void;
  onConfirm: (input: CriarExecucaoInput) => Promise<unknown>;
}) {
  const semanaIni = inicioSemanaAtual();
  const semanaFim = fimSemanaAtual();
  const [inicio, setInicio] = useState(fmtDateInput(semanaIni));
  const [fim, setFim] = useState(fmtDateInput(semanaFim));
  const [materializar, setMaterializar] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const handleConfirm = async () => {
    if (!inicio || !fim) return;
    setSaving(true);
    setErro(null);
    try {
      await onConfirm({
        empresa_id: EMPRESA_ID,
        template_id: template.template_id,
        periodo_inicio_utc: new Date(inicio + "T00:00:00"),
        periodo_fim_utc: new Date(fim + "T23:59:59"),
        materializar_itens: materializar,
      });
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao criar execução.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-5 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center">
              <PlayCircle className="w-4 h-4 text-sky-600" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900 text-sm">Nova Execução</h2>
              <p className="text-[11px] text-slate-400">Template: <span className="font-medium text-slate-600">{template.nome}</span></p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Período</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-400 mb-1">Início</p>
                <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 focus:bg-white" />
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Fim</p>
                <input type="date" value={fim} onChange={(e) => setFim(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 focus:bg-white" />
              </div>
            </div>
          </div>
          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100">
            <input type="checkbox" checked={materializar} onChange={(e) => setMaterializar(e.target.checked)} className="w-4 h-4 rounded accent-sky-600 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-slate-800">Materializar itens imediatamente</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Cria os itens de execução baseados nos itens planejados.</p>
            </div>
          </label>
          {erro && <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-2 text-xs text-rose-700"><AlertCircle className="w-3.5 h-3.5" />{erro}</div>}
        </div>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold">Cancelar</button>
          <button type="button" disabled={!inicio || !fim || saving} onClick={handleConfirm}
            className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            {saving ? "Criando..." : "Criar Execução"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalAdicionarItem({ template, centros, turnos, ordens, ordensLoading, onClose, onConfirm, empresaId }: {
  template: Template;
  centros: CTFiltro[];
  turnos: TurnoFiltro[];
  ordens: OrdemResumo[];
  ordensLoading: boolean;
  onClose: () => void;
  onConfirm: (input: AdicionarItemPlanejadoInput) => Promise<unknown>;
  empresaId: string;
}) {
  const [ctId, setCtId] = useState("");
  const [turnoId, setTurnoId] = useState("");
  const [selectedOrdem, setSelectedOrdem] = useState<OrdemResumo | null>(null);
  const [ordemSearch, setOrdemSearch] = useState("");
  const [showOrdemList, setShowOrdemList] = useState(false);
  const ordemListRef = useRef<HTMLDivElement>(null);
  const now = useMemo(() => { const d = new Date(); d.setHours(6, 0, 0, 0); return d; }, []);
  const nowEnd = useMemo(() => { const d = new Date(); d.setHours(14, 0, 0, 0); return d; }, []);
  const [inicioPlanejado, setInicioPlanejado] = useState(fmtDateLocalInput(now));
  const [fimPlanejado, setFimPlanejado] = useState(fmtDateLocalInput(nowEnd));
  const [meta, setMeta] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ordemsFiltradas = useMemo(() => {
    if (ordensLoading) return [];
    const q = ordemSearch.toLowerCase().trim();
    return (!q ? ordens : ordens.filter((o) =>
      (o.ordem_codigo ?? "").toLowerCase().includes(q) ||
      (o.produto_descricao ?? "").toLowerCase().includes(q)
    )).slice(0, 30);
  }, [ordens, ordemSearch, ordensLoading]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!showOrdemList) return;
      if (ordemListRef.current && e.target instanceof Node && !ordemListRef.current.contains(e.target)) setShowOrdemList(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showOrdemList]);

  const handleConfirm = async () => {
    if (!ctId || !turnoId || !selectedOrdem) return;
    setSaving(true);
    setErro(null);
    try {
      await onConfirm({
        empresa_id: empresaId,
        template_id: template.template_id,
        centro_trabalho_id: ctId,
        turno_id: turnoId,
        ordem_id: selectedOrdem.ordem_id,
        inicio_planejado_utc: new Date(inicioPlanejado),
        fim_planejado_utc: new Date(fimPlanejado),
        meta_planejada: meta ? Number(meta) : null,
      });
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-5 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center">
              <Plus className="w-4 h-4 text-sky-600" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900 text-sm">Adicionar Item Planejado</h2>
              <p className="text-[11px] text-slate-400">Template: <span className="font-medium text-slate-600">{template.nome}</span></p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Ordem de Produção *</label>
            <div className="relative" ref={ordemListRef}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-300 pointer-events-none" />
                <input type="text"
                  value={selectedOrdem ? `${selectedOrdem.ordem_codigo} — ${selectedOrdem.produto_descricao}` : ordemSearch}
                  onChange={(e) => { if (selectedOrdem) setSelectedOrdem(null); setOrdemSearch(e.target.value); setShowOrdemList(true); }}
                  onFocus={() => setShowOrdemList(true)}
                  placeholder={ordensLoading ? "Carregando..." : "Buscar por código ou produto..."}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-9 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:bg-white" />
                {selectedOrdem && (
                  <button type="button" onClick={() => { setSelectedOrdem(null); setOrdemSearch(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-slate-200 text-slate-400">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              {showOrdemList && !selectedOrdem && (
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-40 overflow-hidden">
                  <div className="max-h-48 overflow-y-auto">
                    {ordensLoading ? (
                      <div className="p-4 text-xs text-slate-400 flex items-center gap-2 justify-center"><Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" /> Carregando...</div>
                    ) : ordemsFiltradas.length === 0 ? (
                      <div className="p-4 text-xs text-slate-400 text-center">Nenhuma ordem.</div>
                    ) : ordemsFiltradas.map((o) => (
                      <button type="button" key={o.ordem_id} onClick={() => { setSelectedOrdem(o); setShowOrdemList(false); setOrdemSearch(""); }}
                        className="w-full text-left px-4 py-3 hover:bg-sky-50 border-b border-slate-100 last:border-b-0 transition-colors">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-mono font-bold text-slate-900 text-sm">{o.ordem_codigo}</p>
                            <p className="text-slate-400 text-xs truncate">{o.produto_descricao}</p>
                          </div>
                          <StatusBadge status={asStatusUi(o.status_ui)} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">CT *</label>
              <select value={ctId} onChange={(e) => setCtId(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 focus:bg-white appearance-none">
                <option value="">Selecionar...</option>
                {centros.map((ct) => <option key={ct.centro_trabalho_id} value={ct.centro_trabalho_id}>{ct.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Turno *</label>
              <select value={turnoId} onChange={(e) => setTurnoId(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 focus:bg-white appearance-none">
                <option value="">Selecionar...</option>
                {turnos.map((t) => <option key={t.turno_id} value={t.turno_id}>{t.nome} ({t.hora_inicio}–{t.hora_fim})</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Início Planejado *</label>
              <input type="datetime-local" value={inicioPlanejado} onChange={(e) => setInicioPlanejado(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 focus:bg-white" />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Fim Planejado *</label>
              <input type="datetime-local" value={fimPlanejado} onChange={(e) => setFimPlanejado(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 focus:bg-white" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Meta <span className="normal-case font-normal text-slate-300">(opcional)</span></label>
            <input type="number" min="0" value={meta} onChange={(e) => setMeta(e.target.value)} placeholder="Quantidade..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:bg-white" />
          </div>
          {erro && <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-2 text-xs text-rose-700"><AlertCircle className="w-3.5 h-3.5" />{erro}</div>}
        </div>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <p className="text-[11px] text-slate-400">* campos obrigatórios</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold">Cancelar</button>
            <button type="button" disabled={!ctId || !turnoId || !selectedOrdem || saving} onClick={handleConfirm}
              className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {saving ? "Adicionando..." : "Adicionar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PLANEJAMENTO — COMPONENTES
// ─────────────────────────────────────────────────────────────

function TemplateItemsPanel({ template, empresaId, onAdicionarItem, onRemoverItem }: {
  template: Template;
  empresaId: string;
  onAdicionarItem: () => void;
  onRemoverItem: (input: RemoverItemPlanejadoInput) => Promise<unknown>;
}) {
  const WIDE_START = useMemo(() => new Date(2020, 0, 1), []);
  const WIDE_END = useMemo(() => new Date(2030, 11, 31), []);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const itens = useItensPlanejados(empresaId, { periodo_inicio: WIDE_START, periodo_fim: WIDE_END, template_ids: [template.template_id] });
  const itensList = (itens.data ?? []) as ItemPlanejado[];
  const groupedByCT = useMemo(() => {
    const map = new Map<string, { ct_nome: string; itens: ItemPlanejado[] }>();
    for (const item of itensList) {
      if (!map.has(item.centro_trabalho_id)) map.set(item.centro_trabalho_id, { ct_nome: item.ct_nome, itens: [] });
      map.get(item.centro_trabalho_id)!.itens.push(item);
    }
    return Array.from(map.entries()).map(([id, val]) => ({ id, ...val }));
  }, [itensList]);

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await onRemoverItem({ empresa_id: empresaId, item_planejado_id: id });
      await itens.mutate();
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{template.nome}</p>
          <p className="text-[11px] text-slate-400">{itens.isLoading ? "Carregando…" : `${itensList.length} item(ns)`}</p>
        </div>
        <button type="button" onClick={onAdicionarItem} className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-semibold">
          <Plus className="w-3.5 h-3.5" /> Adicionar
        </button>
      </div>
      {itens.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : itensList.length === 0 ? (
        <div className="py-8 flex flex-col items-center gap-3 bg-slate-50 rounded-xl border border-dashed border-slate-200">
          <CalendarDays className="w-7 h-7 text-slate-300" />
          <p className="text-xs text-slate-400 text-center">Nenhum item planejado</p>
          <button type="button" onClick={onAdicionarItem} className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-semibold">
            <Plus className="w-3 h-3" /> Adicionar
          </button>
        </div>
      ) : (
        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {groupedByCT.map((group) => (
            <div key={group.id}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5 px-1">
                <Wrench className="w-3 h-3" />{group.ct_nome}
              </p>
              <div className="space-y-1.5">
                {group.itens.map((item) => (
                  <div key={item.item_planejado_id} className="group/item flex items-center gap-2 p-2.5 rounded-xl bg-white border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono font-bold text-slate-900 text-xs">{item.ordem_codigo}</p>
                      <p className="text-slate-400 text-[10px] mt-0.5 truncate">{item.turno_nome}</p>
                      {item.meta_planejada != null && <p className="text-[10px] font-mono text-slate-400">meta: {fmtNum(item.meta_planejada)}</p>}
                    </div>
                    <StatusItemBadge status={item.status_item} />
                    {confirmDelete === item.item_planejado_id ? (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button type="button" disabled={deleting} onClick={() => handleDelete(item.item_planejado_id)} className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-semibold disabled:opacity-50">{deleting ? "..." : "Sim"}</button>
                        <button type="button" onClick={() => setConfirmDelete(null)} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-semibold">Não</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setConfirmDelete(item.item_planejado_id)} className="flex-shrink-0 opacity-0 group-hover/item:opacity-100 p-1.5 rounded-lg hover:bg-rose-50 text-slate-300 hover:text-rose-600 transition-all" title="Remover">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({ template, selected, onSelect, onDelete, onNewExecucao }: {
  template: Template;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onNewExecucao: () => void;
}) {
  return (
    <div onClick={onSelect} className={cn("rounded-xl border p-3 cursor-pointer transition-all", selected ? "border-sky-200 bg-sky-50 ring-1 ring-sky-200 shadow-sm" : "border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 text-xs truncate">{template.nome}</p>
          <p className="text-[11px] text-slate-400 font-mono mt-0.5">{template.regra_recorrencia}</p>
        </div>
        <span className={cn("flex-shrink-0 text-[10px] px-2 py-0.5 rounded-lg border font-semibold", template.is_active ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-50 border-slate-200 text-slate-400")}>
          {template.is_active ? "Ativo" : "Inativo"}
        </span>
      </div>
      {selected && (
        <div className="mt-3 pt-3 border-t border-sky-200 flex items-center gap-2">
          <button type="button" onClick={(e) => { e.stopPropagation(); onNewExecucao(); }} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-semibold">
            <PlayCircle className="w-3 h-3" /> Nova Execução
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 rounded-xl hover:bg-rose-50 text-slate-300 hover:text-rose-600 border border-transparent hover:border-rose-100 transition-all" title="Excluir">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function ItemPlanejadoChip({ item, execItem, onUpdateStatus, empresaId }: {
  item?: ItemPlanejado;
  execItem?: ExecucaoItem;
  onUpdateStatus?: (input: AtualizarStatusExecucaoItemInput) => void;
  empresaId: string;
}) {
  const ref = execItem ?? item;
  if (!ref) return null;
  const status = ((execItem?.status_item ?? item?.status_item ?? "RELEASED") as StatusLogisticaItem);
  const Icon = STATUS_ITEM_ICONS[status] ?? Circle;
  const cls = colorStatusItem(status);
  const meta = toNum(ref.meta_planejada);
  const good = toNum(execItem?.total_good ?? 0);
  const pct = meta > 0 ? Math.round((good / meta) * 100) : 0;

  let chipBg = "border-slate-100 bg-slate-50/60";
  if (cls.includes("emerald")) {
    chipBg = "border-emerald-100 bg-emerald-50/60";
  } else if (cls.includes("sky")) {
    chipBg = "border-sky-100 bg-sky-50/60";
  } else if (cls.includes("amber")) {
    chipBg = "border-amber-100 bg-amber-50/60";
  } else if (cls.includes("violet")) {
    chipBg = "border-violet-100 bg-violet-50/60";
  } else if (cls.includes("rose")) {
    chipBg = "border-rose-100 bg-rose-50/60";
  }

  return (
    <div className={cn("rounded-xl border p-2 text-xs transition-all hover:shadow-sm", chipBg)}>
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <div className="min-w-0 flex-1">
          <p className="font-mono font-bold text-slate-900 truncate text-[11px] leading-none">{ref.ordem_codigo}</p>
          <p className="text-slate-400 truncate text-[10px] mt-0.5">{ref.produto_descricao}</p>
        </div>
        <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[9px] font-bold border flex-shrink-0", cls)}>
          <Icon className="w-2.5 h-2.5" />{labelStatusItem(status)}
        </span>
      </div>
      {meta > 0 && (
        <div className="mt-1">
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="text-slate-400 font-mono">{execItem ? `${fmtNum(good)} / ` : ""}{fmtNum(meta)}</span>
            {execItem && <span className={cn("font-bold", pct >= 100 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-slate-400")}>{pct}%</span>}
          </div>
          <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full", getProgressColor(pct))} style={{ width: `${clamp(pct, 0, 100)}%` }} />
          </div>
        </div>
      )}
      {execItem && onUpdateStatus && status !== "FINISHED" && status !== "SKIPPED" && (
        <div className="mt-2 flex items-center gap-1">
          {status === "RELEASED" && (
            <button type="button" onClick={() => onUpdateStatus({ empresa_id: empresaId, execucao_item_id: execItem.execucao_item_id, status_item: "RUNNING" })}
              className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold">
              <Play className="w-2.5 h-2.5" /> Iniciar
            </button>
          )}
          {status === "RUNNING" && (
            <button type="button" onClick={() => onUpdateStatus({ empresa_id: empresaId, execucao_item_id: execItem.execucao_item_id, status_item: "FINISHED" })}
              className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-bold">
              <CheckCheck className="w-2.5 h-2.5" /> Concluir
            </button>
          )}
          {status === "INTERRUPTED" && (
            <button type="button" onClick={() => onUpdateStatus({ empresa_id: empresaId, execucao_item_id: execItem.execucao_item_id, status_item: "RUNNING" })}
              className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold">
              <Play className="w-2.5 h-2.5" /> Retomar
            </button>
          )}
          <button type="button" onClick={() => onUpdateStatus({ empresa_id: empresaId, execucao_item_id: execItem.execucao_item_id, status_item: "SKIPPED" })}
            className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600" title="Pular">
            <SkipForward className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function SlotCell({ slot, onUpdateStatus, empresaId }: {
  slot?: SlotPlano;
  onUpdateStatus: (input: AtualizarStatusExecucaoItemInput) => void;
  empresaId: string;
}) {
  const itens = slot?.itens ?? [];
  const execItens = slot?.itens_execucao ?? [];
  const isEmpty = itens.length === 0 && execItens.length === 0;

  const allItemsMap = new Map<string, { item?: ItemPlanejado; execItem?: ExecucaoItem }>();
  for (const item of itens) allItemsMap.set(item.item_planejado_id, { item });
  for (const ei of execItens) {
    const key = ei.item_planejado_id ?? ei.execucao_item_id;
    if (key) {
      const existing = allItemsMap.get(key);
      if (existing) {
        existing.execItem = ei;
      } else {
        allItemsMap.set(key, { execItem: ei });
      }
    } else {
      allItemsMap.set(ei.execucao_item_id, { execItem: ei });
    }
  }
  const entries = Array.from(allItemsMap.values());

  if (isEmpty) return <div className="min-h-[56px] flex items-center justify-center"><div className="w-4 h-px bg-slate-100" /></div>;
  return (
    <div className="min-h-[56px] p-1.5 space-y-1.5">
      {entries.map((e, i) => (
        <ItemPlanejadoChip
          key={e.execItem?.execucao_item_id ?? e.item?.item_planejado_id ?? String(i)}
          item={e.item}
          execItem={e.execItem}
          onUpdateStatus={onUpdateStatus}
          empresaId={empresaId}
        />
      ))}
    </div>
  );
}

function ExecucaoCard({ exec, onMaterializar, empresaId }: {
  exec: Execucao;
  onMaterializar: (input: MaterializarExecucaoInput) => Promise<unknown>;
  empresaId: string;
}) {
  const [loading, setLoading] = useState(false);
  const pct = fmtPct(exec.total_good, exec.total_meta);

  let statusColor = "text-slate-600 bg-slate-50 border-slate-200";
  if (exec.status_execucao === "RUNNING") {
    statusColor = "text-emerald-700 bg-emerald-50 border-emerald-200";
  } else if (exec.status_execucao === "FINISHED") {
    statusColor = "text-violet-700 bg-violet-50 border-violet-200";
  } else if (exec.status_execucao === "RELEASED") {
    statusColor = "text-sky-700 bg-sky-50 border-sky-200";
  }

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="font-semibold text-slate-900 text-xs truncate flex-1">{exec.template_nome ?? "—"}</p>
        <span className={cn("px-2 py-0.5 rounded-lg border font-bold text-[10px] flex-shrink-0", statusColor)}>{exec.status_execucao ?? "—"}</span>
      </div>
      <p className="text-slate-400 font-mono mb-2 text-[11px]">{fmtDateShort(exec.periodo_inicio_utc)} → {fmtDateShort(exec.periodo_fim_utc)}</p>
      <div className="flex items-center justify-between text-[11px] mb-1.5">
        <span className="text-slate-400">{exec.itens_concluidos ?? 0}/{exec.total_itens ?? 0} itens</span>
        <span className={cn("font-bold font-mono", pct >= 75 ? "text-emerald-600" : "text-amber-600")}>{pct}%</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2">
        <div className={cn("h-full rounded-full", getProgressColor(pct))} style={{ width: `${clamp(pct, 0, 100)}%` }} />
      </div>
      {exec.status_execucao === "RELEASED" && (
        <button type="button" disabled={loading} onClick={async () => {
          setLoading(true);
          try { await onMaterializar({ empresa_id: empresaId, execucao_id: exec.execucao_id }); }
          finally { setLoading(false); }
        }}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-[10px] font-bold">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          {loading ? "Materializando..." : "Materializar"}
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PLANEJAMENTO TAB
// ═══════════════════════════════════════════════════════════════
function PlanejamentoTab({ empresaId }: { empresaId: string }) {
  const semanaIni = useMemo(() => inicioSemanaAtual(), []);
  const semanaFim = useMemo(() => fimSemanaAtual(), []);
  const [periodoInicio, setPeriodoInicio] = useState<Date>(semanaIni);
  const [periodoFim, setPeriodoFim] = useState<Date>(semanaFim);
  const [selectedCTs, setSelectedCTs] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [templateParaExecucao, setTemplateParaExecucao] = useState<Template | null>(null);
  const [showAdicionarItem, setShowAdicionarItem] = useState(false);
  const [ctExpanded, setCtExpanded] = useState<Record<string, boolean>>({});
  const [mostrarInativos, setMostrarInativos] = useState(false);

  const ordens = useKanbanOrdens(empresaId, {}, { refreshInterval: 0 });
  const ordensList = (ordens.data ?? []) as OrdemResumo[];
  const centrosFiltro = useCentrosTrabalhoFiltro(empresaId);
  const turnosFiltro = useTurnosFiltro(empresaId);
  const centrosOpt = useMemo<CTFiltro[]>(
    () => (centrosFiltro?.data ?? []).filter((c): c is CTFiltro => !!(c as CTFiltro)?.centro_trabalho_id),
    [centrosFiltro?.data],
  );
  const turnosOpt = useMemo<TurnoFiltro[]>(
    () => (turnosFiltro?.data ?? []).filter((t): t is TurnoFiltro => !!(t as TurnoFiltro)?.turno_id),
    [turnosFiltro?.data],
  );

  const { plano, templates, execucoes, invalidate, criarTemplate, excluirTemplate, adicionarItem, removerItem, criarExecucao, materializar, atualizarStatusItem, isMutating } =
    usePlanejamentoCompleto(empresaId, periodoInicio, periodoFim, selectedCTs.length ? selectedCTs : undefined, { refreshInterval: 30_000 });

  const allTemplates = useTemplates(empresaId, false);
  const allTemplatesList = (allTemplates.data ?? []) as Template[];
  const templatesList = mostrarInativos ? allTemplatesList : allTemplatesList.filter((t) => t.is_active);
  const planoCTs = (plano.data ?? []) as PlanoCT[];
  const execucoesList: Execucao[] = execucoes.data ?? [];
  const selectedTemplate = useMemo(
    () => allTemplatesList.find((t) => t.template_id === selectedTemplateId) ?? null,
    [allTemplatesList, selectedTemplateId],
  );
  const diasSemana = useMemo(() => getDiasSemana(periodoInicio, periodoFim), [periodoInicio, periodoFim]);
  const turnosUnicos = useMemo(() => {
    const map = new Map<string, string>();
    for (const ct of planoCTs) for (const slot of ct.slots) if (!map.has(slot.turno_id)) map.set(slot.turno_id, slot.turno_nome);
    if (map.size === 0) for (const t of turnosOpt) map.set(t.turno_id, t.nome);
    return Array.from(map.entries()).map(([id, nome]) => ({ turno_id: id, turno_nome: nome }));
  }, [planoCTs, turnosOpt]);

  const navSemana = (dir: -1 | 1) => {
    const ini = new Date(periodoInicio);
    ini.setDate(ini.getDate() + dir * 7);
    const fim = new Date(periodoFim);
    fim.setDate(fim.getDate() + dir * 7);
    setPeriodoInicio(ini);
    setPeriodoFim(fim);
  };

  const handleAtualizarStatus = useCallback(
    async (input: AtualizarStatusExecucaoItemInput) => { await atualizarStatusItem(input); },
    [atualizarStatusItem],
  );
  const handleAdicionarItem = useCallback(
    async (input: AdicionarItemPlanejadoInput) => adicionarItem(input),
    [adicionarItem],
  );
  const handleRemoverItem = useCallback(
    async (input: RemoverItemPlanejadoInput) => removerItem(input),
    [removerItem],
  );
  const handleCriarTemplate = useCallback(async (input: CriarTemplateInput) => {
    const r = await criarTemplate(input);
    await allTemplates.mutate();
    return r;
  }, [criarTemplate, allTemplates]);
  const handleCriarExecucao = useCallback(
    async (input: CriarExecucaoInput) => criarExecucao(input),
    [criarExecucao],
  );
  const handleExcluirTemplate = async (t: Template) => {
    if (!confirm(`Excluir template "${t.nome}"?`)) return;
    await excluirTemplate({ empresa_id: empresaId, template_id: t.template_id });
    await allTemplates.mutate();
    if (selectedTemplateId === t.template_id) setSelectedTemplateId(null);
  };

  // Suppress unused variable warning for templates
  void templates;

  return (
    <div className="space-y-5">
      <div className="flex flex-col xl:flex-row gap-5">
        {/* Painel esquerdo — templates */}
        <div className="xl:w-60 flex-shrink-0 space-y-3">
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-900">Templates</p>
                <p className="text-[11px] text-slate-400">{templatesList.length} plano(s)</p>
              </div>
              <button type="button" onClick={() => setShowCreateTemplate(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[11px] font-bold">
                <Plus className="w-3 h-3" /> Novo
              </button>
            </div>
            <div className="p-2 space-y-1.5 max-h-[400px] overflow-y-auto">
              {allTemplates.isLoading
                ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)
                : templatesList.length === 0
                  ? <EmptyState label="Nenhum template" sub="Clique em Novo para criar" />
                  : templatesList.map((t) => (
                    <TemplateCard
                      key={t.template_id}
                      template={t}
                      selected={selectedTemplateId === t.template_id}
                      onSelect={() => setSelectedTemplateId(selectedTemplateId === t.template_id ? null : t.template_id)}
                      onDelete={() => handleExcluirTemplate(t)}
                      onNewExecucao={() => setTemplateParaExecucao(t)}
                    />
                  ))}
            </div>
            <div className="px-3 py-2.5 border-t border-slate-100">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} className="w-3.5 h-3.5 rounded accent-sky-600" />
                <span className="text-[11px] text-slate-400">Mostrar inativos</span>
              </label>
            </div>
          </Card>

          {execucoesList.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-xs font-bold text-slate-900">Execuções</p>
                <p className="text-[11px] text-slate-400">{execucoesList.length} no período</p>
              </div>
              <div className="p-2 space-y-2 max-h-[280px] overflow-y-auto">
                {execucoesList.map((exec) => (
                  <ExecucaoCard key={exec.execucao_id} exec={exec} onMaterializar={materializar} empresaId={empresaId} />
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Painel itens do template selecionado */}
        {selectedTemplate && (
          <div className="xl:w-64 flex-shrink-0">
            <Card className="overflow-hidden h-full">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center flex-shrink-0">
                  <CalendarDays className="w-3.5 h-3.5 text-sky-600" />
                </div>
                <p className="text-xs font-bold text-slate-900 flex-1 truncate">Itens do Template</p>
                <button type="button" onClick={() => setSelectedTemplateId(null)} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 flex-shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="p-3">
                <TemplateItemsPanel
                  template={selectedTemplate}
                  empresaId={empresaId}
                  onAdicionarItem={() => setShowAdicionarItem(true)}
                  onRemoverItem={handleRemoverItem}
                />
              </div>
            </Card>
          </div>
        )}

        {/* Calendário semanal */}
        <div className="flex-1 min-w-0 space-y-3">
          <Card className="p-3">
            <div className="flex items-center flex-wrap gap-2.5">
              <div className="flex items-center gap-0.5 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                <button type="button" onClick={() => navSemana(-1)} className="p-2 hover:bg-slate-100 text-slate-500"><ChevronLeft className="w-4 h-4" /></button>
                <button type="button" onClick={() => { setPeriodoInicio(inicioSemanaAtual()); setPeriodoFim(fimSemanaAtual()); }} className="px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100">Hoje</button>
                <button type="button" onClick={() => navSemana(1)} className="p-2 hover:bg-slate-100 text-slate-500"><ChevronRight className="w-4 h-4" /></button>
              </div>
              <div className="flex items-center gap-2">
                <CalendarRange className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-sm font-semibold text-slate-800">
                  {periodoInicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – {periodoFim.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider flex-shrink-0">CT:</span>
                  <button type="button" onClick={() => setSelectedCTs([])}
                    className={cn("px-2 py-1 rounded-xl text-[11px] border font-semibold transition-all", selectedCTs.length === 0 ? "bg-sky-50 border-sky-200 text-sky-700" : "bg-white border-slate-200 text-slate-500 hover:border-slate-300")}>
                    Todos
                  </button>
                  {centrosOpt.slice(0, 6).map((ct) => {
                    const active = selectedCTs.includes(ct.centro_trabalho_id);
                    return (
                      <button type="button" key={ct.centro_trabalho_id}
                        onClick={() => setSelectedCTs(active ? selectedCTs.filter((x) => x !== ct.centro_trabalho_id) : [...selectedCTs, ct.centro_trabalho_id])}
                        className={cn("px-2 py-1 rounded-xl text-[11px] border font-semibold transition-all", active ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-white border-slate-200 text-slate-500 hover:border-slate-300")}>
                        {ct.nome}
                      </button>
                    );
                  })}
                  {centrosOpt.length > 6 && <span className="text-[11px] text-slate-400">+{centrosOpt.length - 6}</span>}
                </div>
              </div>
              <div className="flex items-center gap-0.5 bg-slate-50 border border-slate-200 rounded-xl p-1">
                <IconBtn icon={isMutating ? Loader2 : RefreshCw} label="Atualizar" onClick={() => invalidate()} disabled={isMutating} />
              </div>
            </div>
          </Card>

          {plano.isLoading ? (
            <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-48" />)}</div>
          ) : planoCTs.length === 0 ? (
            <Card className="p-12">
              <div className="flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center">
                  <CalendarRange className="w-6 h-6 text-slate-300" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-slate-700 text-sm">Nenhum item planejado no período</p>
                  <p className="text-xs text-slate-400 mt-1">Crie um template e adicione itens para visualizar o calendário.</p>
                </div>
                {allTemplatesList.length === 0 && (
                  <button type="button" onClick={() => setShowCreateTemplate(true)} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold">
                    <Plus className="w-3.5 h-3.5" /> Criar Primeiro Template
                  </button>
                )}
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              {planoCTs.map((ct) => {
                const isExpanded = ctExpanded[ct.centro_trabalho_id] !== false;
                const totalItens = ct.slots.reduce((s, sl) => s + sl.itens.length + sl.itens_execucao.length, 0);
                const concluidos = ct.slots.reduce((s, sl) => s + sl.itens_execucao.filter((i) => i.status_item === "FINISHED").length, 0);
                const running = ct.slots.reduce((s, sl) => s + sl.itens_execucao.filter((i) => i.status_item === "RUNNING").length, 0);
                const ctTotalMeta = ct.slots.reduce((s, sl) => s + sl.itens_execucao.reduce((ss, i) => ss + toNum(i.meta_planejada), 0), 0);
                const ctTotalGood = ct.slots.reduce((s, sl) => s + sl.itens_execucao.reduce((ss, i) => ss + toNum(i.total_good), 0), 0);
                const ctPct = fmtPct(ctTotalGood, ctTotalMeta);
                const statusAtual = ct.status_atual;

                return (
                  <Card key={ct.centro_trabalho_id} className="overflow-hidden">
                    <button
                      type="button"
                      className="w-full text-left px-5 py-3.5 hover:bg-slate-50 transition-colors"
                      onClick={() => setCtExpanded((p) => ({ ...p, [ct.centro_trabalho_id]: !isExpanded }))}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0",
                            statusAtual?.status_ct === "RUNNING" ? "bg-emerald-100 border border-emerald-200" : "bg-slate-100")}>
                            <Wrench className={cn("w-4 h-4", statusAtual?.status_ct === "RUNNING" ? "text-emerald-600" : "text-slate-500")} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-slate-900 text-sm">{ct.ct_nome}</p>
                              {statusAtual?.status_ct === "RUNNING" && (
                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-lg flex items-center gap-1">
                                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" /> AO VIVO
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2.5 mt-0.5 flex-wrap">
                              <span className="text-[11px] text-slate-400">{totalItens} item(ns)</span>
                              {running > 0 && <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />{running} exec.</span>}
                              {concluidos > 0 && <span className="inline-flex items-center gap-1 text-[11px] text-violet-600 font-semibold"><CheckCircle2 className="w-3 h-3" />{concluidos} concluídos</span>}
                              {ctTotalMeta > 0 && <span className={cn("text-[11px] font-mono font-bold", ctPct >= 75 ? "text-emerald-600" : ctPct >= 40 ? "text-amber-600" : "text-slate-400")}>{ctPct}%</span>}
                            </div>
                          </div>
                        </div>
                        <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform flex-shrink-0", isExpanded ? "rotate-180" : "")} />
                      </div>
                    </button>
                    {isExpanded && (
                      <>
                        <Divider />
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[700px] border-collapse">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-100">
                                <th className="w-24 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 border-r border-slate-100 sticky left-0 bg-slate-50 z-10">Turno</th>
                                {diasSemana.map((dia) => {
                                  const d = new Date(dia + "T12:00:00");
                                  const isHoje = dia === new Date().toISOString().slice(0, 10);
                                  return (
                                    <th key={dia} className={cn("px-2 py-2.5 text-center text-[11px] font-bold tracking-wider border-r border-slate-100 last:border-r-0 min-w-[110px]",
                                      isHoje ? "bg-sky-50 text-sky-700" : "text-slate-500")}>
                                      <p>{DIAS_SEMANA_PT[d.getDay()]}</p>
                                      <p className={cn("font-mono mt-0.5", isHoje ? "text-sky-700 font-extrabold" : "font-normal text-slate-400")}>{d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</p>
                                    </th>
                                  );
                                })}
                              </tr>
                            </thead>
                            <tbody>
                              {turnosUnicos.length === 0 ? (
                                <tr><td colSpan={diasSemana.length + 1} className="py-8 text-center text-slate-400 text-sm">Nenhum slot planejado.</td></tr>
                              ) : turnosUnicos.map(({ turno_id, turno_nome }) => (
                                <tr key={turno_id} className="border-b border-slate-50 last:border-b-0">
                                  <td className="px-3 py-2 border-r border-slate-100 align-top sticky left-0 bg-white z-10 min-w-[90px]">
                                    <p className="font-bold text-slate-600 text-[11px] leading-tight">{turno_nome}</p>
                                  </td>
                                  {diasSemana.map((dia) => {
                                    const slot = ct.slots.find((s) => s.data_local === dia && s.turno_id === turno_id);
                                    const isHoje = dia === new Date().toISOString().slice(0, 10);
                                    return (
                                      <td key={dia} className={cn("px-1 py-1 border-r border-slate-50 last:border-r-0 align-top", isHoje ? "bg-sky-50/30" : "")}>
                                        <SlotCell slot={slot} onUpdateStatus={handleAtualizarStatus} empresaId={empresaId} />
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showCreateTemplate && <ModalCriarTemplate onClose={() => setShowCreateTemplate(false)} onConfirm={handleCriarTemplate} />}
      {templateParaExecucao && (
        <ModalCriarExecucao
          template={templateParaExecucao}
          onClose={() => setTemplateParaExecucao(null)}
          onConfirm={async (input) => { await handleCriarExecucao(input); setTemplateParaExecucao(null); }}
        />
      )}
      {showAdicionarItem && selectedTemplate && (
        <ModalAdicionarItem
          template={selectedTemplate}
          centros={centrosOpt}
          turnos={turnosOpt}
          ordens={ordensList}
          ordensLoading={ordens.isLoading}
          onClose={() => setShowAdicionarItem(false)}
          onConfirm={handleAdicionarItem}
          empresaId={empresaId}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB PILLS
// ─────────────────────────────────────────────────────────────
function TabPills({ tabs, active, onChange }: {
  tabs: Array<{ id: TabType; label: string; icon: ElementType }>;
  active: TabType;
  onChange: (t: TabType) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto">
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.id;
        return (
          <button key={t.id} type="button" onClick={() => onChange(t.id)}
            className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all border whitespace-nowrap",
              isActive ? "bg-white border-slate-200 text-slate-900 shadow-sm" : "bg-transparent border-transparent text-slate-500 hover:text-slate-700 hover:bg-white/60")}>
            <Icon className={cn("w-3.5 h-3.5", isActive ? "text-sky-600" : "text-slate-400")} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────
function LogisticaOrdensContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("kanban");
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const tab = searchParams.get("tab") as TabType | null;
    if (tab && (["fila", "kanban", "executadas", "planejamento"] as TabType[]).includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const tabs = [
    { id: "kanban" as TabType, label: "Kanban", icon: LayoutGrid },
    { id: "fila" as TabType, label: "Fila de Produção", icon: List },
    { id: "planejamento" as TabType, label: "Planejamento", icon: CalendarRange },
    { id: "executadas" as TabType, label: "Executadas", icon: CheckSquare },
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FB] text-slate-900">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="min-h-screen">
        <Header onMenuClick={() => setSidebarOpen(true)} title="Logística de Ordens" />

        <div className="sticky top-0 z-20 bg-[#F8F9FB]/90 backdrop-blur-md border-b border-slate-200/60">
          <div className="px-4 lg:px-6 py-3">
            <div className="flex items-center justify-between gap-4 mb-3">
              <div className="min-w-0">
                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Painel operacional</p>
                <h1 className="text-[20px] font-bold text-slate-800 leading-tight">Ordens de Produção</h1>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-slate-400 text-xs font-mono hidden sm:block">
                  {now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
            <TabPills tabs={tabs} active={activeTab} onChange={handleTabChange} />
          </div>
        </div>

        <div className="p-4 lg:p-6">
          {!EMPRESA_ID ? (
            <ErrorState
              message="NEXT_PUBLIC_EMPRESA_ID não configurado. Defina no .env e reinicie o Next."
              onRetry={() => window.location.reload()}
            />
          ) : (
            <>
              {activeTab === "kanban" && <KanbanTab empresaId={EMPRESA_ID} />}
              {activeTab === "fila" && <FilaTab empresaId={EMPRESA_ID} />}
              {activeTab === "planejamento" && <PlanejamentoTab empresaId={EMPRESA_ID} />}
              {activeTab === "executadas" && <ExecutadasTab empresaId={EMPRESA_ID} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function LogisticaOrdensPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F8F9FB] flex items-center justify-center">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-sky-600 animate-spin" />
            <span className="text-sm text-slate-500 font-medium">Carregando…</span>
          </div>
        </div>
      }
    >
      <LogisticaOrdensContent />
    </Suspense>
  );
}
"use client"

import React from "react"
import { useState, useRef, useEffect } from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { CENTROS, MOTIVOS, PRODUTOS } from "@/lib/demo/catalog"
import {
  Plus,
  Calendar,
  BarChart3,
  AlertTriangle,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  Info,
  ExternalLink,
  FileText,
  TrendingDown,
  Trash2,
} from "lucide-react"

// Types
interface Plan {
  id: string
  name: string
  period: string
  workCenters: string[]
  lossType: string
  loss: string
  status: "avaliado" | "cancelado" | "em_execucao" | "em_planejamento" | "finalizado"
  createdAt: string
}

interface FilterState {
  period: { start: Date; end: Date }
  workCenters: string[]
  lossType: string
  loss: string
  status: string
}

// Catálogos da demonstração (mesma fábrica fictícia usada nas demais telas)
const workCentersList = CENTROS.map((c) => c.nome)

const lossTypeOptions = ["Disponibilidade", "Performance", "Qualidade"]

const lossOptions = MOTIVOS.map((m) => m.descricao)

const statusOptions = [
  { value: "avaliado", label: "Avaliado" },
  { value: "cancelado", label: "Cancelado" },
  { value: "em_execucao", label: "Em Execução" },
  { value: "em_planejamento", label: "Em Planejamento" },
  { value: "finalizado", label: "Finalizado" },
]

const turnoOptions = ["Manhã", "Tarde", "Noite"]
const productOptions = PRODUTOS.map((p) => p.codigo)

const mockPlans: Plan[] = [
  {
    id: "1",
    name: "Redução do tempo de setup na moldagem",
    period: "27/01/2026 - 30/01/2026",
    workCenters: ["Moldagem Automática 01", "Moldagem Automática 02"],
    lossType: "Disponibilidade",
    loss: "Setup / troca de ferramental",
    status: "em_execucao",
    createdAt: "2026-01-27",
  },
  {
    id: "2",
    name: "Estabilização do ciclo na usinagem",
    period: "20/01/2026 - 25/01/2026",
    workCenters: ["Centro de Usinagem 01"],
    lossType: "Performance",
    loss: "Ajuste de processo",
    status: "finalizado",
    createdAt: "2026-01-20",
  },
]

// Perdas exibidas na etapa 1 do assistente (Pareto ilustrativo)
const lossItems = [
  { name: "Falta de material", value: 8896.49, type: "disponibilidade", color: "bg-rose-400" },
  { name: "Parada não justificada", value: 7881.97, type: "disponibilidade", color: "bg-rose-400" },
  { name: "Desvio de qualidade", value: 1120.02, type: "qualidade", color: "bg-amber-400" },
  { name: "Troca de ferramenta por desgaste", value: 484.43, type: "performance", color: "bg-teal-500" },
]

// Date Picker Component
function DateRangePicker({
  value,
  onChange,
  onClose,
}: {
  value: { start: Date; end: Date }
  onChange: (value: { start: Date; end: Date }) => void
  onClose: () => void
}) {
  const [selectedPreset, setSelectedPreset] = useState("personalizado")
  const [tempStart, setTempStart] = useState(new Date(value.start))
  const [tempEnd, setTempEnd] = useState(new Date(value.end))
  const [currentMonth1, setCurrentMonth1] = useState(new Date(2025, 11, 1))
  const [currentMonth2, setCurrentMonth2] = useState(new Date(2026, 0, 1))
  const [startHour, setStartHour] = useState("11")
  const [startMinute, setStartMinute] = useState("38")
  const [endHour, setEndHour] = useState("11")
  const [endMinute, setEndMinute] = useState("38")

  const presets = [
    { id: "hoje", label: "Hoje" },
    { id: "ontem", label: "Ontem" },
    { id: "ultimos7", label: "Últimos 7 dias" },
    { id: "ultimos30", label: "Últimos 30 dias" },
    { id: "semana_atual", label: "Semana atual" },
    { id: "semana_anterior", label: "Semana anterior" },
    { id: "mes_atual", label: "Mês atual" },
    { id: "mes_anterior", label: "Mês anterior" },
    { id: "ano_atual", label: "Ano atual" },
    { id: "ano_anterior", label: "Ano anterior" },
    { id: "personalizado", label: "Personalizado" },
  ]

  const applyPreset = (presetId: string) => {
    setSelectedPreset(presetId)
    const today = new Date(2026, 0, 30) // Current date
    let start = new Date(today)
    let end = new Date(today)

    switch (presetId) {
      case "hoje":
        start = new Date(today)
        end = new Date(today)
        break
      case "ontem":
        start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
        end = new Date(start)
        break
      case "ultimos7":
        start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7)
        end = new Date(today)
        break
      case "ultimos30":
        start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)
        end = new Date(today)
        break
      case "mes_atual":
        start = new Date(today.getFullYear(), today.getMonth(), 1)
        end = new Date(today)
        break
      case "mes_anterior":
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
        end = new Date(today.getFullYear(), today.getMonth(), 0)
        break
      case "semana_atual":
        const dayOfWeek = today.getDay()
        start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dayOfWeek)
        end = new Date(today)
        break
      case "semana_anterior":
        const dow = today.getDay()
        start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow - 7)
        end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow - 1)
        break
      case "ano_atual":
        start = new Date(today.getFullYear(), 0, 1)
        end = new Date(today)
        break
      case "ano_anterior":
        start = new Date(today.getFullYear() - 1, 0, 1)
        end = new Date(today.getFullYear() - 1, 11, 31)
        break
      default:
        return
    }
    setTempStart(start)
    setTempEnd(end)
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("pt-BR")
  }

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const days: (Date | null)[] = []

    for (let i = 0; i < firstDay.getDay(); i++) {
      days.push(null)
    }

    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i))
    }

    return days
  }

  const isInRange = (date: Date) => {
    const dateTime = date.getTime()
    const startTime = tempStart.getTime()
    const endTime = tempEnd.getTime()
    return dateTime >= startTime && dateTime <= endTime
  }

  const isStart = (date: Date) => {
    return date.toDateString() === tempStart.toDateString()
  }

  const isEnd = (date: Date) => {
    return date.toDateString() === tempEnd.toDateString()
  }

  const handleDayClick = (date: Date) => {
    if (tempStart && tempEnd && tempStart.toDateString() !== tempEnd.toDateString()) {
      setTempStart(date)
      setTempEnd(date)
    } else if (!tempStart || date < tempStart) {
      setTempStart(date)
      setTempEnd(date)
    } else {
      setTempEnd(date)
    }
    setSelectedPreset("personalizado")
  }

  const monthNames = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ]

  const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"))
  const minutes = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, "0"))

  const renderCalendar = (monthDate: Date, setMonthDate: (d: Date) => void) => {
    const days = getDaysInMonth(monthDate)

    return (
      <div className="flex-1 min-w-[200px]">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))}
            className="p-1 hover:bg-slate-100 rounded transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-medium text-sm">
            {monthNames[monthDate.getMonth()]} {monthDate.getFullYear()}
          </span>
          <button
            onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))}
            className="p-1 hover:bg-slate-100 rounded transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs mb-2">
          {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
            <div key={i} className="text-slate-500 font-medium py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((day, i) => (
            <button
              key={i}
              disabled={!day}
              onClick={() => day && handleDayClick(day)}
              className={`p-2 text-xs rounded transition-colors ${
                !day
                  ? "invisible"
                  : isStart(day) || isEnd(day)
                    ? "bg-slate-700 text-white"
                    : isInRange(day)
                      ? "bg-slate-200"
                      : "hover:bg-slate-100"
              }`}
            >
              {day?.getDate()}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 flex flex-col md:flex-row max-w-[95vw] overflow-auto">
      {/* Presets */}
      <div className="w-full md:w-40 border-b md:border-b-0 md:border-r border-slate-200 py-2 flex flex-row md:flex-col overflow-x-auto md:overflow-x-visible">
        {presets.map((preset) => (
          <button
            key={preset.id}
            onClick={() => applyPreset(preset.id)}
            className={`flex-shrink-0 md:w-full text-left px-4 py-2 text-sm transition-colors whitespace-nowrap ${
              selectedPreset === preset.id ? "bg-slate-700 text-white" : "hover:bg-slate-100 text-slate-700"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Calendars */}
      <div className="p-4">
        <div className="flex flex-col md:flex-row gap-6">
          {renderCalendar(currentMonth1, setCurrentMonth1)}
          {renderCalendar(currentMonth2, setCurrentMonth2)}
        </div>

        {/* Time selectors */}
        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-slate-200">
          <div className="flex items-center gap-2">
            <select 
              value={startHour}
              onChange={(e) => setStartHour(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1 text-sm"
            >
              {hours.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <span>:</span>
            <select 
              value={startMinute}
              onChange={(e) => setStartMinute(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1 text-sm"
            >
              {minutes.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <select 
              value={endHour}
              onChange={(e) => setEndHour(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1 text-sm"
            >
              {hours.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <span>:</span>
            <select 
              value={endMinute}
              onChange={(e) => setEndMinute(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1 text-sm"
            >
              {minutes.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-4 pt-4 border-t border-slate-200">
          <span className="text-sm text-slate-600">
            {formatDate(tempStart)} {startHour}:{startMinute} - {formatDate(tempEnd)} {endHour}:{endMinute}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded">
              Cancelar
            </button>
            <button
              onClick={() => {
                onChange({ start: tempStart, end: tempEnd })
                onClose()
              }}
              className="px-4 py-2 text-sm bg-slate-700 text-white rounded hover:bg-slate-800"
            >
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Dropdown Component
function FilterDropdown({
  label,
  icon: Icon,
  value,
  options,
  onChange,
  multiple = false,
  selectedItems = [],
  onMultiChange,
}: {
  label: string
  icon: React.ElementType
  value: string
  options: string[] | { value: string; label: string }[]
  onChange?: (value: string) => void
  multiple?: boolean
  selectedItems?: string[]
  onMultiChange?: (items: string[]) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [filter, setFilter] = useState("")
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const normalizedOptions = options.map((opt) => (typeof opt === "string" ? { value: opt, label: opt } : opt))

  const filteredOptions = normalizedOptions.filter((opt) => opt.label.toLowerCase().includes(filter.toLowerCase()))

  const handleSelect = (optValue: string) => {
    if (multiple && onMultiChange) {
      if (selectedItems.includes(optValue)) {
        onMultiChange(selectedItems.filter((item) => item !== optValue))
      } else {
        onMultiChange([...selectedItems, optValue])
      }
    } else if (onChange) {
      onChange(optValue)
      setIsOpen(false)
    }
  }

  const displayValue = multiple
    ? selectedItems.length > 0
      ? selectedItems.length === 1
        ? selectedItems[0]
        : `${selectedItems.length} selecionados`
      : "Todos"
    : value || "Todos"

  return (
    <div className="flex-1 min-w-0" ref={dropdownRef}>
      <div className="flex items-center gap-2 text-sm text-slate-600 mb-1">
        <Icon className="w-4 h-4" />
        <span className="truncate">{label}</span>
      </div>
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm hover:border-slate-400 transition-colors"
        >
          <span className="truncate">{displayValue}</span>
          <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-40 max-h-64 overflow-hidden">
            <div className="p-2 border-b border-slate-100">
              <input
                type="text"
                placeholder="Filtrar"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:border-slate-500"
              />
            </div>
            {multiple && selectedItems.length > 0 && (
              <button
                onClick={() => onMultiChange?.([])}
                className="w-full text-left px-3 py-2 text-sm text-rose-500 hover:bg-rose-50 flex items-center gap-2"
              >
                <X className="w-3 h-3" />
                Limpar seleções
              </button>
            )}
            <div className="max-h-48 overflow-y-auto">
              {filteredOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleSelect(opt.value)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 flex items-center gap-2"
                >
                  {multiple && (
                    <div
                      className={`w-4 h-4 border rounded flex items-center justify-center ${
                        selectedItems.includes(opt.value) ? "bg-slate-700 border-slate-700" : "border-slate-300"
                      }`}
                    >
                      {selectedItems.includes(opt.value) && <Check className="w-3 h-3 text-white" />}
                    </div>
                  )}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Step Indicator Component
function StepIndicator({
  currentStep,
  onStepClick,
}: {
  currentStep: number
  onStepClick: (step: number) => void
}) {
  const steps = [
    { number: 1, label: "Perda" },
    { number: 2, label: "Exploratória" },
    { number: 3, label: "Causa raiz" },
    { number: 4, label: "Plano" },
    { number: 5, label: "Monitoramento" },
  ]

  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2 py-6 overflow-x-auto">
      {steps.map((step, index) => (
        <div key={step.number} className="flex items-center">
          <button
            onClick={() => step.number <= currentStep && onStepClick(step.number)}
            className={`flex flex-col items-center ${step.number <= currentStep ? "cursor-pointer" : "cursor-default"}`}
          >
            <div
              className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs sm:text-sm font-semibold border-2 transition-colors ${
                step.number < currentStep
                  ? "bg-slate-700 border-slate-700 text-white"
                  : step.number === currentStep
                    ? "bg-white border-slate-700 text-slate-700"
                    : "bg-white border-slate-300 text-slate-400"
              }`}
            >
              {step.number < currentStep ? <Check className="w-4 h-4 sm:w-5 sm:h-5" /> : step.number}
            </div>
            <span
              className={`text-[10px] sm:text-xs mt-1 whitespace-nowrap ${step.number === currentStep ? "text-slate-700 font-medium" : "text-slate-500"}`}
            >
              {step.label}
            </span>
          </button>
          {index < steps.length - 1 && (
            <div className={`w-8 sm:w-16 h-0.5 mx-1 sm:mx-2 ${step.number < currentStep ? "bg-slate-700" : "bg-slate-300"}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// Step 1: Definição da Perda
function Step1Content({
  wizardData,
  setWizardData,
  onNext,
}: {
  wizardData: WizardData
  setWizardData: (data: WizardData) => void
  onNext: () => void
}) {
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showTurnoDropdown, setShowTurnoDropdown] = useState(false)
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const [selectedLoss, setSelectedLoss] = useState<string | null>(wizardData.selectedLoss)
  const datePickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(event.target as Node)) {
        setShowDatePicker(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-700 text-white p-4 sm:p-6 rounded-xl">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center font-semibold flex-shrink-0">1</div>
          <div>
            <h2 className="text-lg sm:text-xl font-semibold">Definição da Perda</h2>
            <p className="text-slate-300 text-sm mt-1">
              Selecione os parâmetros necessários para personalizar sua análise e identificar oportunidades de melhoria
            </p>
          </div>
        </div>
      </div>

      {/* Filters Card */}
      <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {/* Period */}
          <div className="relative" ref={datePickerRef}>
            <label className="block text-sm font-medium text-slate-700 mb-2">Período:</label>
            <button
              onClick={() => setShowDatePicker(!showDatePicker)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm hover:border-slate-400"
            >
              <span className="truncate">
                {wizardData.period.start.toLocaleDateString("pt-BR")} -{" "}
                {wizardData.period.end.toLocaleDateString("pt-BR")}
              </span>
              <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" />
            </button>
            {showDatePicker && (
              <DateRangePicker
                value={wizardData.period}
                onChange={(period) => setWizardData({ ...wizardData, period })}
                onClose={() => setShowDatePicker(false)}
              />
            )}
          </div>

          {/* Work Centers */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Centros de Trabalho:</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600 flex-1 truncate">
                {wizardData.workCenters.length > 0 ? wizardData.workCenters.join(", ") : "Todos"}
              </span>
              <button className="p-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 flex-shrink-0">
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Turnos */}
          <div className="relative">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Turnos <Info className="w-3 h-3 inline text-slate-400" />
            </label>
            <button
              onClick={() => setShowTurnoDropdown(!showTurnoDropdown)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm hover:border-slate-400"
            >
              <span className="truncate">{wizardData.turnos.length > 0 ? wizardData.turnos.join(", ") : "Manhã, Tarde, Noite"}</span>
              <ChevronDown className="w-4 h-4 flex-shrink-0" />
            </button>
            {showTurnoDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-40">
                <div className="p-2 border-b border-slate-100">
                  <input type="text" placeholder="Filtrar" className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
                </div>
                <button
                  onClick={() => setWizardData({ ...wizardData, turnos: [] })}
                  className="w-full text-left px-3 py-2 text-sm text-rose-500 hover:bg-rose-50 flex items-center gap-2"
                >
                  <X className="w-3 h-3" /> Limpar seleções
                </button>
                {turnoOptions.map((turno) => (
                  <button
                    key={turno}
                    onClick={() => {
                      const newTurnos = wizardData.turnos.includes(turno)
                        ? wizardData.turnos.filter((t) => t !== turno)
                        : [...wizardData.turnos, turno]
                      setWizardData({ ...wizardData, turnos: newTurnos })
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 flex items-center gap-2"
                  >
                    <div className={`w-4 h-4 border rounded flex items-center justify-center ${
                      wizardData.turnos.includes(turno) ? "bg-slate-700 border-slate-700" : "border-slate-300"
                    }`}>
                      {wizardData.turnos.includes(turno) && <Check className="w-3 h-3 text-white" />}
                    </div>
                    {turno}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Products */}
          <div className="relative">
            <label className="block text-sm font-medium text-slate-700 mb-2">Produtos</label>
            <button
              onClick={() => setShowProductDropdown(!showProductDropdown)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm hover:border-slate-400"
            >
              <span className="truncate">{wizardData.products.length > 0 ? wizardData.products.join(", ") : "Todos"}</span>
              <ChevronDown className="w-4 h-4 flex-shrink-0" />
            </button>
            {showProductDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-40">
                <div className="p-2 border-b border-slate-100">
                  <input type="text" placeholder="Filtrar" className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
                </div>
                <button
                  onClick={() => setWizardData({ ...wizardData, products: [] })}
                  className="w-full text-left px-3 py-2 text-sm text-rose-500 hover:bg-rose-50 flex items-center gap-2"
                >
                  <X className="w-3 h-3" /> Limpar seleções
                </button>
                {productOptions.map((product) => (
                  <button
                    key={product}
                    onClick={() => {
                      const newProducts = wizardData.products.includes(product)
                        ? wizardData.products.filter((p) => p !== product)
                        : [...wizardData.products, product]
                      setWizardData({ ...wizardData, products: newProducts })
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 flex items-center gap-2"
                  >
                    <div className={`w-4 h-4 border rounded flex items-center justify-center ${
                      wizardData.products.includes(product) ? "bg-slate-700 border-slate-700" : "border-slate-300"
                    }`}>
                      {wizardData.products.includes(product) && <Check className="w-3 h-3 text-white" />}
                    </div>
                    {product}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Loss Selection */}
      <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-slate-200">
        <h3 className="font-semibold text-slate-800 mb-4">
          Selecione uma das perdas abaixo para iniciar a análise exploratória:
        </h3>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 mb-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-teal-500 rounded" />
            <span>Performance</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-rose-400 rounded" />
            <span>Disponibilidade</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-amber-400 rounded" />
            <span>Qualidade</span>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">Visualizar por:</span>
            <select className="border border-slate-300 rounded px-3 py-1.5 text-sm">
              <option>Quantidade</option>
              <option>Tempo</option>
              <option>Valor</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">Unidade de Medida:</span>
            <select className="border border-slate-300 rounded px-3 py-1.5 text-sm">
              <option>UN</option>
              <option>KG</option>
              <option>M</option>
            </select>
          </div>
        </div>

        {/* Loss Items */}
        <div className="space-y-3">
          {lossItems.map((item) => (
            <div
              key={item.name}
              className={`relative overflow-hidden rounded-lg border transition-all ${
                selectedLoss === item.name ? "border-slate-700 ring-2 ring-slate-700/20" : "border-slate-200"
              }`}
            >
              <div
                className={`absolute inset-y-0 left-0 ${item.color} opacity-60`}
                style={{ width: `${Math.min(Math.abs(item.value) / 100, 100)}%` }}
              />
              <div className="relative flex items-center justify-between p-4 bg-white/80">
                <div>
                  <p className="font-medium text-slate-800">{item.name}</p>
                  <p className="text-sm text-slate-600">{item.value.toLocaleString("pt-BR")} UN</p>
                </div>
                <button
                  onClick={() => {
                    setSelectedLoss(item.name)
                    setWizardData({ ...wizardData, selectedLoss: item.name })
                  }}
                  className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                    selectedLoss === item.name
                      ? "bg-slate-700 text-white"
                      : "bg-white border border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  Analisar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Action Button */}
      {selectedLoss && (
        <div className="flex justify-end">
          <button
            onClick={onNext}
            className="px-6 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-800 font-medium flex items-center gap-2"
          >
            Ir para a análise exploratória
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}

// Step 2: Análise Exploratória
function Step2Content({
  wizardData,
  onNext,
  onBack,
}: {
  wizardData: WizardData
  onNext: () => void
  onBack: () => void
}) {
  const [activeTab, setActiveTab] = useState("graficos")
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false)
  const [hoveredBar, setHoveredBar] = useState<{ label: string; value: number; x: number; y: number } | null>(null)
  const [metricType, setMetricType] = useState("qtd_perdida")
  const [chartMetric, setChartMetric] = useState("Dia")

  const metricOptions = [
    { value: "qtd_perdida", label: "Qtd. Perdida", color: "#3b82f6" },
    { value: "horas_perdidas", label: "Horas Perdidas", color: "#22c55e" },
    { value: "perc_qtd_planejada", label: "% Sobre Quantidade Planejada", color: "#eab308" },
    { value: "perc_qtd_total", label: "% Sobre Quantidade Total", color: "#3b82f6" },
  ]

  const chartData = {
    periodo: [
      { label: "26/01", value: 1100 },
      { label: "27/01", value: 950 },
      { label: "28/01", value: 1050 },
      { label: "29/01", value: 1100 },
      { label: "30/01", value: 150 },
    ],
    produto: [
      { label: "A-120", value: 4500, color: "#3b82f6" },
    ],
    turno: [
      { label: "Tarde", value: 1500, color: "#3b82f6" },
      { label: "Manhã", value: 1300, color: "#22c55e" },
      { label: "Noite", value: 1100, color: "#ef4444" },
    ],
    diaSemana: [
      { label: "segunda-feira", value: 950, color: "#3b82f6" },
      { label: "terça-feira", value: 1000, color: "#22c55e" },
      { label: "quarta-feira", value: 850, color: "#ef4444" },
      { label: "quinta-feira", value: 800, color: "#eab308" },
      { label: "sexta-feira", value: 300, color: "#06b6d4" },
    ],
  }

  const currentMetric = metricOptions.find(m => m.value === metricType) || metricOptions[0]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-700 text-white p-4 sm:p-6 rounded-xl">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center font-semibold flex-shrink-0">2</div>
            <div>
              <h2 className="text-lg sm:text-xl font-semibold">Análise Exploratória</h2>
              <p className="text-slate-300 text-sm mt-1">
                Analise os dados e identifique indícios que possam explicar a perda
              </p>
              <div className="flex items-center gap-2 mt-2 text-amber-300 text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>{wizardData.selectedLoss} (Principais Paradas)</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setIsHeaderCollapsed(!isHeaderCollapsed)}
            className="p-2 hover:bg-white/10 rounded-lg"
          >
            <ChevronDown className={`w-5 h-5 transition-transform ${isHeaderCollapsed ? "" : "rotate-180"}`} />
          </button>
        </div>

        {!isHeaderCollapsed && (
          <div className="mt-4 pt-4 border-t border-white/20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-slate-400">Período:</span>
              <span className="ml-2">
                {wizardData.period.start.toLocaleDateString("pt-BR")} -{" "}
                {wizardData.period.end.toLocaleDateString("pt-BR")}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Centros de Trabalho:</span>
              <span className="ml-2">
                {wizardData.workCenters.length > 0 ? wizardData.workCenters.join(", ") : "Todos"}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Turnos:</span>
              <span className="ml-2">
                {wizardData.turnos.length > 0 ? wizardData.turnos.join(", ") : "Manhã, Tarde, Noite"}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Produtos:</span>
              <span className="ml-2">{wizardData.products.length > 0 ? wizardData.products.join(", ") : "Todos"}</span>
            </div>
          </div>
        )}
      </div>

      {/* Chart: Perda por período */}
      <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="font-semibold text-slate-800">Perda por período</h3>
            <p className="text-xs text-slate-500">Clique com botão direito do mouse em um ponto para removê-lo da análise</p>
          </div>
          <select 
            value={chartMetric}
            onChange={(e) => setChartMetric(e.target.value)}
            className="border border-slate-300 rounded px-3 py-1.5 text-sm"
          >
            <option>Dia</option>
            <option>Semana</option>
            <option>Mês</option>
          </select>
        </div>

        <p className="text-center text-sm text-slate-600 mb-2">{currentMetric.label}</p>

        <div className="relative h-64 ml-12">
          {/* Y axis labels */}
          <div className="absolute left-0 top-0 bottom-8 w-12 flex flex-col justify-between text-xs text-slate-500 -ml-12">
            <span>1.200</span>
            <span>1.000</span>
            <span>800</span>
            <span>600</span>
            <span>400</span>
            <span>200</span>
            <span>0</span>
          </div>

          {/* Chart area */}
          <svg className="w-full h-full" viewBox="0 0 500 200" preserveAspectRatio="none">
            {/* Grid lines */}
            {[0, 33, 66, 100, 133, 166, 200].map((y, i) => (
              <line key={i} x1="0" y1={y} x2="500" y2={y} stroke="#e2e8f0" strokeWidth="1" />
            ))}
            
            {/* Line */}
            <polyline
              fill="none"
              stroke={currentMetric.color}
              strokeWidth="3"
              points="50,30 125,50 200,40 300,30 400,170"
            />
            
            {/* Points */}
            {chartData.periodo.map((d, i) => {
              const x = 50 + i * 95
              const y = 200 - (d.value / 1200) * 200
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r="6"
                  fill={currentMetric.color}
                  className="cursor-pointer"
                  onMouseEnter={(e) => setHoveredBar({ label: d.label, value: d.value, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHoveredBar(null)}
                />
              )
            })}
          </svg>

          {/* X axis labels */}
          <div className="flex justify-around text-xs text-slate-500 mt-2">
            {chartData.periodo.map((d) => (
              <span key={d.label}>{d.label}</span>
            ))}
          </div>
        </div>

        {/* Pagination dots */}
        <div className="flex justify-center gap-2 mt-4">
          <div className="w-2 h-2 rounded-full bg-slate-700" />
          <div className="w-2 h-2 rounded-full bg-slate-300" />
          <div className="w-2 h-2 rounded-full bg-slate-300" />
          <div className="w-2 h-2 rounded-full bg-slate-300" />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-l-rose-400 border border-slate-200">
          <p className="text-sm text-slate-500">Horas Perdidas</p>
          <p className="text-2xl font-bold text-slate-800">92,13</p>
          <p className="text-xs text-slate-400">horas</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-l-amber-400 border border-slate-200">
          <p className="text-sm text-slate-500">Perda Financeira</p>
          <p className="text-2xl font-bold text-slate-800">0</p>
          <p className="text-xs text-slate-400">$</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-l-sky-400 border border-slate-200">
          <p className="text-sm text-slate-500 flex items-center gap-1">
            MTBF <Info className="w-3 h-3" />
          </p>
          <p className="text-2xl font-bold text-slate-800">0,35</p>
          <p className="text-xs text-slate-400">horas</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-l-teal-400 border border-slate-200">
          <p className="text-sm text-slate-500 flex items-center gap-1">
            MTTR <Info className="w-3 h-3" />
          </p>
          <p className="text-2xl font-bold text-slate-800">3,29</p>
          <p className="text-xs text-slate-400">horas</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-200">
          {[
            { id: "graficos", label: "Gráficos" },
            { id: "anotacoes", label: "Anotações" },
            { id: "pedidos", label: "Pedidos de Ajuda" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-slate-700 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-4 sm:p-6">
          {activeTab === "graficos" && (
            <div className="space-y-8">
              {/* Gráfico de Produto */}
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <h4 className="font-semibold text-slate-800">Gráficos de Produto</h4>
                  <div className="flex gap-2">
                    <select 
                      value={metricType}
                      onChange={(e) => setMetricType(e.target.value)}
                      className="border border-slate-300 rounded px-3 py-1.5 text-sm"
                    >
                      <option value="qtd_perdida">Ordenar por Qtd. Perdida</option>
                      <option value="horas_perdidas">Ordenar por Horas Perdidas</option>
                      <option value="perc_qtd_planejada">Ordenar por % Sobre Quantidade Planejada</option>
                    </select>
                    <select className="border border-slate-300 rounded px-3 py-1.5 text-sm">
                      <option>Todos</option>
                    </select>
                  </div>
                </div>
                <p className="text-center text-sm text-slate-600 mb-2">{currentMetric.label}</p>
                <div className="h-48 flex items-end justify-center gap-8 px-8">
                  {chartData.produto.map((d) => (
                    <div 
                      key={d.label} 
                      className="flex flex-col items-center gap-2 relative"
                      onMouseEnter={(e) => setHoveredBar({ label: d.label, value: d.value, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHoveredBar(null)}
                    >
                      <div
                        className="w-20 rounded-t cursor-pointer transition-opacity hover:opacity-80"
                        style={{ height: `${(d.value / 5000) * 100}%`, backgroundColor: d.color }}
                      />
                      <span className="text-xs text-slate-600">{d.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-center gap-2 mt-4">
                  <div className="w-2 h-2 rounded-full bg-slate-700" />
                  <div className="w-2 h-2 rounded-full bg-slate-300" />
                  <div className="w-2 h-2 rounded-full bg-slate-300" />
                  <div className="w-2 h-2 rounded-full bg-slate-300" />
                </div>
              </div>

              {/* Gráfico de Turno */}
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <h4 className="font-semibold text-slate-800">Gráfico de Turno</h4>
                  <select className="border border-slate-300 rounded px-3 py-1.5 text-sm">
                    <option>Ordenar por Qtd. Perdida</option>
                  </select>
                </div>
                <p className="text-center text-sm text-slate-600 mb-2">{currentMetric.label}</p>
                <div className="h-48 flex items-end justify-around gap-4 sm:gap-8 px-4 sm:px-8">
                  {chartData.turno.map((d) => (
                    <div 
                      key={d.label} 
                      className="flex flex-col items-center gap-2 relative flex-1 max-w-24"
                      onMouseEnter={(e) => setHoveredBar({ label: d.label, value: d.value, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHoveredBar(null)}
                    >
                      <div
                        className="w-full rounded-t cursor-pointer transition-opacity hover:opacity-80"
                        style={{ height: `${(d.value / 1600) * 100}%`, backgroundColor: d.color }}
                      />
                      <span className="text-xs text-slate-600 -rotate-45 origin-top-left whitespace-nowrap">{d.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-center gap-2 mt-8">
                  <div className="w-2 h-2 rounded-full bg-slate-700" />
                  <div className="w-2 h-2 rounded-full bg-slate-300" />
                  <div className="w-2 h-2 rounded-full bg-slate-300" />
                  <div className="w-2 h-2 rounded-full bg-slate-300" />
                </div>
              </div>

              {/* Gráfico de Dia da Semana */}
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <h4 className="font-semibold text-slate-800">Gráfico de Dia da Semana</h4>
                  <select className="border border-slate-300 rounded px-3 py-1.5 text-sm">
                    <option>Ordenar por Dia da Semana</option>
                    <option>Ordenar por Qtd. Perdida</option>
                    <option>Ordenar por Horas Perdidas</option>
                    <option>Ordenar por % Sobre Quantidade Planejada</option>
                    <option>Ordenar por % Sobre Quantidade Total</option>
                  </select>
                </div>
                <p className="text-center text-sm text-slate-600 mb-2">{currentMetric.label}</p>
                <div className="h-48 flex items-end justify-around gap-2 sm:gap-4 px-2 sm:px-8 overflow-x-auto">
                  {chartData.diaSemana.map((d) => (
                    <div 
                      key={d.label} 
                      className="flex flex-col items-center gap-2 relative flex-1 min-w-12 max-w-20"
                      onMouseEnter={(e) => setHoveredBar({ label: d.label, value: d.value, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHoveredBar(null)}
                    >
                      <div
                        className="w-full rounded-t cursor-pointer transition-opacity hover:opacity-80"
                        style={{ height: `${(d.value / 1200) * 100}%`, backgroundColor: d.color }}
                      />
                      <span className="text-[10px] sm:text-xs text-slate-600 -rotate-45 origin-top-left whitespace-nowrap">{d.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-center gap-2 mt-8">
                  <div className="w-2 h-2 rounded-full bg-slate-700" />
                  <div className="w-2 h-2 rounded-full bg-slate-300" />
                  <div className="w-2 h-2 rounded-full bg-slate-300" />
                  <div className="w-2 h-2 rounded-full bg-slate-300" />
                </div>
              </div>
            </div>
          )}

          {activeTab === "anotacoes" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-slate-50 rounded-xl p-6">
                <h4 className="font-semibold text-slate-800 mb-4">Palavras Mais Frequentes</h4>
                <p className="text-sm text-slate-500 text-center py-8">Nenhuma palavra-chave encontrada.</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-6">
                <h4 className="font-semibold text-slate-800 mb-4">Anotações</h4>
                <p className="text-sm text-slate-500 text-center py-8">Sem Anotações.</p>
              </div>
            </div>
          )}

          {activeTab === "pedidos" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-50 rounded-xl p-6">
                  <h4 className="font-semibold text-slate-800 mb-4">Tipos de Pedido Requisitados</h4>
                  <p className="text-sm text-slate-500 text-center py-4">Nenhum tipo de pedido requisitado encontrado.</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-6">
                  <h4 className="font-semibold text-slate-800 mb-4">Times Requisitados</h4>
                  <p className="text-sm text-slate-500 text-center py-4">Nenhum time requisitado encontrado.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-50 rounded-xl p-6">
                  <h4 className="font-semibold text-slate-800 mb-4">Problemas Mais Frequentes</h4>
                  <p className="text-sm text-slate-500 text-center py-4">Nenhum problema frequente encontrado.</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-6">
                  <h4 className="font-semibold text-slate-800 mb-4">Soluções Mais Frequentes</h4>
                  <p className="text-sm text-slate-500 text-center py-4">Nenhuma solução frequente encontrada.</p>
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-6">
                <h4 className="font-semibold text-slate-800 mb-4">Pedidos de Ajuda</h4>
                <p className="text-sm text-slate-500 text-center py-4">Nenhum pedido de ajuda encontrado</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tooltip */}
      {hoveredBar && (
        <div
          className="fixed bg-slate-800 text-white px-3 py-2 rounded-lg text-sm shadow-xl z-50 pointer-events-none"
          style={{ left: hoveredBar.x + 10, top: hoveredBar.y - 40 }}
        >
          <p className="font-medium">{hoveredBar.label}</p>
          <p>Quantidade: {hoveredBar.value.toLocaleString("pt-BR")}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <button
          onClick={onBack}
          className="px-6 py-3 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium flex items-center justify-center gap-2"
        >
          <ChevronLeft className="w-4 h-4" />
          Voltar
        </button>
        <button
          onClick={onNext}
          className="px-6 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-800 font-medium flex items-center justify-center gap-2"
        >
          Ir para a análise da causa raiz
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// Step 3: Análise das Causas
function Step3Content({
  wizardData,
  setWizardData,
  onNext,
  onBack,
}: {
  wizardData: WizardData
  setWizardData: (data: WizardData) => void
  onNext: () => void
  onBack: () => void
}) {
  const [activeTab, setActiveTab] = useState("ishikawa")
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false)
  const [hypotheses, setHypotheses] = useState<{ id: number; initial: string; whys: string[]; expanded: boolean }[]>([
    { id: 1, initial: "", whys: [""], expanded: true }
  ])
  const [causaRaiz, setCausaRaiz] = useState("")

  // Ishikawa categories
  const [ishikawaData, setIshikawaData] = useState({
    maquina: { items: [] as string[], input: "" },
    material: { items: [] as string[], input: "" },
    metodo: { items: [] as string[], input: "" },
    maoDeObra: { items: [] as string[], input: "" },
    ambiente: { items: [] as string[], input: "" },
    medicao: { items: [] as string[], input: "" },
  })

  const ishikawaCategories = [
    { id: "maquina", label: "Máquina", color: "bg-sky-100 border-sky-300", buttonColor: "bg-sky-500 hover:bg-sky-600" },
    { id: "material", label: "Material", color: "bg-emerald-100 border-emerald-300", buttonColor: "bg-emerald-500 hover:bg-emerald-600" },
    { id: "metodo", label: "Método", color: "bg-purple-100 border-purple-300", buttonColor: "bg-purple-500 hover:bg-purple-600" },
    { id: "maoDeObra", label: "Mão de Obra", color: "bg-rose-100 border-rose-300", buttonColor: "bg-rose-400 hover:bg-rose-500" },
    { id: "ambiente", label: "Ambiente", color: "bg-amber-100 border-amber-300", buttonColor: "bg-amber-400 hover:bg-amber-500" },
    { id: "medicao", label: "Medição", color: "bg-orange-100 border-orange-300", buttonColor: "bg-orange-400 hover:bg-orange-500" },
  ]

  const addIshikawaCause = (categoryId: string) => {
    const category = ishikawaData[categoryId as keyof typeof ishikawaData]
    if (category.input.trim()) {
      setIshikawaData({
        ...ishikawaData,
        [categoryId]: {
          items: [...category.items, category.input],
          input: ""
        }
      })
    }
  }

  const addHypothesis = () => {
    setHypotheses([...hypotheses, { id: hypotheses.length + 1, initial: "", whys: [""], expanded: true }])
  }

  const addWhy = (hypothesisId: number) => {
    setHypotheses(hypotheses.map(h => 
      h.id === hypothesisId ? { ...h, whys: [...h.whys, ""] } : h
    ))
  }

  const updateWhy = (hypothesisId: number, whyIndex: number, value: string) => {
    setHypotheses(hypotheses.map(h => 
      h.id === hypothesisId ? { ...h, whys: h.whys.map((w, i) => i === whyIndex ? value : w) } : h
    ))
  }

  const removeHypothesis = (hypothesisId: number) => {
    setHypotheses(hypotheses.filter(h => h.id !== hypothesisId))
  }

  const clearIshikawa = () => {
    setIshikawaData({
      maquina: { items: [], input: "" },
      material: { items: [], input: "" },
      metodo: { items: [], input: "" },
      maoDeObra: { items: [], input: "" },
      ambiente: { items: [], input: "" },
      medicao: { items: [], input: "" },
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-700 text-white p-4 sm:p-6 rounded-xl">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center font-semibold flex-shrink-0">3</div>
            <div>
              <h2 className="text-lg sm:text-xl font-semibold">Análise das Causas</h2>
              <p className="text-slate-300 text-sm mt-1">
                Investigue as causas do problema utilizando as ferramentas disponíveis
              </p>
              <div className="flex items-center gap-2 mt-2 text-amber-300 text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>{wizardData.selectedLoss} (Principais Paradas)</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setIsHeaderCollapsed(!isHeaderCollapsed)}
            className="p-2 hover:bg-white/10 rounded-lg"
          >
            <ChevronDown className={`w-5 h-5 transition-transform ${isHeaderCollapsed ? "" : "rotate-180"}`} />
          </button>
        </div>

        {!isHeaderCollapsed && (
          <div className="mt-4 pt-4 border-t border-white/20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-slate-400">Período:</span>
              <span className="ml-2">
                {wizardData.period.start.toLocaleDateString("pt-BR")} -{" "}
                {wizardData.period.end.toLocaleDateString("pt-BR")}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Centros de Trabalho:</span>
              <span className="ml-2">
                {wizardData.workCenters.length > 0 ? wizardData.workCenters.join(", ") : "Todos"}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Turnos:</span>
              <span className="ml-2">
                {wizardData.turnos.length > 0 ? wizardData.turnos.join(", ") : "Manhã, Tarde, Noite"}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Produtos:</span>
              <span className="ml-2">{wizardData.products.length > 0 ? wizardData.products.join(", ") : "Todos"}</span>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-200">
          {[
            { id: "ishikawa", label: "Ishikawa" },
            { id: "5porques", label: "5 Porquês" },
            { id: "causaraiz", label: "Causa Raiz" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-slate-700 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-4 sm:p-6">
          {/* Ishikawa */}
          {activeTab === "ishikawa" && (
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="font-semibold text-slate-800">Diagrama de Ishikawa</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Utilize o diagrama de Ishikawa para realizar um brainstorm de hipóteses para a perda {wizardData.selectedLoss}
                  </p>
                </div>
                <button 
                  onClick={clearIshikawa}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50"
                >
                  Limpar
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {ishikawaCategories.map((category) => (
                  <div key={category.id} className={`rounded-xl p-4 border ${category.color}`}>
                    <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                      {category.label}
                      <Info className="w-4 h-4 text-slate-400" />
                    </h4>
                    
                    {/* Added items */}
                    {ishikawaData[category.id as keyof typeof ishikawaData].items.map((item, i) => (
                      <div key={i} className="mb-2 p-2 bg-white rounded border border-slate-200 text-sm flex items-center justify-between">
                        <span>{item}</span>
                        <button 
                          onClick={() => {
                            const cat = ishikawaData[category.id as keyof typeof ishikawaData]
                            setIshikawaData({
                              ...ishikawaData,
                              [category.id]: { ...cat, items: cat.items.filter((_, idx) => idx !== i) }
                            })
                          }}
                          className="text-slate-400 hover:text-rose-500"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}

                    <input
                      type="text"
                      placeholder="Digite sua hipótese..."
                      value={ishikawaData[category.id as keyof typeof ishikawaData].input}
                      onChange={(e) => setIshikawaData({
                        ...ishikawaData,
                        [category.id]: { ...ishikawaData[category.id as keyof typeof ishikawaData], input: e.target.value }
                      })}
                      onKeyDown={(e) => e.key === "Enter" && addIshikawaCause(category.id)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-2 bg-white"
                    />
                    <button
                      onClick={() => addIshikawaCause(category.id)}
                      className={`w-full py-2 text-white rounded-lg text-sm font-medium ${category.buttonColor}`}
                    >
                      + Adicionar Causa
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end mt-6">
                <button
                  onClick={() => setActiveTab("5porques")}
                  className="px-6 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-800 font-medium flex items-center gap-2"
                >
                  Ir para os 5 porquês
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* 5 Porquês */}
          {activeTab === "5porques" && (
            <div>
              <div className="mb-6">
                <h3 className="font-semibold text-slate-800">5 Porquês</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Investigue passo a passo até encontrar a verdadeira origem do problema
                </p>
              </div>

              <div className="space-y-4">
                {hypotheses.map((hypothesis, hIndex) => (
                  <div key={hypothesis.id} className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between p-4 bg-slate-50 border-b border-slate-200">
                      <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-slate-500" />
                        <span className="font-medium text-slate-700">Hipótese {hIndex + 1}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => removeHypothesis(hypothesis.id)}
                          className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-rose-500"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setHypotheses(hypotheses.map(h => 
                            h.id === hypothesis.id ? { ...h, expanded: !h.expanded } : h
                          ))}
                          className="p-1 hover:bg-slate-200 rounded"
                        >
                          <ChevronDown className={`w-4 h-4 transition-transform ${hypothesis.expanded ? "rotate-180" : ""}`} />
                        </button>
                      </div>
                    </div>

                    {hypothesis.expanded && (
                      <div className="p-4 space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Hipótese inicial</label>
                          <input
                            type="text"
                            placeholder="Digite sua hipótese..."
                            value={hypothesis.initial}
                            onChange={(e) => setHypotheses(hypotheses.map(h => 
                              h.id === hypothesis.id ? { ...h, initial: e.target.value } : h
                            ))}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Por quês</label>
                          <div className="space-y-2">
                            {hypothesis.whys.map((why, wIndex) => (
                              <div key={wIndex} className="flex items-center gap-2">
                                <div className="w-6 h-6 bg-slate-700 text-white rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0">
                                  {wIndex + 1}
                                </div>
                                <input
                                  type="text"
                                  placeholder="Digite o motivo..."
                                  value={why}
                                  onChange={(e) => updateWhy(hypothesis.id, wIndex, e.target.value)}
                                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                                />
                              </div>
                            ))}
                          </div>
                          {hypothesis.whys.length < 5 && (
                            <button
                              onClick={() => addWhy(hypothesis.id)}
                              className="mt-2 px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
                            >
                              + Adicionar Por quê
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-center mt-6">
                <button
                  onClick={addHypothesis}
                  className="px-6 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-800 font-medium"
                >
                  + Adicionar seção de análise
                </button>
              </div>

              <div className="flex justify-end mt-6">
                <button
                  onClick={() => setActiveTab("causaraiz")}
                  className="px-6 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-800 font-medium flex items-center gap-2"
                >
                  Ir para a definição da causa raiz
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Causa Raiz */}
          {activeTab === "causaraiz" && (
            <div>
              <div className="mb-6">
                <h3 className="font-semibold text-slate-800">Definição de Causa Raiz</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Defina a causa raiz para a perda
                </p>
              </div>

              <div className="border border-slate-200 rounded-xl p-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Causa raiz <span className="text-rose-500">*</span>
                </label>
                <textarea
                  placeholder="Ex: Foi uma falha mecânica"
                  value={causaRaiz}
                  onChange={(e) => {
                    setCausaRaiz(e.target.value)
                    setWizardData({ ...wizardData, causaRaiz: e.target.value })
                  }}
                  rows={6}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <button
          onClick={onBack}
          className="px-6 py-3 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium flex items-center justify-center gap-2"
        >
          <ChevronLeft className="w-4 h-4" />
          Voltar
        </button>
        <button
          onClick={onNext}
          disabled={!causaRaiz.trim()}
          className={`px-6 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors ${
            causaRaiz.trim()
              ? "bg-slate-700 text-white hover:bg-slate-800"
              : "bg-slate-300 text-slate-500 cursor-not-allowed"
          }`}
        >
          Ir para a definição do plano de melhoria
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// Wizard Data Type
interface WizardData {
  period: { start: Date; end: Date }
  workCenters: string[]
  turnos: string[]
  products: string[]
  selectedLoss: string | null
  causaRaiz?: string
  planName?: string
  metaType?: string
  metaValue?: string
  responsible?: string
  execStartDate?: Date
  evalStartDate?: Date
  endDate?: Date
}

// Step 4 - Plan Definition Component
function Step4Content({
  wizardData,
  setWizardData,
  onNext,
  onBack,
}: {
  wizardData: WizardData
  setWizardData: (data: WizardData) => void
  onNext: () => void
  onBack: () => void
}) {
  const [planName, setPlanName] = useState(wizardData.planName || "")
  const [metaType, setMetaType] = useState(wizardData.metaType || "")
  const [metaValue, setMetaValue] = useState(wizardData.metaValue || "")
  const [responsible, setResponsible] = useState(wizardData.responsible || "")
  const [showResponsibleDropdown, setShowResponsibleDropdown] = useState(false)
  const [responsibleFilter, setResponsibleFilter] = useState("")
  const [execStartDate, setExecStartDate] = useState(wizardData.execStartDate || new Date(2026, 0, 30))
  const [evalStartDate, setEvalStartDate] = useState(wizardData.evalStartDate || new Date(2026, 2, 11))
  const [endDate, setEndDate] = useState(wizardData.endDate || new Date(2026, 2, 30))

  const metaTypes = [
    { id: "ocorrencias", title: "Média diária de ocorrências de parada", description: "Reduzir o número de vezes que uma parada acontece por dia", current: "1.50 ocorrência", icon: "stop" },
    { id: "horas", title: "Média diária de horas perdidas", description: "Reduzir a média diária de horas perdida", current: "5.14 horas", icon: "clock" },
    { id: "mttr", title: "MTTR (Tempo médio de reparo)", description: "Reduzir o tempo médio para resolver o problema", current: "3.42 horas", icon: "clock" },
    { id: "mtbf", title: "MTBF (Tempo Médio Entre Falhas)", description: "Aumentar o tempo médio entre falhas", current: "4.28 horas", icon: "clock" },
    { id: "financeira", title: "Média diária de perda financeira", description: "Reduzir a média diária de perda financeira", current: "0.00$", icon: "dollar" },
  ]

  const responsibles = [
    "George Felipe",
    "Helbert Marcelo",
    "Jefferson Luan",
    "João Henrique",
    "Luiz Cantini",
    "Matheus Oliveira",
    "Matheus Silva",
    "Operador",
    "Pedro Henrique",
    "René Dias",
  ]

  const filteredResponsibles = responsibles.filter(r => 
    r.toLowerCase().includes(responsibleFilter.toLowerCase())
  )

  const formatDate = (date: Date) => date.toLocaleDateString("pt-BR")

  const daysBetween = (d1: Date, d2: Date) => Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24))

  const execDays = daysBetween(execStartDate, evalStartDate)
  const evalDays = daysBetween(evalStartDate, endDate)
  const totalDays = execDays + evalDays

  const handleSave = () => {
    setWizardData({
      ...wizardData,
      planName,
      metaType,
      metaValue,
      responsible,
      execStartDate,
      evalStartDate,
      endDate,
    })
    onNext()
  }

  const isValid = planName && metaType && metaValue && responsible

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-700 text-white rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center text-lg font-bold">4</div>
          <div className="flex-1">
            <h2 className="text-xl font-bold">Definição do Plano de Melhoria</h2>
            <p className="text-slate-300 text-sm mt-1">
              Estabeleça uma meta específica, nome do plano e cronograma
            </p>
            <div className="flex items-center gap-2 mt-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-amber-300">{wizardData.selectedLoss}</span>
              <span className="text-slate-400">(Principais Paradas)</span>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 pt-4 border-t border-slate-600/50">
          <div>
            <span className="text-slate-400 text-sm">Período:</span>
            <span className="ml-2 text-white">{formatDate(wizardData.period.start)} - {formatDate(wizardData.period.end)}</span>
          </div>
          <div>
            <span className="text-slate-400 text-sm">Centros de Trabalho:</span>
            <span className="ml-2 text-white">{wizardData.workCenters.join(", ")}</span>
          </div>
          <div>
            <span className="text-slate-400 text-sm">Turnos:</span>
            <span className="ml-2 text-white">{wizardData.turnos.join(", ")}</span>
          </div>
          <div>
            <span className="text-slate-400 text-sm">Produtos:</span>
            <span className="ml-2 text-white">{wizardData.products.join(", ")}</span>
          </div>
          {wizardData.causaRaiz && (
            <div className="md:col-span-2">
              <span className="text-slate-400 text-sm">Causa raiz:</span>
              <span className="ml-2 text-white">{wizardData.causaRaiz}</span>
            </div>
          )}
        </div>
      </div>

      {/* Plan Name */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Nome do plano <span className="text-rose-500">*</span>
        </label>
        <input
          type="text"
          placeholder="Ex.: Plano de redução de perdas por Falhas de vedação"
          value={planName}
          onChange={(e) => setPlanName(e.target.value)}
          className="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
      </div>

      {/* Meta Type */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <label className="block text-sm font-medium text-slate-700 mb-4">
          Tipo de Meta <span className="text-rose-500">*</span>
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {metaTypes.map((type) => (
            <button
              key={type.id}
              onClick={() => setMetaType(type.id)}
              className={`p-4 border-2 rounded-xl text-left transition-all ${
                metaType === type.id
                  ? "border-slate-700 bg-slate-50"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  metaType === type.id ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-500"
                }`}>
                  {type.icon === "stop" && <AlertTriangle className="w-5 h-5" />}
                  {type.icon === "clock" && <Calendar className="w-5 h-5" />}
                  {type.icon === "dollar" && <span className="text-lg font-bold">$</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-slate-800 text-sm leading-tight">{type.title}</h4>
                  <p className="text-xs text-slate-500 mt-1">{type.description}</p>
                  <p className="text-xs text-slate-400 mt-2">{type.current} <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px] font-medium">ATUAL</span></p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Meta Value and Responsible */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Meta <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <input
              type="number"
              placeholder="0"
              value={metaValue}
              onChange={(e) => setMetaValue(e.target.value)}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 pr-12"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
              {metaType === "financeira" ? "$" : metaType === "ocorrencias" ? "oc" : "h"}
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 relative">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Responsável <span className="text-rose-500">*</span>
          </label>
          <button
            onClick={() => setShowResponsibleDropdown(!showResponsibleDropdown)}
            className="w-full flex items-center justify-between px-4 py-3 border border-slate-300 rounded-lg text-sm hover:border-slate-400"
          >
            <span className={responsible ? "text-slate-800" : "text-slate-400"}>
              {responsible || "Selecionar Responsável"}
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showResponsibleDropdown ? "rotate-180" : ""}`} />
          </button>
          
          {showResponsibleDropdown && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-30 max-h-64 overflow-hidden">
              <div className="p-2 border-b border-slate-100">
                <input
                  type="text"
                  placeholder="Filtrar"
                  value={responsibleFilter}
                  onChange={(e) => setResponsibleFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                />
              </div>
              <div className="overflow-y-auto max-h-48">
                {filteredResponsibles.map((r) => (
                  <button
                    key={r}
                    onClick={() => {
                      setResponsible(r)
                      setShowResponsibleDropdown(false)
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 ${
                      responsible === r ? "bg-slate-100 font-medium" : ""
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <div className="flex items-center gap-2 mb-4">
          <label className="text-sm font-medium text-slate-700">
            Cronograma do Plano <span className="text-rose-500">*</span>
          </label>
          <Info className="w-4 h-4 text-slate-400" />
        </div>

        {/* Visual Timeline */}
        <div className="relative mb-6">
          <div className="flex items-center gap-0">
            <div className="w-6 h-6 bg-sky-500 rounded-full flex items-center justify-center z-10">
              <Check className="w-3 h-3 text-white" />
            </div>
            <div className="flex-1 h-2 bg-gradient-to-r from-sky-500 via-teal-500 to-amber-500" />
            <div className="w-6 h-6 bg-amber-500 rounded-full flex items-center justify-center z-10">
              <Calendar className="w-3 h-3 text-white" />
            </div>
            <div className="flex-1 h-2 bg-gradient-to-r from-amber-500 to-rose-500" />
            <div className="w-6 h-6 bg-rose-500 rounded-full flex items-center justify-center z-10">
              <X className="w-3 h-3 text-white" />
            </div>
          </div>
        </div>

        {/* Date Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-sky-50 border border-sky-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 bg-sky-500 rounded-full flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
              </div>
              <span className="font-medium text-slate-700 text-sm">INÍCIO DA EXECUÇÃO</span>
            </div>
            <input
              type="date"
              value={execStartDate.toISOString().split("T")[0]}
              onChange={(e) => setExecStartDate(new Date(e.target.value))}
              className="w-full px-3 py-2 border border-sky-300 rounded-lg text-sm bg-white"
            />
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center">
                <Calendar className="w-4 h-4 text-white" />
              </div>
              <span className="font-medium text-slate-700 text-sm">INÍCIO DA AVALIAÇÃO</span>
            </div>
            <input
              type="date"
              value={evalStartDate.toISOString().split("T")[0]}
              onChange={(e) => setEvalStartDate(new Date(e.target.value))}
              className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm bg-white"
            />
          </div>

          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 bg-rose-500 rounded-full flex items-center justify-center">
                <X className="w-4 h-4 text-white" />
              </div>
              <span className="font-medium text-slate-700 text-sm">FIM DO PLANO</span>
            </div>
            <input
              type="date"
              value={endDate.toISOString().split("T")[0]}
              onChange={(e) => setEndDate(new Date(e.target.value))}
              className="w-full px-3 py-2 border border-rose-300 rounded-lg text-sm bg-white"
            />
          </div>
        </div>

        <p className="text-center text-sm text-slate-500 mt-4">
          {execDays} dias de execução + {evalDays} dias de avaliação = {totalDays} dias no total
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <button
          onClick={onBack}
          className="px-6 py-3 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium flex items-center justify-center gap-2"
        >
          <ChevronLeft className="w-4 h-4" />
          Voltar
        </button>
        <button
          onClick={handleSave}
          disabled={!isValid}
          className={`px-6 py-3 rounded-lg font-medium transition-colors ${
            isValid
              ? "bg-slate-700 text-white hover:bg-slate-800"
              : "bg-slate-300 text-slate-500 cursor-not-allowed"
          }`}
        >
          Criar Plano
        </button>
      </div>
    </div>
  )
}

// Step 5 - Monitoring Component
function Step5Content({
  wizardData,
  onBack,
  onFinish,
}: {
  wizardData: WizardData
  onBack: () => void
  onFinish: () => void
}) {
  const [activeFilter, setActiveFilter] = useState("plano")
  const chartRef = useRef<HTMLCanvasElement>(null)

  const formatDate = (date: Date | undefined) => date?.toLocaleDateString("pt-BR") || "--"

  const metaTypeLabels: Record<string, string> = {
    ocorrencias: "Média diária de ocorrências de parada",
    horas: "Média diária de horas perdidas",
    mttr: "MTTR (Tempo médio de reparo)",
    mtbf: "MTBF (Tempo Médio Entre Falhas)",
    financeira: "Média diária de perda financeira",
  }

  const metaUnit: Record<string, string> = {
    ocorrencias: "ocorrência",
    horas: "horas",
    mttr: "horas",
    mtbf: "horas",
    financeira: "$",
  }

  // Calculate progress
  const execStart = wizardData.execStartDate || new Date()
  const end = wizardData.endDate || new Date()
  const today = new Date(2026, 0, 30)
  const totalDays = Math.ceil((end.getTime() - execStart.getTime()) / (1000 * 60 * 60 * 24))
  const elapsedDays = Math.max(0, Math.ceil((today.getTime() - execStart.getTime()) / (1000 * 60 * 60 * 24)))

  // Draw chart
  useEffect(() => {
    const canvas = chartRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    const padding = 50

    ctx.clearRect(0, 0, width, height)

    // Grid
    ctx.strokeStyle = "#e2e8f0"
    ctx.lineWidth = 1
    for (let i = 0; i <= 5; i++) {
      const y = padding + (height - padding * 2) * (i / 5)
      ctx.beginPath()
      ctx.moveTo(padding, y)
      ctx.lineTo(width - padding, y)
      ctx.stroke()
    }

    // Meta line (dashed)
    const metaY = padding + 20
    ctx.strokeStyle = "#0ea5e9"
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    ctx.moveTo(padding, metaY)
    ctx.lineTo(width - padding, metaY)
    ctx.stroke()
    ctx.setLineDash([])

    // Meta label
    ctx.fillStyle = "#0ea5e9"
    ctx.font = "12px sans-serif"
    ctx.textAlign = "right"
    ctx.fillText(`Meta: ${wizardData.metaValue || "1,48"}`, width - padding, metaY - 8)

    // Y-axis labels
    ctx.fillStyle = "#64748b"
    ctx.textAlign = "right"
    const maxVal = Number.parseFloat(wizardData.metaValue || "1.5") * 1.2
    for (let i = 0; i <= 5; i++) {
      const val = maxVal - (maxVal / 5) * i
      const y = padding + (height - padding * 2) * (i / 5)
      ctx.fillText(val.toFixed(1), padding - 10, y + 4)
    }

    // Y-axis title
    ctx.save()
    ctx.translate(15, height / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = "center"
    ctx.fillText(metaUnit[wizardData.metaType || "ocorrencias"], 0, 0)
    ctx.restore()

    // X-axis labels (dates)
    ctx.textAlign = "center"
    const dates = ["31/01", "03/02", "06/02", "09/02", "12/02", "15/02", "18/02", "21/02", "24/02"]
    dates.forEach((date, i) => {
      const x = padding + (width - padding * 2) * (i / (dates.length - 1))
      ctx.fillText(date, x, height - 20)
    })
  }, [wizardData])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-700 text-white rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center text-lg font-bold">5</div>
          <div className="flex-1">
            <h2 className="text-xl font-bold">Monitoramento do Plano</h2>
            <p className="text-slate-300 text-sm mt-1">
              Acompanhe as métricas do plano
            </p>
            <div className="flex items-center gap-2 mt-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-amber-300">{wizardData.selectedLoss}</span>
              <span className="text-slate-400">(Principais Paradas)</span>
            </div>
          </div>
          <button className="p-2 hover:bg-white/10 rounded-lg">
            <ExternalLink className="w-5 h-5" />
          </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6 pt-4 border-t border-slate-600/50 text-sm">
          <div>
            <span className="text-slate-400">Período:</span>
            <span className="ml-2 text-white">{formatDate(wizardData.period.start)} - {formatDate(wizardData.period.end)}</span>
          </div>
          <div>
            <span className="text-slate-400">Centros de Trabalho:</span>
            <span className="ml-2 text-white">{wizardData.workCenters.join(", ")}</span>
          </div>
          <div>
            <span className="text-slate-400">Turnos:</span>
            <span className="ml-2 text-white">{wizardData.turnos.join(", ")}</span>
          </div>
          <div>
            <span className="text-slate-400">Produtos:</span>
            <span className="ml-2 text-white">{wizardData.products.join(", ")}</span>
          </div>
          <div>
            <span className="text-slate-400">Causa raiz:</span>
            <span className="ml-2 text-white">{wizardData.causaRaiz}</span>
          </div>
          <div>
            <span className="text-slate-400">Início da execução:</span>
            <span className="ml-2 text-white">{formatDate(wizardData.execStartDate)}</span>
          </div>
          <div>
            <span className="text-slate-400">Início da avaliação:</span>
            <span className="ml-2 text-white">{formatDate(wizardData.evalStartDate)}</span>
          </div>
          <div>
            <span className="text-slate-400">Fim do plano:</span>
            <span className="ml-2 text-white">{formatDate(wizardData.endDate)}</span>
          </div>
          <div className="md:col-span-2 lg:col-span-4">
            <span className="text-slate-400">Meta:</span>
            <span className="ml-2 text-white">{metaTypeLabels[wizardData.metaType || "ocorrencias"]}</span>
            <br />
            <span className="text-slate-400">{wizardData.metaValue} {metaUnit[wizardData.metaType || "ocorrencias"]}</span>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-6 shadow-sm border-l-4 border-sky-500">
          <p className="text-sm text-slate-500">Meta</p>
          <p className="text-3xl font-bold text-slate-800 mt-1">
            {wizardData.metaValue || "1,48"} <span className="text-lg font-normal text-slate-500">{metaUnit[wizardData.metaType || "ocorrencias"]}</span>
          </p>
          <p className="text-sm text-slate-500 mt-1">{metaTypeLabels[wizardData.metaType || "ocorrencias"]}</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border-l-4 border-amber-500">
          <p className="text-sm text-slate-500">Valor atual</p>
          <p className="text-3xl font-bold text-slate-800 mt-1">
            0 <span className="text-lg font-normal text-slate-500">{metaUnit[wizardData.metaType || "ocorrencias"]}</span>
          </p>
          <p className="text-sm text-slate-500 mt-1">{metaTypeLabels[wizardData.metaType || "ocorrencias"]}</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border-l-4 border-teal-500">
          <p className="text-sm text-slate-500">Progresso</p>
          <p className="text-3xl font-bold text-slate-800 mt-1">
            {elapsedDays}/{totalDays} <span className="text-lg font-normal text-slate-500">dias</span>
          </p>
        </div>
      </div>

      {/* Progress Chart */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <h3 className="font-semibold text-slate-800">Progresso do Plano</h3>
          <button className="px-4 py-2 bg-sky-500 text-white rounded-lg text-sm font-medium flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Período de execução
          </button>
        </div>
        <canvas ref={chartRef} width={800} height={300} className="w-full" />
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <h3 className="font-semibold text-slate-800">Timeline do Plano</h3>
          <div className="flex gap-2">
            {[
              { id: "plano", label: "Plano de Ação" },
              { id: "ajuda", label: "Pedidos de Ajuda" },
              { id: "anotacoes", label: "Anotações" },
            ].map((filter) => (
              <button
                key={filter.id}
                onClick={() => setActiveFilter(filter.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeFilter === filter.id
                    ? "bg-slate-700 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {/* Visual Timeline */}
        <div className="relative">
          <div className="flex items-center gap-0">
            <div className="w-6 h-6 bg-teal-500 rounded-full flex items-center justify-center z-10">
              <Check className="w-3 h-3 text-white" />
            </div>
            <div className="flex-1 h-2 bg-slate-200" />
            <div className="w-6 h-6 bg-rose-500 rounded-full flex items-center justify-center z-10">
              <X className="w-3 h-3 text-white" />
            </div>
          </div>
        </div>

        <div className="mt-8 text-center text-slate-500">
          <p>Nenhuma atividade registrada na timeline.</p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <button
          onClick={onBack}
          className="px-6 py-3 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium flex items-center justify-center gap-2"
        >
          <ChevronLeft className="w-4 h-4" />
          Voltar
        </button>
        <button
          onClick={onFinish}
          className="px-6 py-3 bg-teal-500 text-white rounded-lg hover:bg-teal-600 font-medium"
        >
          Finalizar e Salvar
        </button>
      </div>
    </div>
  )
}

// Plan Card Component (for list view)
function PlanCard({ plan, onClick }: { plan: Plan & { 
  metaType?: string
  metaValue?: string
  resultado?: string
  responsible?: string
  execStart?: string
  execEnd?: string
  evalStart?: string
  evalEnd?: string
  progress?: number
}; onClick: () => void }) {
  const statusColors: Record<string, { bg: string; text: string; border: string }> = {
    avaliado: { bg: "bg-sky-50", text: "text-sky-600", border: "border-sky-200" },
    cancelado: { bg: "bg-slate-50", text: "text-slate-600", border: "border-slate-200" },
    em_execucao: { bg: "bg-amber-50", text: "text-amber-600", border: "border-amber-200" },
    em_planejamento: { bg: "bg-purple-50", text: "text-purple-600", border: "border-purple-200" },
    finalizado: { bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-200" },
  }

  const statusLabels: Record<string, string> = {
    avaliado: "Avaliado",
    cancelado: "Cancelado",
    em_execucao: "Em Execução",
    em_planejamento: "Em Planejamento",
    finalizado: "Finalizado",
  }

  const metaTypeLabels: Record<string, string> = {
    ocorrencias: "MÉDIA DIÁRIA DE OCORRÊNCIAS DE PARADA",
    horas: "MÉDIA DIÁRIA DE HORAS PERDIDAS",
    mttr: "MTTR (TEMPO MÉDIO DE REPARO)",
    mtbf: "MTBF (TEMPO MÉDIO ENTRE FALHAS)",
    financeira: "MÉDIA DIÁRIA DE PERDA FINANCEIRA",
  }

  const colors = statusColors[plan.status] || statusColors.em_planejamento
  const progress = plan.progress || 0

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl shadow-sm border ${colors.border} overflow-hidden cursor-pointer hover:shadow-md transition-shadow`}
    >
      {/* Status Header */}
      <div className={`${colors.bg} px-4 py-3 flex items-center justify-between`}>
        <div>
          <h3 className="font-bold text-slate-800">{plan.name}</h3>
          <p className={`text-sm font-medium ${colors.text}`}>{statusLabels[plan.status]}</p>
        </div>
        <button className="p-2 hover:bg-white/50 rounded-lg text-slate-400 hover:text-rose-500">
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Meta Type */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {metaTypeLabels[plan.metaType || "ocorrencias"]}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-slate-600">Meta</span>
            <span className="text-lg font-bold text-sky-600">{plan.metaValue || "1,48"} ocorrência</span>
            <span className="text-slate-400">→</span>
            <span className="text-sm text-slate-600">Resultado</span>
            <span className="text-lg font-bold text-teal-600">{plan.resultado || "1,48"} ocorrência</span>
          </div>
        </div>

        {/* Loss Info */}
        <div className="border-t border-slate-100 pt-4">
          <p className="text-xs text-slate-500">Perda:</p>
          <p className="font-semibold text-slate-800">{plan.loss}</p>
          <p className="text-sm text-slate-500 italic">{plan.lossType === "Disponibilidade" ? "Parada não planejada" : plan.lossType}</p>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
          <div>
            <p className="text-xs text-slate-500">Execução</p>
            <p className="text-sm text-slate-700">{plan.execStart || "30/01/2026"} - {plan.execEnd || "30/01/2026"}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Avaliação</p>
            <p className="text-sm text-slate-700">{plan.evalStart || "30/01/2026"} - {plan.evalEnd || "30/01/2026"}</p>
          </div>
        </div>

        {/* Work Center & Responsible */}
        <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
          <div>
            <p className="text-xs text-slate-500">Centros de Trabalho:</p>
            <p className="text-sm font-medium text-slate-800">{plan.workCenters.join(", ")}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Responsável:</p>
            <p className="text-sm font-medium text-slate-800">{plan.responsible || "Operador"}</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="border-t border-slate-100 pt-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Cronograma:</span>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs font-medium text-slate-700">{progress}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Main Component
export default function PlanosMelhoriaPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [currentStep, setCurrentStep] = useState(1)
  const [plans, setPlans] = useState<(Plan & { 
    metaType?: string
    metaValue?: string
    resultado?: string
    responsible?: string
    execStart?: string
    execEnd?: string
    evalStart?: string
    evalEnd?: string
    progress?: number
  })[]>(mockPlans.map(p => ({ ...p, metaType: "ocorrencias", metaValue: "1,48", resultado: "1,48", responsible: "Operador", progress: p.status === "finalizado" ? 100 : 45 })))
  const datePickerRef = useRef<HTMLDivElement>(null)

  const [filters, setFilters] = useState<FilterState>({
    period: { start: new Date(2025, 11, 12), end: new Date(2026, 0, 15) },
    workCenters: [],
    lossType: "",
    loss: "",
    status: "",
  })

  const [wizardData, setWizardData] = useState<WizardData>({
    period: { start: new Date(2026, 0, 27), end: new Date(2026, 0, 30) },
    workCenters: ["Moldagem Automática 01", "Moldagem Automática 02"],
    turnos: ["Manhã", "Tarde", "Noite"],
    products: ["B-240"],
    selectedLoss: null,
  })

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(event.target as Node)) {
        setShowDatePicker(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const formatDateRange = (start: Date, end: Date) => {
    return `${start.toLocaleDateString("pt-BR")} - ${end.toLocaleDateString("pt-BR")}`
  }

  const filteredPlans = plans.filter((plan) => {
    if (filters.workCenters.length > 0 && !plan.workCenters.some((wc) => filters.workCenters.includes(wc))) {
      return false
    }
    if (filters.lossType && plan.lossType !== filters.lossType) return false
    if (filters.loss && plan.loss !== filters.loss) return false
    if (filters.status && plan.status !== filters.status) return false
    return true
  })

  if (showWizard) {
    return (
      <div className="min-h-screen bg-slate-100">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="min-h-screen">
          <Header onMenuClick={() => setSidebarOpen(true)} title="Planos de Melhoria" />
          <div className="p-4 lg:p-6 max-w-6xl mx-auto">
            {/* Back button */}
            <button
              onClick={() => setShowWizard(false)}
              className="flex items-center gap-2 text-slate-600 hover:text-slate-800 mb-4"
            >
              <ChevronLeft className="w-4 h-4" />
              Voltar para lista
            </button>

            {/* Step Indicator */}
            <StepIndicator currentStep={currentStep} onStepClick={setCurrentStep} />

            {/* Step Content */}
            {currentStep === 1 && (
              <Step1Content
                wizardData={wizardData}
                setWizardData={setWizardData}
                onNext={() => setCurrentStep(2)}
              />
            )}
            {currentStep === 2 && (
              <Step2Content
                wizardData={wizardData}
                onNext={() => setCurrentStep(3)}
                onBack={() => setCurrentStep(1)}
              />
            )}
            {currentStep === 3 && (
              <Step3Content
                wizardData={wizardData}
                setWizardData={setWizardData}
                onNext={() => setCurrentStep(4)}
                onBack={() => setCurrentStep(2)}
              />
            )}
            {currentStep === 4 && (
              <Step4Content
                wizardData={wizardData}
                setWizardData={setWizardData}
                onNext={() => setCurrentStep(5)}
                onBack={() => setCurrentStep(3)}
              />
            )}
            {currentStep === 5 && (
              <Step5Content
                wizardData={wizardData}
                onBack={() => setCurrentStep(4)}
                onFinish={() => {
                  // Create new plan from wizard data
                  const newPlan = {
                    id: Date.now().toString(),
                    name: wizardData.planName || "Novo Plano",
                    period: `${wizardData.period.start.toLocaleDateString("pt-BR")} - ${wizardData.period.end.toLocaleDateString("pt-BR")}`,
                    workCenters: wizardData.workCenters,
                    lossType: "Disponibilidade",
                    loss: wizardData.selectedLoss || "4.Falta de Operador",
                    status: "em_execucao" as const,
                    createdAt: new Date().toISOString(),
                    metaType: wizardData.metaType,
                    metaValue: wizardData.metaValue,
                    resultado: wizardData.metaValue,
                    responsible: wizardData.responsible,
                    execStart: wizardData.execStartDate?.toLocaleDateString("pt-BR"),
                    execEnd: wizardData.evalStartDate?.toLocaleDateString("pt-BR"),
                    evalStart: wizardData.evalStartDate?.toLocaleDateString("pt-BR"),
                    evalEnd: wizardData.endDate?.toLocaleDateString("pt-BR"),
                    progress: 0,
                  }
                  setPlans([newPlan, ...plans])
                  setShowWizard(false)
                  setCurrentStep(1)
                  setWizardData({
                    period: { start: new Date(2026, 0, 27), end: new Date(2026, 0, 30) },
                    workCenters: ["Moldagem Automática 01", "Moldagem Automática 02"],
                    turnos: ["Manhã", "Tarde", "Noite"],
                    products: ["B-240"],
                    selectedLoss: null,
                  })
                }}
              />
            )}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="min-h-screen">
        <Header onMenuClick={() => setSidebarOpen(true)} title="Planos de Melhoria" />

        <div className="p-4 lg:p-6">
          {/* Page Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-slate-800">Planos de Melhoria</h1>
              <button
                onClick={() => setShowWizard(true)}
                className="flex items-center gap-2 px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 font-medium text-sm"
              >
                <Plus className="w-4 h-4" />
                Adicionar
              </button>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="text-center">
                <p className="text-2xl font-bold text-sky-600">{filteredPlans.length}</p>
                <p className="text-slate-500">PLANO</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-sky-600">0</p>
                <p className="text-slate-500">PÁGINA</p>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6">
            <h2 className="font-semibold text-slate-800 mb-4">Filtros</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Period Filter */}
              <div className="relative" ref={datePickerRef}>
                <div className="flex items-center gap-2 text-sm text-slate-600 mb-1">
                  <Calendar className="w-4 h-4" />
                  <span>Período</span>
                </div>
                <button
                  onClick={() => setShowDatePicker(!showDatePicker)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm hover:border-slate-400"
                >
                  <span className="truncate">{formatDateRange(filters.period.start, filters.period.end)}</span>
                  <Calendar className="w-4 h-4 flex-shrink-0 text-slate-400" />
                </button>
                {showDatePicker && (
                  <DateRangePicker
                    value={filters.period}
                    onChange={(period) => setFilters({ ...filters, period })}
                    onClose={() => setShowDatePicker(false)}
                  />
                )}
              </div>

              {/* Work Centers Filter */}
              <FilterDropdown
                label="Centros de Trabalho"
                icon={BarChart3}
                value=""
                options={workCentersList}
                multiple
                selectedItems={filters.workCenters}
                onMultiChange={(items) => setFilters({ ...filters, workCenters: items })}
              />

              {/* Loss Type Filter */}
              <FilterDropdown
                label="Tipo de Perda"
                icon={TrendingDown}
                value={filters.lossType}
                options={lossTypeOptions}
                onChange={(value) => setFilters({ ...filters, lossType: value })}
              />

              {/* Loss Filter */}
              <FilterDropdown
                label="Perda"
                icon={AlertTriangle}
                value={filters.loss}
                options={lossOptions}
                onChange={(value) => setFilters({ ...filters, loss: value })}
              />

              {/* Status Filter */}
              <FilterDropdown
                label="Estado"
                icon={FileText}
                value={filters.status}
                options={statusOptions}
                onChange={(value) => setFilters({ ...filters, status: value })}
              />
            </div>
          </div>

          {/* Plans List or Empty State */}
          {filteredPlans.length === 0 ? (
            <div className="bg-white rounded-xl p-12 text-center shadow-sm border border-slate-200">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800 mb-2">Nenhum plano encontrado</h3>
              <p className="text-slate-500 mb-6">
                Tente ajustar os filtros ou criar um novo plano de melhoria.
              </p>
              <button
                onClick={() => setShowWizard(true)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-teal-500 text-white rounded-lg hover:bg-teal-600 font-medium"
              >
                <Plus className="w-4 h-4" />
                Criar Novo Plano
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPlans.map((plan) => (
<PlanCard
                  key={plan.id}
                  plan={plan}
                  onClick={() => {
                    setWizardData({
                      period: { start: new Date(2025, 11, 6), end: new Date(2026, 0, 7) },
                      workCenters: plan.workCenters,
                      turnos: ["Manhã", "Tarde", "Noite"],
                      products: ["D-080"],
                      selectedLoss: plan.loss,
                      causaRaiz: "k",
                      planName: plan.name,
                      metaType: plan.metaType,
                      metaValue: plan.metaValue,
                      responsible: plan.responsible,
                      execStartDate: new Date(2026, 0, 30),
                      evalStartDate: new Date(2026, 1, 25),
                      endDate: new Date(2026, 2, 30),
                    })
                    setCurrentStep(5)
                    setShowWizard(true)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

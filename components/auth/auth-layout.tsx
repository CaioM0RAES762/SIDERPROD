"use client"

import React from "react"

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      {/* ── LEFT PANEL 38% ── */}
      <div className="hidden lg:flex lg:w-[38%] bg-[#090909] flex-col overflow-hidden relative">

        {/* top bar */}
        <div className="flex items-center justify-between px-10 pt-9 pb-0">
          <div className="flex items-baseline gap-0.5">
            <span className="text-[#E8630A] font-bold text-[22px] tracking-tight">Sider</span>
            <span className="text-white font-light text-[22px] tracking-tight">Prod</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] tracking-[0.22em] text-[#555] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[#E8630A] animate-pulse inline-block" />
            QC · LIVE
          </div>
        </div>

        {/* category label */}
        <div className="px-10 mt-10 flex items-center gap-3">
          <span className="block w-4 h-px bg-[#9C5826]" />
          <span className="text-[#9C5826] text-[8px] tracking-[0.32em] font-bold uppercase">
            Linha de Produção · Automotivo
          </span>
        </div>

        {/* ── ILLUSTRATION ── */}
        <div className="px-6 mt-5">
          <svg
            viewBox="0 0 380 220"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full"
          >
            <defs>
              <clipPath id="pc">
                <rect x="10" y="74" width="360" height="78" />
              </clipPath>
            </defs>

            {/* ═══════════════════════════════
                PARTES ANIMADAS
            ═══════════════════════════════ */}
            <g clipPath="url(#pc)">

              {/* ── RODA ── */}
              <g>
                <animateTransform
                  attributeName="transform" type="translate"
                  values="-60,122; 94,119; 192,124; 295,119; 442,122"
                  keyTimes="0;0.28;0.52;0.76;1"
                  calcMode="spline"
                  keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
                  dur="12s" begin="0s" repeatCount="indefinite"
                />
                {/* pneu externo — traço hand-drawn levemente irregular */}
                <path
                  d="M4,-27 C17,-26 28,-14 28,1 C28,16 17,28 2,28 C-13,28 -28,16 -27,1 C-26,-14 -13,-28 4,-27 Z"
                  fill="#9C5826" stroke="#EDE3D0" strokeWidth="4.5" strokeLinejoin="round"
                />
                {/* perfil interno do aro */}
                <circle cx="0" cy="0" r="16" fill="none" stroke="#EDE3D0" strokeWidth="2.5" />
                {/* 4 raios robustos */}
                <line x1="0" y1="-16" x2="0" y2="-27" stroke="#EDE3D0" strokeWidth="3.5" strokeLinecap="round" />
                <line x1="0"  y1="16"  x2="0"  y2="27"  stroke="#EDE3D0" strokeWidth="3.5" strokeLinecap="round" />
                <line x1="-16" y1="0"  x2="-27" y2="0"  stroke="#EDE3D0" strokeWidth="3.5" strokeLinecap="round" />
                <line x1="16"  y1="0"  x2="27"  y2="0"  stroke="#EDE3D0" strokeWidth="3.5" strokeLinecap="round" />
                {/* cubo central sólido */}
                <circle cx="0" cy="0" r="6" fill="#EDE3D0" />
              </g>

              {/* ── PORTA LATERAL ── */}
              <g>
                <animateTransform
                  attributeName="transform" type="translate"
                  values="-60,119; 94,116; 192,121; 295,116; 442,119"
                  keyTimes="0;0.28;0.52;0.76;1"
                  calcMode="spline"
                  keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
                  dur="12s" begin="-4s" repeatCount="indefinite"
                />
                {/* silhueta da porta — forma orgânica com topo levemente arredondado */}
                <path
                  d="M-35,-26 C-33,-29 -10,-31 10,-30 C30,-29 37,-25 37,-22 L37,24 C37,27 28,30 0,30 C-28,30 -37,27 -37,24 L-37,-22 C-37,-24 -36,-25 -35,-26 Z"
                  fill="#9C5826" stroke="#EDE3D0" strokeWidth="4.5" strokeLinejoin="round"
                />
                {/* vidro — recorte trapezoidal orgânico */}
                <path
                  d="M-27,-22 C-25,-24 10,-24 24,-22 C25,-18 25,-4 24,-2 C18,-1 -24,-1 -26,-2 C-27,-5 -27,-19 -27,-22 Z"
                  fill="#0c0b0a" stroke="#EDE3D0" strokeWidth="2.5" strokeLinejoin="round"
                />
                {/* linha de cintura — dobra estrutural */}
                <path
                  d="M-34,8 C-20,10 20,10 34,8"
                  stroke="#EDE3D0" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.55"
                />
                {/* maçaneta — detalhe curvo */}
                <path
                  d="M23,17 C26,17 30,18 30,21 C30,24 27,25 24,24"
                  stroke="#EDE3D0" strokeWidth="3.5" strokeLinecap="round" fill="none"
                />
              </g>

              {/* ── BLOCO DE MOTOR ── */}
              <g>
                <animateTransform
                  attributeName="transform" type="translate"
                  values="-60,121; 94,118; 192,123; 295,118; 442,121"
                  keyTimes="0;0.28;0.52;0.76;1"
                  calcMode="spline"
                  keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
                  dur="12s" begin="-8s" repeatCount="indefinite"
                />
                {/* bloco principal — forma orgânica robusta */}
                <path
                  d="M-4,-30 C9,-31 25,-22 30,-8 C34,3 29,18 19,26 C10,32 -3,32 -16,27 C-28,22 -34,10 -32,-2 C-30,-16 -19,-29 -4,-30 Z"
                  fill="#9C5826" stroke="#EDE3D0" strokeWidth="4.5" strokeLinejoin="round"
                />
                {/* bocais de cilindro — 3 unidades no topo */}
                <path
                  d="M-16,-30 L-13,-21 L-7,-21 L-4,-30 Z"
                  fill="#0c0b0a" stroke="#EDE3D0" strokeWidth="2.5" strokeLinejoin="round"
                />
                <path
                  d="M-2,-31 L1,-22 L7,-22 L10,-31 Z"
                  fill="#0c0b0a" stroke="#EDE3D0" strokeWidth="2.5" strokeLinejoin="round"
                />
                <path
                  d="M12,-29 L15,-20 L21,-20 L24,-29 Z"
                  fill="#0c0b0a" stroke="#EDE3D0" strokeWidth="2.5" strokeLinejoin="round"
                />
                {/* parafuso central — âncora visual */}
                <circle cx="0" cy="7" r="6" fill="#EDE3D0" />
              </g>
            </g>

            {/* ═══════════════════════════════
                ESTEIRA / CONVEYOR BELT
            ═══════════════════════════════ */}

            {/* corpo orgânico — forma de estádio hand-drawn */}
            <path
              d="M36,148 C115,144 265,144 344,148 C358,150 359,175 344,177 C265,180 115,180 36,177 C22,175 21,150 36,148 Z"
              fill="#171411" stroke="#EDE3D0" strokeWidth="3.5" strokeLinejoin="round"
            />

            {/* juntas da correia — animação de rolamento */}
            <line
              x1="22" y1="162" x2="358" y2="162"
              stroke="#201c19" strokeWidth="20"
              strokeDasharray="22 11"
              className="auth-belt-anim"
            />

            {/* rolo esquerdo — âncora terracota */}
            <circle cx="22" cy="162" r="16" fill="#9C5826" stroke="#EDE3D0" strokeWidth="3.5" />
            <circle cx="22" cy="162" r="5.5" fill="#EDE3D0" />

            {/* rolo direito — âncora terracota */}
            <circle cx="358" cy="162" r="16" fill="#9C5826" stroke="#EDE3D0" strokeWidth="3.5" />
            <circle cx="358" cy="162" r="5.5" fill="#EDE3D0" />

            {/* ═══════════════════════════════
                ESTRUTURA DE SUPORTE
            ═══════════════════════════════ */}

            {/* perna esquerda — A-frame elegante */}
            <line x1="60"  y1="177" x2="46"  y2="208" stroke="#EDE3D0" strokeWidth="3"   strokeLinecap="round" />
            <line x1="60"  y1="177" x2="74"  y2="208" stroke="#EDE3D0" strokeWidth="3"   strokeLinecap="round" />
            <line x1="48"  y1="202" x2="72"  y2="202" stroke="#EDE3D0" strokeWidth="2.5" strokeLinecap="round" />

            {/* perna direita — A-frame elegante */}
            <line x1="320" y1="177" x2="306" y2="208" stroke="#EDE3D0" strokeWidth="3"   strokeLinecap="round" />
            <line x1="320" y1="177" x2="334" y2="208" stroke="#EDE3D0" strokeWidth="3"   strokeLinecap="round" />
            <line x1="308" y1="202" x2="332" y2="202" stroke="#EDE3D0" strokeWidth="2.5" strokeLinecap="round" />

            {/* linha de piso */}
            <line x1="22" y1="210" x2="358" y2="210" stroke="#2a2520" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>

        {/* main headline */}
        <div className="px-10 mt-5">
          {/* H1 — impacto máximo */}
          <p className="text-[#F0E8DC] font-black text-[30px] leading-none tracking-tight">
            Chão de fábrica.
          </p>
          {/* H2 — contraste de peso */}
          <p className="text-[#6B5A4E] font-extralight text-[24px] leading-none tracking-tight mt-1.5">
            Sob controle total.
          </p>
          {/* separador */}
          <div className="w-8 h-px bg-[#3A2E24] mt-5 mb-4" />
          {/* corpo — objetivo e direto */}
          <p className="text-[#7A6A5C] text-[11px] leading-[1.65] max-w-[230px]">
            OEE, conformidade e paradas em tempo real —
            por posto, turno e linha de produção.
          </p>
          <p className="text-[#5A4A3C] text-[9.5px] leading-[1.6] max-w-[230px] mt-3">
            Demonstração pública do SIDERPROD. Todos os dados exibidos são
            fictícios e gerados pela própria aplicação.
          </p>
        </div>

        {/* stats */}
        <div className="mt-auto px-10 pb-9">
          {/* linha divisora */}
          <div className="border-t border-[#2A2018] mb-5" />

          {/* métricas — 3 colunas */}
          <div className="grid grid-cols-3 gap-0">
            <div>
              <p className="text-[7px] tracking-[0.24em] text-[#6B5A4A] uppercase mb-2 font-semibold">
                OEE Médio
              </p>
              <p className="text-[#F0E8DC] font-bold text-[26px] leading-none tabular-nums">
                78.4<span className="text-[#5A4A3C] text-[11px] font-medium ml-0.5">%</span>
              </p>
            </div>
            <div>
              <p className="text-[7px] tracking-[0.24em] text-[#6B5A4A] uppercase mb-2 font-semibold">
                Conformidade
              </p>
              <p className="text-[#9C5826] font-bold text-[26px] leading-none tabular-nums">
                99.2<span className="text-[#7A4A28] text-[11px] font-medium ml-0.5">%</span>
              </p>
            </div>
            <div>
              <p className="text-[7px] tracking-[0.24em] text-[#6B5A4A] uppercase mb-2 font-semibold">
                Postos Ativos
              </p>
              <p className="text-[#F0E8DC] font-bold text-[26px] leading-none tabular-nums">
                12
              </p>
            </div>
          </div>

          {/* rodapé */}
          <div className="flex items-center justify-between mt-6">
            <p className="text-[#3D3028] text-[7.5px] tracking-[0.25em] uppercase font-semibold">
              Ambiente demonstrativo
            </p>
            <p className="text-[#3D3028] text-[7.5px] tracking-[0.12em]">Dados fictícios</p>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="flex-1 bg-white flex items-center justify-center px-8 py-12 min-h-screen">
        <div className="w-full max-w-[400px]">
          {children}
        </div>
      </div>
    </div>
  )
}

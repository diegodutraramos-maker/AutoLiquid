"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CalendarDays,
  Landmark,
  Loader2,
  Receipt,
  ShieldAlert,
  Wallet,
} from "lucide-react";

import { GlassCard, GlassPanel } from "@/components/glass-card";
import type { ResumoFinanceiro, StatusGeralDocumento } from "@/lib/data";
import Link from "next/link";
import { GlassButton } from "@/components/glass-card";

interface StatusOverviewProps {
  statusGeral: StatusGeralDocumento;
  resumo: ResumoFinanceiro;
  optanteSimples: boolean;
  hasDdf025: boolean;
  apuracaoDate?: string;
  vencimentoDate?: string;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function statusBadgeClass(tipo: StatusGeralDocumento["tipo"]) {
  switch (tipo) {
    case "pronto":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700";
    case "bloqueado":
      return "border-destructive/25 bg-destructive/10 text-destructive";
    case "em_execucao":
      return "border-sky-500/25 bg-sky-500/10 text-sky-700";
    default:
      return "border-amber-500/25 bg-amber-500/10 text-amber-700";
  }
}

export function StatusOverview({
  statusGeral,
  resumo,
  optanteSimples,
  hasDdf025,
  apuracaoDate,
  vencimentoDate,
}: StatusOverviewProps) {
  const simplesStatus =
    optanteSimples === hasDdf025
      ? optanteSimples
        ? {
            tone: "border-amber-500/25 bg-amber-500/10 text-amber-700",
            title: "Optante pelo Simples com DDF025 presente",
            description:
              "A retenção DDF025 foi identificada junto com o enquadramento no Simples Nacional.",
          }
        : {
            tone: "border-amber-500/25 bg-amber-500/10 text-amber-700",
            title: "Não optante e sem DDF025",
            description:
              "A empresa não consta como optante pelo Simples e a dedução DDF025 não foi identificada.",
          }
      : null;

  return (
    <GlassCard className="p-5">
      <div className="mb-5 flex flex-col gap-4 border-b border-glass-border pb-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/">
                <GlassButton variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4" />
                  Voltar
                </GlassButton>
              </Link>
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-foreground">
                  Conferência e Automação
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Resumo operacional do documento e conferências antes da execução.
                </p>
              </div>
            </div>
          </div>

          {(apuracaoDate || vencimentoDate) && (
            <div className="flex flex-wrap gap-2">
              {apuracaoDate ? (
                <span className="inline-flex items-center gap-2 rounded-xl border border-glass-border bg-background/70 px-3 py-2 text-xs font-medium text-foreground">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  Apuração: {apuracaoDate}
                </span>
              ) : null}
              {vencimentoDate ? (
                <span className="inline-flex items-center gap-2 rounded-xl border border-glass-border bg-background/70 px-3 py-2 text-xs font-medium text-foreground">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  Vencimento: {vencimentoDate}
                </span>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${statusBadgeClass(statusGeral.tipo)}`}
            >
              {statusGeral.tipo === "pronto" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : statusGeral.tipo === "em_execucao" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldAlert className="h-4 w-4" />
              )}
              {statusGeral.titulo}
            </span>
            <span className="rounded-full border border-glass-border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
              {optanteSimples ? "Optante pelo Simples" : "Não optante pelo Simples"}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{statusGeral.descricao}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[430px]">
          <GlassPanel className="border-glass-border/70 bg-background/70 p-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Landmark className="h-3.5 w-3.5" />
              Bruto
            </div>
            <p className="mt-2 text-sm font-semibold text-foreground">{formatCurrency(resumo.bruto)}</p>
          </GlassPanel>

          <GlassPanel className="border-glass-border/70 bg-background/70 p-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Receipt className="h-3.5 w-3.5" />
              Deduções
            </div>
            <p className="mt-2 text-sm font-semibold text-destructive">{formatCurrency(resumo.deducoes)}</p>
          </GlassPanel>

          <GlassPanel className="border-glass-border/70 bg-background/70 p-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" />
              Líquido
            </div>
            <p className="mt-2 text-sm font-semibold text-emerald-700">{formatCurrency(resumo.liquido)}</p>
          </GlassPanel>
        </div>
      </div>

      {simplesStatus ? (
        <div className={`mt-4 rounded-2xl border px-4 py-4 ${simplesStatus.tone}`}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{simplesStatus.title}</p>
              <p className="mt-1 text-sm leading-6 opacity-90">{simplesStatus.description}</p>
            </div>
          </div>
        </div>
      ) : null}
    </GlassCard>
  );
}

"use client";

import { CheckCircle2, Loader2, Server, ShieldAlert, Smartphone, Workflow } from "lucide-react";

import { GlassCard, GlassPanel } from "@/components/glass-card";
import type { ChromeStatus, StatusGeralDocumento } from "@/lib/data";

interface StatusOverviewProps {
  statusGeral: StatusGeralDocumento;
  apiStatus: "conectada" | "carregando" | "erro";
  chromeStatus: ChromeStatus;
  browserName: string;
  appVersion: string;
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

function indicatorClass(status: "conectada" | "carregando" | "erro") {
  switch (status) {
    case "conectada":
      return "text-emerald-700";
    case "erro":
      return "text-destructive";
    default:
      return "text-amber-700";
  }
}

function browserIndicatorClass(status: ChromeStatus) {
  switch (status) {
    case "pronto":
      return "text-emerald-700";
    case "erro":
      return "text-destructive";
    default:
      return "text-amber-700";
  }
}

export function StatusOverview({
  statusGeral,
  apiStatus,
  chromeStatus,
  browserName,
  appVersion,
}: StatusOverviewProps) {
  return (
    <GlassCard className="p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Status do Documento
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
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
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            {statusGeral.descricao}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[420px]">
          <GlassPanel className="border-glass-border/70 bg-background/70 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Server className="h-3.5 w-3.5" />
              API
            </div>
            <p className={`mt-2 text-sm font-medium ${indicatorClass(apiStatus)}`}>
              {apiStatus === "conectada"
                ? "Conectada"
                : apiStatus === "erro"
                  ? "Indisponível"
                  : "Conectando"}
            </p>
          </GlassPanel>

          <GlassPanel className="border-glass-border/70 bg-background/70 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Workflow className="h-3.5 w-3.5" />
              Navegador
            </div>
            <p className={`mt-2 text-sm font-medium ${browserIndicatorClass(chromeStatus)}`}>
              {browserName} {chromeStatus === "pronto" ? "pronto" : chromeStatus === "erro" ? "indisponível" : "verificando"}
            </p>
          </GlassPanel>

          <GlassPanel className="border-glass-border/70 bg-background/70 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Smartphone className="h-3.5 w-3.5" />
              Versão
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">v{appVersion || "—"}</p>
          </GlassPanel>
        </div>
      </div>
    </GlassCard>
  );
}

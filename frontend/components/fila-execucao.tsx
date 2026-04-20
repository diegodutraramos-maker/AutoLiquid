"use client";

import { useState } from "react";
import {
  FileText,
  DollarSign,
  MinusCircle,
  CreditCard,
  Building,
  Play,
  Circle,
  Square,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { GlassCard, GlassButton } from "./glass-card";
import type { Deducao, EtapaExecucao } from "@/lib/data";
import { cn } from "@/lib/utils";

interface FilaExecucaoProps {
  etapas: EtapaExecucao[];
  deducoes?: Deducao[];
  onExecutarTudo?: () => void;
  onExecutarEtapa?: (etapa: EtapaExecucao) => void;
  onExecutarDeducao?: (deducao: Deducao) => void;
  onApropriarSIAFI?: () => void;
  apuracaoDate?: string;
  vencimentoDate?: string;
  isExecutando?: boolean;
  etapaAtivaId?: number | null;
  deducaoAtivaId?: number | null;
  statusMensagem?: string;
  onPararExecucao?: () => void;
  paradaSolicitada?: boolean;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText,
  DollarSign,
  MinusCircle,
  CreditCard,
  Building,
};

function getStatusColor(status: EtapaExecucao["status"], index: number) {
  switch (status) {
    case "concluido":
      return "bg-success";
    case "executando":
      return "bg-primary";
    case "erro":
      return "bg-destructive";
    default:
      // Different colors for each step when aguardando
      const colors = ["bg-primary", "bg-warning", "bg-destructive", "bg-muted", "bg-accent"];
      return colors[index % colors.length];
  }
}

function getStatusLabel(status: EtapaExecucao["status"], isAtiva: boolean) {
  if (isAtiva || status === "executando") {
    return "Em execução"
  }

  switch (status) {
    case "concluido":
      return "Concluída"
    case "erro":
      return "Com erro"
    default:
      return "Aguardando"
  }
}

function getStatusBadgeClass(status: EtapaExecucao["status"], isAtiva: boolean) {
  if (isAtiva || status === "executando") {
    return "border-primary/30 bg-primary/12 text-primary"
  }

  switch (status) {
    case "concluido":
      return "border-success/30 bg-success/12 text-success"
    case "erro":
      return "border-destructive/25 bg-destructive/10 text-destructive"
    default:
      return "border-glass-border bg-background/70 text-muted-foreground"
  }
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function DeducaoStatusIcon({ status, isAtiva }: { status: Deducao["status"]; isAtiva: boolean }) {
  if (isAtiva || status === "executando")
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (status === "concluido")
    return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
  if (status === "erro")
    return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  return null;
}

export function FilaExecucao({
  etapas,
  deducoes = [],
  onExecutarTudo,
  onExecutarEtapa,
  onExecutarDeducao,
  onApropriarSIAFI,
  apuracaoDate,
  vencimentoDate,
  isExecutando = false,
  etapaAtivaId = null,
  deducaoAtivaId = null,
  statusMensagem,
  onPararExecucao,
  paradaSolicitada = false,
}: FilaExecucaoProps) {
  const concluidos = etapas.filter((e) => e.status === "concluido").length;
  const [deducoesExpandidas, setDeducoesExpandidas] = useState(true);

  return (
    <GlassCard className="flex h-full flex-col">
      <div className="p-6">
        <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-primary">
          Fila de Execução
        </h3>

        <div className="space-y-3">
          {etapas.map((etapa, index) => {
            const IconComponent = iconMap[etapa.icone] || FileText;
            const isAtiva = etapaAtivaId === etapa.id;
            const isClickable = Boolean(onExecutarEtapa) && !isExecutando;

            // Etapa Dedução (id=3) pode expandir sub-itens quando há deduções
            const isDeducaoEtapa = etapa.id === 3 && deducoes.length > 0;

            return (
              <div key={etapa.id} className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => onExecutarEtapa?.(etapa)}
                  disabled={!isClickable}
                  title={onExecutarEtapa ? "Clique para executar apenas esta etapa" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all",
                    isAtiva
                      ? "border-primary/40 bg-primary/10 shadow-[0_18px_40px_-28px_rgba(79,70,229,0.75)]"
                      : "border-transparent bg-secondary/25",
                    isClickable && "hover:border-primary/30 hover:bg-secondary/50",
                    !isClickable && "cursor-default opacity-90"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-primary-foreground",
                      getStatusColor(etapa.status, index)
                    )}
                  >
                    {index + 1}
                  </span>
                  <IconComponent className="h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">
                    {etapa.nome}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                      getStatusBadgeClass(etapa.status, isAtiva)
                    )}
                  >
                    {getStatusLabel(etapa.status, isAtiva)}
                  </span>
                  {isDeducaoEtapa ? (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={deducoesExpandidas ? "Recolher deduções" : "Expandir deduções"}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDeducoesExpandidas((current) => !current);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          setDeducoesExpandidas((current) => !current);
                        }
                      }}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
                    >
                      {deducoesExpandidas ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </span>
                  ) : null}
                </button>

                {/* Sub-lista de deduções individuais */}
                {isDeducaoEtapa && deducoesExpandidas && (
                  <div className="ml-4 space-y-1.5 border-l-2 border-glass-border pl-3">
                    {deducoes.map((ded) => {
                      const isDedAtiva = deducaoAtivaId === ded.id;
                      const dedClickable = Boolean(onExecutarDeducao) && !isExecutando;
                      return (
                        <div
                          key={ded.id}
                          className={cn(
                            "flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-all",
                            isDedAtiva
                              ? "border-primary/30 bg-primary/8"
                              : ded.status === "concluido"
                              ? "border-success/20 bg-success/5"
                              : ded.status === "erro"
                              ? "border-destructive/20 bg-destructive/5"
                              : "border-transparent bg-background/40"
                          )}
                        >
                          <DeducaoStatusIcon status={ded.status} isAtiva={isDedAtiva} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-foreground">
                              {ded.tipo || ded.siafi}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {ded.siafi} · {formatCurrency(ded.valor)}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={!dedClickable}
                            onClick={() => onExecutarDeducao?.(ded)}
                            title="Executar apenas esta dedução"
                            className={cn(
                              "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                              ded.status === "concluido"
                                ? "text-success hover:bg-success/10"
                                : ded.status === "erro"
                                ? "border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
                                : "border border-primary/25 bg-primary/10 text-primary hover:bg-primary/15",
                              !dedClickable && "cursor-default opacity-50"
                            )}
                          >
                            <Play className="h-2.5 w-2.5" />
                            {ded.status === "concluido" ? "Refazer" : "Executar"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex gap-3">
          <GlassButton
            variant="success"
            className="flex-1"
            onClick={onExecutarTudo}
            disabled={isExecutando}
          >
            <Play className="h-4 w-4" />
            {isExecutando ? "Executando..." : "Executar Tudo"}
          </GlassButton>
          <GlassButton
            variant="warning"
            className="flex-1"
            onClick={onApropriarSIAFI}
            disabled={isExecutando}
          >
            <Circle className="h-4 w-4" />
            Apropriar SIAFI
          </GlassButton>
        </div>

        {isExecutando && (
          <GlassButton
            variant="ghost"
            className="mt-3 w-full border border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15"
            onClick={onPararExecucao}
            disabled={!onPararExecucao || paradaSolicitada}
          >
            <Square className="h-4 w-4" />
            {paradaSolicitada ? "Parada solicitada" : "Parar após a etapa atual"}
          </GlassButton>
        )}

        <div className="mt-4 text-right text-sm">
          <span className="text-muted-foreground">
            {statusMensagem || "Aguardando execução"}
          </span>{" "}
          <span className="font-medium text-foreground">
            {concluidos} / {etapas.length}
          </span>
        </div>
      </div>
    </GlassCard>
  );
}

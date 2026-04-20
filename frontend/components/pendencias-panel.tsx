"use client";

import { AlertTriangle, OctagonAlert, SearchCheck } from "lucide-react";

import { GlassCard } from "@/components/glass-card";
import type { PendenciaDocumento } from "@/lib/data";

interface PendenciasPanelProps {
  pendencias: PendenciaDocumento[];
}

function itemClass(tipo: PendenciaDocumento["tipo"]) {
  switch (tipo) {
    case "bloqueio":
      return "border-destructive/25 bg-destructive/10";
    case "divergencia":
      return "border-amber-500/25 bg-amber-500/10";
    default:
      return "border-sky-500/20 bg-sky-500/8";
  }
}

function badgeClass(tipo: PendenciaDocumento["tipo"]) {
  switch (tipo) {
    case "bloqueio":
      return "border-destructive/25 bg-destructive/10 text-destructive";
    case "divergencia":
      return "border-amber-500/25 bg-amber-500/10 text-amber-700";
    default:
      return "border-sky-500/20 bg-sky-500/10 text-sky-700";
  }
}

function PendenciaIcon({ tipo }: { tipo: PendenciaDocumento["tipo"] }) {
  if (tipo === "bloqueio") {
    return <OctagonAlert className="h-4 w-4 text-destructive" />;
  }
  if (tipo === "divergencia") {
    return <AlertTriangle className="h-4 w-4 text-amber-700" />;
  }
  return <SearchCheck className="h-4 w-4 text-sky-700" />;
}

function renderPendenciaDescricao(descricao: string) {
  const textoLimpo = descricao
    .replace(/^⚠\s*/, "")
    .replace(/^[^:]+ requer confer[êe]ncia manual:\s*/i, "")
    .trim();

  const segmentos = Array.from(
    textoLimpo.matchAll(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .()/-]+:)\s*([^:]+?)(?=(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .()/-]+:)|$)/g)
  );

  if (segmentos.length === 0) {
    return <p className="mt-2 text-sm leading-6 text-muted-foreground">{descricao}</p>;
  }

  return (
    <div className="mt-2 space-y-1.5">
      {segmentos.map((segmento, index) => (
        <p key={`${segmento[1]}-${index}`} className="text-sm leading-6 text-muted-foreground">
          <strong className="font-semibold text-foreground">{segmento[1]}</strong>{" "}
          {segmento[2].trim()}
        </p>
      ))}
    </div>
  );
}

export function PendenciasPanel({ pendencias }: PendenciasPanelProps) {
  return (
    <GlassCard className="p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Pendências e Divergências
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Este resumo mostra o que bloqueia, o que diverge e o que merece conferência antes da execução.
          </p>
        </div>
        <span className="inline-flex w-fit shrink-0 self-start whitespace-nowrap rounded-full border border-glass-border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
          {pendencias.length} item(ns)
        </span>
      </div>

      {pendencias.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-700">
          Nenhuma pendência relevante foi detectada até aqui. O documento está em condição boa para seguir.
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {pendencias.map((pendencia) => (
            <div
              key={pendencia.id}
              className={`rounded-2xl border px-4 py-4 ${itemClass(pendencia.tipo)}`}
            >
              <div className="flex items-start gap-3">
                <PendenciaIcon tipo={pendencia.tipo} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{pendencia.titulo}</p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em] ${badgeClass(pendencia.tipo)}`}
                    >
                      {pendencia.tipo}
                    </span>
                  </div>
                  {renderPendenciaDescricao(pendencia.descricao)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

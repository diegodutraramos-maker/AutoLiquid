"use client";

import { AlertTriangle } from "lucide-react";
import { GlassCard, GlassPanel } from "./glass-card";
import type { Documento, ResumoFinanceiro } from "@/lib/data";

interface DocumentoPanelProps {
  documento: Documento;
  resumo: ResumoFinanceiro;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, "");
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  return cnpj;
}

function InfoRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="space-y-0.5">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <p className={highlight ? "font-medium text-primary" : "text-sm text-foreground"}>{value}</p>
    </div>
  );
}

export function DocumentoPanel({ documento, resumo }: DocumentoPanelProps) {
  return (
    <GlassCard className="p-6">
      <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-primary">
        Documento
      </h3>

      <div className="space-y-4">
        <InfoRow label="CNPJ" value={formatCnpj(documento.cnpj)} />
        <InfoRow label="Processo" value={documento.processo} />
        <InfoRow label="Sol. Pagamento" value={documento.solPagamento} />
        <InfoRow label="Convênio" value={documento.convenio} />
        <InfoRow label="Natureza" value={documento.natureza.toString()} highlight />
        <InfoRow label="Ateste" value={documento.ateste} highlight />
        <InfoRow label="Contrato" value={documento.contrato} />
        <InfoRow label="Cód. para (IG)" value={documento.codigoIG} highlight />
        <InfoRow label="Tipo Liquidação" value={documento.tipoLiquidacao} />

        {documento.alertas && documento.alertas.length > 0 && (
          <GlassPanel className="border-warning/30 bg-warning/10">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
              <div className="space-y-1">
                {documento.alertas.map((alerta, i) => (
                  <p key={i} className="text-xs text-warning">
                    {alerta}
                  </p>
                ))}
              </div>
            </div>
          </GlassPanel>
        )}

        <GlassPanel className="border-primary/20 bg-primary/5">
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-primary">
            Resumo Financeiro
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Bruto:</span>
              <span className="text-foreground">{formatCurrency(resumo.bruto)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Deduções:</span>
              <span className="text-destructive">{formatCurrency(resumo.deducoes)}</span>
            </div>
            <div className="flex justify-between border-t border-glass-border pt-2 text-sm font-medium">
              <span className="text-foreground">Líquido:</span>
              <span className="text-success">{formatCurrency(resumo.liquido)}</span>
            </div>
          </div>
        </GlassPanel>
      </div>
    </GlassCard>
  );
}

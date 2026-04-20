"use client";

import { AlertTriangle } from "lucide-react";
import { GlassCard, GlassPanel } from "./glass-card";
import type { Documento, ResumoFinanceiro } from "@/lib/data";

interface DocumentoPanelProps {
  documento: Documento;
  resumo: ResumoFinanceiro;
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
    <div className="min-w-0 space-y-0.5">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <p className={highlight ? "break-words font-medium text-primary" : "break-words text-sm text-foreground"}>{value}</p>
    </div>
  );
}

export function DocumentoPanel({ documento, resumo: _resumo }: DocumentoPanelProps) {
  const alertasExibidos = (documento.alertas ?? []).filter(
    (alerta) => !String(alerta).toLowerCase().includes("simples nacional")
  );

  return (
    <GlassCard className="p-7 md:p-8">
      <h3 className="mb-5 text-xs font-medium uppercase tracking-wider text-primary">
        Documento
      </h3>

      <div className="grid gap-5 sm:grid-cols-2 min-[1180px]:grid-cols-1 2xl:grid-cols-2">
        <InfoRow label="CNPJ" value={formatCnpj(documento.cnpj)} />
        <InfoRow label="Processo" value={documento.processo} />
        <InfoRow label="Sol. Pagamento" value={documento.solPagamento} />
        <InfoRow label="Convênio" value={documento.convenio} />
        <InfoRow label="Natureza" value={documento.natureza.toString()} highlight />
        <InfoRow label="Ateste" value={documento.ateste} highlight />
        <InfoRow label="Contrato" value={documento.contrato} />
        <InfoRow label="Cód. para (IG)" value={documento.codigoIG} highlight />
        <InfoRow label="Tipo Liquidação" value={documento.tipoLiquidacao} />

        {alertasExibidos.length > 0 && (
          <GlassPanel className="border-warning/30 bg-warning/10">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
              <div className="space-y-1">
                {alertasExibidos.map((alerta, i) => (
                  <p key={i} className="text-xs text-warning">
                    {alerta}
                  </p>
                ))}
              </div>
            </div>
          </GlassPanel>
        )}
      </div>
    </GlassCard>
  );
}

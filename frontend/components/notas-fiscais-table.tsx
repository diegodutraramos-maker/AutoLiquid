"use client";

import { useState } from "react";
import { CalendarDays, Check, ChevronDown, ChevronRight, Loader2, X, AlertTriangle } from "lucide-react";
import { GlassCard, GlassButton, GlassTable, GlassTableRow, GlassTableCell, GlassPanel } from "./glass-card";
import type { Deducao, Empenho, NotaFiscal, ProcessDates, ResumoFinanceiro } from "@/lib/data";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type TabType = "notas" | "empenhos" | "deducoes" | "log";

interface DatasDeducao {
  apuracao: string;
  vencimento: string;
}

interface NotasFiscaisTableProps {
  notasFiscais: NotaFiscal[];
  empenhos: Empenho[];
  deducoes: Deducao[];
  resumo: ResumoFinanceiro;
  dates?: ProcessDates;
  datasDeducoes?: Record<number, DatasDeducao>;
  onDatasDeducaoChange?: (dedId: number, datas: DatasDeducao) => void;
  logs?: string[];
  logsSimples?: string[];
  nivelLog?: "simples" | "desenvolvedor";
  onLimparLogs?: () => void;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + "%";
}

function formatEditableCurrency(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

function parseEditableCurrency(value: string): number | null {
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function obterBasePercentual(
  deducao: Deducao,
  resumoBruto: number,
  brutoNotas: number
): number {
  if (deducao.baseCalculo > 0) return deducao.baseCalculo;
  if (resumoBruto > 0) return resumoBruto;
  return brutoNotas;
}

function distribuirRetencaoPorNotas(notasFiscais: NotaFiscal[], valorTotalDeducao: number) {
  const brutoNotas = notasFiscais.reduce((acc, nota) => acc + nota.valor, 0);
  const percentual = brutoNotas > 0 ? valorTotalDeducao / brutoNotas : 0;
  const itens = notasFiscais.map((nota) => ({
    nota,
    percentual,
    retencao: Number((nota.valor * percentual).toFixed(2)),
  }));

  const totalRateado = itens.reduce((acc, item) => acc + item.retencao, 0);
  const diferenca = Number((valorTotalDeducao - totalRateado).toFixed(2));
  if (itens.length > 0 && diferenca !== 0) {
    itens[itens.length - 1].retencao = Number((itens[itens.length - 1].retencao + diferenca).toFixed(2));
  }

  return {
    percentual,
    brutoNotas,
    itens,
  };
}

type LogLineType = "header" | "ok" | "run" | "err" | "warn" | "info";

function parseLogLine(raw: string): { type: LogLineType; text: string } {
  if (raw.startsWith("HEADER ")) return { type: "header", text: raw.slice(7) };
  if (raw.startsWith("OK "))     return { type: "ok",     text: raw.slice(3) };
  if (raw.startsWith("RUN "))    return { type: "run",    text: raw.slice(4) };
  if (raw.startsWith("ERR "))    return { type: "err",    text: raw.slice(4) };
  if (raw.startsWith("WARN "))   return { type: "warn",   text: raw.slice(5) };
  // Dev log lines — derive type from existing prefix conventions
  if (raw.startsWith("✓"))  return { type: "ok",   text: raw.slice(1).trimStart() };
  if (raw.startsWith("✗"))  return { type: "err",  text: raw.slice(1).trimStart() };
  if (raw.startsWith("⚠"))  return { type: "warn", text: raw.slice(1).trimStart() };
  if (raw.startsWith("→"))  return { type: "run",  text: raw.slice(1).trimStart() };
  return { type: "info", text: raw };
}

function SimpleLogLine({ raw }: { raw: string }) {
  const { type, text } = parseLogLine(raw);

  if (type === "header") {
    return (
      <div className="flex items-center gap-3 pb-1 pt-3 first:pt-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {text}
        </span>
        <span className="h-px flex-1 bg-glass-border" />
      </div>
    );
  }

  const dotClass =
    type === "ok"   ? "bg-success" :
    type === "run"  ? "bg-primary animate-pulse" :
    type === "err"  ? "bg-destructive" :
    type === "warn" ? "bg-warning" :
                      "bg-muted-foreground/40";

  const textClass =
    type === "err"  ? "text-destructive" :
    type === "warn" ? "text-warning" :
    type === "run"  ? "text-primary" :
                      "text-foreground";

  const Icon =
    type === "ok"   ? Check :
    type === "err"  ? X :
    type === "warn" ? AlertTriangle :
    type === "run"  ? Loader2 :
                      null;

  return (
    <div className="flex items-start gap-2.5 py-1">
      <span className="mt-[5px] flex h-4 w-4 flex-shrink-0 items-center justify-center">
        {Icon ? (
          <Icon
            className={`h-3.5 w-3.5 ${
              type === "ok"   ? "text-success" :
              type === "err"  ? "text-destructive" :
              type === "warn" ? "text-warning" :
              type === "run"  ? "text-primary animate-spin" :
                                "text-muted-foreground"
            }`}
            strokeWidth={type === "ok" ? 2.5 : 2}
          />
        ) : (
          <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        )}
      </span>
      <span className={`text-sm leading-snug ${textClass}`}>{text}</span>
    </div>
  );
}

function DevLogLine({ raw }: { raw: string }) {
  const { type } = parseLogLine(raw);
  const cls =
    type === "ok"   ? "text-success" :
    type === "err"  ? "text-destructive" :
    type === "warn" ? "text-warning" :
    type === "run"  ? "text-primary" :
                      "text-muted-foreground";
  return <p className={`font-mono text-xs leading-relaxed ${cls}`}>{raw}</p>;
}

export function NotasFiscaisTable({
  notasFiscais,
  empenhos,
  deducoes,
  resumo,
  dates,
  datasDeducoes = {},
  onDatasDeducaoChange,
  logs = [],
  logsSimples = [],
  nivelLog = "desenvolvedor",
  onLimparLogs,
}: NotasFiscaisTableProps) {
  const [activeTab, setActiveTab] = useState<TabType>("notas");
  const [expandedDeducoes, setExpandedDeducoes] = useState<number[]>([]);
  const [retencoesEditadas, setRetencoesEditadas] = useState<Record<string, string>>({});
  const totalDeducoes = deducoes.reduce((acc, deducao) => acc + deducao.valor, 0);
  const totalNotas = notasFiscais.reduce((acc, nota) => acc + nota.valor, 0);
  const basePercentualTotal = resumo.bruto > 0 ? resumo.bruto : totalNotas;

  const totalLogs = nivelLog === "simples" ? logsSimples.length : logs.length;

  const tabs: { id: TabType; label: string }[] = [
    { id: "notas", label: "Notas Fiscais" },
    { id: "empenhos", label: "Empenhos" },
    { id: "deducoes", label: "Deduções" },
    { id: "log", label: "Log de Execução" },
  ];

  const alternarDeducao = (id: number) => {
    setExpandedDeducoes((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const atualizarRetencao = (key: string, value: string) => {
    setRetencoesEditadas((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const normalizarRetencao = (key: string, valorOriginal: number) => {
    setRetencoesEditadas((current) => {
      const raw = current[key];
      if (raw === undefined) return current;
      const parsed = parseEditableCurrency(raw);
      return {
        ...current,
        [key]: formatEditableCurrency(parsed ?? valorOriginal),
      };
    });
  };

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex border-b border-glass-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {activeTab === "notas" && (
          <GlassTable headers={["", "Tipo", "Nota", "Emissão", "Ateste", "Valor"]}>
            {notasFiscais.map((nota, index) => (
              <GlassTableRow key={nota.id}>
                <GlassTableCell className="w-12 text-muted-foreground">
                  {index + 1}
                </GlassTableCell>
                <GlassTableCell>{nota.tipo}</GlassTableCell>
                <GlassTableCell>{nota.nota}</GlassTableCell>
                <GlassTableCell>{nota.emissao}</GlassTableCell>
                <GlassTableCell className="text-primary">{nota.ateste}</GlassTableCell>
                <GlassTableCell className="font-medium">
                  {formatCurrency(nota.valor)}
                </GlassTableCell>
              </GlassTableRow>
            ))}
          </GlassTable>
        )}

        {activeTab === "empenhos" && (
          empenhos.length > 0 ? (
            <GlassTable headers={["", "Empenho", "Situação", "Recurso"]}>
              {empenhos.map((empenho, index) => (
                <GlassTableRow key={empenho.id}>
                  <GlassTableCell className="w-12 text-muted-foreground">
                    {index + 1}
                  </GlassTableCell>
                  <GlassTableCell className="font-medium">
                    {empenho.numero}
                  </GlassTableCell>
                  <GlassTableCell>{empenho.situacao}</GlassTableCell>
                  <GlassTableCell>{empenho.recurso}</GlassTableCell>
                </GlassTableRow>
              ))}
            </GlassTable>
          ) : (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              Nenhum empenho cadastrado
            </div>
          )
        )}

        {activeTab === "log" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {nivelLog === "simples" ? "Log Simplificado" : "Log Desenvolvedor"}
                {totalLogs > 0 && ` · ${totalLogs} linha${totalLogs !== 1 ? "s" : ""}`}
              </span>
              {onLimparLogs && (
                <GlassButton
                  variant="ghost"
                  size="sm"
                  onClick={onLimparLogs}
                  disabled={totalLogs === 0}
                >
                  limpar
                </GlassButton>
              )}
            </div>

            {nivelLog === "simples" ? (
              logsSimples.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                  Nenhum registro ainda — execute a automação para ver as confirmações.
                </div>
              ) : (
                <div className="px-1">
                  {logsSimples.map((linha, i) => (
                    <SimpleLogLine key={i} raw={linha} />
                  ))}
                </div>
              )
            ) : (
              <GlassPanel className="min-h-[8rem] bg-background/50">
                {logs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum log disponível</p>
                ) : (
                  <div className="space-y-0.5">
                    {logs.map((linha, i) => (
                      <DevLogLine key={i} raw={linha} />
                    ))}
                  </div>
                )}
              </GlassPanel>
            )}
          </div>
        )}

        {activeTab === "deducoes" && (
          deducoes.length > 0 ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-glass-border/70 bg-secondary/25 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    Total Deduções
                  </div>
                  <div className="mt-2 text-lg font-semibold text-foreground">
                    {formatCurrency(totalDeducoes)}
                  </div>
                </div>
                <div className="rounded-xl border border-glass-border/70 bg-secondary/25 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    Base do Percentual
                  </div>
                  <div className="mt-2 text-lg font-semibold text-foreground">
                    {formatCurrency(basePercentualTotal)}
                  </div>
                </div>
                <div className="rounded-xl border border-glass-border/70 bg-secondary/25 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    Percentual Total
                  </div>
                  <div className="mt-2 text-lg font-semibold text-foreground">
                    {basePercentualTotal > 0
                      ? formatPercent((totalDeducoes / basePercentualTotal) * 100)
                      : "0,00%"}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {deducoes.map((deducao, index) => {
                  const distribuicao = distribuirRetencaoPorNotas(notasFiscais, deducao.valor);
                  const basePercentual = obterBasePercentual(deducao, resumo.bruto, distribuicao.brutoNotas);
                  const percentualAplicado = basePercentual > 0 ? deducao.valor / basePercentual : 0;
                  const percentualSobreBruto = resumo.bruto > 0 ? deducao.valor / resumo.bruto : percentualAplicado;
                  const aberto = expandedDeducoes.includes(deducao.id);
                  const totalManual = distribuicao.itens.reduce((acc, { nota, retencao }) => {
                    const key = `${deducao.id}-${nota.id}`;
                    const override = retencoesEditadas[key];
                    const valor = override !== undefined ? parseEditableCurrency(override) ?? retencao : retencao;
                    return acc + valor;
                  }, 0);

                  return (
                    <Collapsible
                      key={deducao.id}
                      open={aberto}
                      onOpenChange={() => alternarDeducao(deducao.id)}
                    >
                      <div className="overflow-hidden rounded-2xl border border-glass-border/70 bg-secondary/20">
                        <CollapsibleTrigger asChild>
                          <button className="flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-secondary/30">
                            <div className="flex w-10 items-center justify-center text-muted-foreground">
                              {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                  <div className="text-sm font-semibold text-foreground">
                                    {index + 1}. {deducao.tipo} · {deducao.siafi}
                                  </div>
                                  <div className="mt-1 text-sm text-muted-foreground">
                                    Código {deducao.codigo || "—"} · {distribuicao.itens.length} NF(s) no rateio
                                  </div>
                                </div>
                                <div className="grid gap-3 text-sm md:grid-cols-3 md:text-right">
                                  <div>
                                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                                      Valor da Dedução
                                    </div>
                                    <div className="font-semibold text-foreground">{formatCurrency(deducao.valor)}</div>
                                  </div>
                                  <div>
                                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                                      Percentual Aplicado
                                    </div>
                                    <div className="font-semibold text-foreground">
                                      {formatPercent(percentualSobreBruto * 100)}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                                      Total Manual
                                    </div>
                                    <div className="font-semibold text-foreground">
                                      {formatCurrency(totalManual)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </button>
                        </CollapsibleTrigger>

                        <CollapsibleContent>
                          <div className="border-t border-glass-border/70 px-4 py-4 space-y-4">
                            {/* ── Datas por dedução ── */}
                            <div className="rounded-xl border border-sky-500/20 bg-sky-500/8 px-4 py-3">
                              <div className="mb-3 flex items-center gap-2">
                                <CalendarDays className="h-3.5 w-3.5 text-sky-600" />
                                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                                  Datas desta dedução
                                </span>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                {(["apuracao", "vencimento"] as const).map((campo) => {
                                  const label = campo === "apuracao" ? "Data de Apuração" : "Data de Vencimento";
                                  const placeholder = dates?.[campo] || "DD/MM/AAAA";
                                  const valor = datasDeducoes[deducao.id]?.[campo] ?? "";
                                  return (
                                    <div key={campo}>
                                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        {label}
                                        {!valor && dates?.[campo] && (
                                          <span className="ml-1.5 text-sky-600">(global: {dates[campo]})</span>
                                        )}
                                      </label>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        placeholder={placeholder}
                                        value={valor}
                                        onChange={(e) => {
                                          const novasDatas: DatasDeducao = {
                                            apuracao: datasDeducoes[deducao.id]?.apuracao ?? "",
                                            vencimento: datasDeducoes[deducao.id]?.vencimento ?? "",
                                            [campo]: e.target.value,
                                          };
                                          onDatasDeducaoChange?.(deducao.id, novasDatas);
                                        }}
                                        className="w-full rounded-xl border border-glass-border bg-background/80 px-3 py-2 text-sm text-foreground outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">
                                Deixe em branco para usar as datas globais do documento.
                              </p>
                            </div>

                            {/* ── Rateio de retenções ── */}
                            <div>
                            <div className="mb-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                              <span>Rateio manual proporcional às NFs exibidas.</span>
                              <span>Base do percentual: {formatCurrency(basePercentual)}</span>
                              <span>Base do rateio visual: {formatCurrency(distribuicao.brutoNotas)}</span>
                              <span>% sobre o bruto: {formatPercent(percentualSobreBruto * 100)}</span>
                            </div>

                            <GlassTable
                              headers={["NF", "Tipo", "Emissão", "Valor da NF", "Percentual", "Valor da Retenção"]}
                              className="rounded-xl border border-glass-border/50"
                            >
                              {distribuicao.itens.map(({ nota, percentual, retencao }) => {
                                const key = `${deducao.id}-${nota.id}`;
                                const valorEditado = retencoesEditadas[key] ?? formatEditableCurrency(retencao);

                                return (
                                  <GlassTableRow key={key}>
                                    <GlassTableCell className="font-medium">{nota.nota}</GlassTableCell>
                                    <GlassTableCell>{nota.tipo}</GlassTableCell>
                                    <GlassTableCell>{nota.emissao}</GlassTableCell>
                                    <GlassTableCell>{formatCurrency(nota.valor)}</GlassTableCell>
                                    <GlassTableCell>{formatPercent(percentual * 100)}</GlassTableCell>
                                    <GlassTableCell className="font-semibold text-foreground">
                                      <div className="flex items-center justify-end gap-2">
                                        <span className="text-xs font-normal text-muted-foreground">R$</span>
                                        <input
                                          value={valorEditado}
                                          onChange={(event) => atualizarRetencao(key, event.target.value)}
                                          onBlur={() => normalizarRetencao(key, retencao)}
                                          className="w-24 rounded-md border border-glass-border bg-background/70 px-2 py-1 text-right text-sm font-semibold text-foreground outline-none transition focus:border-primary"
                                          inputMode="decimal"
                                          aria-label={`Valor da retenção da NF ${nota.nota}`}
                                        />
                                      </div>
                                    </GlassTableCell>
                                  </GlassTableRow>
                                );
                              })}
                            </GlassTable>
                            </div>{/* fim rateio */}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              Nenhuma dedução cadastrada
            </div>
          )
        )}
      </div>
    </GlassCard>
  );
}

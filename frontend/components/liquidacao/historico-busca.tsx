"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Calendar,
  ChevronDown,
  ChevronUp,
  CreditCard,
  FileText,
  Loader2,
  Minus,
  Search,
  TriangleAlert,
  User,
} from "lucide-react";
import { GlassButton, GlassTable, GlassTableCell, GlassTableRow } from "@/components/glass-card";

const API = "http://127.0.0.1:8000";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface NotaFiscal {
  numero: string;
  tipo: string;
  emissao: string;
  ateste: string;
  valor: number;
}

interface Deducao {
  codigo: string;
  siafi: string;
  tipo: string;
  valor: number;
  baseCalculo: number;
  status: string;
}

interface Pendencia {
  tipo: string;
  titulo: string;
  descricao: string;
  resolvida: boolean;
}

interface EmpenhoHistorico {
  numero: string;
  situacao: string;
  recurso: string;
  natureza: string;
  valor: number;
  saldo: number;
}

interface Execucao {
  id: number;
  dataExecucao: string | null;
  status: string;
  bruto: number;
  totalDeducoes: number;
  liquido: number;
  lfNumero: string;
  ugrNumero: string;
  vencimentoDocumento: string;
  possuiDivergencia: boolean;
  exigeIntervencao: boolean;
  observacoes: string;
  servidorNome: string;
  servidorSetor: string;
  notasFiscais: NotaFiscal[];
  deducoes: Deducao[];
  pendencias: Pendencia[];
  empenhos: EmpenhoHistorico[];
}

interface Processo {
  numeroProcesso: string;
  cnpj: string;
  fornecedor: string;
  contrato: string;
  natureza: string;
  tipoLiquidacao: string;
  atualizadoEm: string | null;
  execucoes: Execucao[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtData(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDataHora(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function mascaraCnpj(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2}\.\d{3})(\d)/, "$1.$2")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  concluido:  { label: "Concluído",  cls: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20" },
  executando: { label: "Executando", cls: "bg-blue-500/10 text-blue-700 ring-blue-500/20" },
  erro:       { label: "Erro",       cls: "bg-red-500/10 text-red-700 ring-red-500/20" },
  aguardando: { label: "Aguardando", cls: "bg-amber-500/10 text-amber-700 ring-amber-500/20" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status || "—", cls: "bg-secondary/60 text-muted-foreground ring-glass-border" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${s.cls}`}>
      {s.label}
    </span>
  );
}

// ── Sub-componentes de seção ───────────────────────────────────────────────────

function SecaoNotasFiscais({ notas }: { notas: NotaFiscal[] }) {
  if (!notas.length) return <p className="text-xs text-muted-foreground italic">Nenhuma nota fiscal registrada.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-glass-border/50 text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="pb-1.5 pr-4 text-left font-semibold">Nº Nota</th>
            <th className="pb-1.5 pr-4 text-left font-semibold">Tipo</th>
            <th className="pb-1.5 pr-4 text-left font-semibold">Emissão</th>
            <th className="pb-1.5 pr-4 text-left font-semibold">Ateste</th>
            <th className="pb-1.5 text-right font-semibold">Valor</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-glass-border/30">
          {notas.map((nf, i) => (
            <tr key={i} className="text-foreground/90">
              <td className="py-1.5 pr-4 font-mono font-medium">{nf.numero || "—"}</td>
              <td className="py-1.5 pr-4 text-muted-foreground">{nf.tipo || "—"}</td>
              <td className="py-1.5 pr-4">{fmtData(nf.emissao)}</td>
              <td className="py-1.5 pr-4">{fmtData(nf.ateste)}</td>
              <td className="py-1.5 text-right font-medium tabular-nums">{brl(nf.valor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-glass-border/50">
            <td colSpan={4} className="pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total
            </td>
            <td className="pt-1.5 text-right font-bold tabular-nums text-foreground">
              {brl(notas.reduce((s, n) => s + n.valor, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SecaoDeducoes({ deducoes }: { deducoes: Deducao[] }) {
  if (!deducoes.length) return <p className="text-xs text-muted-foreground italic">Nenhuma dedução registrada.</p>;

  const STATUS_DED: Record<string, string> = {
    concluido:  "text-emerald-600",
    erro:       "text-red-600",
    aguardando: "text-amber-600",
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-glass-border/50 text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="pb-1.5 pr-3 text-left font-semibold">Código</th>
            <th className="pb-1.5 pr-3 text-left font-semibold">SIAFI</th>
            <th className="pb-1.5 pr-3 text-left font-semibold">Tipo</th>
            <th className="pb-1.5 pr-3 text-right font-semibold">Base Cálc.</th>
            <th className="pb-1.5 pr-3 text-right font-semibold">Valor</th>
            <th className="pb-1.5 text-left font-semibold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-glass-border/30">
          {deducoes.map((d, i) => (
            <tr key={i} className="text-foreground/90">
              <td className="py-1.5 pr-3 font-mono font-medium">{d.codigo || "—"}</td>
              <td className="py-1.5 pr-3 font-mono text-muted-foreground">{d.siafi || "—"}</td>
              <td className="py-1.5 pr-3">{d.tipo || "—"}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{brl(d.baseCalculo)}</td>
              <td className="py-1.5 pr-3 text-right font-medium tabular-nums">{brl(d.valor)}</td>
              <td className={`py-1.5 text-[10px] font-medium ${STATUS_DED[d.status] ?? "text-muted-foreground"}`}>
                {d.status || "—"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-glass-border/50">
            <td colSpan={4} className="pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total deduções
            </td>
            <td className="pt-1.5 text-right font-bold tabular-nums text-foreground" colSpan={2}>
              {brl(deducoes.reduce((s, d) => s + d.valor, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SecaoEmpenhos({
  exec,
  tipoLiquidacao,
  natureza,
}: {
  exec: Execucao;
  tipoLiquidacao: string;
  natureza: string;
}) {
  const empenhos = exec.empenhos ?? [];

  // Sem empenhos e sem valores: nada a exibir
  if (empenhos.length === 0 && !exec.bruto) {
    return <p className="text-xs text-muted-foreground italic">Nenhum dado de empenho registrado.</p>;
  }

  // Se temos empenhos salvos, exibe cada um
  if (empenhos.length > 0) {
    const liquido    = exec.liquido || 0;
    const brutoTotal = empenhos.reduce((s, e) => s + (e.valor || 0), 0) || exec.bruto || 0;
    const pctUso     = brutoTotal > 0 ? Math.min((liquido / brutoTotal) * 100, 100) : 0;

    return (
      <GlassTable
        compact
        headers={["#", "Empenho", "Sit.", "Natureza", "Valor"]}
        headerTitles={["", "Número do Empenho (NE)", "Situação (DSP)", "Natureza da Despesa", "Valor do Empenho"]}
        className="overflow-x-hidden"
      >
        {empenhos.map((emp, idx) => {
          const isLast = idx === empenhos.length - 1;
          return (
            <GlassTableRow key={idx}>
              <GlassTableCell compact className="w-5 text-center text-xs text-muted-foreground">
                {idx + 1}
              </GlassTableCell>
              {/* Número do Empenho (NE) */}
              <GlassTableCell compact className="whitespace-nowrap font-mono text-xs font-medium">
                {emp.numero || "—"}
              </GlassTableCell>
              {/* Situação */}
              <GlassTableCell compact className="whitespace-nowrap text-xs">
                {emp.situacao || tipoLiquidacao || "—"}
              </GlassTableCell>
              {/* Natureza */}
              <GlassTableCell compact className="whitespace-nowrap text-xs tabular-nums">
                {emp.natureza || natureza || "—"}
              </GlassTableCell>
              {/* Valor + barra de liquidação na última linha */}
              <GlassTableCell compact className="text-right">
                <div className="flex flex-col items-end gap-0.5">
                  <span className="whitespace-nowrap text-xs font-semibold tabular-nums">
                    {emp.valor > 0 ? brl(emp.valor) : "—"}
                  </span>
                  {isLast && brutoTotal > 0 && (
                    <div className="group/bar relative w-full min-w-[60px]">
                      <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-emerald-400/70 transition-all"
                          style={{ width: `${pctUso}%` }}
                        />
                      </div>
                      <div className="pointer-events-none absolute bottom-full right-0 z-10 mb-1.5 hidden whitespace-nowrap rounded-md border border-glass-border bg-background/95 px-2 py-1 text-[11px] text-muted-foreground shadow-lg group-hover/bar:block">
                        Líquido: <span className="font-semibold text-foreground">{brl(liquido)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </GlassTableCell>
            </GlassTableRow>
          );
        })}
      </GlassTable>
    );
  }

  // Fallback: sem empenhos salvos (registros antigos), exibe linha resumida
  const bruto    = exec.bruto || 0;
  const liquido  = exec.liquido || 0;
  const pctUso   = bruto > 0 ? Math.min((liquido / bruto) * 100, 100) : 0;
  const temBarra = bruto > 0;

  return (
    <GlassTable
      compact
      headers={["#", "Empenho", "Sit.", "Natureza", "Valor"]}
      headerTitles={["", "Número do Empenho (NE)", "Situação (DSP)", "Natureza da Despesa", "Valor Bruto"]}
      className="overflow-x-hidden"
    >
      <GlassTableRow>
        {/* # */}
        <GlassTableCell compact className="w-5 text-center text-xs text-muted-foreground">
          1
        </GlassTableCell>
        {/* Empenho — não disponível em registros antigos */}
        <GlassTableCell compact className="whitespace-nowrap font-mono text-xs font-medium">
          —
        </GlassTableCell>
        {/* Situação */}
        <GlassTableCell compact className="whitespace-nowrap text-xs">
          {tipoLiquidacao || "—"}
        </GlassTableCell>
        {/* Natureza */}
        <GlassTableCell compact className="whitespace-nowrap text-xs tabular-nums">
          {natureza || "—"}
        </GlassTableCell>
        {/* Valor + barra */}
        <GlassTableCell compact className="text-right">
          <div className="flex flex-col items-end gap-0.5">
            <span className="whitespace-nowrap text-xs font-semibold tabular-nums">
              {bruto > 0 ? brl(bruto) : "—"}
            </span>
            {temBarra && (
              <div className="group/bar relative w-full min-w-[60px]">
                <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-emerald-400/70 transition-all"
                    style={{ width: `${pctUso}%` }}
                  />
                </div>
                <div className="pointer-events-none absolute bottom-full right-0 z-10 mb-1.5 hidden whitespace-nowrap rounded-md border border-glass-border bg-background/95 px-2 py-1 text-[11px] text-muted-foreground shadow-lg group-hover/bar:block">
                  Líquido: <span className="font-semibold text-foreground">{brl(liquido)}</span>
                </div>
              </div>
            )}
          </div>
        </GlassTableCell>
      </GlassTableRow>
    </GlassTable>
  );
}

function SecaoPendencias({ pendencias }: { pendencias: Pendencia[] }) {
  if (!pendencias.length) return <p className="text-xs text-muted-foreground italic">Nenhuma pendência registrada.</p>;

  const TIPO_CLS: Record<string, string> = {
    bloqueio:   "border-red-400/40 bg-red-500/5 text-red-700",
    divergencia:"border-amber-400/40 bg-amber-500/5 text-amber-700",
    aviso:      "border-blue-400/40 bg-blue-500/5 text-blue-700",
  };

  return (
    <div className="flex flex-col gap-2">
      {pendencias.map((p, i) => {
        const cls = TIPO_CLS[p.tipo] ?? "border-glass-border/60 bg-secondary/20 text-foreground";
        return (
          <div key={i} className={`flex items-start gap-2 rounded-xl border px-3 py-2 ${cls}`}>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
            <div className="min-w-0">
              <p className="text-xs font-semibold">{p.titulo || p.tipo}</p>
              {p.descricao && <p className="mt-0.5 text-[11px] opacity-80">{p.descricao}</p>}
              {p.resolvida && (
                <span className="mt-1 inline-block rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  Resolvida
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Card de uma execução ──────────────────────────────────────────────────────

type Aba = "nfs" | "deducoes" | "empenhos" | "pendencias";

function ExecucaoCard({
  exec,
  defaultOpen,
  tipoLiquidacao,
  natureza,
}: {
  exec: Execucao;
  defaultOpen?: boolean;
  tipoLiquidacao: string;
  natureza: string;
}) {
  const [abaAtiva, setAbaAtiva] = useState<Aba>("nfs");
  const [aberto, setAberto] = useState(defaultOpen ?? false);

  const contadores = {
    nfs:       exec.notasFiscais.length,
    deducoes:  exec.deducoes.length,
    pendencias:exec.pendencias.filter(p => !p.resolvida).length,
  };

  return (
    <div className="rounded-xl border border-glass-border/60 bg-background/40">
      {/* Cabeçalho da execução */}
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={exec.status} />
            <span className="text-[11px] text-muted-foreground">
              {fmtDataHora(exec.dataExecucao)}
            </span>
            {exec.possuiDivergencia && (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-500/20">
                <TriangleAlert className="h-3 w-3" /> Divergência
              </span>
            )}
            {exec.servidorNome && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <User className="h-3 w-3" />{exec.servidorNome}
              </span>
            )}
          </div>

          {/* Valores em linha */}
          <div className="mt-2 flex flex-wrap gap-4">
            <span className="text-xs">
              <span className="text-muted-foreground">Bruto </span>
              <span className="font-semibold tabular-nums text-foreground">{brl(exec.bruto)}</span>
            </span>
            <Minus className="h-3 w-3 self-center text-muted-foreground/40" />
            <span className="text-xs">
              <span className="text-muted-foreground">Deduções </span>
              <span className="font-semibold tabular-nums text-red-600">{brl(exec.totalDeducoes)}</span>
            </span>
            <span className="text-[10px] self-center text-muted-foreground/50">=</span>
            <span className="text-xs">
              <span className="text-muted-foreground">Líquido </span>
              <span className="font-bold tabular-nums text-emerald-700">{brl(exec.liquido)}</span>
            </span>
          </div>
        </div>
        {aberto
          ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        }
      </button>

      {/* Conteúdo expandido */}
      {aberto && (
        <div className="border-t border-glass-border/40 px-4 pb-4 pt-3">
          {/* Abas */}
          <div className="mb-3 flex gap-1 overflow-x-auto">
            {(["nfs", "deducoes", "empenhos", "pendencias"] as Aba[]).map(aba => {
              const LABELS: Record<Aba, string> = {
                nfs: "Notas Fiscais",
                deducoes: "Deduções",
                empenhos: "Empenhos",
                pendencias: "Pendências",
              };
              const ICONS: Record<Aba, React.ReactNode> = {
                nfs:       <FileText className="h-3 w-3" />,
                deducoes:  <CreditCard className="h-3 w-3" />,
                empenhos:  <Calendar className="h-3 w-3" />,
                pendencias:<AlertTriangle className="h-3 w-3" />,
              };
              const contador =
                aba === "nfs" ? contadores.nfs :
                aba === "deducoes" ? contadores.deducoes :
                aba === "pendencias" ? contadores.pendencias :
                null;

              const ativa = abaAtiva === aba;
              return (
                <button
                  key={aba}
                  type="button"
                  onClick={() => setAbaAtiva(aba)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                    ativa
                      ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  }`}
                >
                  {ICONS[aba]}
                  {LABELS[aba]}
                  {contador !== null && contador > 0 && (
                    <span className={`rounded-full px-1.5 text-[10px] font-bold ${
                      ativa ? "bg-primary/20 text-primary" : "bg-secondary/80 text-muted-foreground"
                    }`}>
                      {contador}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Conteúdo da aba */}
          <div className="pt-1">
            {abaAtiva === "nfs"       && <SecaoNotasFiscais notas={exec.notasFiscais} />}
            {abaAtiva === "deducoes"  && <SecaoDeducoes deducoes={exec.deducoes} />}
            {abaAtiva === "empenhos"  && <SecaoEmpenhos exec={exec} tipoLiquidacao={tipoLiquidacao} natureza={natureza} />}
            {abaAtiva === "pendencias"&& <SecaoPendencias pendencias={exec.pendencias} />}
          </div>

        </div>
      )}
    </div>
  );
}

// ── Card de um processo ───────────────────────────────────────────────────────

function ProcessoCard({ processo }: { processo: Processo }) {
  const [expandido, setExpandido] = useState(false);
  const exec = processo.execucoes[0]; // mais recente

  return (
    <div className="rounded-2xl border border-glass-border/70 bg-background/50 overflow-hidden">
      {/* Cabeçalho do processo */}
      <button
        type="button"
        onClick={() => setExpandido(v => !v)}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-secondary/10 transition-colors"
      >
        <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-foreground">
              {processo.numeroProcesso}
            </span>
            {exec && <StatusBadge status={exec.status} />}
            {processo.execucoes.length > 1 && (
              <span className="rounded-full bg-secondary/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {processo.execucoes.length} execuções
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {processo.fornecedor || "Fornecedor não identificado"}
          </p>
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            {processo.contrato && (
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" /> {processo.contrato}
              </span>
            )}
            {processo.natureza && (
              <span>{processo.natureza}</span>
            )}
            {exec?.dataExecucao && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" /> {fmtData(exec.dataExecucao)}
              </span>
            )}
          </div>
          {/* Resumo de valores da última execução */}
          {exec && (
            <div className="mt-2 flex flex-wrap gap-4">
              <span className="text-xs">
                <span className="text-muted-foreground">Bruto </span>
                <span className="font-semibold tabular-nums">{brl(exec.bruto)}</span>
              </span>
              <span className="text-xs">
                <span className="text-muted-foreground">Deduções </span>
                <span className="font-semibold tabular-nums text-red-600">{brl(exec.totalDeducoes)}</span>
              </span>
              <span className="text-xs">
                <span className="text-muted-foreground">Líquido </span>
                <span className="font-bold tabular-nums text-emerald-700">{brl(exec.liquido)}</span>
              </span>
            </div>
          )}
        </div>
        {expandido
          ? <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          : <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
        }
      </button>

      {/* Execuções expandidas */}
      {expandido && (
        <div className="border-t border-glass-border/40 flex flex-col gap-2 p-3">
          {processo.execucoes.map((exec, idx) => (
            <ExecucaoCard
              key={exec.id}
              exec={exec}
              defaultOpen={idx === 0}
              tipoLiquidacao={processo.tipoLiquidacao || ""}
              natureza={processo.natureza || ""}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Normalização de número de processo (exibe ao usuário) ────────────────────

function normalizarNumeroProcesso(texto: string): string {
  const s = texto.trim().replace(/^\d{4,6}\./, ""); // remove prefixo UORG
  const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return s;
  const num = m[1].padStart(6, "0");
  const ano = m[2].length === 2 ? "20" + m[2] : m[2];
  return `${num}/${ano}`;
}

// ── Componente principal ──────────────────────────────────────────────────────

type Modo = "cnpj" | "processo" | "contrato" | "empenho";

const MODO_LABELS: Record<Modo, string> = {
  cnpj: "CNPJ",
  processo: "Processo",
  contrato: "Contrato",
  empenho: "Empenho",
};

export function HistoricoBusca({
  buscaInicial,
  buscaInicialCnpj,
}: {
  buscaInicial?: string | null;
  buscaInicialCnpj?: { cnpj: string; contrato?: string } | null;
}) {
  const [modo, setModo] = useState<Modo>("cnpj");
  const [cnpj, setCnpj] = useState("");
  const [contrato, setContrato] = useState("");
  const [empenho, setEmpenho] = useState("");
  const [numeroProcesso, setNumeroProcesso] = useState("");
  const buscaInicialProcessadaRef = useRef<string | null | undefined>(undefined);
  const buscaInicialCnpjKeyRef = useRef<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<{ processos: Processo[]; total: number } | null>(null);
  const [filtroContrato, setFiltroContrato] = useState<string>("__todos__");

  // Extrai contratos únicos dos resultados para filtro pós-busca
  const contratosUnicos: string[] = resultado
    ? [...new Set(resultado.processos.map(p => p.contrato || ""))]
        .sort()
    : [];
  const mostrarFiltroContrato =
    resultado !== null &&
    contratosUnicos.length > 1;

  const processosFiltrados = resultado
    ? filtroContrato === "__todos__"
      ? resultado.processos
      : resultado.processos.filter(p => (p.contrato || "") === filtroContrato)
    : [];

  // Auto-busca por CNPJ (+contrato opcional) quando vem da fila
  useEffect(() => {
    if (!buscaInicialCnpj) return;
    const chave = JSON.stringify(buscaInicialCnpj);
    if (chave === buscaInicialCnpjKeyRef.current) return;
    buscaInicialCnpjKeyRef.current = chave;

    const cnpjLimpo = buscaInicialCnpj.cnpj.replace(/\D/g, "");
    if (cnpjLimpo.length !== 14) return;

    setModo("cnpj");
    setCnpj(cnpjLimpo);
    setContrato(buscaInicialCnpj.contrato ?? "");
    setEmpenho("");
    setNumeroProcesso("");
    setErro("");
    setResultado(null);
    setFiltroContrato("__todos__");
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`${API}/api/historico/buscar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cnpj: cnpjLimpo, contrato: buscaInicialCnpj.contrato ?? "" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = data.detail;
          const msg = Array.isArray(detail)
            ? detail.map((e: { msg?: string }) => e.msg ?? JSON.stringify(e)).join("; ")
            : typeof detail === "string" ? detail : `Erro HTTP ${res.status}`;
          throw new Error(msg);
        }
        setResultado({ processos: data.processos ?? [], total: data.total ?? 0 });
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao buscar.");
      } finally {
        setLoading(false);
      }
    })();
  }, [buscaInicialCnpj]);

  // Auto-busca quando buscaInicial é fornecido (ex: clique no dashboard)
  useEffect(() => {
    if (!buscaInicial || buscaInicial === buscaInicialProcessadaRef.current) return;
    buscaInicialProcessadaRef.current = buscaInicial;
    setModo("processo");
    setNumeroProcesso(buscaInicial);
    setEmpenho("");
    setErro("");
    setResultado(null);
    setFiltroContrato("__todos__");
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`${API}/api/historico/buscar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ numero_processo: buscaInicial }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = data.detail;
          const msg = Array.isArray(detail)
            ? detail.map((e: { msg?: string }) => e.msg ?? JSON.stringify(e)).join("; ")
            : typeof detail === "string" ? detail : `Erro HTTP ${res.status}`;
          throw new Error(msg);
        }
        setResultado({ processos: data.processos ?? [], total: data.total ?? 0 });
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao buscar.");
      } finally {
        setLoading(false);
      }
    })();
  }, [buscaInicial]);

  const buscar = async () => {
    setErro("");

    if (modo === "cnpj") {
      const limpo = cnpj.replace(/\D/g, "");
      if (limpo.length !== 14) { setErro("Informe os 14 dígitos do CNPJ."); return; }
    } else if (modo === "processo") {
      if (!numeroProcesso.trim()) { setErro("Informe o número do processo."); return; }
    } else if (modo === "contrato") {
      if (!contrato.trim()) { setErro("Informe o número do contrato."); return; }
    } else {
      if (!empenho.trim()) { setErro("Informe o número do empenho."); return; }
    }

    setLoading(true);
    setResultado(null);
    setFiltroContrato("__todos__");

    try {
      const body =
        modo === "cnpj"
          ? { cnpj: cnpj.replace(/\D/g, ""), contrato: contrato.trim() }
          : modo === "processo"
            ? { numero_processo: numeroProcesso.trim() }
            : modo === "contrato"
              ? { contrato: contrato.trim() }
              : { empenho: empenho.trim() };

      const res = await fetch(`${API}/api/historico/buscar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.detail;
        const msg = Array.isArray(detail)
          ? detail.map((e: { msg?: string }) => e.msg ?? JSON.stringify(e)).join("; ")
          : typeof detail === "string" ? detail : `Erro HTTP ${res.status}`;
        throw new Error(msg);
      }
      setResultado({ processos: data.processos ?? [], total: data.total ?? 0 });
    } catch (e) {
      setErro(
        e instanceof TypeError && e.message.includes("fetch")
          ? "Servidor indisponível — reinicie o AutoLiquid."
          : e instanceof Error ? e.message : "Erro ao buscar."
      );
    } finally {
      setLoading(false);
    }
  };

  const limpar = () => {
    setCnpj(""); setContrato(""); setEmpenho(""); setNumeroProcesso("");
    setErro(""); setResultado(null); setFiltroContrato("__todos__");
  };

  const trocarModo = (novo: Modo) => {
    setModo(novo); limpar();
  };

  return (
    <div className="rounded-2xl border border-glass-border/70 bg-background/55 p-4">
      {/* Cabeçalho + toggle */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Histórico de Processos
        </p>
        <div className="flex rounded-lg border border-glass-border bg-secondary/30 p-0.5 text-[11px] font-semibold">
          {(["cnpj", "processo", "contrato", "empenho"] as Modo[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => trocarModo(m)}
              className={`rounded-md px-3 py-1 transition-colors ${
                modo === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {MODO_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Campos de busca */}
      <div className="flex flex-col gap-2 sm:flex-row">
        {modo === "cnpj" ? (
          <>
            <input
              value={cnpj}
              onChange={e => { setCnpj(mascaraCnpj(e.target.value)); setErro(""); }}
              onKeyDown={e => e.key === "Enter" && void buscar()}
              placeholder="CNPJ do fornecedor"
              disabled={loading}
              className="flex-1 rounded-xl border border-glass-border bg-background/80 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 font-mono tracking-wider disabled:opacity-50"
            />
            <input
              value={contrato}
              onChange={e => setContrato(e.target.value)}
              onKeyDown={e => e.key === "Enter" && void buscar()}
              placeholder="Contrato (opcional)"
              disabled={loading}
              className="w-full sm:w-44 rounded-xl border border-glass-border bg-background/80 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
            />
          </>
        ) : modo === "processo" ? (
          <input
            value={numeroProcesso}
            onChange={e => { setNumeroProcesso(e.target.value); setErro(""); }}
            onKeyDown={e => e.key === "Enter" && void buscar()}
            placeholder="017645/2026 ou 17645/26"
            disabled={loading}
            className="flex-1 rounded-xl border border-glass-border bg-background/80 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 font-mono tracking-wider disabled:opacity-50"
          />
        ) : modo === "contrato" ? (
          <input
            value={contrato}
            onChange={e => { setContrato(e.target.value); setErro(""); }}
            onKeyDown={e => e.key === "Enter" && void buscar()}
            placeholder="Número do contrato"
            disabled={loading}
            className="flex-1 rounded-xl border border-glass-border bg-background/80 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 font-mono tracking-wider disabled:opacity-50"
          />
        ) : (
          <input
            value={empenho}
            onChange={e => { setEmpenho(e.target.value); setErro(""); }}
            onKeyDown={e => e.key === "Enter" && void buscar()}
            placeholder="Número do empenho"
            disabled={loading}
            className="flex-1 rounded-xl border border-glass-border bg-background/80 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 font-mono tracking-wider disabled:opacity-50"
          />
        )}
        <GlassButton
          type="button" variant="secondary" size="sm"
          onClick={() => void buscar()} disabled={loading} className="shrink-0"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {loading ? "Buscando…" : "Buscar"}
        </GlassButton>
        {resultado && (
          <GlassButton type="button" variant="ghost" size="sm" onClick={limpar} className="shrink-0">
            Limpar
          </GlassButton>
        )}
      </div>

      {erro && <p className="mt-2 text-xs text-destructive">{erro}</p>}

      {/* Filtro de contrato pós-resultado */}
      {mostrarFiltroContrato && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["__todos__", ...contratosUnicos].map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setFiltroContrato(c)}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold ring-1 ring-inset transition-colors ${
                filtroContrato === c
                  ? "bg-primary/10 text-primary ring-primary/30"
                  : "bg-secondary/40 text-muted-foreground ring-glass-border hover:text-foreground"
              }`}
            >
              {c === "__todos__" ? "Todos" : c || "Sem contrato"}
            </button>
          ))}
        </div>
      )}

      {/* Resultados */}
      {resultado && (
        <div className="mt-4">
          {processosFiltrados.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
              <Search className="h-8 w-8 opacity-30" />
              <p className="text-sm font-medium">Nenhum processo encontrado</p>
              <p className="text-xs opacity-70">
                {modo === "cnpj"
                  ? "Verifique o CNPJ ou tente sem filtro de contrato."
                  : modo === "processo"
                    ? `Nenhum resultado para "${normalizarNumeroProcesso(numeroProcesso)}".`
                    : modo === "contrato"
                      ? `Nenhum resultado para o contrato "${contrato.trim()}".`
                      : `Nenhum resultado para o empenho "${empenho.trim()}".`}
              </p>
            </div>
          ) : (
            <>
              <p className="mb-2 text-[11px] text-muted-foreground">
                {processosFiltrados.length} processo{processosFiltrados.length !== 1 ? "s" : ""} encontrado{processosFiltrados.length !== 1 ? "s" : ""}
                {filtroContrato !== "__todos__" && ` · ${filtroContrato || "sem contrato"}`}
              </p>
              <div className="flex flex-col gap-2">
                {processosFiltrados.map((p, index) => (
                  <ProcessoCard key={`${p.numeroProcesso}-${p.contrato}-${index}`} processo={p} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

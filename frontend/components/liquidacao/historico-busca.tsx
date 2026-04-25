"use client";

import { useState } from "react";
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
import { GlassButton } from "@/components/glass-card";

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

function SecaoEmpenhos({ exec }: { exec: Execucao }) {
  const temInfo = exec.lfNumero || exec.ugrNumero || exec.vencimentoDocumento;
  if (!temInfo) return <p className="text-xs text-muted-foreground italic">Nenhum dado de empenho registrado.</p>;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {exec.lfNumero && (
        <div className="rounded-xl border border-glass-border/60 bg-background/50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">LF / Empenho</p>
          <p className="mt-0.5 font-mono text-sm font-medium text-foreground">{exec.lfNumero}</p>
        </div>
      )}
      {exec.ugrNumero && (
        <div className="rounded-xl border border-glass-border/60 bg-background/50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">UGR</p>
          <p className="mt-0.5 font-mono text-sm font-medium text-foreground">{exec.ugrNumero}</p>
        </div>
      )}
      {exec.vencimentoDocumento && (
        <div className="rounded-xl border border-glass-border/60 bg-background/50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Vencimento</p>
          <p className="mt-0.5 text-sm font-medium text-foreground">{exec.vencimentoDocumento}</p>
        </div>
      )}
    </div>
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

function ExecucaoCard({ exec, defaultOpen }: { exec: Execucao; defaultOpen?: boolean }) {
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
            {abaAtiva === "empenhos"  && <SecaoEmpenhos exec={exec} />}
            {abaAtiva === "pendencias"&& <SecaoPendencias pendencias={exec.pendencias} />}
          </div>

          {/* Observações */}
          {exec.observacoes && (
            <p className="mt-3 text-[11px] italic text-muted-foreground">
              <span className="font-semibold not-italic">Obs:</span> {exec.observacoes}
            </p>
          )}
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
            <ExecucaoCard key={exec.id} exec={exec} defaultOpen={idx === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export function HistoricoBusca() {
  const [cnpj, setCnpj] = useState("");
  const [contrato, setContrato] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<{ processos: Processo[]; total: number } | null>(null);

  const buscar = async () => {
    const limpo = cnpj.replace(/\D/g, "");
    if (limpo.length !== 14) { setErro("Informe os 14 dígitos do CNPJ."); return; }
    setLoading(true);
    setErro("");
    setResultado(null);

    try {
      const res = await fetch(`${API}/api/historico/buscar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnpj: limpo, contrato: contrato.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.detail || `Erro HTTP ${res.status}`);
      }
      setResultado({ processos: body.processos ?? [], total: body.total ?? 0 });
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
    setCnpj("");
    setContrato("");
    setErro("");
    setResultado(null);
  };

  return (
    <div className="rounded-2xl border border-glass-border/70 bg-background/55 p-4">
      {/* Título */}
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Histórico de Processos
      </p>

      {/* Campos de busca */}
      <div className="flex flex-col gap-2 sm:flex-row">
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
          className="w-full sm:w-48 rounded-xl border border-glass-border bg-background/80 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
        />
        <GlassButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void buscar()}
          disabled={loading}
          className="shrink-0"
        >
          {loading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Search className="h-4 w-4" />
          }
          {loading ? "Buscando…" : "Buscar"}
        </GlassButton>
        {resultado && (
          <GlassButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={limpar}
            className="shrink-0"
          >
            Limpar
          </GlassButton>
        )}
      </div>

      {erro && <p className="mt-2 text-xs text-destructive">{erro}</p>}

      {/* Resultados */}
      {resultado && (
        <div className="mt-4">
          {resultado.total === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
              <Search className="h-8 w-8 opacity-30" />
              <p className="text-sm font-medium">Nenhum processo encontrado</p>
              <p className="text-xs opacity-70">
                Verifique o CNPJ ou tente sem filtro de contrato.
              </p>
            </div>
          ) : (
            <>
              <p className="mb-2 text-[11px] text-muted-foreground">
                {resultado.total} processo{resultado.total !== 1 ? "s" : ""} encontrado{resultado.total !== 1 ? "s" : ""}
              </p>
              <div className="flex flex-col gap-2">
                {resultado.processos.map(p => (
                  <ProcessoCard key={p.numeroProcesso} processo={p} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

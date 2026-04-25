"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { GlassButton } from "@/components/glass-card";

const API = "http://127.0.0.1:8000";

function mascaraCnpj(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2}\.\d{3})(\d)/, "$1.$2")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

interface SimplesResult {
  razaoSocial: string;
  optanteSimples: boolean | null;
}

export function CnpjChecker() {
  const [cnpj, setCnpj] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimplesResult | null>(null);
  const [erro, setErro] = useState("");

  const consultar = async () => {
    const limpo = cnpj.replace(/\D/g, "");
    if (limpo.length !== 14) { setErro("Informe os 14 dígitos do CNPJ."); return; }
    setLoading(true);
    setErro("");
    setResult(null);
    try {
      const res = await fetch(`${API}/api/simples/consultar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnpj: limpo }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 404) throw new Error("CNPJ não encontrado na base da Receita Federal.");
        if (res.status === 422) throw new Error(body.detail || "CNPJ inválido.");
        throw new Error(body.detail || `Erro ao consultar (HTTP ${res.status}).`);
      }
      const data = await res.json();
      setResult(data);
    } catch (e) {
      if (e instanceof TypeError && e.message.includes("fetch")) {
        setErro("Servidor indisponível — reinicie o AutoLiquid.");
      } else {
        setErro(e instanceof Error ? e.message : "Erro ao consultar.");
      }
    } finally {
      setLoading(false);
    }
  };

  const simplesLabel =
    result?.optanteSimples === true  ? { text: "Simples Nacional",       cls: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20" } :
    result?.optanteSimples === false ? { text: "Não optante",            cls: "bg-secondary/60 text-muted-foreground ring-glass-border" } :
    result                           ? { text: "Status não identificado", cls: "bg-amber-500/10 text-amber-700 ring-amber-500/20" } :
    null;

  return (
    <div className="rounded-2xl border border-glass-border/70 bg-background/55 p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Consulta CNPJ / Simples
      </p>
      <div className="flex gap-2">
        <input
          value={cnpj}
          onChange={(e) => { setCnpj(mascaraCnpj(e.target.value)); setErro(""); setResult(null); }}
          onKeyDown={(e) => e.key === "Enter" && void consultar()}
          placeholder="00.000.000/0000-00"
          className="flex-1 rounded-xl border border-glass-border bg-background/80 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 font-mono tracking-wider"
        />
        <GlassButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void consultar()}
          disabled={loading}
          className="shrink-0"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {loading ? "Consultando..." : "Consultar"}
        </GlassButton>
      </div>

      {erro && <p className="mt-2 text-xs text-destructive">{erro}</p>}

      {result && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-glass-border/60 bg-secondary/20 px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {result.razaoSocial || "Razão social não encontrada"}
          </span>
          {simplesLabel && (
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${simplesLabel.cls}`}>
              {simplesLabel.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

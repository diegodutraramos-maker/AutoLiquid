"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
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
  fonte?: string; // "cache" | "historico" | "historico_expirado" | "api"
}

type Estado =
  | { tipo: "idle" }
  | { tipo: "loading"; mensagem: string }
  | { tipo: "resultado"; data: SimplesResult }
  | { tipo: "erro"; mensagem: string };

export function CnpjChecker() {
  const [cnpj, setCnpj] = useState("");
  const [estado, setEstado] = useState<Estado>({ tipo: "idle" });
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Limpa timer ao desmontar
  useEffect(() => () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); }, []);

  const chamarApi = async (cnpjLimpo: string): Promise<SimplesResult | null> => {
    const res = await fetch(`${API}/api/simples/consultar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cnpj: cnpjLimpo }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 404) throw new Error("CNPJ não encontrado na base da Receita Federal.");
      if (res.status === 422) throw new Error(body.detail || "CNPJ inválido.");
      throw new Error(body.detail || `Erro ao consultar (HTTP ${res.status}).`);
    }
    return res.json() as Promise<SimplesResult>;
  };

  const consultar = async (cnpjLimpo?: string, isAutoRetry = false) => {
    const limpo = cnpjLimpo ?? cnpj.replace(/\D/g, "");
    if (limpo.length !== 14) {
      setEstado({ tipo: "erro", mensagem: "Informe os 14 dígitos do CNPJ." });
      return;
    }

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    setEstado({
      tipo: "loading",
      mensagem: isAutoRetry ? "Verificando novamente…" : "Consultando…",
    });

    try {
      const data = await chamarApi(limpo);
      if (!data) return;

      setEstado({ tipo: "resultado", data });

      // Se o backend ainda não conseguiu o status do Simples, agenda 1 auto-retry
      if (data.optanteSimples === null && !isAutoRetry) {
        retryTimerRef.current = setTimeout(() => {
          void consultar(limpo, true);
        }, 2000);
      }
    } catch (e) {
      const msg =
        e instanceof TypeError && e.message.includes("fetch")
          ? "Servidor indisponível — reinicie o AutoLiquid."
          : e instanceof Error
          ? e.message
          : "Erro ao consultar.";
      setEstado({ tipo: "erro", mensagem: msg });
    }
  };

  const simplesLabel = (data: SimplesResult) => {
    const expirado = data.fonte === "historico_expirado";
    if (data.optanteSimples === true)
      return {
        text: expirado ? "Simples Nacional *" : "Simples Nacional",
        cls: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20",
        expirado,
      };
    if (data.optanteSimples === false)
      return {
        text: expirado ? "Não optante *" : "Não optante",
        cls: "bg-secondary/60 text-muted-foreground ring-glass-border",
        expirado,
      };
    return null;
  };

  const carregando = estado.tipo === "loading";

  return (
    <div className="rounded-2xl border border-glass-border/70 bg-background/55 p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Consulta CNPJ / Simples
      </p>

      <div className="flex gap-2">
        <input
          value={cnpj}
          onChange={(e) => {
            setCnpj(mascaraCnpj(e.target.value));
            setEstado({ tipo: "idle" });
            if (retryTimerRef.current) {
              clearTimeout(retryTimerRef.current);
              retryTimerRef.current = null;
            }
          }}
          onKeyDown={(e) => e.key === "Enter" && void consultar()}
          placeholder="00.000.000/0000-00"
          className="flex-1 rounded-xl border border-glass-border bg-background/80 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 font-mono tracking-wider"
          disabled={carregando}
        />
        <GlassButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void consultar()}
          disabled={carregando}
          className="shrink-0"
        >
          {carregando
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Search className="h-4 w-4" />}
          {carregando
            ? (estado.tipo === "loading" ? estado.mensagem : "Consultando…")
            : "Consultar"}
        </GlassButton>
      </div>

      {estado.tipo === "erro" && (
        <p className="mt-2 text-xs text-destructive">{estado.mensagem}</p>
      )}

      {estado.tipo === "resultado" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-glass-border/60 bg-secondary/20 px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {estado.data.razaoSocial || "Razão social não encontrada"}
          </span>

          {estado.data.optanteSimples !== null ? (
            /* Badge definitivo */
            (() => {
              const lbl = simplesLabel(estado.data);
              return lbl ? (
                <span
                  title={lbl.expirado ? "Dado com mais de 30 dias — re-verificar" : undefined}
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${lbl.cls} ${lbl.expirado ? "opacity-70" : ""}`}
                >
                  {lbl.text}
                </span>
              ) : null;
            })()
          ) : (
            /* Aguardando auto-retry */
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-500/20">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Verificando…
            </span>
          )}
        </div>
      )}

      {/* Fallback após auto-retry — status ainda indisponível */}
      {estado.tipo === "resultado" &&
        estado.data.optanteSimples === null &&
        !retryTimerRef.current && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Status não identificado nas fontes externas.{" "}
            <button
              type="button"
              onClick={() => void consultar()}
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Tentar novamente
            </button>
          </p>
        )}

      {/* Aviso de dado expirado (>30 dias) */}
      {estado.tipo === "resultado" &&
        estado.data.fonte === "historico_expirado" && (
          <p className="mt-1.5 text-[11px] text-amber-600/80">
            * Dado com mais de 30 dias — APIs externas indisponíveis no momento.{" "}
            <button
              type="button"
              onClick={() => void consultar()}
              className="underline underline-offset-2 hover:text-amber-700 transition-colors"
            >
              Atualizar
            </button>
          </p>
        )}
    </div>
  );
}

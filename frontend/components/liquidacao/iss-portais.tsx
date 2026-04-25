"use client";

import { ExternalLink } from "lucide-react";

const API = "http://127.0.0.1:8000";

async function abrirUrl(url: string) {
  try {
    await fetch(`${API}/api/abrir-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {
    // silencia erros de rede
  }
}

const MUNICIPIOS = [
  { nome: "Curitibanos",            url: "https://e-gov.betha.com.br/livroeletronico2/02022-064/login.faces?lastUrl=/contribuinte/main.faces" },
  { nome: "Araranguá",              url: "https://ararangua.atende.net/autoatendimento/servicos/nfse" },
  { nome: "Balneário Barra do Sul", url: "https://nfse-balneariobarradosul.atende.net/autoatendimento/servicos/nfse?redirected=1" },
  { nome: "Gov. Celso Ramos",       url: "https://www.prefeituramoderna.com.br/" },
] as const;

export function IssPortais() {
  return (
    <div className="rounded-2xl border border-glass-border/70 bg-background/55 p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Portais ISS Municipal
      </p>
      <div className="flex flex-wrap gap-2">
        {MUNICIPIOS.map(({ nome, url }) => (
          <button
            key={nome}
            type="button"
            onClick={() => void abrirUrl(url)}
            className="flex items-center gap-1.5 rounded-xl border border-glass-border bg-background/60 px-3 py-2 text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {nome}
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { saveAppSettings, fetchAppSettings } from "@/lib/data";

interface WelcomeScreenProps {
  onConcluido: (nome: string) => void;
}

export function WelcomeScreen({ onConcluido }: WelcomeScreenProps) {
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [visivel, setVisivel] = useState(false);

  // Fade-in suave ao montar
  useEffect(() => {
    const t = setTimeout(() => setVisivel(true), 30);
    return () => clearTimeout(t);
  }, []);

  const confirmar = async () => {
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) {
      setErro("Informe seu nome para continuar.");
      return;
    }

    setSalvando(true);
    setErro("");
    try {
      const atual = await fetchAppSettings();
      await saveAppSettings({ ...atual, nomeUsuario: nomeLimpo });
      // Fade-out antes de chamar callback
      setVisivel(false);
      setTimeout(() => onConcluido(nomeLimpo), 350);
    } catch {
      setErro("Não foi possível salvar. Tente novamente.");
      setSalvando(false);
    }
  };

  return (
    <div
      className={[
        "fixed inset-0 z-[200] flex items-center justify-center bg-background/90 backdrop-blur-sm",
        "transition-opacity duration-300",
        visivel ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <div
        className={[
          "mx-4 w-full max-w-sm rounded-3xl border border-glass-border bg-background/95 p-8 shadow-2xl",
          "transition-all duration-300",
          visivel ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
        ].join(" ")}
      >
        {/* Ícone */}
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-[0_16px_40px_-20px_rgba(79,70,229,0.5)]">
            <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
          </div>
        </div>

        {/* Texto */}
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-foreground">Bem-vindo ao AutoLiquid</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Como você quer ser identificado nos registros?
          </p>
        </div>

        {/* Input */}
        <div className="mb-2">
          <input
            type="text"
            value={nome}
            onChange={(e) => { setNome(e.target.value); setErro(""); }}
            onKeyDown={(e) => e.key === "Enter" && void confirmar()}
            placeholder="Seu nome completo"
            autoFocus
            className="w-full rounded-xl border border-glass-border bg-secondary/30 px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/60"
          />
          {erro && (
            <p className="mt-1.5 text-xs text-destructive">{erro}</p>
          )}
        </div>

        {/* Botão */}
        <button
          type="button"
          onClick={() => void confirmar()}
          disabled={salvando}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-[0_8px_20px_-8px_rgba(79,70,229,0.7)] transition hover:brightness-110 disabled:opacity-60"
        >
          {salvando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              Começar
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Você pode alterar isso depois nas Configurações.
        </p>
      </div>
    </div>
  );
}

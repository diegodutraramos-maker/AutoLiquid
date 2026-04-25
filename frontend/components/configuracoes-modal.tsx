"use client";

import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  CalendarDays,
  Check,
  CheckCircle2,
  Chrome,
  Coffee,
  Copy,
  Database,
  ExternalLink,
  Globe,
  Loader2,
  Moon,
  Play,
  RefreshCw,
  Save,
  Settings,
  Settings2,
  Sun,
  Tag,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { GlassButton, GlassCard } from "./glass-card";
import {
  fetchAppSettings,
  openChromeSession,
  recarregarModulos,
  saveAppSettings,
  verificarAtualizacao,
  abrirUrl,
  type AppSettings,
  type VersaoInfo,
} from "@/lib/data";

interface ConfiguracoesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (settings: AppSettings) => void;
  onChromeOpened?: () => void;
  onOpenDatas?: () => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  chromePorta: 9222,
  navegador: "chrome",
  perguntarLimparMes: true,
  temaWeb: "light",
  nivelLog: "desenvolvedor",
};

const SUPABASE_PROJECT_URL = "https://supabase.com/dashboard/project/fxffsintfysatyglcmmi";

type Aba = "basico" | "avancado";

export function ConfiguracoesModal({
  isOpen,
  onClose,
  onSaved,
  onChromeOpened,
  onOpenDatas,
}: ConfiguracoesModalProps) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [abaAtiva, setAbaAtiva] = useState<Aba>("basico");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");
  const [pixCopiado, setPixCopiado] = useState(false);
  const [abrindoNavegador, setAbrindoNavegador] = useState(false);
  const [recarregando, setRecarregando] = useState(false);
  const [msgRecarregar, setMsgRecarregar] = useState("");

  // Debug avançado
  const [detectando, setDetectando] = useState(false);
  const [relatorioCopiado, setRelatorioCopiado] = useState(false);
  const [erroDeteccao, setErroDeteccao] = useState("");
  const [relatorioTexto, setRelatorioTexto] = useState("");

  // Atualização
  const [verificandoUpdate, setVerificandoUpdate] = useState(false);
  const [infoUpdate, setInfoUpdate] = useState<VersaoInfo | null>(null);
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let ativo = true;
    setAbaAtiva("basico");
    setInfoUpdate(null);

    const carregar = async () => {
      setLoading(true);
      setErro("");
      setPixCopiado(false);

      try {
        const data = await fetchAppSettings();
        if (!ativo) return;
        setSettings({ ...DEFAULT_SETTINGS, ...data });
      } catch (error) {
        if (!ativo) return;
        setErro(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar as configurações."
        );
      } finally {
        if (ativo) setLoading(false);
      }
    };

    carregar();
    return () => { ativo = false; };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopiarPix = async () => {
    try {
      await navigator.clipboard.writeText("111.779.619-11");
      setPixCopiado(true);
    } catch {
      setPixCopiado(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setErro("");
    try {
      const saved = await saveAppSettings(settings);
      setSettings(saved);
      setTheme(saved.temaWeb);
      onSaved?.(saved);
      onClose();
    } catch (error) {
      setErro(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar as configurações."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRecarregar = async () => {
    setRecarregando(true);
    setMsgRecarregar("");
    setErro("");
    try {
      const res = await recarregarModulos();
      setMsgRecarregar(res.mensagem);
    } catch (error) {
      setErro(
        error instanceof Error
          ? error.message
          : "Não foi possível recarregar os módulos."
      );
    } finally {
      setRecarregando(false);
    }
  };

  const copiarTexto = (texto: string) => {
    // Tenta clipboard moderno; fallback via textarea + execCommand
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(texto).catch(() => copiarViaExecCommand(texto));
    } else {
      copiarViaExecCommand(texto);
    }
  };

  const copiarViaExecCommand = (texto: string) => {
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand("copy"); } catch (_) { /* silencia */ }
    document.body.removeChild(ta);
  };

  const handleDetectarPaginacao = async () => {
    setDetectando(true);
    setErroDeteccao("");
    setRelatorioCopiado(false);
    setRelatorioTexto("");
    try {
      const res = await fetch("http://127.0.0.1:8000/api/debug/detectar-paginacao", {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Erro desconhecido");
      }
      const data = await res.json();
      const texto = JSON.stringify(data.relatorio ?? data, null, 2);
      setRelatorioTexto(texto);
      copiarTexto(texto);
      setRelatorioCopiado(true);
      setTimeout(() => setRelatorioCopiado(false), 3000);
    } catch (error) {
      setErroDeteccao(
        error instanceof Error ? error.message : "Falha ao detectar campos."
      );
    } finally {
      setDetectando(false);
    }
  };

  const handleAbrirNavegador = async () => {
    setAbrindoNavegador(true);
    setErro("");
    try {
      await openChromeSession();
      await onChromeOpened?.();
    } catch (error) {
      setErro(
        error instanceof Error
          ? error.message
          : "Não foi possível abrir o navegador."
      );
    } finally {
      setAbrindoNavegador(false);
    }
  };

  const handleVerificarUpdate = async () => {
    setVerificandoUpdate(true);
    setErro("");
    try {
      const info = await verificarAtualizacao();
      setInfoUpdate(info);
    } catch (error) {
      setErro(
        error instanceof Error
          ? error.message
          : "Não foi possível verificar atualizações."
      );
    } finally {
      setVerificandoUpdate(false);
    }
  };

  const nomeNavegador = settings.navegador === "edge" ? "Edge" : "Chrome";

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative flex min-h-full items-start justify-center p-4 sm:items-center">
        <GlassCard
          className="relative z-10 pointer-events-auto w-full max-w-xl overflow-hidden border-white/50 shadow-[0_28px_90px_-40px_rgba(15,23,42,0.35)]"
          contentClassName="flex max-h-[92vh] min-h-0 flex-col"
        >
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between border-b border-glass-border px-6 py-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Configurações</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Personalize a interface e a conexão com o navegador.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Abas */}
          <div className="shrink-0 flex gap-1 border-b border-glass-border px-6 pt-3 pb-0">
            {(
              [
                { id: "basico" as Aba, label: "Básico", icon: Settings },
                { id: "avancado" as Aba, label: "Avançado", icon: Settings2 },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setAbaAtiva(id)}
                className={[
                  "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-xl border-b-2 transition-all",
                  abaAtiva === id
                    ? "border-primary text-primary bg-primary/5"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Conteúdo */}
          <div className="min-h-0 flex-1 overflow-y-scroll overscroll-contain px-6 py-5 [touch-action:pan-y]">
            {loading ? (
              <div className="rounded-xl border border-glass-border bg-secondary/40 px-4 py-8 text-center text-sm text-muted-foreground">
                Carregando configurações...
              </div>
            ) : (
              <div className="space-y-6">

                {/* ── ABA BÁSICO ── */}
                {abaAtiva === "basico" && (
                  <>
                    {/* Aparência */}
                    <section className="space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Aparência</h3>
                        <p className="text-sm text-muted-foreground">
                          O tema claro é o padrão da interface web.
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {[
                          { value: "light" as const, title: "Tema Claro", description: "Superfície clara, contraste suave e leitura direta.", icon: Sun },
                          { value: "dark" as const, title: "Tema Escuro", description: "Versão noturna para ambientes com pouca luz.", icon: Moon },
                        ].map((option) => {
                          const Icon = option.icon;
                          const active = settings.temaWeb === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setSettings((c) => ({ ...c, temaWeb: option.value }))}
                              className={[
                                "rounded-2xl border px-4 py-4 text-left transition-all",
                                active
                                  ? "border-primary bg-primary/10 shadow-[0_12px_30px_-24px_rgba(79,70,229,0.8)]"
                                  : "border-glass-border bg-secondary/30 hover:border-primary/40 hover:bg-secondary/55",
                              ].join(" ")}
                            >
                              <div className="flex items-center gap-3">
                                <div className={["flex h-10 w-10 items-center justify-center rounded-xl border", active ? "border-primary/30 bg-primary/15 text-primary" : "border-glass-border bg-background/70 text-muted-foreground"].join(" ")}>
                                  <Icon className="h-5 w-5" />
                                </div>
                                <div>
                                  <p className="font-medium text-foreground">{option.title}</p>
                                  <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    {/* Navegador */}
                    <section className="space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Navegador</h3>
                        <p className="text-sm text-muted-foreground">
                          Escolha o navegador usado pela automação para acessar o Comprasnet.
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {[
                          {
                            value: "chrome" as const,
                            title: "Google Chrome",
                            description: "Recomendado. Ampla compatibilidade com o Comprasnet.",
                            icon: Chrome,
                          },
                          {
                            value: "edge" as const,
                            title: "Microsoft Edge",
                            description: "Baseado no Chromium. Boa opção em ambientes corporativos.",
                            icon: Globe,
                          },
                        ].map((option) => {
                          const Icon = option.icon;
                          const active = settings.navegador === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setSettings((c) => ({ ...c, navegador: option.value }))}
                              className={[
                                "rounded-2xl border px-4 py-4 text-left transition-all",
                                active
                                  ? "border-primary bg-primary/10 shadow-[0_12px_30px_-24px_rgba(79,70,229,0.8)]"
                                  : "border-glass-border bg-secondary/30 hover:border-primary/40 hover:bg-secondary/55",
                              ].join(" ")}
                            >
                              <div className="flex items-center gap-3">
                                <div className={["flex h-10 w-10 items-center justify-center rounded-xl border", active ? "border-primary/30 bg-primary/15 text-primary" : "border-glass-border bg-background/70 text-muted-foreground"].join(" ")}>
                                  <Icon className="h-5 w-5" />
                                </div>
                                <div>
                                  <p className="font-medium text-foreground">{option.title}</p>
                                  <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* Abrir navegador */}
                      <div className="flex justify-end">
                        <GlassButton
                          variant="secondary"
                          size="sm"
                          onClick={handleAbrirNavegador}
                          disabled={abrindoNavegador}
                        >
                          <Play className="h-4 w-4" />
                          {abrindoNavegador ? `Abrindo ${nomeNavegador}...` : `Abrir ${nomeNavegador}`}
                        </GlassButton>
                      </div>
                    </section>

                    {/* Datas */}
                    <section className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-4">
                      <div
                        role="button"
                        tabIndex={onOpenDatas ? 0 : -1}
                        onClick={() => { if (!onOpenDatas) return; onClose(); onOpenDatas(); }}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === " ") && onOpenDatas) {
                            e.preventDefault(); onClose(); onOpenDatas();
                          }
                        }}
                        className={`flex w-full items-start gap-3 text-left${!onOpenDatas ? " opacity-50 cursor-not-allowed" : " cursor-pointer"}`}
                      >
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-sky-500/20 bg-background/80 text-sky-700 shadow-[0_16px_30px_-24px_rgba(14,116,144,0.85)]">
                          <CalendarDays className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-semibold text-foreground">Datas</h3>
                              <p className="mt-1 text-sm text-muted-foreground">
                                Regras de vencimento, apuração e exceções por imposto.
                              </p>
                            </div>
                            <GlassButton
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="border border-sky-500/20 bg-background/80 text-foreground hover:bg-background pointer-events-none shrink-0"
                              tabIndex={-1}
                              aria-hidden
                            >
                              Abrir regras
                            </GlassButton>
                          </div>
                        </div>
                      </div>
                    </section>

                    {/* Atualização */}
                    <section className="rounded-2xl border border-violet-500/20 bg-violet-500/10 px-4 py-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-violet-500/20 bg-background/80 text-violet-700 shadow-[0_16px_30px_-24px_rgba(124,58,237,0.7)]">
                          <ArrowDownToLine className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-semibold text-foreground">Atualização</h3>
                              <p className="mt-1 text-sm text-muted-foreground">
                                Verifique se há uma nova versão disponível.
                              </p>
                            </div>
                            <GlassButton
                              variant="ghost"
                              size="sm"
                              onClick={handleVerificarUpdate}
                              disabled={verificandoUpdate}
                              className="border border-violet-500/20 bg-background/80 text-foreground hover:bg-background shrink-0"
                            >
                              {verificandoUpdate ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                              {verificandoUpdate ? "Verificando..." : "Verificar"}
                            </GlassButton>
                          </div>

                          {/* Resultado da verificação */}
                          {infoUpdate && (
                            <div className="mt-3 space-y-2">
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Tag className="h-3.5 w-3.5" />
                                Versão atual: <span className="font-semibold text-foreground">v{infoUpdate.versao_atual}</span>
                              </div>
                              {infoUpdate.erro ? (
                                <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-3 space-y-2">
                                  <p className="text-sm font-medium text-destructive">
                                    Não foi possível consultar as releases do repositório.
                                  </p>
                                  <p className="text-xs text-destructive/90 break-words">
                                    {infoUpdate.erro}
                                  </p>
                                  <button
                                    onClick={() => abrirUrl(infoUpdate.url_download)}
                                    className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 bg-background/80 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-background"
                                  >
                                    <ArrowDownToLine className="h-3.5 w-3.5" />
                                    Abrir página de releases
                                  </button>
                                </div>
                              ) : infoUpdate.tem_atualizacao ? (
                                <div className="rounded-xl border border-violet-500/30 bg-background/75 px-3 py-3 space-y-2">
                                  <p className="text-sm font-medium text-violet-700">
                                    Nova versão disponível: v{infoUpdate.versao_nova}
                                  </p>
                                  <button
                                    disabled={baixando}
                                    onClick={async () => {
                                      setBaixando(true);
                                      try {
                                        await abrirUrl(infoUpdate.url_download);
                                      } finally {
                                        setBaixando(false);
                                      }
                                    }}
                                    className="inline-flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                                  >
                                    {baixando ? (
                                      <>
                                        <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                                        </svg>
                                        Abrindo…
                                      </>
                                    ) : (
                                      <>
                                        <ArrowDownToLine className="h-3.5 w-3.5" />
                                        Baixar v{infoUpdate.versao_nova}
                                      </>
                                    )}
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
                                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                                  O aplicativo está atualizado.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </section>

                    {/* Apoiar o desenvolvimento */}
                    <section className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-5">
                      <div className="flex flex-col items-center gap-4 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/20 bg-background/80 text-amber-600 shadow-[0_16px_30px_-24px_rgba(180,83,9,0.8)]">
                          <Coffee className="h-7 w-7" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">Apoiar o desenvolvimento</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Se a automação está te ajudando, considere pagar um café. ☕
                          </p>
                        </div>

                        <div className="w-full rounded-2xl border border-glass-border bg-background/75 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            Chave PIX
                          </p>
                          <p className="mt-1.5 text-base font-semibold tracking-[0.04em] text-foreground">
                            111.779.619-11
                          </p>
                          <p className="mt-0.5 text-sm text-muted-foreground">Diego Dutra Ramos</p>
                        </div>

                        <GlassButton
                          variant="ghost"
                          size="sm"
                          onClick={handleCopiarPix}
                          className="border border-amber-500/20 bg-background/80 text-foreground hover:bg-background"
                        >
                          {pixCopiado ? (
                            <Check className="h-4 w-4 text-success" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                          {pixCopiado ? "PIX copiado!" : "Copiar chave PIX"}
                        </GlassButton>
                      </div>
                    </section>
                  </>
                )}

                {/* ── ABA AVANÇADO ── */}
                {abaAtiva === "avancado" && (
                  <>
                    {/* Integrações */}
                    <section>
                      <button
                        type="button"
                        onClick={() => abrirUrl(SUPABASE_PROJECT_URL)}
                        className="flex items-center gap-2 rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-sm font-medium text-foreground transition hover:border-sky-500/35 hover:bg-sky-500/15"
                      >
                        <Database className="h-4 w-4 text-sky-600" />
                        Supabase
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </section>

                    {/* Porta de depuração */}
                    <section className="rounded-2xl border border-glass-border bg-secondary/25 px-4 py-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            Porta de depuração
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Use a mesma porta do{" "}
                            <code className="rounded bg-secondary/60 px-1 py-0.5 text-xs">
                              --remote-debugging-port
                            </code>.
                          </p>
                        </div>
                        <div className="relative w-full sm:w-36">
                          <input
                            id="chrome-porta"
                            type="number"
                            min={1}
                            max={65535}
                            value={settings.chromePorta}
                            onChange={(e) =>
                              setSettings((c) => ({ ...c, chromePorta: Number(e.target.value || 0) }))
                            }
                            className="w-full rounded-xl border border-glass-border bg-background/80 py-2.5 pl-3 pr-4 text-sm text-foreground shadow-inner outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                      </div>
                    </section>

                    {/* Perguntar sobre datas */}
                    <section className="rounded-2xl border border-glass-border bg-secondary/25 px-4 py-4">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={settings.perguntarLimparMes}
                          onChange={(e) =>
                            setSettings((c) => ({ ...c, perguntarLimparMes: e.target.checked }))
                          }
                          className="mt-1 h-4 w-4 rounded border-glass-border text-primary focus:ring-primary/30"
                        />
                        <span>
                          <span className="block font-medium text-foreground">
                            Perguntar sobre datas no início do mês
                          </span>
                          <span className="mt-1 block text-sm text-muted-foreground">
                            Avisa caso haja datas antigas salvas, evitando processamentos incorretos.
                          </span>
                        </span>
                      </label>
                    </section>

                    {/* Recarregar automação */}
                    <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/20 bg-background/80 text-emerald-700 shadow-[0_16px_30px_-24px_rgba(16,185,129,0.8)]">
                          <RefreshCw className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-semibold text-foreground">Recarregar automação</h3>
                              <p className="mt-1 text-sm text-muted-foreground">
                                Aplica alterações nos arquivos Python sem reiniciar o servidor.
                              </p>
                            </div>
                            <GlassButton
                              variant="ghost"
                              size="sm"
                              onClick={handleRecarregar}
                              disabled={recarregando}
                              className="border border-emerald-500/20 bg-background/80 text-foreground hover:bg-background shrink-0"
                            >
                              <RefreshCw className={`h-4 w-4 ${recarregando ? "animate-spin" : ""}`} />
                              {recarregando ? "Recarregando..." : "Recarregar"}
                            </GlassButton>
                          </div>
                          {msgRecarregar && (
                            <div className="mt-3 rounded-xl border border-emerald-500/20 bg-background/75 px-3 py-2 text-sm text-emerald-700">
                              {msgRecarregar}
                            </div>
                          )}
                        </div>
                      </div>
                    </section>

                    {/* ── Debug: Detectar campos de paginação ── */}
                    <section className="rounded-2xl border border-violet-500/20 bg-violet-500/8 px-4 py-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-violet-500/20 bg-background/80 text-violet-600 shadow-[0_16px_30px_-24px_rgba(139,92,246,0.7)]">
                          {/* Ícone de aranha inline */}
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-5 w-5"
                          >
                            {/* corpo */}
                            <ellipse cx="12" cy="13" rx="3" ry="3.5" />
                            {/* cabeça */}
                            <circle cx="12" cy="8.5" r="1.8" />
                            {/* pernas esquerdas */}
                            <path d="M9 11.5 L5 9" />
                            <path d="M9 13 L4 13" />
                            <path d="M9 14.5 L5 17" />
                            {/* pernas direitas */}
                            <path d="M15 11.5 L19 9" />
                            <path d="M15 13 L20 13" />
                            <path d="M15 14.5 L19 17" />
                            {/* fio */}
                            <line x1="12" y1="6.7" x2="12" y2="3" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-semibold text-foreground">
                                Diagnóstico de paginação
                              </h3>
                              <p className="mt-1 text-sm text-muted-foreground">
                                Inspeciona a página de apropriação no Chrome e copia o relatório de campos detectados para a área de transferência.
                              </p>
                            </div>
                            <GlassButton
                              variant="ghost"
                              size="sm"
                              onClick={handleDetectarPaginacao}
                              disabled={detectando}
                              className="shrink-0 border border-violet-500/20 bg-background/80 text-foreground hover:bg-background"
                            >
                              {detectando ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Detectando...
                                </>
                              ) : relatorioCopiado ? (
                                <>
                                  <Check className="h-4 w-4 text-emerald-600" />
                                  Copiado!
                                </>
                              ) : (
                                <>
                                  <Copy className="h-4 w-4" />
                                  Detectar e copiar
                                </>
                              )}
                            </GlassButton>
                          </div>
                          {erroDeteccao && (
                            <div className="mt-3 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                              {erroDeteccao}
                            </div>
                          )}
                          {relatorioTexto && (
                            <div className="mt-3 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">
                                  Relatório detectado — selecione tudo e copie (Ctrl+A → Ctrl+C)
                                </span>
                                <GlassButton
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => { copiarTexto(relatorioTexto); setRelatorioCopiado(true); setTimeout(() => setRelatorioCopiado(false), 2000); }}
                                >
                                  <Copy className="h-3 w-3" />
                                  {relatorioCopiado ? "Copiado!" : "Copiar"}
                                </GlassButton>
                              </div>
                              <textarea
                                readOnly
                                value={relatorioTexto}
                                rows={8}
                                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                                className="w-full rounded-xl border border-glass-border bg-zinc-950/80 px-3 py-2 font-mono text-[11px] text-emerald-400 outline-none resize-none"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </section>
                  </>
                )}

                {/* Erro */}
                {erro && (
                  <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {erro.includes("127.0.0.1:8000")
                      ? "A API web não respondeu. Inicie com ./iniciar_web.sh ou suba o uvicorn em 127.0.0.1:8000."
                      : erro}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 flex items-center justify-end gap-3 border-t border-glass-border px-6 py-4">
            <GlassButton variant="ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </GlassButton>
            <GlassButton variant="primary" onClick={handleSave} disabled={loading || saving}>
              <Save className="h-4 w-4" />
              {saving ? "Salvando..." : "Salvar"}
            </GlassButton>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

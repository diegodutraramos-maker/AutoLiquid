"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, FileUp, Loader2, X } from "lucide-react";
import { Header } from "@/components/header";
import { DateFields } from "@/components/date-fields";
import { UploadZone } from "@/components/upload-zone";
import { TabelasModal } from "@/components/tabelas-modal";
import { ConfiguracoesModal } from "@/components/configuracoes-modal";
import { GlassButton } from "@/components/glass-card";
import { CnpjChecker, NfeConsulta, IssPortais } from "@/components/liquidacao";
import {
  abrirUrl,
  delay,
  fetchDashboard,
  type BackendStartupProgress,
  type DashboardInfo,
  MOCK_PROCESS_DATES,
  fetchBackendStatus,
  fetchAppSettings,
  fetchProcessDates,
  openChromeSession,
  saveProcessDates,
  waitForBackendReady,
  verificarAtualizacao,
  type TableKey,
  type ProcessDates,
  type VersaoInfo,
  uploadPDF,
} from "@/lib/data";

const FILA_TRABALHO_URL =
  "https://docs.google.com/spreadsheets/d/1O2Ft4Ioy3_t4bKmPQ38d56UhHY2TBHfPI6kTkNkmy-4/edit?gid=0#gid=0";

const INITIAL_STARTUP_STATE: BackendStartupProgress = {
  phase: "booting-ui",
  title: "Preparando AutoLiquid",
  detail: "Carregando a interface inicial do aplicativo...",
  progress: 12,
  attempt: 0,
  elapsedMs: 0,
};

const DASHBOARD_LABELS = {
  dia: "Hoje",
  semana: "Semana",
  mes: "30 dias",
  "este-mes": "Este mês",
} as const;

type MainTab = "liquidacao" | "registro";


export default function HomePage() {
  const router = useRouter();
  const [activeMainTab, setActiveMainTab] = useState<MainTab>("liquidacao");
  const [dates, setDates] = useState<ProcessDates>(MOCK_PROCESS_DATES);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isTabelasOpen, setIsTabelasOpen] = useState(false);
  const [tabelasInitialTab, setTabelasInitialTab] = useState<TableKey>("contratos");
  const [tabelasVisibleTabs, setTabelasVisibleTabs] = useState<TableKey[] | undefined>(undefined);
  const [isConfiguracoesOpen, setIsConfiguracoesOpen] = useState(false);
  const [erro, setErro] = useState("");
  const [erroInicializacao, setErroInicializacao] = useState("");
  const [apiDisponivel, setApiDisponivel] = useState(true);
  const [chromeStatus, setChromeStatus] = useState<"pronto" | "carregando" | "erro">("carregando");
  const [abrindoChrome, setAbrindoChrome] = useState(false);
  const [bannerUpdate, setBannerUpdate] = useState<VersaoInfo | null>(null);
  const [browserName, setBrowserName] = useState("Chrome");
  const [startupState, setStartupState] =
    useState<BackendStartupProgress>(INITIAL_STARTUP_STATE);
  const [startupError, setStartupError] = useState("");
  // Persiste o startup entre navegações dentro da mesma sessão do app
  const [startupConcluido, setStartupConcluido] = useState(() => {
    try { return sessionStorage.getItem("startup_ok") === "1"; } catch { return false; }
  });
  const [startupRunId, setStartupRunId] = useState(0);
  const [dashboardPeriodo, setDashboardPeriodo] =
    useState<keyof typeof DASHBOARD_LABELS>("semana");
  const [dashboard, setDashboard] = useState<DashboardInfo | null>(null);
  const [carregandoDashboard, setCarregandoDashboard] = useState(false);
  const [uploadResetKey, setUploadResetKey] = useState(0);
  const lastSavedDatesRef = useRef(JSON.stringify(MOCK_PROCESS_DATES));

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  const resetUploadArea = () => {
    setSelectedFile(null);
    setIsUploading(false);
    setErro("");
    setUploadResetKey((current) => current + 1);
  };

  // Verificação de versão na inicialização (só quando API estiver disponível)
  useEffect(() => {
    if (!startupConcluido || !apiDisponivel) {
      return;
    }

    let ativo = true;
    const checarVersao = async () => {
      // Aguarda API ficar disponível antes de consultar
      await new Promise(r => setTimeout(r, 3000));
      if (!ativo) return;
      try {
        const info = await verificarAtualizacao();
        if (ativo && info.tem_atualizacao) setBannerUpdate(info);
      } catch {
        // silencia erros de rede na checagem automática
      }
    };
    checarVersao();
    return () => { ativo = false; };
  }, [startupConcluido, apiDisponivel]);

  useEffect(() => {
    let ativo = true;
    let ultimoStartup = INITIAL_STARTUP_STATE;

    const carregarTela = async () => {
      // Se o startup já foi concluído nesta sessão do app, faz apenas uma
      // verificação rápida em background sem mostrar o banner de loading.
      const jaFezStartup = (() => { try { return sessionStorage.getItem("startup_ok") === "1"; } catch { return false; } })();
      if (jaFezStartup) {
        try {
          const backendStatus = await fetchBackendStatus();
          if (!ativo) return;
          setChromeStatus(backendStatus.chromeStatus);
          setApiDisponivel(true);
        } catch {
          if (!ativo) return;
          setChromeStatus("erro");
          setApiDisponivel(false);
        }
        return;
      }

      setStartupConcluido(false);
      setStartupError("");
      setErroInicializacao("");
      setApiDisponivel(false);
      setChromeStatus("carregando");
      setStartupState(INITIAL_STARTUP_STATE);

      await delay(250);
      if (!ativo) return;

      try {
        const backendStatus = await waitForBackendReady({
          timeoutMs: 60000,
          retryDelayMs: 1000,
          onProgress: (progress) => {
            if (!ativo) return;
            ultimoStartup = progress;
            setStartupState(progress);
          },
        });
        if (!ativo) return;
        setChromeStatus(backendStatus.chromeStatus);
        setApiDisponivel(true);
        setErroInicializacao("");
      } catch (error) {
        if (!ativo) return;
        console.error("Erro ao consultar status do backend:", error);
        const mensagem =
          error instanceof Error
            ? error.message
            : "Não foi possível iniciar a API interna."
        setChromeStatus("erro");
        setApiDisponivel(false);
        setErroInicializacao(mensagem);
        setStartupError(mensagem);
        setStartupState({
          phase: "error",
          title: "Nao foi possivel iniciar a API",
          detail: "O AutoLiquid ainda nao recebeu resposta do backend interno.",
          progress: 100,
          attempt: ultimoStartup.attempt,
          elapsedMs: ultimoStartup.elapsedMs,
        });
        return;
      }

      setStartupState({
        phase: "restoring-data",
        title: "Restaurando dados iniciais",
        detail: "Carregando datas salvas e preparando a tela principal...",
        progress: 92,
        attempt: ultimoStartup.attempt,
        elapsedMs: ultimoStartup.elapsedMs,
      });

      const [datesResult, settingsResult] = await Promise.allSettled([
        fetchProcessDates(),
        fetchAppSettings(),
      ]);

      if (datesResult.status === "fulfilled") {
        if (!ativo) return;
        setDates(datesResult.value);
        lastSavedDatesRef.current = JSON.stringify(datesResult.value);
      } else {
        console.error("Erro ao carregar datas do processo:", datesResult.reason);
        if (ativo) {
          setErroInicializacao(
            datesResult.reason instanceof Error
              ? datesResult.reason.message
              : "Não foi possível carregar as datas salvas."
          );
        }
      }

      if (settingsResult.status === "fulfilled" && ativo) {
        setBrowserName(settingsResult.value.navegador === "edge" ? "Edge" : "Chrome");
      }

      if (!ativo) return;

      setStartupState({
        phase: "ready",
        title: "Tudo pronto",
        detail: "Abrindo a tela inicial da automacao...",
        progress: 100,
        attempt: ultimoStartup.attempt,
        elapsedMs: ultimoStartup.elapsedMs,
      });
      await delay(320);
      if (!ativo) return;
      try { sessionStorage.setItem("startup_ok", "1"); } catch { /* ignore */ }
      setStartupConcluido(true);
    };

    carregarTela();

    return () => {
      ativo = false;
    };
  }, [startupRunId]);

  useEffect(() => {
    if (!startupConcluido) {
      return;
    }

    const serialized = JSON.stringify(dates);
    if (serialized === lastSavedDatesRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const saved = await saveProcessDates(dates);
        lastSavedDatesRef.current = JSON.stringify(saved);
      } catch (error) {
        console.error("Erro ao salvar datas do processo:", error);
      }
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [dates, startupConcluido]);

  useEffect(() => {
    if (startupConcluido || !startupError) {
      return;
    }

    let ativo = true;
    const intervalId = window.setInterval(async () => {
      try {
        await fetchBackendStatus();
        if (!ativo) return;
        setStartupRunId((current) => current + 1);
      } catch {
        // continua aguardando a API aparecer sem interromper a tela
      }
    }, 2000);

    return () => {
      ativo = false;
      window.clearInterval(intervalId);
    };
  }, [startupConcluido, startupError]);

  useEffect(() => {
    if (!startupConcluido) {
      return;
    }

    let ativo = true;

    const atualizarChrome = async () => {
      try {
        const backendStatus = await fetchBackendStatus();
        if (!ativo) return false;
        setChromeStatus(backendStatus.chromeStatus);
        setApiDisponivel(true);
        setErroInicializacao("");
        return true;
      } catch (error) {
        if (!ativo) return false;
        console.error("Erro ao consultar status do backend:", error);
        setChromeStatus("erro");
        setApiDisponivel(false);
        setErroInicializacao(
          error instanceof Error
            ? error.message
            : "Não foi possível consultar o status do Chrome."
        );
        return false;
      }
    };

    const handleFocus = () => {
      resetUploadArea();
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      void atualizarChrome();
    };

    const handleVisibility = () => {
      if (!document.hidden) {
        resetUploadArea();
        void atualizarChrome();
      }
    };

    const handlePageShow = () => {
      resetUploadArea();
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      void atualizarChrome();
    };

    const intervalId = window.setInterval(() => {
      void atualizarChrome();
    }, 5000);

    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      ativo = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [startupConcluido]);

  useEffect(() => {
    if (!startupConcluido || !apiDisponivel) {
      return;
    }

    let ativo = true;
    const carregarDashboard = async () => {
      setCarregandoDashboard(true);
      try {
        const data = await fetchDashboard(dashboardPeriodo);
        if (!ativo) return;
        setDashboard(data);
      } catch (error) {
        if (!ativo) return;
        console.error("Erro ao carregar dashboard:", error);
      } finally {
        if (ativo) {
          setCarregandoDashboard(false);
        }
      }
    };

    void carregarDashboard();
    return () => {
      ativo = false;
    };
  }, [apiDisponivel, dashboardPeriodo, startupConcluido]);

  const handleFileSelect = (file: File | null, source: "drop" | "input" | "clear") => {
    setErro("");
    setSelectedFile(file);
    if (file && source !== "clear") {
      void handleProcessar(file);
    }
  };

  const handleProcessar = async (fileOverride?: File) => {
    const arquivoParaProcessar = fileOverride ?? selectedFile;
    if (!arquivoParaProcessar) {
      setErro("Selecione um PDF antes de processar.");
      return;
    }
    if (isUploading) {
      return;
    }

    setIsUploading(true);
    setErro("");
    try {
      const result = await uploadPDF(arquivoParaProcessar, dates);
      if (result.success) {
        router.push(`/conferencia?id=${result.documentoId}`);
        return;
      }
      setErro(result.mensagem || "Não foi possível processar o documento.");
    } catch (error) {
      console.error("Erro ao processar:", error);
      setErro(
        error instanceof Error
          ? error.message
          : "Erro inesperado ao processar o documento."
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleAbrirChrome = async () => {
    setAbrindoChrome(true);
    setErro("");
    try {
      const status = await openChromeSession();
      setChromeStatus(status.chromeStatus);
      setApiDisponivel(true);
      setErroInicializacao("");
    } catch (error) {
      setErroInicializacao(
        error instanceof Error
          ? error.message
          : "Nao foi possivel abrir o Chrome."
      );
      setChromeStatus("erro");
      setApiDisponivel(false);
    } finally {
      setAbrindoChrome(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Background decoration */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-1/4 -top-1/4 h-1/2 w-1/2 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-1/4 -right-1/4 h-1/2 w-1/2 rounded-full bg-accent/5 blur-3xl" />
      </div>

      <Header
        chromeStatus={chromeStatus}
        browserName={browserName}
        onOpenTabelas={() => {
          setTabelasInitialTab("contratos");
          setTabelasVisibleTabs(undefined);
          setIsTabelasOpen(true);
        }}
        onOpenConfiguracoes={() => setIsConfiguracoesOpen(true)}
        onOpenFilaTrabalho={() => void abrirUrl(FILA_TRABALHO_URL)}
        onOpenChrome={handleAbrirChrome}
        chromeActionDisabled={abrindoChrome || !apiDisponivel}
      />

      <main className="relative mx-auto max-w-5xl px-5 py-6 sm:px-6 sm:py-8">
        <section className="mb-5 rounded-[28px] border border-glass-border bg-glass-bg px-5 py-5 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.4)] backdrop-blur-xl sm:px-6">

          {/* ── Cabeçalho + Abas ── */}
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">
                AutoLiquid
              </p>
              <h1 className="mt-2 text-balance text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {activeMainTab === "liquidacao" ? "Liquidação" : "Registro"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeMainTab === "liquidacao"
                  ? "Acesse os portais municipais e execute a liquidação no SIAFI."
                  : "Envie o PDF da liquidação para extrair e conferir os dados antes de executar."}
              </p>
            </div>

            {/* Seletor de abas */}
            <div className="flex shrink-0 gap-1 rounded-xl border border-glass-border bg-background/60 p-1">
              {(["liquidacao", "registro"] as MainTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveMainTab(tab)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                    activeMainTab === tab
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab === "liquidacao" ? "Liquidação" : "Registro"}
                </button>
              ))}
            </div>
          </div>

          {bannerUpdate && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <ArrowDownToLine className="h-4 w-4 shrink-0 text-violet-700" />
              <p className="text-sm text-violet-700">
                <span className="font-semibold">Nova versão disponível:</span>{" "}
                v{bannerUpdate.versao_nova}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href={bannerUpdate.url_download}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-violet-500/30 bg-background/80 px-3 py-1.5 text-xs font-medium text-violet-700 transition-colors hover:bg-background"
              >
                Baixar
              </a>
              <button
                type="button"
                onClick={() => setBannerUpdate(null)}
                className="rounded-full p-1 text-violet-500 transition-colors hover:bg-violet-500/10"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            </div>
          )}

          {erroInicializacao && (
            <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {erroInicializacao}
            </div>
          )}

          {!startupConcluido && (
            <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-glass-border/70 bg-background/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">{startupState.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{startupState.detail}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-glass-border bg-background/70 px-3 py-1 text-xs text-muted-foreground">
                  {startupState.progress}%
                </span>
                {startupError ? (
                  <GlassButton
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setStartupRunId((current) => current + 1)}
                  >
                    Tentar novamente
                  </GlassButton>
                ) : null}
              </div>
            </div>
          )}

          {/* ── Aba: Liquidação ── */}
          {activeMainTab === "liquidacao" && (
            <div className="space-y-4">
              <IssPortais />
              <CnpjChecker />
              <NfeConsulta />
            </div>
          )}

          {/* ── Aba: Registro ── */}
          {activeMainTab === "registro" && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
            <div className="space-y-4">
              <DateFields dates={dates} onDatesChange={setDates} compact />

              <div className="rounded-3xl border border-glass-border bg-background/55 p-4 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.4)]">
                <UploadZone
                  key={uploadResetKey}
                  onFileSelect={handleFileSelect}
                  compact
                  disabled={!apiDisponivel}
                  disabledMessage={
                    !apiDisponivel
                      ? "A seleção foi desativada porque a API web não está respondendo."
                      : undefined
                  }
                />

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-h-5">
                    {erro ? (
                      <p className="max-w-xl text-sm text-destructive">{erro}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Envie o PDF e siga direto para a conferência.
                      </p>
                    )}
                  </div>

                  <GlassButton
                    variant="secondary"
                    size="lg"
                    onClick={() => handleProcessar()}
                    disabled={!selectedFile || isUploading || !apiDisponivel}
                    className="w-full sm:w-auto"
                  >
                    {isUploading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <FileUp className="h-5 w-5" />
                    )}
                    {isUploading ? "Processando PDF..." : "Processar Documento"}
                  </GlassButton>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-glass-border bg-background/55 p-4 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.4)]">
              <div className="flex flex-col gap-3 border-b border-glass-border pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                    Dashboard Operacional
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Resumo consolidado e últimos processos.
                  </p>
                </div>

                <div className="w-full sm:w-40">
                  <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Período
                  </label>
                  <select
                    value={dashboardPeriodo}
                    onChange={(event) =>
                      setDashboardPeriodo(event.target.value as keyof typeof DASHBOARD_LABELS)
                    }
                    className="w-full rounded-xl border border-glass-border bg-background/80 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    {Object.entries(DASHBOARD_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-glass-border/70 bg-background/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Valor Bruto
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">
                    {carregandoDashboard ? "Carregando..." : formatCurrency(dashboard?.valorBruto ?? 0)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Total em {DASHBOARD_LABELS[dashboardPeriodo].toLowerCase()}.
                  </p>
                </div>

                <div className="rounded-2xl border border-glass-border/70 bg-background/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Processos
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">
                    {carregandoDashboard ? "Carregando..." : dashboard?.quantidadeProcessos ?? 0}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Processos únicos liquidados.
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-glass-border/70 bg-background/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Últimos 5 Processos
                  </p>
                  {dashboard?.habilitado === false ? (
                    <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                      Supabase indisponível
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-2">
                  {carregandoDashboard ? (
                    <p className="text-sm text-muted-foreground">Carregando processos...</p>
                  ) : (dashboard?.ultimosProcessos?.length ?? 0) > 0 ? (
                    dashboard!.ultimosProcessos.map((processo, index) => (
                      <div
                        key={processo.numeroProcesso || `processo-${index}`}
                        className="flex items-center gap-3 rounded-xl border border-glass-border/60 bg-secondary/20 px-3 py-2.5"
                      >
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                          {index + 1}
                        </span>
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">
                          {processo.numeroProcesso}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Ainda não há processos sincronizados para mostrar.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
          )}
        </section>
      </main>

      {/* Tabelas Modal */}
      <TabelasModal
        isOpen={isTabelasOpen}
        onClose={() => {
          setIsTabelasOpen(false);
          setTabelasVisibleTabs(undefined);
        }}
        initialTab={tabelasInitialTab}
        visibleTabs={tabelasVisibleTabs}
      />

      <ConfiguracoesModal
        isOpen={isConfiguracoesOpen}
        onClose={() => setIsConfiguracoesOpen(false)}
        onSaved={async () => {
          try {
            const settings = await fetchAppSettings();
            setBrowserName(settings.navegador === "edge" ? "Edge" : "Chrome");
            const status = await fetchBackendStatus();
            setChromeStatus(status.chromeStatus);
          } catch {
            setChromeStatus("erro");
          }
        }}
        onChromeOpened={async () => {
          try {
            const status = await fetchBackendStatus();
            setChromeStatus(status.chromeStatus);
            setApiDisponivel(true);
            setErroInicializacao("");
          } catch {
            setChromeStatus("erro");
            setApiDisponivel(false);
          }
        }}
        onOpenDatas={() => {
          setTabelasInitialTab("datas-impostos");
          setTabelasVisibleTabs(["datas-impostos"]);
          setIsTabelasOpen(true);
        }}
      />
    </div>
  );
}

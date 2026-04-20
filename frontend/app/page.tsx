"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, FileUp, Loader2, X } from "lucide-react";
import { Header } from "@/components/header";
import { StartupScreen } from "@/components/startup-screen";
import { DateFields } from "@/components/date-fields";
import { UploadZone } from "@/components/upload-zone";
import { TabelasModal } from "@/components/tabelas-modal";
import { ConfiguracoesModal } from "@/components/configuracoes-modal";
import { GlassButton } from "@/components/glass-card";
import {
  abrirUrl,
  delay,
  type BackendStartupProgress,
  MOCK_PROCESS_DATES,
  fetchBackendStatus,
  fetchAppSettings,
  fetchProcessDates,
  openChromeSession,
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

export default function HomePage() {
  const router = useRouter();
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
  const [startupConcluido, setStartupConcluido] = useState(false);
  const [startupRunId, setStartupRunId] = useState(0);

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
          timeoutMs: 30000,
          retryDelayMs: 650,
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
      setStartupConcluido(true);
    };

    carregarTela();

    return () => {
      ativo = false;
    };
  }, [startupRunId]);

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
      void atualizarChrome();
    };

    const handleVisibility = () => {
      if (!document.hidden) {
        void atualizarChrome();
      }
    };

    const intervalId = window.setInterval(() => {
      void atualizarChrome();
    }, 5000);

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      ativo = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [startupConcluido]);

  const handleFileSelect = (file: File | null) => {
    setErro("");
    setSelectedFile(file);
  };

  const handleProcessar = async () => {
    if (!selectedFile) {
      setErro("Selecione um PDF antes de processar.");
      return;
    }

    setIsUploading(true);
    setErro("");
    try {
      const result = await uploadPDF(selectedFile, dates);
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

  if (!startupConcluido) {
    return (
      <StartupScreen
        phase={startupState.phase}
        progress={startupState.progress}
        title={startupState.title}
        detail={startupState.detail}
        attempt={startupState.attempt}
        error={startupError}
        onRetry={
          startupError
            ? () => {
                setStartupRunId((current) => current + 1);
              }
            : undefined
        }
      />
    );
  }

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

      <main className="relative mx-auto max-w-3xl px-6 py-12">
        {/* Title Section */}
        <div className="mb-12 text-center">
          <h1 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            AutoLiquid
          </h1>
          <p className="mt-3 text-muted-foreground">
            Automação contábil de liquidação · Comprasnet / SIAFI
          </p>
        </div>

        {/* Banner de nova versão */}
        {bannerUpdate && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3">
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
          <div className="mb-8 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {erroInicializacao}
          </div>
        )}

        {/* Date Fields */}
        <div className="mb-8">
          <DateFields dates={dates} onDatesChange={setDates} />
        </div>

        {/* Upload Zone */}
        <div className="mb-8">
          <UploadZone
            onFileSelect={handleFileSelect}
            disabled={!apiDisponivel}
            disabledMessage={
              !apiDisponivel
                ? "A seleção foi desativada porque a API web não está respondendo."
                : undefined
            }
          />
        </div>

        {/* Action Button */}
        <div className="flex flex-col items-center gap-4">
          <GlassButton
            variant="secondary"
            size="lg"
            onClick={handleProcessar}
            disabled={!selectedFile || isUploading || !apiDisponivel}
          >
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <FileUp className="h-5 w-5" />
            )}
            {isUploading ? "Processando PDF..." : "Processar Documento"}
          </GlassButton>

          {erro && (
            <p className="max-w-xl text-center text-sm text-destructive">{erro}</p>
          )}
        </div>
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

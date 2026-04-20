"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Header } from "@/components/header";
import { DocumentoPanel } from "@/components/documento-panel";
import { NotasFiscaisTable } from "@/components/notas-fiscais-table";
import { FilaExecucao } from "@/components/fila-execucao";
import { StatusOverview } from "@/components/status-overview";
import { TabelasModal } from "@/components/tabelas-modal";
import { ConfiguracoesModal } from "@/components/configuracoes-modal";
import { GlassButton } from "@/components/glass-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  MOCK_DOCUMENTO,
  MOCK_DEDUCOES,
  MOCK_EMPENHOS,
  MOCK_RESUMO_FINANCEIRO,
  MOCK_NOTAS_FISCAIS,
  MOCK_ETAPAS_EXECUCAO,
  MOCK_PROCESS_DATES,
  fetchBackendStatus,
  fetchDocumentoProcessado,
  fetchAppSettings,
  openChromeSession,
  pararExecucao,
  waitForBackendReady,
  type Documento,
  type Deducao,
  type DocumentoProcessado,
  type Empenho,
  type PendenciaDocumento,
  type ResumoFinanceiro,
  type NotaFiscal,
  type EtapaExecucao,
  type ProcessDates,
  type StatusGeralDocumento,
  type TableKey,
  executarTodas,
  executarEtapa,
  executarDeducao,
  apropriarSIAFI,
} from "@/lib/data";

type PendingExecution =
  | { type: "todas" }
  | { type: "etapa"; etapa: EtapaExecucao }
  | null;

function ConferenciaPageContent() {
  const searchParams = useSearchParams();
  const documentoId = searchParams.get("id");
  const filaRef = useRef<HTMLDivElement | null>(null);
  const execucaoAbortControllerRef = useRef<AbortController | null>(null);
  const ultimoAvisoManualRef = useRef("");
  const avisosManuaisDispensadosRef = useRef<Set<string>>(new Set());
  const ugrDialogDispensadoRef = useRef(false);
  const [documento, setDocumento] = useState<Documento>(MOCK_DOCUMENTO);
  const [resumo, setResumo] = useState<ResumoFinanceiro>(MOCK_RESUMO_FINANCEIRO);
  const [notasFiscais, setNotasFiscais] = useState<NotaFiscal[]>(MOCK_NOTAS_FISCAIS);
  const [empenhos, setEmpenhos] = useState<Empenho[]>(MOCK_EMPENHOS);
  const [deducoes, setDeducoes] = useState<Deducao[]>(MOCK_DEDUCOES);
  const [etapas, setEtapas] = useState<EtapaExecucao[]>(MOCK_ETAPAS_EXECUCAO);
  const [dates, setDates] = useState<ProcessDates>(MOCK_PROCESS_DATES);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsSimples, setLogsSimples] = useState<string[]>([]);
  const [nivelLog, setNivelLog] = useState<"simples" | "desenvolvedor">("desenvolvedor");
  const [isTabelasOpen, setIsTabelasOpen] = useState(false);
  const [tabelasInitialTab, setTabelasInitialTab] = useState<TableKey>("contratos");
  const [tabelasVisibleTabs, setTabelasVisibleTabs] = useState<TableKey[] | undefined>(undefined);
  const [isConfiguracoesOpen, setIsConfiguracoesOpen] = useState(false);
  const [isExecutando, setIsExecutando] = useState(false);
  const [paradaSolicitada, setParadaSolicitada] = useState(false);
  const [etapaAtivaId, setEtapaAtivaId] = useState<number | null>(null);
  const [deducaoAtivaId, setDeducaoAtivaId] = useState<number | null>(null);
  const [erro, setErro] = useState("");
  const [statusMensagem, setStatusMensagem] = useState("");
  const [chromeStatus, setChromeStatus] = useState<"pronto" | "carregando" | "erro">("carregando");
  const [browserName, setBrowserName] = useState("Chrome");
  const [pendencias, setPendencias] = useState<PendenciaDocumento[]>([]);
  const [statusGeral, setStatusGeral] = useState<StatusGeralDocumento>({
    tipo: "atencao",
    titulo: "Carregando documento",
    descricao: "O resumo operacional do documento será exibido em instantes.",
  });
  const [avisoManual, setAvisoManual] = useState("");
  const [abrindoChrome, setAbrindoChrome] = useState(false);
  const [lfNumero, setLfNumero] = useState("");
  const [ugrNumero, setUgrNumero] = useState("");
  const [vencimentoDocumento, setVencimentoDocumento] = useState("");
  const [requiresCentroCusto, setRequiresCentroCusto] = useState(false);
  const [isLfDialogOpen, setIsLfDialogOpen] = useState(false);
  const [isUgrDialogOpen, setIsUgrDialogOpen] = useState(false);
  const [isFaturaDialogOpen, setIsFaturaDialogOpen] = useState(false);
  const [faturaDialogResolvido, setFaturaDialogResolvido] = useState(false);
  const [isContaDialogOpen, setIsContaDialogOpen] = useState(false);
  const [contaDialogResolvido, setContaDialogResolvido] = useState(false);
  const [usarContaPdf, setUsarContaPdf] = useState(true);
  const [contaBanco, setContaBanco] = useState("");
  const [contaAgencia, setContaAgencia] = useState("");
  const [contaConta, setContaConta] = useState("");
  const [pendingExecution, setPendingExecution] = useState<PendingExecution>(null);
  const [datasDeducoes, setDatasDeducoes] = useState<Record<number, { apuracao: string; vencimento: string }>>({});
  const precisaLF = deducoes.some((deducao) => deducao.siafi === "DOB001");
  const precisaUGR = requiresCentroCusto;
  const temFatura = notasFiscais.some((nota) =>
    nota.tipo.toLowerCase().includes("fatura")
  );

  const detectarAvisoManual = (mensagens: string[]) => {
    const aviso = mensagens.find((mensagem) =>
      mensagem.toLowerCase().includes("requer conferência manual")
    );
    if (
      aviso &&
      !avisosManuaisDispensadosRef.current.has(aviso) &&
      aviso !== ultimoAvisoManualRef.current
    ) {
      ultimoAvisoManualRef.current = aviso;
      setAvisoManual(aviso);
    }
  };

  const aplicarPayload = (payload: DocumentoProcessado) => {
    setDocumento(payload.documento);
    setResumo(payload.resumo);
    setNotasFiscais(payload.notasFiscais);
    setEmpenhos(payload.empenhos);
    setDeducoes(payload.deducoes);
    setEtapas(payload.etapas);
    setDates(payload.dates);
    setLogs(payload.logs);
    setLogsSimples(payload.logsSimples ?? []);
    setPendencias(payload.pendencias ?? []);
    setStatusGeral(
      payload.statusGeral ?? {
        tipo: "atencao",
        titulo: "Resumo indisponível",
        descricao: "Não foi possível montar o resumo operacional deste documento.",
      }
    );
    setLfNumero(payload.lfNumero ?? "");
    setUgrNumero(payload.ugrNumero ?? "");
    setVencimentoDocumento(payload.vencimentoDocumento ?? "");
    setRequiresCentroCusto(Boolean(payload.requiresCentroCusto));
    setFaturaDialogResolvido(
      Boolean(
        payload.vencimentoDocumento.trim() ||
          payload.lfNumero.trim() ||
          payload.ugrNumero.trim()
      )
    );
    setIsExecutando(Boolean(payload.isRunning));
    setParadaSolicitada(Boolean(payload.cancelRequested));
    setEtapaAtivaId(
      payload.etapas.find((etapa) => etapa.status === "executando")?.id ?? null
    );

    if (payload.isRunning) {
      const etapaEmExecucao = payload.etapas.find(
        (etapa) => etapa.status === "executando"
      );
      setStatusMensagem(
        payload.cancelRequested
          ? "Parada solicitada. A etapa atual será concluída antes da interrupção."
          : etapaEmExecucao
            ? `Executando ${etapaEmExecucao.nome}...`
            : "Execução em andamento..."
      );
    }

    detectarAvisoManual([
      ...(payload.documento.alertas ?? []),
      ...payload.logs,
    ]);

    const payloadTemFatura = payload.notasFiscais.some((nota) =>
      nota.tipo.toLowerCase().includes("fatura")
    );

    if (
      payload.requiresCentroCusto &&
      !String(payload.ugrNumero ?? "").trim() &&
      !payload.isRunning &&
      !ugrDialogDispensadoRef.current &&
      !payloadTemFatura
    ) {
      setIsUgrDialogOpen(true);
    }
  };

  const resumirExecucao = (
    payload: DocumentoProcessado,
    mensagemSucesso: string
  ) => {
    const ultimoLog = payload.logs.at(-1)?.toLowerCase() ?? "";

    if (ultimoLog.includes("parada solicitada")) {
      return "Execução interrompida após a etapa atual.";
    }

    if (payload.etapas.some((etapa) => etapa.status === "erro")) {
      return "Execução interrompida com erro.";
    }

    return mensagemSucesso;
  };

  useEffect(() => {
    let ativo = true;
    let documentoCarregado = false;
    let recarregandoDocumento = false;

    const atualizarChrome = async () => {
      try {
        const status = await fetchBackendStatus();
        if (!ativo) return;
        setChromeStatus(status.chromeStatus);

        if (!documentoCarregado && !recarregandoDocumento && documentoId) {
          recarregandoDocumento = true;
          try {
            const [payloadResult, settingsResult] = await Promise.allSettled([
              fetchDocumentoProcessado(documentoId),
              fetchAppSettings(),
            ]);

            if (payloadResult.status === "fulfilled") {
              if (!ativo) return;
              aplicarPayload(payloadResult.value);
              documentoCarregado = true;
              setErro("");
            }

            if (settingsResult.status === "fulfilled" && ativo) {
              setNivelLog(settingsResult.value.nivelLog ?? "desenvolvedor");
              setBrowserName(settingsResult.value.navegador === "edge" ? "Edge" : "Chrome");
            }
          } finally {
            recarregandoDocumento = false;
          }
        }
      } catch (error) {
        if (!ativo) return;
        console.error("Erro ao consultar status do Chrome:", error);
        setChromeStatus("erro");
      }
    };

    const loadData = async () => {
      if (!documentoId) {
        setErro("Nenhum documento foi informado para conferência.");
        return;
      }

      try {
        const status = await waitForBackendReady();
        if (!ativo) return;
        setChromeStatus(status.chromeStatus);
      } catch (error) {
        console.error("Erro ao consultar status do Chrome:", error);
        if (ativo) {
          setChromeStatus("erro");
        }
      }

      const [payloadResult, settingsResult] = await Promise.allSettled([
        fetchDocumentoProcessado(documentoId),
        fetchAppSettings(),
      ]);

      if (payloadResult.status === "fulfilled") {
        if (!ativo) return;
        aplicarPayload(payloadResult.value);
        documentoCarregado = true;
        setErro("");
      } else {
        console.error("Erro ao carregar documento processado:", payloadResult.reason);
        if (ativo) {
          setErro(
            payloadResult.reason instanceof Error
              ? payloadResult.reason.message
              : "Erro ao carregar os dados do documento."
          );
        }
      }

      if (settingsResult.status === "fulfilled" && ativo) {
        setNivelLog(settingsResult.value.nivelLog ?? "desenvolvedor");
        setBrowserName(settingsResult.value.navegador === "edge" ? "Edge" : "Chrome");
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
    loadData();

    return () => {
      ativo = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [documentoId]);

  useEffect(() => {
    ugrDialogDispensadoRef.current = false;
    setIsUgrDialogOpen(false);
    setUgrNumero("");
    setLfNumero("");
    setVencimentoDocumento("");
    setIsFaturaDialogOpen(false);
    setFaturaDialogResolvido(false);
    setIsContaDialogOpen(false);
    setContaDialogResolvido(false);
    setUsarContaPdf(true);
    setContaBanco("");
    setContaAgencia("");
    setContaConta("");
  }, [documentoId]);

  useEffect(() => {
    if (!documentoId || !isExecutando) return;

    let ativo = true;
    const intervalId = window.setInterval(async () => {
      try {
        const payload = await fetchDocumentoProcessado(documentoId);
        if (!ativo) return;
        aplicarPayload(payload);
        if (!payload.isRunning) {
          setStatusMensagem(resumirExecucao(payload, "Execução concluída."));
        }
      } catch (error) {
        if (!ativo) return;
        console.error("Erro ao atualizar andamento da execução:", error);
      }
    }, 2500);

    return () => {
      ativo = false;
      window.clearInterval(intervalId);
    };
  }, [documentoId, isExecutando]);

  const executeAll = async (
    lfInformada = lfNumero,
    ugrInformada = ugrNumero,
    vencimentoInformado = vencimentoDocumento,
    usarPdf = usarContaPdf,
    banco = contaBanco,
    agencia = contaAgencia,
    conta = contaConta,
  ) => {
    if (!documentoId) return;
    execucaoAbortControllerRef.current?.abort();
    const controller = new AbortController();
    execucaoAbortControllerRef.current = controller;
    setIsExecutando(true);
    setParadaSolicitada(false);
    setEtapaAtivaId(null);
    setStatusMensagem("Executando automação...");
    setErro("");
    try {
      const payload = await executarTodas(documentoId, {
        signal: controller.signal,
        lfNumero: lfInformada,
        ugrNumero: ugrInformada,
        vencimentoDocumento: vencimentoInformado,
        usarContaPdf: usarPdf,
        contaBanco: banco,
        contaAgencia: agencia,
        contaConta: conta,
      });
      aplicarPayload(payload);
      setStatusMensagem(resumirExecucao(payload, "Execução concluída."));
    } catch (error) {
      console.error("Erro ao executar:", error);
      if (controller.signal.aborted) {
        setStatusMensagem("Parada solicitada. Atualizando andamento da automação...");
      } else {
        setErro(
          error instanceof Error ? error.message : "Erro ao executar automação."
        );
        setStatusMensagem("Execução interrompida.");
      }
    } finally {
      if (execucaoAbortControllerRef.current === controller) {
        execucaoAbortControllerRef.current = null;
      }
      if (!controller.signal.aborted) {
        setIsExecutando(false);
      }
    }
  };

  const executeEtapa = async (
    etapa: EtapaExecucao,
    lfInformada = lfNumero,
    ugrInformada = ugrNumero,
    vencimentoInformado = vencimentoDocumento,
    usarPdf = usarContaPdf,
    banco = contaBanco,
    agencia = contaAgencia,
    conta = contaConta,
  ) => {
    if (!documentoId) return;
    execucaoAbortControllerRef.current?.abort();
    const controller = new AbortController();
    execucaoAbortControllerRef.current = controller;
    setIsExecutando(true);
    setParadaSolicitada(false);
    setEtapaAtivaId(etapa.id);
    setStatusMensagem(`Executando ${etapa.nome}...`);
    setErro("");

    try {
      const payload = await executarEtapa(documentoId, etapa.id, {
        signal: controller.signal,
        lfNumero: lfInformada,
        ugrNumero: ugrInformada,
        vencimentoDocumento: vencimentoInformado,
        usarContaPdf: usarPdf,
        contaBanco: banco,
        contaAgencia: agencia,
        contaConta: conta,
      });
      aplicarPayload(payload);
      setStatusMensagem(resumirExecucao(payload, `${etapa.nome} concluída.`));
    } catch (error) {
      console.error("Erro ao executar etapa:", error);
      if (controller.signal.aborted) {
        setStatusMensagem("Parada solicitada. Atualizando andamento da automação...");
      } else {
        setErro(
          error instanceof Error
            ? error.message
            : "Erro ao executar a etapa selecionada."
        );
        setStatusMensagem(`Falha na etapa ${etapa.nome}.`);
      }
    } finally {
      if (execucaoAbortControllerRef.current === controller) {
        execucaoAbortControllerRef.current = null;
      }
      if (!controller.signal.aborted) {
        setIsExecutando(false);
        setEtapaAtivaId(null);
      }
    }
  };

  const handleExecutarTudo = async () => {
    if (temFatura && !faturaDialogResolvido) {
      setPendingExecution({ type: "todas" });
      setIsFaturaDialogOpen(true);
      return;
    }
    if (precisaUGR && !ugrNumero.trim()) {
      setPendingExecution({ type: "todas" });
      setIsUgrDialogOpen(true);
      return;
    }
    if (precisaLF && !lfNumero.trim()) {
      setPendingExecution({ type: "todas" });
      setIsLfDialogOpen(true);
      return;
    }
    if (!contaDialogResolvido) {
      setPendingExecution({ type: "todas" });
      setIsContaDialogOpen(true);
      return;
    }
    await executeAll();
  };

  const handleExecutarEtapa = async (etapa: EtapaExecucao) => {
    if (temFatura && !faturaDialogResolvido) {
      setPendingExecution({ type: "etapa", etapa });
      setIsFaturaDialogOpen(true);
      return;
    }
    if (etapa.id === 5 && precisaUGR && !ugrNumero.trim()) {
      setPendingExecution({ type: "etapa", etapa });
      setIsUgrDialogOpen(true);
      return;
    }
    if (etapa.id === 3 && precisaLF && !lfNumero.trim()) {
      setPendingExecution({ type: "etapa", etapa });
      setIsLfDialogOpen(true);
      return;
    }
    if (etapa.id === 4 && !contaDialogResolvido) {
      setPendingExecution({ type: "etapa", etapa });
      setIsContaDialogOpen(true);
      return;
    }
    await executeEtapa(etapa);
  };

  const handleExecutarDeducao = async (deducao: Deducao) => {
    if (!documentoId) return;
    execucaoAbortControllerRef.current?.abort();
    const controller = new AbortController();
    execucaoAbortControllerRef.current = controller;
    setIsExecutando(true);
    setParadaSolicitada(false);
    setDeducaoAtivaId(deducao.id);
    setStatusMensagem(`Executando dedução ${deducao.tipo || deducao.siafi}...`);
    setErro("");
    try {
      const datasOverride = datasDeducoes[deducao.id];
      const payload = await executarDeducao(documentoId, deducao.id, {
        signal: controller.signal,
        lfNumero,
        ugrNumero,
        vencimentoDocumento,
        dataApuracao: datasOverride?.apuracao || "",
        dataVencimento: datasOverride?.vencimento || "",
      });
      aplicarPayload(payload);
      setStatusMensagem(`Dedução ${deducao.tipo || deducao.siafi} concluída.`);
    } catch (error) {
      console.error("Erro ao executar dedução:", error);
      if (controller.signal.aborted) {
        setStatusMensagem("Parada solicitada.");
      } else {
        setErro(
          error instanceof Error ? error.message : "Erro ao executar a dedução."
        );
        setStatusMensagem(`Falha na dedução ${deducao.tipo || deducao.siafi}.`);
      }
    } finally {
      if (execucaoAbortControllerRef.current === controller) {
        execucaoAbortControllerRef.current = null;
      }
      if (!controller.signal.aborted) {
        setIsExecutando(false);
        setDeducaoAtivaId(null);
      }
    }
  };

  const handleConfirmarConta = async () => {
    const pendencia = pendingExecution;
    setIsContaDialogOpen(false);
    setContaDialogResolvido(true);
    setPendingExecution(null);
    setErro("");

    if (!pendencia) return;
    if (pendencia.type === "todas") {
      await executeAll(lfNumero, ugrNumero, vencimentoDocumento, usarContaPdf, contaBanco, contaAgencia, contaConta);
      return;
    }
    await executeEtapa(pendencia.etapa, lfNumero, ugrNumero, vencimentoDocumento, usarContaPdf, contaBanco, contaAgencia, contaConta);
  };

  const handlePararExecucao = async () => {
    if (!documentoId || !isExecutando) return;

    try {
      const payload = await pararExecucao(documentoId);
      execucaoAbortControllerRef.current?.abort();
      aplicarPayload(payload);
      setErro("");
      setStatusMensagem(payload.mensagem);
    } catch (error) {
      console.error("Erro ao solicitar parada:", error);
      setErro(
        error instanceof Error
          ? error.message
          : "Erro ao solicitar a interrupção da execução."
      );
    }
  };

  const handleApropriarSIAFI = async () => {
    if (!documentoId) return;
    setEtapaAtivaId(null);
    setStatusMensagem("Enviando apropriação ao SIAFI...");
    setErro("");
    try {
      const resultado = await apropriarSIAFI(documentoId);
      setLogs(resultado.logs);
      setLogsSimples([]);
      setStatusMensagem(resultado.mensagem);
    } catch (error) {
      console.error("Erro ao apropriar SIAFI:", error);
      setErro(
        error instanceof Error
          ? error.message
          : "Erro ao apropriar no SIAFI."
      );
      setStatusMensagem("Falha ao apropriar no SIAFI.");
    }
  };

  const handleAbrirChrome = async () => {
    setAbrindoChrome(true);
    setErro("");
    try {
      const status = await openChromeSession();
      setChromeStatus(status.chromeStatus);
    } catch (error) {
      setErro(
        error instanceof Error
          ? error.message
          : "Não foi possível abrir o Chrome."
      );
      setChromeStatus("erro");
    } finally {
      setAbrindoChrome(false);
    }
  };

  const handleConfirmarLf = async () => {
    const lfLimpa = lfNumero.trim();
    if (!lfLimpa) {
      setErro("Informe o número da LF antes de executar DOB001.");
      return;
    }

    const pendencia = pendingExecution;
    setIsLfDialogOpen(false);
    setErro("");

    if (!pendencia) return;

    // Após LF, ainda precisamos perguntar sobre a conta (se for "todas")
    if (pendencia.type === "todas" && !contaDialogResolvido) {
      setIsContaDialogOpen(true);
      return;
    }

    setPendingExecution(null);
    if (pendencia.type === "todas") {
      await executeAll(lfLimpa, ugrNumero, vencimentoDocumento, usarContaPdf, contaBanco, contaAgencia, contaConta);
      return;
    }
    await executeEtapa(pendencia.etapa, lfLimpa, ugrNumero, vencimentoDocumento, usarContaPdf, contaBanco, contaAgencia, contaConta);
  };

  const handleConfirmarUgr = async () => {
    const ugrLimpa = ugrNumero.trim();
    if (!ugrLimpa) {
      setErro("Informe a UGR antes de executar Centro de Custo.");
      return;
    }

    ugrDialogDispensadoRef.current = false;
    const pendencia = pendingExecution;
    setIsUgrDialogOpen(false);
    setErro("");

    if (!pendencia) return;

    const precisaLfDepoisDaUgr =
      precisaLF &&
      !lfNumero.trim() &&
      (pendencia.type === "todas" || pendencia.etapa.id === 3);

    if (precisaLfDepoisDaUgr) {
      setIsLfDialogOpen(true);
      return;
    }

    // Após UGR, ainda precisamos perguntar sobre a conta (se for "todas")
    if (pendencia.type === "todas" && !contaDialogResolvido) {
      setIsContaDialogOpen(true);
      return;
    }

    setPendingExecution(null);
    if (pendencia.type === "todas") {
      await executeAll(lfNumero, ugrLimpa, vencimentoDocumento, usarContaPdf, contaBanco, contaAgencia, contaConta);
      return;
    }
    await executeEtapa(pendencia.etapa, lfNumero, ugrLimpa, vencimentoDocumento, usarContaPdf, contaBanco, contaAgencia, contaConta);
  };

  const handleConfirmarFatura = async () => {
    const lfLimpa = lfNumero.trim();
    const ugrLimpa = ugrNumero.trim();
    const vencimentoLimpo = vencimentoDocumento.trim();

    if (precisaUGR && !ugrLimpa) {
      setErro("Informe a UGR para o Centro de Custo.");
      return;
    }

    if (precisaLF && !lfLimpa) {
      setErro("Informe o número da LF antes de executar este processo.");
      return;
    }

    const pendencia = pendingExecution;
    setIsFaturaDialogOpen(false);
    setErro("");
    setFaturaDialogResolvido(true);

    if (!pendencia) return;

    // Após fatura, perguntar sobre a conta
    if (!contaDialogResolvido) {
      setIsContaDialogOpen(true);
      return;
    }

    setPendingExecution(null);
    if (pendencia.type === "todas") {
      await executeAll(lfLimpa, ugrLimpa, vencimentoLimpo, usarContaPdf, contaBanco, contaAgencia, contaConta);
      return;
    }
    await executeEtapa(pendencia.etapa, lfLimpa, ugrLimpa, vencimentoLimpo, usarContaPdf, contaBanco, contaAgencia, contaConta);
  };

  const pendenciasVisiveis = pendencias.filter((pendencia) => {
    const titulo = String(pendencia.titulo ?? "").toLowerCase();

    if (titulo.includes("ugr obrigatória") && ugrNumero.trim()) {
      return false;
    }

    if (titulo.includes("lf obrigatória") && lfNumero.trim()) {
      return false;
    }

    return true;
  });

  const bloqueiosAtivos = pendenciasVisiveis.filter((pendencia) => pendencia.tipo === "bloqueio");
  const pontosAtencao = pendenciasVisiveis.filter((pendencia) =>
    ["atencao", "divergencia"].includes(pendencia.tipo)
  );

  const statusGeralVisivel: StatusGeralDocumento = isExecutando
    ? {
        tipo: "em_execucao",
        titulo: statusGeral.titulo,
        descricao: statusMensagem || statusGeral.descricao,
      }
    : bloqueiosAtivos.length > 0
      ? {
          tipo: "bloqueado",
          titulo: "Documento com bloqueios",
          descricao: `${bloqueiosAtivos.length} item(ns) exigem ação antes de seguir com segurança.`,
        }
      : pontosAtencao.length > 0
        ? {
            tipo: "atencao",
            titulo: "Documento requer conferência",
            descricao: `${pontosAtencao.length} ponto(s) merecem revisão antes da execução completa.`,
          }
        : {
            tipo: "pronto",
            titulo: "Documento pronto para seguir",
            descricao: "Nenhuma pendência ativa foi identificada neste momento.",
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
        onOpenChrome={handleAbrirChrome}
        chromeActionDisabled={abrindoChrome}
        onOpenFilaTrabalho={() =>
          filaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        }
      />

      <main className="relative mx-auto max-w-7xl px-6 py-8">
        {/* Back button and title */}
        <div className="mb-8 flex items-center gap-4">
          <Link href="/">
            <GlassButton variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </GlassButton>
          </Link>
          <h1 className="text-xl font-semibold text-foreground">
            Conferência e Automação
          </h1>
        </div>

        {erro && (
          <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {erro}
          </div>
        )}

        <div className="mb-6">
          <StatusOverview
            statusGeral={statusGeralVisivel}
            resumo={resumo}
            optanteSimples={Boolean(documento.optanteSimples)}
            hasDdf025={deducoes.some((deducao) => deducao.siafi === "DDF025")}
          />
        </div>

        {/* Main Grid Layout */}
        <div className="grid gap-6 lg:grid-cols-[280px_1fr_320px]">
          {/* Left Column - Documento */}
          <div className="space-y-6">
            <DocumentoPanel documento={documento} resumo={resumo} />
          </div>

          {/* Center Column - Notas Fiscais */}
          <div className="space-y-6">
            <NotasFiscaisTable
              notasFiscais={notasFiscais}
              empenhos={empenhos}
              deducoes={deducoes}
              resumo={resumo}
              dates={dates}
              datasDeducoes={datasDeducoes}
              onDatasDeducaoChange={(dedId, datas) =>
                setDatasDeducoes((prev) => ({ ...prev, [dedId]: datas }))
              }
              logs={logs}
              logsSimples={logsSimples}
              nivelLog={nivelLog}
              pendencias={pendenciasVisiveis}
              onLimparLogs={() => {
                setLogs([]);
                setLogsSimples([]);
                setStatusMensagem("Logs limpos.");
              }}
            />
          </div>

          {/* Right Column - Fila de Execução */}
          <div ref={filaRef} className="space-y-6">
            <FilaExecucao
              etapas={etapas}
              deducoes={deducoes}
              apuracaoDate={dates.apuracao}
              vencimentoDate={dates.vencimento}
              isExecutando={isExecutando}
              etapaAtivaId={etapaAtivaId}
              deducaoAtivaId={deducaoAtivaId}
              paradaSolicitada={paradaSolicitada}
              statusMensagem={statusMensagem}
              onExecutarEtapa={handleExecutarEtapa}
              onExecutarDeducao={handleExecutarDeducao}
              onExecutarTudo={handleExecutarTudo}
              onApropriarSIAFI={handleApropriarSIAFI}
              onPararExecucao={handlePararExecucao}
            />
          </div>
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
        onSaved={async (saved) => {
          try {
            const status = await fetchBackendStatus();
            setChromeStatus(status.chromeStatus);
          } catch {
            setChromeStatus("erro");
          }
          if (saved?.navegador) {
            setBrowserName(saved.navegador === "edge" ? "Edge" : "Chrome");
          }
          if (saved?.nivelLog) {
            setNivelLog(saved.nivelLog);
          }
        }}
        onChromeOpened={async () => {
          try {
            const status = await fetchBackendStatus();
            setChromeStatus(status.chromeStatus);
          } catch {
            setChromeStatus("erro");
          }
        }}
        onOpenDatas={() => {
          setTabelasInitialTab("datas-impostos");
          setTabelasVisibleTabs(["datas-impostos"]);
          setIsTabelasOpen(true);
        }}
      />

      <AlertDialog
        open={Boolean(avisoManual)}
        onOpenChange={(open) => {
          if (!open) {
            if (avisoManual) {
              avisosManuaisDispensadosRef.current.add(avisoManual);
            }
            setAvisoManual("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Conferência manual necessária
            </AlertDialogTitle>
            <AlertDialogDescription>
              {avisoManual}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Entendi</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={isFaturaDialogOpen}
        onOpenChange={(open) => {
          setIsFaturaDialogOpen(open);
          if (!open) {
            setPendingExecution(null);
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Informações da fatura</DialogTitle>
            <DialogDescription>
              Para processos com fatura, concentre aqui a UGR, a LF e um vencimento diferente
              para Dados Básicos e Dados de Pagamento. Se o vencimento for igual ao do processo
              ou se não existir LF, deixe em branco.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <label
                className="text-sm font-medium text-foreground"
                htmlFor="vencimento-documento"
              >
                Vencimento diferente da fatura
              </label>
              <Input
                id="vencimento-documento"
                value={vencimentoDocumento}
                placeholder="dd/mm/aaaa"
                onChange={(event) => setVencimentoDocumento(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="lf-numero-fatura">
                LF
              </label>
              <Input
                id="lf-numero-fatura"
                value={lfNumero}
                maxLength={12}
                placeholder="Preencha só se houver LF"
                onChange={(event) => setLfNumero(event.target.value)}
              />
            </div>

            {precisaUGR && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground" htmlFor="ugr-numero-fatura">
                  UGR
                </label>
                <Input
                  id="ugr-numero-fatura"
                  value={ugrNumero}
                  maxLength={6}
                  placeholder="Ex.: 153424"
                  onChange={(event) => setUgrNumero(event.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <GlassButton
              variant="ghost"
              onClick={() => {
                setIsFaturaDialogOpen(false);
                setPendingExecution(null);
              }}
            >
              Agora não
            </GlassButton>
            <GlassButton onClick={() => void handleConfirmarFatura()}>
              Confirmar dados
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isUgrDialogOpen}
        onOpenChange={(open) => {
          setIsUgrDialogOpen(open);
          if (!open) {
            ugrDialogDispensadoRef.current = true;
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>UGR necessária para Centro de Custo</DialogTitle>
            <DialogDescription>
              Este processo possui Centro de Custo. Informe a <code>UGR</code> e a automação vai usar a tabela
              <code> UORG </code>
              para converter o <code>Código SIORG</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="ugr-numero">
              UGR
            </label>
            <Input
              id="ugr-numero"
              value={ugrNumero}
              maxLength={6}
              placeholder="Ex.: 153424"
              onChange={(event) => setUgrNumero(event.target.value)}
            />
          </div>
          <DialogFooter>
            <GlassButton
              variant="ghost"
              onClick={() => {
                ugrDialogDispensadoRef.current = true;
                setIsUgrDialogOpen(false);
              }}
            >
              Agora não
            </GlassButton>
            <GlassButton onClick={() => void handleConfirmarUgr()}>
              Confirmar UGR
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isContaDialogOpen}
        onOpenChange={(open) => {
          setIsContaDialogOpen(open);
          if (!open) {
            setPendingExecution(null);
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Conta para Dados de Pagamento</DialogTitle>
            <DialogDescription>
              Escolha qual conta bancária usar no Pré-Doc. Se a conta da solicitação de
              pagamento (PDF) já está cadastrada no sistema, selecione a primeira opção.
              Caso contrário, informe os dados abaixo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setUsarContaPdf(true)}
                className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                  usarContaPdf
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-accent"
                }`}
              >
                <div>Conta da solicitação (PDF)</div>
                {(documento.bancoPdf || documento.agenciaPdf || documento.contaPdf) && (
                  <div className="mt-1 text-xs opacity-70">
                    {[
                      documento.bancoPdf && `Banco ${documento.bancoPdf}`,
                      documento.agenciaPdf && `Ag. ${documento.agenciaPdf}`,
                      documento.contaPdf && `Conta ${documento.contaPdf}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setUsarContaPdf(false);
                  // Pré-preenche com os dados do PDF como ponto de partida
                  if (!contaBanco && documento.bancoPdf) setContaBanco(documento.bancoPdf);
                  if (!contaAgencia && documento.agenciaPdf) setContaAgencia(documento.agenciaPdf);
                  if (!contaConta && documento.contaPdf) setContaConta(documento.contaPdf);
                }}
                className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                  !usarContaPdf
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-accent"
                }`}
              >
                Outra conta
              </button>
            </div>

            {!usarContaPdf && (
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="conta-banco">
                    Banco
                  </label>
                  <Input
                    id="conta-banco"
                    value={contaBanco}
                    placeholder={documento.bancoPdf || "Ex.: 001"}
                    onChange={(e) => setContaBanco(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="conta-agencia">
                    Agência
                  </label>
                  <Input
                    id="conta-agencia"
                    value={contaAgencia}
                    placeholder={documento.agenciaPdf || "Ex.: 0001-9"}
                    onChange={(e) => setContaAgencia(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="conta-conta">
                    Conta
                  </label>
                  <Input
                    id="conta-conta"
                    value={contaConta}
                    placeholder={documento.contaPdf || "Ex.: 12345-6"}
                    onChange={(e) => setContaConta(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <GlassButton
              variant="ghost"
              onClick={() => {
                setIsContaDialogOpen(false);
                setPendingExecution(null);
              }}
            >
              Agora não
            </GlassButton>
            <GlassButton onClick={() => void handleConfirmarConta()}>
              Confirmar conta
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isLfDialogOpen}
        onOpenChange={(open) => {
          setIsLfDialogOpen(open);
          if (!open) {
            if (!isUgrDialogOpen) {
              setPendingExecution(null);
            }
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Número da LF necessário</DialogTitle>
            <DialogDescription>
              Este processo possui dedução <code>DOB001</code>. Informe a LF uma única vez e a automação vai
              reaproveitar esse valor nas demais deduções do processo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="lf-numero">
              Número da LF
            </label>
            <Input
              id="lf-numero"
              value={lfNumero}
              maxLength={12}
              placeholder="Ex.: 2026LF00123"
              onChange={(event) => setLfNumero(event.target.value)}
            />
          </div>
          <DialogFooter>
            <GlassButton
              variant="ghost"
              onClick={() => {
                setIsLfDialogOpen(false);
                setPendingExecution(null);
              }}
            >
              Agora não
            </GlassButton>
            <GlassButton onClick={() => void handleConfirmarLf()}>
              Confirmar LF
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ConferenciaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
          Carregando conferência...
        </div>
      }
    >
      <ConferenciaPageContent />
    </Suspense>
  );
}

"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/header";
import { DocumentoPanel } from "@/components/documento-panel";
import { NotasFiscaisTable } from "@/components/notas-fiscais-table";
import { FilaExecucao } from "@/components/fila-execucao";
import { StatusOverview } from "@/components/status-overview";
import { TabelasModal } from "@/components/tabelas-modal";
import { ConfiguracoesModal } from "@/components/configuracoes-modal";
import { GlassButton } from "@/components/glass-card";
import { Input } from "@/components/ui/input";
import {
  abrirUrl,
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
  salvarPreenchimentoDocumento,
} from "@/lib/data";

const FILA_TRABALHO_URL =
  "https://docs.google.com/spreadsheets/d/1O2Ft4Ioy3_t4bKmPQ38d56UhHY2TBHfPI6kTkNkmy-4/edit?gid=0#gid=0";

function ConferenciaPageContent() {
  const searchParams = useSearchParams();
  const documentoId = searchParams.get("id");
  const execucaoAbortControllerRef = useRef<AbortController | null>(null);
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
  const [abrindoChrome, setAbrindoChrome] = useState(false);
  const [lfNumero, setLfNumero] = useState("");
  const [ugrNumero, setUgrNumero] = useState("");
  const [vencimentoDocumento, setVencimentoDocumento] = useState("");
  const [requiresCentroCusto, setRequiresCentroCusto] = useState(false);
  const [usarContaPdf, setUsarContaPdf] = useState(true);
  const [contaBanco, setContaBanco] = useState("");
  const [contaAgencia, setContaAgencia] = useState("");
  const [contaConta, setContaConta] = useState("");
  const [datasDeducoes, setDatasDeducoes] = useState<Record<number, { apuracao: string; vencimento: string }>>({});
  const [tocouLf, setTocouLf] = useState(false);
  const [tocouUgr, setTocouUgr] = useState(false);
  const [tocouConta, setTocouConta] = useState(false);
  const [tocouFatura, setTocouFatura] = useState(false);
  const [salvandoPendencias, setSalvandoPendencias] = useState(false);
  const precisaLF = deducoes.some((deducao) => deducao.siafi === "DOB001");
  const precisaUGR = requiresCentroCusto;
  const temFatura = notasFiscais.some((nota) =>
    nota.tipo.toLowerCase().includes("fatura")
  );
  const contaPdfDisponivel = Boolean(documento.bancoPdf || documento.agenciaPdf || documento.contaPdf);
  const contaManualCompleta = Boolean(
    contaBanco.trim() && contaAgencia.trim() && contaConta.trim()
  );
  const dadosBancariosResolvidos = usarContaPdf ? contaPdfDisponivel : contaManualCompleta;

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
    setUgrNumero("");
    setLfNumero("");
    setVencimentoDocumento("");
    setUsarContaPdf(true);
    setContaBanco("");
    setContaAgencia("");
    setContaConta("");
    setTocouLf(false);
    setTocouUgr(false);
    setTocouConta(false);
    setTocouFatura(false);
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

  const validarPendenciasPreenchimento = (contexto: "todas" | "etapa", etapa?: EtapaExecucao) => {
    const faltas: string[] = [];
    let mensagemSemClique = "";

    if ((contexto === "todas" || etapa?.id === 5) && precisaUGR && !ugrNumero.trim()) {
      faltas.push("UGR");
      if (!tocouUgr) {
        mensagemSemClique = "Preencha a UGR na aba Pendências antes de continuar.";
      }
    }

    if ((contexto === "todas" || etapa?.id === 3) && precisaLF && !lfNumero.trim()) {
      faltas.push("LF");
      if (!mensagemSemClique && !tocouLf) {
        mensagemSemClique = "Preencha a LF na aba Pendências antes de continuar.";
      }
    }

    if (contexto === "todas" || etapa?.id === 4) {
      if (temFatura && !vencimentoDocumento.trim()) {
        faltas.push("vencimento da fatura");
        if (!mensagemSemClique && !tocouFatura) {
          mensagemSemClique = "Revise os dados de fatura na aba Pendências antes de executar.";
        }
      }

      if (!dadosBancariosResolvidos) {
        faltas.push("dados bancários");
        if (!mensagemSemClique && !tocouConta) {
          mensagemSemClique = "Escolha ou preencha os dados bancários na aba Pendências antes de executar.";
        }
      }
    }

    if (faltas.length === 0) {
      return true;
    }

    setErro(mensagemSemClique || `Ainda há pendências de preenchimento: ${faltas.join(", ")}.`);
    setStatusMensagem("Preencha as lacunas destacadas na aba Pendências antes de executar.");
    return false;
  };

  const handleExecutarTudo = async () => {
    if (!validarPendenciasPreenchimento("todas")) {
      return;
    }
    await executeAll();
  };

  const handleExecutarEtapa = async (etapa: EtapaExecucao) => {
    if (!validarPendenciasPreenchimento("etapa", etapa)) {
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

  const handleSalvarPreenchimento = async () => {
    if (!documentoId) return;
    setSalvandoPendencias(true);
    setErro("");

    try {
      const payload = await salvarPreenchimentoDocumento(documentoId, {
        lfNumero,
        ugrNumero,
        vencimentoDocumento,
        usarContaPdf,
        contaBanco,
        contaAgencia,
        contaConta,
      });
      aplicarPayload(payload);
      setStatusMensagem("Preenchimento operacional salvo.");
    } catch (error) {
      console.error("Erro ao salvar preenchimento:", error);
      setErro(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar os campos de pendência."
      );
    } finally {
      setSalvandoPendencias(false);
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

  const pendenciasBaseVisiveis = pendencias.filter((pendencia) => {
    const titulo = String(pendencia.titulo ?? "").toLowerCase();

    if (titulo.includes("ugr obrigatória") && ugrNumero.trim()) {
      return false;
    }

    if (titulo.includes("lf obrigatória") && lfNumero.trim()) {
      return false;
    }

    return true;
  });

  const pendenciasLocais: PendenciaDocumento[] = [];

  if (precisaUGR && !ugrNumero.trim()) {
    pendenciasLocais.push({
      id: "local-ugr",
      tipo: "bloqueio",
      titulo: "UGR pendente",
      descricao: "Informe a UGR para liberar a etapa de Centro de Custo.",
      origem: "configuracao",
    });
  }

  if (precisaLF && !lfNumero.trim()) {
    pendenciasLocais.push({
      id: "local-lf",
      tipo: "bloqueio",
      titulo: "LF pendente",
      descricao: "Preencha a LF para permitir a execução das deduções que dependem dela.",
      origem: "configuracao",
    });
  }

  if (temFatura && !vencimentoDocumento.trim()) {
    pendenciasLocais.push({
      id: "local-fatura-vencimento",
      tipo: "atencao",
      titulo: "Vencimento da fatura não informado",
      descricao: "Se este documento usa vencimento específico de fatura, informe-o antes de executar os dados de pagamento.",
      origem: "configuracao",
    });
  }

  if (!dadosBancariosResolvidos) {
    pendenciasLocais.push({
      id: "local-banco",
      tipo: "bloqueio",
      titulo: "Dados bancários pendentes",
      descricao: usarContaPdf
        ? "Selecione uma conta válida do PDF ou troque para preenchimento manual."
        : "Preencha banco, agência e conta para concluir Dados de Pagamento.",
      origem: "configuracao",
    });
  }

  const pendenciasVisiveis = [...pendenciasBaseVisiveis, ...pendenciasLocais];

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
        onOpenFilaTrabalho={() => void abrirUrl(FILA_TRABALHO_URL)}
      />

      <main className="relative mx-auto max-w-[1600px] px-4 py-8 sm:px-6 xl:px-8">
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
            apuracaoDate={dates.apuracao}
            vencimentoDate={dates.vencimento}
          />
        </div>

        {/* Main Grid Layout */}
        <div className="grid items-start gap-6 min-[1180px]:grid-cols-[minmax(240px,300px)_minmax(0,1.7fr)_minmax(270px,330px)]">
          {/* Left Column - Documento */}
          <div className="space-y-6">
            <DocumentoPanel documento={documento} resumo={resumo} />
          </div>

          {/* Center Column - Notas Fiscais */}
          <div className="min-w-0 space-y-6">
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
              pendenciasExtraContent={
                <div className="rounded-2xl border border-glass-border/70 bg-background/55 p-4">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                        Preenchimento Operacional
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Resolva aqui as lacunas antes de executar. Se nada for selecionado, a execução avisa sem abrir pop-ups.
                      </p>
                    </div>
                    <GlassButton
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleSalvarPreenchimento()}
                      disabled={salvandoPendencias || isExecutando}
                      className="shrink-0"
                    >
                      {salvandoPendencias ? "Salvando..." : "Salvar"}
                    </GlassButton>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    {(precisaLF || temFatura) && (
                      <div className="space-y-3 rounded-2xl border border-glass-border/60 bg-secondary/20 p-4">
                        <div>
                          <p className="text-sm font-semibold text-foreground">LF e fatura</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Use a LF do processo e, se houver fatura, informe também o vencimento específico.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            LF
                          </label>
                          <Input
                            value={lfNumero}
                            maxLength={12}
                            placeholder="Ex.: 2026LF00123"
                            onFocus={() => setTocouLf(true)}
                            onChange={(event) => {
                              setTocouLf(true);
                              setLfNumero(event.target.value);
                            }}
                          />
                        </div>
                        {temFatura && (
                          <div className="space-y-2">
                            <label className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                              Vencimento da fatura
                            </label>
                            <Input
                              value={vencimentoDocumento}
                              placeholder="dd/mm/aaaa"
                              onFocus={() => setTocouFatura(true)}
                              onChange={(event) => {
                                setTocouFatura(true);
                                setVencimentoDocumento(event.target.value);
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {precisaUGR && (
                      <div className="space-y-3 rounded-2xl border border-glass-border/60 bg-secondary/20 p-4">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Centro de custo</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            A UGR será usada na etapa de Centro de Custo.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            UGR
                          </label>
                          <Input
                            value={ugrNumero}
                            maxLength={6}
                            placeholder="Ex.: 153424"
                            onFocus={() => setTocouUgr(true)}
                            onChange={(event) => {
                              setTocouUgr(true);
                              setUgrNumero(event.target.value);
                            }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="space-y-3 rounded-2xl border border-glass-border/60 bg-secondary/20 p-4 lg:col-span-2">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Dados bancários</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Escolha usar a conta do PDF ou informe manualmente banco, agência e conta.
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setTocouConta(true);
                              setUsarContaPdf(true);
                            }}
                            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                              usarContaPdf
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-glass-border bg-background text-muted-foreground hover:bg-secondary/50"
                            }`}
                          >
                            Conta do PDF
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTocouConta(true);
                              setUsarContaPdf(false);
                              if (!contaBanco && documento.bancoPdf) setContaBanco(documento.bancoPdf);
                              if (!contaAgencia && documento.agenciaPdf) setContaAgencia(documento.agenciaPdf);
                              if (!contaConta && documento.contaPdf) setContaConta(documento.contaPdf);
                            }}
                            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                              !usarContaPdf
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-glass-border bg-background text-muted-foreground hover:bg-secondary/50"
                            }`}
                          >
                            Preencher manualmente
                          </button>
                        </div>
                      </div>

                      {usarContaPdf ? (
                        <div className="rounded-xl border border-glass-border/60 bg-background/70 px-3 py-3 text-sm text-muted-foreground">
                          {contaPdfDisponivel
                            ? [documento.bancoPdf && `Banco ${documento.bancoPdf}`, documento.agenciaPdf && `Ag. ${documento.agenciaPdf}`, documento.contaPdf && `Conta ${documento.contaPdf}`].filter(Boolean).join(" · ")
                            : "Nenhuma conta foi identificada no PDF. Troque para preenchimento manual."}
                        </div>
                      ) : (
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="space-y-2">
                            <label className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                              Banco
                            </label>
                            <Input
                              value={contaBanco}
                              placeholder={documento.bancoPdf || "Ex.: 001"}
                              onFocus={() => setTocouConta(true)}
                              onChange={(e) => {
                                setTocouConta(true);
                                setContaBanco(e.target.value);
                              }}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                              Agência
                            </label>
                            <Input
                              value={contaAgencia}
                              placeholder={documento.agenciaPdf || "Ex.: 0001-9"}
                              onFocus={() => setTocouConta(true)}
                              onChange={(e) => {
                                setTocouConta(true);
                                setContaAgencia(e.target.value);
                              }}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                              Conta
                            </label>
                            <Input
                              value={contaConta}
                              placeholder={documento.contaPdf || "Ex.: 12345-6"}
                              onFocus={() => setTocouConta(true)}
                              onChange={(e) => {
                                setTocouConta(true);
                                setContaConta(e.target.value);
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              }
              onLimparLogs={() => {
                setLogs([]);
                setLogsSimples([]);
                setStatusMensagem("Logs limpos.");
              }}
            />
          </div>

          {/* Right Column - Fila de Execução */}
          <div className="space-y-6 min-[1180px]:min-w-[270px]">
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

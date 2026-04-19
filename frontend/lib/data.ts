const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000"
const DEFAULT_API_TIMEOUT_MS = 10000
const EXECUTION_API_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_API_STARTUP_TIMEOUT_MS = 15000
const DEFAULT_API_STARTUP_RETRY_MS = 750

export type ChromeStatus = "pronto" | "carregando" | "erro"

export interface ProcessDates {
  apuracao: string
  vencimento: string
}

export interface Documento {
  cnpj: string
  processo: string
  solPagamento: string
  convenio: string
  natureza: string
  ateste: string
  contrato: string
  codigoIG: string
  tipoLiquidacao: string
  alertas?: string[]
  bancoPdf?: string
  agenciaPdf?: string
  contaPdf?: string
}

export interface ResumoFinanceiro {
  bruto: number
  deducoes: number
  liquido: number
}

export interface NotaFiscal {
  id: number
  tipo: string
  nota: string
  emissao: string
  ateste: string
  valor: number
}

export interface Empenho {
  id: number
  numero: string
  situacao: string
  recurso: string
}

export interface Deducao {
  id: number
  tipo: string
  codigo: string
  siafi: string
  baseCalculo: number
  valor: number
  status: "aguardando" | "executando" | "concluido" | "erro"
  datasCalculadas?: { apuracao: string; vencimento: string }
}

export interface EtapaExecucao {
  id: number
  nome: string
  status: "aguardando" | "executando" | "concluido" | "erro"
  icone: string
}

export interface PendenciaDocumento {
  id: string
  tipo: "bloqueio" | "divergencia" | "atencao"
  titulo: string
  descricao: string
  origem?: "pdf" | "portal" | "configuracao" | "automacao"
}

export interface StatusGeralDocumento {
  tipo: "pronto" | "atencao" | "bloqueado" | "em_execucao"
  titulo: string
  descricao: string
}

export type TableKey =
  | "contratos"
  | "vpd"
  | "vpd-especiais"
  | "uorg"
  | "nat-rendimento"
  | "fontes-recurso"
  | "datas-impostos"

export interface TableColumn {
  key: string
  label: string
  editable: boolean
}

export type TableRow = Record<string, string>

export interface TableDataset {
  key: TableKey
  label: string
  description: string
  searchPlaceholder: string
  columns: TableColumn[]
  rows: TableRow[]
  totalRows: number
  fixedRows: boolean
}

export interface AppSettings {
  chromePorta: number
  navegador: "chrome" | "edge"
  perguntarLimparMes: boolean
  temaWeb: "light" | "dark"
  nivelLog: "simples" | "desenvolvedor"
}

export interface DocumentoProcessado {
  id: string
  lfNumero: string
  ugrNumero: string
  vencimentoDocumento: string
  requiresCentroCusto: boolean
  dates: ProcessDates
  documento: Documento
  resumo: ResumoFinanceiro
  notasFiscais: NotaFiscal[]
  empenhos: Empenho[]
  deducoes: Deducao[]
  etapas: EtapaExecucao[]
  pendencias: PendenciaDocumento[]
  statusGeral: StatusGeralDocumento
  logs: string[]
  logsSimples: string[]
  isRunning: boolean
  cancelRequested: boolean
}

export interface StopExecutionResponse extends DocumentoProcessado {
  success: boolean
  mensagem: string
}

export interface BackendStatus {
  chromeStatus: ChromeStatus
  chromePorta: number
}

export type BackendStartupPhase =
  | "booting-ui"
  | "starting-api"
  | "restoring-data"
  | "ready"
  | "error"

export interface BackendStartupProgress {
  phase: BackendStartupPhase
  title: string
  detail: string
  progress: number
  attempt: number
  elapsedMs: number
}

export interface OpenChromeResponse {
  success: boolean
  chromeStatus: ChromeStatus
  chromePorta: number
  url: string
  mensagem: string
}

export const MOCK_PROCESS_DATES: ProcessDates = {
  apuracao: "",
  vencimento: "",
}

export const MOCK_DOCUMENTO: Documento = {
  cnpj: "—",
  processo: "—",
  solPagamento: "—",
  convenio: "—",
  natureza: "—",
  ateste: "—",
  contrato: "—",
  codigoIG: "—",
  tipoLiquidacao: "Aguardando processamento",
  alertas: [],
}

export const MOCK_RESUMO_FINANCEIRO: ResumoFinanceiro = {
  bruto: 0,
  deducoes: 0,
  liquido: 0,
}

export const MOCK_NOTAS_FISCAIS: NotaFiscal[] = []
export const MOCK_EMPENHOS: Empenho[] = []
export const MOCK_DEDUCOES: Deducao[] = []

export const MOCK_ETAPAS_EXECUCAO: EtapaExecucao[] = [
  { id: 1, nome: "Dados Básicos", status: "aguardando", icone: "FileText" },
  { id: 2, nome: "Principal com Orçamento", status: "aguardando", icone: "DollarSign" },
  { id: 3, nome: "Dedução", status: "aguardando", icone: "MinusCircle" },
  { id: 4, nome: "Dados de Pagamento", status: "aguardando", icone: "CreditCard" },
  { id: 5, nome: "Centro de Custo", status: "aguardando", icone: "Building" },
]

interface ApiFetchOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

export const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

function getNetworkErrorMessage(
  path: string,
  error: unknown,
  abortedByCaller = false
): string {
  if (abortedByCaller) {
    return "A requisição foi interrompida antes da conclusão."
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return `A API não respondeu a tempo em ${API_BASE_URL}${path}. Verifique se o backend interno/web terminou de iniciar.`
  }

  if (error instanceof TypeError) {
    return `Não foi possível conectar à API em ${API_BASE_URL}. Aguarde alguns segundos; se persistir, reinicie o backend interno ou o backend web.`
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return `Falha ao acessar ${API_BASE_URL}${path}.`
}

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  options: ApiFetchOptions = {}
): Promise<T> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS
  let abortedByCaller = false
  let removeAbortListener: (() => void) | undefined

  if (options.signal) {
    if (options.signal.aborted) {
      abortedByCaller = true
      controller.abort()
    } else {
      const handleAbort = () => {
        abortedByCaller = true
        controller.abort()
      }
      options.signal.addEventListener("abort", handleAbort, { once: true })
      removeAbortListener = () =>
        options.signal?.removeEventListener("abort", handleAbort)
    }
  }

  const timeoutId =
    timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    })

    if (!response.ok) {
      let message = `Erro HTTP ${response.status}`
      try {
        const data = await response.json()
        message = data.detail || data.mensagem || message
      } catch {
        // sem corpo JSON
      }
      throw new Error(message)
    }

    try {
      return (await response.json()) as T
    } catch {
      throw new Error("A API respondeu sem um JSON válido.")
    }
  } catch (error) {
    throw new Error(getNetworkErrorMessage(path, error, abortedByCaller))
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
    removeAbortListener?.()
  }
}

export async function fetchBackendStatus(): Promise<BackendStatus> {
  return apiFetch<BackendStatus>("/api/status")
}

export async function waitForBackendReady(
  {
    timeoutMs = DEFAULT_API_STARTUP_TIMEOUT_MS,
    retryDelayMs = DEFAULT_API_STARTUP_RETRY_MS,
    onProgress,
  }: {
    timeoutMs?: number
    retryDelayMs?: number
    onProgress?: (progress: BackendStartupProgress) => void
  } = {}
): Promise<BackendStatus> {
  const deadline = Date.now() + timeoutMs
  const startedAt = Date.now()
  let lastError: unknown
  let attempt = 0

  onProgress?.({
    phase: "starting-api",
    title: "Iniciando API interna",
    detail: "Preparando os serviços locais do AutoLiquid...",
    progress: 18,
    attempt,
    elapsedMs: 0,
  })

  while (Date.now() <= deadline) {
    attempt += 1
    const elapsedMs = Date.now() - startedAt
    const progress = Math.min(
      82,
      22 + Math.round((elapsedMs / Math.max(timeoutMs, 1)) * 54)
    )

    onProgress?.({
      phase: "starting-api",
      title: "Conectando ao backend interno",
      detail:
        attempt === 1
          ? "Abrindo a API local pela primeira vez..."
          : `Tentativa ${attempt}: aguardando resposta em ${API_BASE_URL}.`,
      progress,
      attempt,
      elapsedMs,
    })

    try {
      const status = await fetchBackendStatus()
      onProgress?.({
        phase: "starting-api",
        title: "API conectada",
        detail: "Conexao com o backend interno estabelecida.",
        progress: 86,
        attempt,
        elapsedMs: Date.now() - startedAt,
      })
      return status
    } catch (error) {
      lastError = error
      if (Date.now() + retryDelayMs > deadline) {
        break
      }
      await delay(retryDelayMs)
    }
  }

  if (lastError instanceof Error) {
    throw lastError
  }

  throw new Error(
    `A API não ficou disponível em ${API_BASE_URL} dentro de ${Math.round(
      timeoutMs / 1000
    )} segundos.`
  )
}

export async function openChromeSession(): Promise<OpenChromeResponse> {
  return apiFetch<OpenChromeResponse>("/api/chrome/abrir", {
    method: "POST",
  })
}

export async function fetchProcessDates(): Promise<ProcessDates> {
  return apiFetch<ProcessDates>("/api/process-dates")
}

export async function fetchDocumentoProcessado(
  id: string
): Promise<DocumentoProcessado> {
  return apiFetch<DocumentoProcessado>(`/api/documentos/${id}`)
}

export async function fetchTabela(
  tableKey: TableKey,
  search?: string
): Promise<TableDataset> {
  const query = search ? `?search=${encodeURIComponent(search)}` : ""
  return apiFetch<TableDataset>(`/api/tabelas/${tableKey}${query}`)
}

export async function saveTabela(
  tableKey: TableKey,
  rows: TableRow[]
): Promise<TableDataset> {
  return apiFetch<TableDataset>(`/api/tabelas/${tableKey}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ rows }),
  })
}

export async function fetchAppSettings(): Promise<AppSettings> {
  return apiFetch<AppSettings>("/api/configuracoes")
}

export async function saveAppSettings(
  settings: AppSettings
): Promise<AppSettings> {
  return apiFetch<AppSettings>("/api/configuracoes", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  })
}

export async function recarregarModulos(): Promise<{
  recarregados: string[]
  erros: Record<string, string>
  mensagem: string
}> {
  return apiFetch("/api/recarregar", { method: "POST" })
}

export async function uploadPDF(
  file: File,
  dates: ProcessDates
): Promise<{ success: boolean; documentoId?: string; mensagem?: string }> {
  const formData = new FormData()
  formData.append("file", file)
  formData.append("apuracao", dates.apuracao)
  formData.append("vencimento", dates.vencimento)

  return apiFetch<{ success: boolean; documentoId?: string; mensagem?: string }>(
    "/api/processar",
    {
      method: "POST",
      body: formData,
    }
  )
}

export async function executarTodas(
  documentoId: string,
  options: {
    signal?: AbortSignal
    lfNumero?: string
    ugrNumero?: string
    vencimentoDocumento?: string
    usarContaPdf?: boolean
    contaBanco?: string
    contaAgencia?: string
    contaConta?: string
  } = {}
): Promise<DocumentoProcessado> {
  return apiFetch<DocumentoProcessado>(
    `/api/documentos/${documentoId}/executar-todas`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lfNumero: options.lfNumero ?? "",
        ugrNumero: options.ugrNumero ?? "",
        vencimentoDocumento: options.vencimentoDocumento ?? "",
        usarContaPdf: options.usarContaPdf ?? true,
        contaBanco: options.contaBanco ?? "",
        contaAgencia: options.contaAgencia ?? "",
        contaConta: options.contaConta ?? "",
      }),
    },
    {
      timeoutMs: EXECUTION_API_TIMEOUT_MS,
      signal: options.signal,
    }
  )
}

export async function executarEtapa(
  documentoId: string,
  etapaId: number,
  options: {
    signal?: AbortSignal
    lfNumero?: string
    ugrNumero?: string
    vencimentoDocumento?: string
    usarContaPdf?: boolean
    contaBanco?: string
    contaAgencia?: string
    contaConta?: string
  } = {}
): Promise<DocumentoProcessado> {
  return apiFetch<DocumentoProcessado>(
    `/api/documentos/${documentoId}/executar-etapa/${etapaId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lfNumero: options.lfNumero ?? "",
        ugrNumero: options.ugrNumero ?? "",
        vencimentoDocumento: options.vencimentoDocumento ?? "",
        usarContaPdf: options.usarContaPdf ?? true,
        contaBanco: options.contaBanco ?? "",
        contaAgencia: options.contaAgencia ?? "",
        contaConta: options.contaConta ?? "",
      }),
    },
    {
      timeoutMs: EXECUTION_API_TIMEOUT_MS,
      signal: options.signal,
    }
  )
}

export async function apropriarSIAFI(
  documentoId: string,
  options: { signal?: AbortSignal } = {}
): Promise<{ success: boolean; mensagem: string; logs: string[] }> {
  return apiFetch<{ success: boolean; mensagem: string; logs: string[] }>(
    `/api/documentos/${documentoId}/apropriar-siafi`,
    {
      method: "POST",
    },
    {
      timeoutMs: EXECUTION_API_TIMEOUT_MS,
      signal: options.signal,
    }
  )
}

export async function executarDeducao(
  documentoId: string,
  dedId: number,
  options: {
    signal?: AbortSignal
    lfNumero?: string
    ugrNumero?: string
    vencimentoDocumento?: string
    dataApuracao?: string
    dataVencimento?: string
  } = {}
): Promise<DocumentoProcessado> {
  return apiFetch<DocumentoProcessado>(
    `/api/documentos/${documentoId}/executar-deducao/${dedId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lfNumero: options.lfNumero ?? "",
        ugrNumero: options.ugrNumero ?? "",
        vencimentoDocumento: options.vencimentoDocumento ?? "",
        usarContaPdf: true,
        contaBanco: "",
        contaAgencia: "",
        contaConta: "",
        dataApuracao: options.dataApuracao ?? "",
        dataVencimento: options.dataVencimento ?? "",
      }),
    },
    {
      timeoutMs: EXECUTION_API_TIMEOUT_MS,
      signal: options.signal,
    }
  )
}

export async function pararExecucao(
  documentoId: string
): Promise<StopExecutionResponse> {
  return apiFetch<StopExecutionResponse>(
    `/api/documentos/${documentoId}/parar-execucao`,
    {
      method: "POST",
    }
  )
}

// ── Versão / Atualização ──────────────────────────────────────────────────

export interface VersaoInfo {
  versao_atual: string
  versao_nova: string
  url_download: string
  tem_atualizacao: boolean
  erro?: string
}

export async function obterVersao(): Promise<{ versao: string }> {
  return apiFetch<{ versao: string }>("/versao")
}

export async function verificarAtualizacao(): Promise<VersaoInfo> {
  return apiFetch<VersaoInfo>("/versao/verificar", {}, { timeoutMs: 8000 })
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowDownToLine, ArrowUp, CheckCircle2, FileUp, Loader2, MessageSquare, Plus, RefreshCw, Settings2, Trash2, X } from "lucide-react";
import { Header } from "@/components/header";
import { DateFields } from "@/components/date-fields";
import { UploadZone } from "@/components/upload-zone";
import { TabelasModal } from "@/components/tabelas-modal";
import { ConfiguracoesModal } from "@/components/configuracoes-modal";
import { DashboardModal } from "@/components/dashboard-modal";
import { FeriasModal } from "@/components/ferias-modal";
import { DashboardHistorico } from "@/components/dashboard-historico";
import { WelcomeScreen } from "@/components/welcome-screen";
import { GlassButton } from "@/components/glass-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CnpjChecker, NfeConsulta, IssPortais, HistoricoBusca } from "@/components/liquidacao";
import {
  abrirUrl,
  createFilaProcessosEventSource,
  delay,
  fetchDashboard,
  fetchFilaProcessos,
  fetchQueueServersConfig,
  fetchRocketChatNotifications,
  type BackendStartupProgress,
  type DashboardInfo,
  type FilaProcessosInfo,
  MOCK_PROCESS_DATES,
  fetchBackendStatus,
  fetchAppSettings,
  saveAppSettings,
  fetchProcessDates,
  fetchDatasGlobais,
  fetchSimplesBatch,
  fetchContratosIcLookup,
  openChromeSession,
  saveProcessDates,
  saveFilaAlerta,
  saveFilaConclusao,
  saveFilaResponsavel,
  saveQueueServersConfig,
  waitForBackendReady,
  verificarAtualizacao,
  type FilaAlerta,
  type QueueServerConfig,
  type QueueServerMode,
  type TableKey,
  type ProcessDates,
  type VersaoInfo,
  uploadPDF,
} from "@/lib/data";

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

type MainTab = "dashboard" | "painel" | "liquidacao" | "registro";

interface QueueDisplayColumn {
  key: keyof QueueDisplayRow;
  label: string;
  defaultWidth: number;
}

interface QueueDisplayRow {
  rowKey: string;
  responsavel: string;
  responsavelAlterado: boolean;
  responsavelAlteradoPor: string;
  responsavelAlteradoEm: string;
  concluido: boolean;
  concluidoPor: string;
  concluidoEm: string;
  alertas: FilaAlerta[];
  nfServicoAlerta: boolean;
  nfServicoAlertaTooltip: string;
  competencia: string;
  tipo: string;
  cpfCnpj: string;
  credor: string;
  valor: string;
  contrato: string;
  ic: string;
  dataEnc: string;
  setorOrigem: string;
  numeroProcesso: string;
  solPagamento: string;
}

const QUEUE_SERVER_STORAGE_KEY = "painel_queue_servers_v1";
const QUEUE_VISIBLE_COLUMNS_STORAGE_KEY = "painel_queue_columns_v1";
const QUEUE_COMPACT_COLUMNS_STORAGE_KEY = "painel_queue_compact_columns_v1";
const QUEUE_COLUMN_WIDTHS_STORAGE_KEY = "painel_queue_column_widths_v1";
const QUEUE_MOSTRAR_TIPO_BADGES_KEY = "painel_mostrar_tipo_badges_v1";
const QUEUE_MOSTRAR_SIMPLES_KEY = "painel_mostrar_simples_v1";
const MIN_QUEUE_COLUMN_WIDTH = 44;
const DEFAULT_QUEUE_SERVERS: QueueServerConfig[] = [
  { id: "diego", nome: "Diego", modo: "ativo" },
  { id: "rubens", nome: "Rubens", modo: "ativo" },
  { id: "gabriel", nome: "Gabriel", modo: "ativo" },
  { id: "karine", nome: "Karine", modo: "ativo" },
  { id: "ramone", nome: "Ramone", modo: "metade" },
];
const LEGACY_DISTRIBUTION_NAMES = [
  "Diego", "Rubens", "Karine", "Gabriel", "Ramone", "Diego", "Karine", "Ramone", "Rubens", "Gabriel",
  "Karine", "Gabriel", "Diego", "Ramone", "Rubens", "Karine", "Rubens", "Gabriel", "Ramone", "Diego",
  "Gabriel", "Karine", "Ramone", "Rubens", "Diego", "Gabriel", "Diego", "Ramone", "Karine", "Rubens",
  "Rubens", "Diego", "Gabriel", "Karine", "Ramone", "Rubens", "Ramone", "Karine", "Diego", "Gabriel",
  "Ramone", "Rubens", "Karine", "Diego", "Gabriel", "Ramone", "Gabriel", "Rubens", "Karine", "Diego",
  "Diego", "Ramone", "Rubens", "Gabriel", "Karine", "Diego", "Ramone", "Gabriel", "Karine", "Rubens",
  "Karine", "Diego", "Ramone", "Rubens", "Gabriel", "Karine", "Gabriel", "Ramone", "Diego", "Rubens",
  "Gabriel", "Ramone", "Diego", "Karine", "Rubens", "Gabriel", "Rubens", "Diego", "Ramone", "Karine",
  "Rubens", "Karine", "Gabriel", "Ramone", "Diego", "Rubens", "Ramone", "Karine", "Gabriel", "Diego",
  "Ramone", "Gabriel", "Rubens", "Diego", "Karine", "Ramone", "Diego", "Rubens", "Gabriel", "Karine",
] as const;
const QUEUE_DISPLAY_COLUMNS: QueueDisplayColumn[] = [
  { key: "responsavel", label: "Responsável", defaultWidth: 182 },
  { key: "competencia", label: "Competência", defaultWidth: 100 },
  { key: "tipo", label: "Tipo", defaultWidth: 140 },
  { key: "cpfCnpj", label: "CPF/CNPJ", defaultWidth: 132 },
  { key: "credor", label: "Credor", defaultWidth: 280 },
  { key: "valor", label: "Valor", defaultWidth: 110 },
  { key: "contrato", label: "Contrato", defaultWidth: 110 },
  { key: "ic", label: "IC", defaultWidth: 110 },
  { key: "dataEnc", label: "Data Enc.", defaultWidth: 102 },
  { key: "setorOrigem", label: "Setor Origem", defaultWidth: 112 },
  { key: "numeroProcesso", label: "Nº Processo", defaultWidth: 124 },
  { key: "solPagamento", label: "Sol. Pag.", defaultWidth: 108 },
];

const QUEUE_COMPACT_COLUMN_CLASSES: Partial<Record<keyof QueueDisplayRow, string>> = {
  responsavel: "min-w-[120px] max-w-[150px]",
  competencia: "min-w-[82px] max-w-[96px]",
  tipo: "min-w-[96px] max-w-[120px]",
  cpfCnpj: "min-w-[112px] max-w-[128px]",
  credor: "min-w-[220px] max-w-[280px]",
  valor: "min-w-[90px] max-w-[108px]",
  contrato: "min-w-[92px] max-w-[110px]",
  ic: "min-w-[82px] max-w-[100px]",
  dataEnc: "min-w-[88px] max-w-[100px]",
  setorOrigem: "min-w-[86px] max-w-[106px]",
  numeroProcesso: "min-w-[104px] max-w-[118px]",
  solPagamento: "min-w-[92px] max-w-[110px]",
};

function normalizeQueueCell(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseValorBRL(valor: string): number {
  // "R$ 1.274,59" → 1274.59
  const n = parseFloat(valor.replace(/[R$\s.]/g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function formatValorCompact(valor: number): string {
  if (valor >= 1_000_000) return `R$ ${(valor / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (valor >= 1_000) return `R$ ${(valor / 1_000).toFixed(1).replace(".", ",")}K`;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

interface TipoEntry {
  label: string;  // nome completo (para tooltip)
  abbr: string;   // versão curta (exibida na badge)
  style: string;
  priority: boolean;
}

// Each pattern captures a known tipo; order matters — more specific first.
const TIPO_PATTERNS: Array<{ regex: RegExp; label: string; abbr: string; style: string; priority?: boolean }> = [
  { regex: /proc\.?\s*origem/i,  label: "Proc. Origem", abbr: "P. Orig.", style: "border-rose-500/35 bg-rose-500/10 text-rose-700",     priority: true },
  { regex: /nf\s*servi[çc]o/i,   label: "NF Serviço",   abbr: "NF Srv.",  style: "border-violet-500/35 bg-violet-500/10 text-violet-700" },
  { regex: /nf\s*material/i,     label: "NF Material",  abbr: "NF Mat.",  style: "border-sky-500/35 bg-sky-500/10 text-sky-700" },
  { regex: /fatura/i,            label: "Fatura",       abbr: "Fatura",   style: "border-indigo-500/35 bg-indigo-500/10 text-indigo-700" },
  { regex: /boleto/i,            label: "Boleto",       abbr: "Boleto",   style: "border-amber-500/35 bg-amber-500/10 text-amber-700" },
  { regex: /bolsa/i,             label: "Bolsa",        abbr: "Bolsa",    style: "border-teal-500/35 bg-teal-500/10 text-teal-700" },
];

const TIPO_DEFAULT_STYLE = "border-glass-border bg-muted/40 text-muted-foreground";

function _extractTipos(raw: string, out: TipoEntry[]): void {
  let remaining = raw.trim();
  if (!remaining) return;

  let anyMatch = false;
  while (remaining.length > 0) {
    let found = false;
    for (const p of TIPO_PATTERNS) {
      const m = remaining.match(p.regex);
      if (m && m.index !== undefined) {
        out.push({ label: p.label, abbr: p.abbr, style: p.style, priority: Boolean(p.priority) });
        remaining = (remaining.slice(0, m.index) + remaining.slice(m.index + m[0].length)).trim();
        anyMatch = true;
        found = true;
        break;
      }
    }
    if (!found) {
      // No pattern matched — keep literal remainder
      if (remaining) out.push({ label: remaining, abbr: remaining, style: TIPO_DEFAULT_STYLE, priority: false });
      break;
    }
  }
  void anyMatch; // used only for intent clarity
}

function parseTipos(tipo: string): TipoEntry[] {
  if (!tipo) return [];
  // Try hard-delimiter split first (/, +, ;, |, comma); space is intentionally NOT here
  // because known types like "NF Serviço" or "NF Material" contain spaces.
  const parts = tipo.split(/[\/+;|,]/).map((p) => p.trim()).filter(Boolean);
  const entries: TipoEntry[] = [];
  if (parts.length > 1) {
    // Delimiter-separated — but still run pattern extraction on each part
    // to normalise labels (e.g. "Proc.Origem" → "Proc. Origem")
    for (const part of parts) _extractTipos(part, entries);
  } else {
    // Single string — extract all known types greedy (handles "Fatura NF Serviço")
    _extractTipos(tipo, entries);
  }
  // Proc. Origem always first
  return entries.sort((a, b) => {
    if (a.priority && !b.priority) return -1;
    if (!a.priority && b.priority) return 1;
    return 0;
  });
}

function loadQueueMostrarTipoBadges(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(QUEUE_MOSTRAR_TIPO_BADGES_KEY);
    return v === null ? true : v === "1";
  } catch { return true; }
}

function loadQueueMostrarSimples(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(QUEUE_MOSTRAR_SIMPLES_KEY);
    return v === null ? true : v === "1";
  } catch { return true; }
}

function firstNameOf(value: string): string {
  return normalizeQueueCell(value).split(" ")[0]?.toLocaleLowerCase("pt-BR") ?? "";
}

function formatFirstNameLabel(value: string): string {
  if (!value) return "";
  return value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1);
}

function formatResponsavelTooltip(autor: string, alteradoEm: string): string {
  const parts: string[] = [];
  if (autor) parts.push(`Alterado por ${autor}`);
  const parsed = alteradoEm ? new Date(alteradoEm) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    parts.push(
      `às ${parsed.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })}`
    );
  }
  return parts.join(" ") || "Responsável alterado manualmente";
}

function parseFilaAlertas(value: string | number | null | undefined): FilaAlerta[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        id: Number(item?.id ?? 0),
        mensagem: normalizeQueueCell(item?.mensagem),
        autor: normalizeQueueCell(item?.autor),
        criadoEm: normalizeQueueCell(item?.criadoEm) || null,
      }))
      .filter((item) => item.id && item.mensagem);
  } catch {
    return [];
  }
}

function formatAlertaCriadoEm(value?: string | null): string {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeDataEnc(value: string | number | null | undefined): string {
  const text = normalizeQueueCell(value);
  const match = text.match(/^(\d{1,2}\/\d{1,2}\/\d{4})/);
  return match ? match[1] : text;
}

function parseCompetenciaToTimestamp(value: string): number {
  const match = normalizeQueueCell(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const [, day, month, year] = match;
  return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
}

function parseDateBR(value: string): Date | null {
  const match = normalizeQueueCell(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateBR(date: Date): string {
  return date.toLocaleDateString("pt-BR");
}

function isBusinessDay(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function getNfServicoDeadline(competencia: Date): Date {
  const prazo = new Date(competencia.getFullYear(), competencia.getMonth() + 1, 20);
  while (!isBusinessDay(prazo)) {
    prazo.setDate(prazo.getDate() - 1);
  }
  return prazo;
}

function businessDaysUntil(target: Date, now: Date = new Date()): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  if (start.getTime() === end.getTime()) return 0;

  const step = start < end ? 1 : -1;
  const cursor = new Date(start);
  let count = 0;

  while (cursor.getTime() !== end.getTime()) {
    cursor.setDate(cursor.getDate() + step);
    if (isBusinessDay(cursor)) {
      count += step;
    }
  }

  return count;
}

function buildNfServicoAlert(tipo: string, competencia: string, limiteDiasUteis: number): {
  ativo: boolean;
  tooltip: string;
} {
  const normalizedTipo = normalizeQueueCell(tipo).toLocaleLowerCase("pt-BR");
  if (!normalizedTipo.includes("nf serviço")) {
    return { ativo: false, tooltip: "" };
  }

  const competenciaDate = parseDateBR(competencia);
  if (!competenciaDate) {
    return { ativo: false, tooltip: "" };
  }

  const prazo = getNfServicoDeadline(competenciaDate);
  const diasRestantes = businessDaysUntil(prazo);
  const limite = Math.max(0, limiteDiasUteis);
  const ativo = diasRestantes <= limite;

  if (!ativo) {
    return { ativo: false, tooltip: "" };
  }

  if (diasRestantes < 0) {
    return {
      ativo: true,
      tooltip: `NF Serviço: competência ${competencia} tem prazo em ${formatDateBR(prazo)} e está vencida há ${Math.abs(diasRestantes)} dia(s) útil(eis).`,
    };
  }

  return {
    ativo: true,
    tooltip: `NF Serviço: competência ${competencia} tem prazo em ${formatDateBR(prazo)}. Faltam ${diasRestantes} dia(s) útil(eis).`,
  };
}

function loadQueueServerConfigs(): QueueServerConfig[] {
  if (typeof window === "undefined") {
    return DEFAULT_QUEUE_SERVERS;
  }

  try {
    const raw = window.localStorage.getItem(QUEUE_SERVER_STORAGE_KEY);
    if (!raw) return DEFAULT_QUEUE_SERVERS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_QUEUE_SERVERS;

    const configs = parsed
      .filter((item): item is QueueServerConfig =>
        Boolean(item)
        && typeof item.id === "string"
        && typeof item.nome === "string"
        && ["ativo", "metade", "fora"].includes(String(item.modo))
      )
      .map((item) => ({
        id: item.id,
        nome: item.nome,
        modo: item.modo,
      }));

    return configs.length > 0 ? configs : DEFAULT_QUEUE_SERVERS;
  } catch {
    return DEFAULT_QUEUE_SERVERS;
  }
}

function loadVisibleQueueColumns(): Array<keyof QueueDisplayRow> {
  const validKeys = QUEUE_DISPLAY_COLUMNS.map((column) => column.key);
  if (typeof window === "undefined") {
    return validKeys;
  }

  try {
    const raw = window.localStorage.getItem(QUEUE_VISIBLE_COLUMNS_STORAGE_KEY);
    if (!raw) return validKeys;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return validKeys;
    const filtered = parsed.filter((key): key is keyof QueueDisplayRow => validKeys.includes(key));
    const missing = validKeys.filter((key) => !filtered.includes(key));
    const ordered = [...filtered, ...missing];
    return ordered.length > 0 ? ordered : validKeys;
  } catch {
    return validKeys;
  }
}

function loadCompactQueueColumns(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(QUEUE_COMPACT_COLUMNS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function loadQueueColumnWidths(): Partial<Record<keyof QueueDisplayRow, number>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(QUEUE_COLUMN_WIDTHS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const validKeys = new Set(QUEUE_DISPLAY_COLUMNS.map((column) => column.key));
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([key, value]) => validKeys.has(key as keyof QueueDisplayRow) && typeof value === "number")
        .map(([key, value]) => [key, Math.max(MIN_QUEUE_COLUMN_WIDTH, Math.min(520, Number(value)))])
    ) as Partial<Record<keyof QueueDisplayRow, number>>;
  } catch {
    return {};
  }
}

function hashProcessIdentifier(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeServerKey(name: string): string {
  return name.trim().toLocaleLowerCase("pt-BR");
}

function shouldUseHalfSlot(
  _slotName: string,
  _slotIndex: number,
  occurrenceIndex: number,
): boolean {
  // Extensão da fórmula original: qualquer servidor em modo 1/2
  // participa somente nas ocorrências ímpares da sua sequência dentro
  // da lista-base de 100 posições, replicando o padrão do "Ramone 1/2".
  return occurrenceIndex % 2 === 0;
}

function buildDistributionSlots(queueServers: QueueServerConfig[]) {
  const slots: Array<{ name: string; key: string; halfEligible: boolean }> = [];
  const occurrenceByName = new Map<string, number>();

  for (let index = 0; index < LEGACY_DISTRIBUTION_NAMES.length; index += 1) {
    const name = LEGACY_DISTRIBUTION_NAMES[index];
    const key = normalizeServerKey(name);
    const occurrence = occurrenceByName.get(key) ?? 0;
    occurrenceByName.set(key, occurrence + 1);
    slots.push({
      name,
      key,
      halfEligible: shouldUseHalfSlot(name, index, occurrence),
    });
  }

  const legacyNames = new Set(Array.from(LEGACY_DISTRIBUTION_NAMES, normalizeServerKey));
  const extraServers = queueServers.filter((server) => {
    const nome = server.nome.trim();
    return nome && !legacyNames.has(normalizeServerKey(nome));
  });

  for (const server of extraServers) {
    const nome = server.nome.trim();
    const key = normalizeServerKey(nome);
    for (let index = 0; index < 20; index += 1) {
      slots.push({
        name: nome,
        key,
        halfEligible: index % 2 === 0,
      });
    }
  }

  return slots;
}

function sortearResponsavel(
  numeroProcesso: string,
  queueServers: QueueServerConfig[],
): string {
  const serverMap = new Map(
    queueServers
      .filter((server) => server.nome.trim())
      .map((server) => [normalizeServerKey(server.nome), { ...server, nome: server.nome.trim() }]),
  );
  const slots = buildDistributionSlots(queueServers);
  const activeSlots = slots.filter((slot) => {
    const server = serverMap.get(slot.key);
    if (!server || server.modo === "fora") return false;
    if (server.modo === "metade") return slot.halfEligible;
    return true;
  });

  if (activeSlots.length === 0) {
    return "Ninguém ativo";
  }

  const idCalculo = Number(numeroProcesso.replace(/\D+/g, "") || "0");
  const totalSlots = slots.length;
  const posBase = ((Math.floor(idCalculo * 7919) % totalSlots) + totalSlots) % totalSlots;

  let bestWeight = -1;
  let bestName = activeSlots[0]?.name ?? "Ninguém ativo";

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const server = serverMap.get(slot.key);
    if (!server || server.modo === "fora") continue;
    if (server.modo === "metade" && !slot.halfEligible) continue;

    const sequenceIndex = index + 1;
    const weightBase = Math.floor(idCalculo * (sequenceIndex * 104729 + 13));
    const weight = ((weightBase % 10000) + 10000) % 10000
      + (index === posBase ? 1000000 : 0);

    if (weight > bestWeight) {
      bestWeight = weight;
      bestName = slot.name;
    }
  }

  return bestName;
}

function buildFilaDistribuida(
  filaProcessos: FilaProcessosInfo | null,
  queueServers: QueueServerConfig[],
  nfServicoAlertaDiasUteis: number,
): QueueDisplayRow[] {
  if (!filaProcessos?.rows?.length) return [];

  return filaProcessos.rows.map((row) => {
    const numeroProcesso = normalizeQueueCell(row["Número Processo"]);
    const solPagamento = normalizeQueueCell(row["Sol. Pagamento"]);
    const recebidoPor = normalizeQueueCell(row["Recebido Por"]);
    const responsavelManual = normalizeQueueCell(row["__responsavel_manual"]);
    const responsavelAlterado = Boolean(row["__responsavel_alterado"]) && Boolean(responsavelManual);
    const responsavelAlteradoPor = normalizeQueueCell(row["__responsavel_alterado_por"]);
    const responsavelAlteradoEm = normalizeQueueCell(row["__responsavel_alterado_em"]);
    const concluido = Boolean(row["__concluido"]);
    const concluidoPor = normalizeQueueCell(row["__concluido_por"]);
    const concluidoEm = normalizeQueueCell(row["__concluido_em"]);
    const alertas = parseFilaAlertas(row["__alertas_json"]);
    const tipo = normalizeQueueCell(row["Tipo"]);
    const competencia = normalizeQueueCell(row["Competência"]);
    const nfServicoAlert = buildNfServicoAlert(tipo, competencia, nfServicoAlertaDiasUteis);

    return {
      rowKey: `${numeroProcesso}::${solPagamento}`,
      responsavel: responsavelManual || recebidoPor || sortearResponsavel(numeroProcesso, queueServers),
      responsavelAlterado,
      responsavelAlteradoPor,
      responsavelAlteradoEm,
      concluido,
      concluidoPor,
      concluidoEm,
      alertas,
      nfServicoAlerta: nfServicoAlert.ativo,
      nfServicoAlertaTooltip: nfServicoAlert.tooltip,
      competencia,
      tipo,
      cpfCnpj: normalizeQueueCell(row["CPF/CNPJ"]),
      credor: normalizeQueueCell(row["Fornecedor/Interessado"]),
      valor: normalizeQueueCell(row["Valor"]),
      contrato: normalizeQueueCell(row["Contrato"]),
      ic: normalizeQueueCell(row["IC"]),
      dataEnc: normalizeDataEnc(row["Data Enc."]),
      setorOrigem: normalizeQueueCell(row["Setor Origem"]),
      numeroProcesso,
      solPagamento,
    };
  }).sort((a, b) => {
    const byCompetencia = parseCompetenciaToTimestamp(a.competencia) - parseCompetenciaToTimestamp(b.competencia);
    if (byCompetencia !== 0) return byCompetencia;
    return a.numeroProcesso.localeCompare(b.numeroProcesso, "pt-BR", { numeric: true });
  });
}

function buildQueueProcessCounts(rows: QueueDisplayRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeServerKey(row.responsavel);
    if (!key || key === normalizeServerKey("Ninguém ativo")) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}


export default function HomePage() {
  const router = useRouter();
  const [activeMainTab, setActiveMainTab] = useState<MainTab>("dashboard");
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
  const [nomeUsuario, setNomeUsuario] = useState<string | null>(null); // null = ainda carregando
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
  const [filaProcessos, setFilaProcessos] = useState<FilaProcessosInfo | null>(null);
  const [carregandoFila, setCarregandoFila] = useState(false);
  const [erroFila, setErroFila] = useState("");
  const [queueServers, setQueueServers] = useState<QueueServerConfig[]>(() => loadQueueServerConfigs());
  const [visibleQueueColumns, setVisibleQueueColumns] = useState<Array<keyof QueueDisplayRow>>(() => loadVisibleQueueColumns());
  const [compactQueueColumns, setCompactQueueColumns] = useState(() => loadCompactQueueColumns());
  const [queueColumnWidths, setQueueColumnWidths] = useState<Partial<Record<keyof QueueDisplayRow, number>>>(() => loadQueueColumnWidths());
  const [queueSettingsOpen, setQueueSettingsOpen] = useState(false);
  const [mostrarTipoBadges, setMostrarTipoBadges] = useState(() => loadQueueMostrarTipoBadges());
  const [mostrarSimples, setMostrarSimples] = useState(() => loadQueueMostrarSimples());
  const [queueSimplesMap, setQueueSimplesMap] = useState<Record<string, boolean | null>>({});
  const [isLoadingSimples, setIsLoadingSimples] = useState(false);
  // IC lookup: contrato (SARF) → IC (IG) da tabela de contratos; null = não cadastrado
  const [queueIcOverrides, setQueueIcOverrides] = useState<Record<string, string | null>>({});
  const [responsavelFilter, setResponsavelFilter] = useState("todos");
  const [queueResponsavelDrafts, setQueueResponsavelDrafts] = useState<Record<string, string>>({});
  const [savingResponsavelKey, setSavingResponsavelKey] = useState<string | null>(null);
  const [queueAlertDrafts, setQueueAlertDrafts] = useState<Record<string, string>>({});
  const [savingAlertKey, setSavingAlertKey] = useState<string | null>(null);
  const conclusaoPendingRef = useRef<Map<string, { latest: boolean; saving: boolean }>>(new Map());
  const [queueConclusaoOverrides, setQueueConclusaoOverrides] = useState<
    Record<string, { concluido: boolean; concluidoPor: string; concluidoEm: string }>
  >({});
  const [nfServicoAlertaDiasUteis, setNfServicoAlertaDiasUteis] = useState(3);
  const [rocketChatUnreadCount, setRocketChatUnreadCount] = useState<number | null>(null);
  const [uploadResetKey, setUploadResetKey] = useState(0);
  const [buscaProcesso, setBuscaProcesso] = useState<string | null>(null);
  const [buscaHistorico, setBuscaHistorico] = useState<{ cnpj: string; contrato?: string } | null>(null);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [isFeriasOpen, setIsFeriasOpen] = useState(false);
  const lastSavedDatesRef = useRef(JSON.stringify(MOCK_PROCESS_DATES));
  const queueServersSyncedRef = useRef(false);
  const skipNextQueueServersSaveRef = useRef(false);
  const apiStatusFailuresRef = useRef(0);

  // ── Cálculos memoizados — evita recalcular em renders causados por outros estados ──
  const filaDistribuidaBase = useMemo(
    () => buildFilaDistribuida(filaProcessos, queueServers, nfServicoAlertaDiasUteis),
    [filaProcessos, queueServers, nfServicoAlertaDiasUteis],
  );
  const filaDistribuida = useMemo(
    () => filaDistribuidaBase.map((row) => {
      const override = queueConclusaoOverrides[row.rowKey];
      return override ? { ...row, ...override } : row;
    }),
    [filaDistribuidaBase, queueConclusaoOverrides],
  );
  const queueColumnsToRender = useMemo(
    () => QUEUE_DISPLAY_COLUMNS
      .filter((column) => visibleQueueColumns.includes(column.key))
      .sort((a, b) => visibleQueueColumns.indexOf(a.key) - visibleQueueColumns.indexOf(b.key)),
    [visibleQueueColumns],
  );
  const queueColumnsByKey = useMemo(
    () => new Map(QUEUE_DISPLAY_COLUMNS.map((column) => [column.key, column])),
    [],
  );
  const inactiveQueueColumns = useMemo(
    () => QUEUE_DISPLAY_COLUMNS.filter((column) => !visibleQueueColumns.includes(column.key)),
    [visibleQueueColumns],
  );
  const queueTableMinWidth = compactQueueColumns ? "min-w-[1180px]" : "min-w-[1480px]";
  const hasManualQueueWidths = Object.keys(queueColumnWidths).length > 0;
  useEffect(() => {
    if (!startupConcluido || !apiDisponivel) return;

    let ativo = true;
    const carregarNotificacoes = async () => {
      try {
        const data = await fetchRocketChatNotifications();
        if (!ativo) return;
        setRocketChatUnreadCount(data.configured ? data.count : null);
      } catch {
        if (ativo) setRocketChatUnreadCount(null);
      }
    };

    void carregarNotificacoes();
    const intervalId = window.setInterval(() => {
      void carregarNotificacoes();
    }, 45_000);

    return () => {
      ativo = false;
      window.clearInterval(intervalId);
    };
  }, [startupConcluido, apiDisponivel]);
  const queueProcessCounts = useMemo(
    () => buildQueueProcessCounts(filaDistribuida),
    [filaDistribuida],
  );
  const responsavelOptions = useMemo(
    () => Array.from(
      new Set(filaDistribuida.map((row) => firstNameOf(row.responsavel)).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [filaDistribuida],
  );
  const filaFiltrada = useMemo(
    () => responsavelFilter === "todos"
      ? filaDistribuida
      : filaDistribuida.filter((row) => firstNameOf(row.responsavel) === responsavelFilter),
    [filaDistribuida, responsavelFilter],
  );

  // Conjunto estável de contratos sem IC — muda só quando a fila é recarregada do servidor.
  // Usado como dependência do lookup de IC para evitar re-consulta a cada check/responsável.
  const filaContratosKey = filaProcessos
    ? JSON.stringify(
        Array.from(new Set(
          filaProcessos.rows
            .filter((r) => {
              const contrato = String(r["Contrato"] ?? "").trim();
              const ic = String(r["IC"] ?? "").trim();
              return contrato && !ic;
            })
            .map((r) => String(r["Contrato"] ?? "").trim())
        )).sort()
      )
    : "";

  // Conjunto estável de CNPJs — muda só quando a fila é recarregada do servidor,
  // não quando metadados locais (check, responsável) são atualizados.
  const filaCnpjsKey = filaProcessos
    ? JSON.stringify(
        Array.from(new Set(
          filaProcessos.rows
            .map((r) => String(r["CPF/CNPJ"] ?? "").replace(/\D/g, ""))
            .filter((c) => c.length === 14)
        )).sort()
      )
    : "";

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  const resetUploadArea = () => {
    setSelectedFile(null);
    setIsUploading(false);
    setErro("");
    setUploadResetKey((current) => current + 1);
  };

  // Ref para distinguir edição de nome (debounce longo) de ação discreta (debounce curto)
  const queueServerActionRef = useRef<"typing" | "action">("action");

  const updateQueueServer = (serverId: string, patch: Partial<QueueServerConfig>) => {
    queueServerActionRef.current = "nome" in patch ? "typing" : "action";
    setQueueServers((current) =>
      current.map((server) =>
        server.id === serverId ? { ...server, ...patch } : server
      )
    );
  };

  const addQueueServer = () => {
    queueServerActionRef.current = "action";
    setQueueServers((current) => [
      ...current,
      { id: `server-${Date.now()}`, nome: "", modo: "ativo" },
    ]);
  };

  const removeQueueServer = (serverId: string) => {
    queueServerActionRef.current = "action";
    setQueueServers((current) =>
      current.filter((server) => server.id !== serverId)
    );
  };

  const loadRemoteQueueServers = async () => {
    const data = await fetchQueueServersConfig();
    if (data.servidores.length > 0) {
      skipNextQueueServersSaveRef.current = true;
      setQueueServers(data.servidores);
    }
    queueServersSyncedRef.current = true;
  };

  const updateResponsavelDraft = (rowKey: string, value: string) => {
    setQueueResponsavelDrafts((current) => ({
      ...current,
      [rowKey]: value,
    }));
  };

  const updateAlertDraft = (rowKey: string, value: string) => {
    setQueueAlertDrafts((current) => ({
      ...current,
      [rowKey]: value,
    }));
  };

  const updateRowMeta = (rowKey: string, patch: Record<string, string | number | null>) => {
    setFilaProcessos((current) => {
      if (!current) return current;
      return {
        ...current,
        rows: current.rows.map((item) => {
          const currentKey = `${normalizeQueueCell(item["Número Processo"])}::${normalizeQueueCell(item["Sol. Pagamento"])}`;
          return currentKey === rowKey ? { ...item, ...patch } : item;
        }),
      };
    });
  };

  const toggleQueueConclusao = async (row: QueueDisplayRow) => {
    const nextConcluido = !row.concluido;

    // Capture rollback state from the current row (before any optimistic update)
    const rollbackMeta = {
      __concluido: row.concluido ? "1" : "",
      __concluido_por: row.concluidoPor,
      __concluido_em: row.concluidoEm,
    };
    const rollbackOverride = queueConclusaoOverrides[row.rowKey];

    // Apply optimistic update immediately — no delay, no grey flash
    const applyOptimistic = (concluido: boolean) => {
      setQueueConclusaoOverrides((current) => ({
        ...current,
        [row.rowKey]: {
          concluido,
          concluidoPor: concluido ? (nomeUsuario || "Você") : "",
          concluidoEm: concluido ? new Date().toISOString() : "",
        },
      }));
      updateRowMeta(row.rowKey, {
        __concluido: concluido ? "1" : "",
        __concluido_por: concluido ? (nomeUsuario || "Você") : "",
        __concluido_em: concluido ? new Date().toISOString() : "",
      });
    };

    applyOptimistic(nextConcluido);

    const pending = conclusaoPendingRef.current;
    const existing = pending.get(row.rowKey);

    // Record latest intent; if a save is already in flight it will pick this up
    pending.set(row.rowKey, { latest: nextConcluido, saving: existing?.saving ?? false });
    if (existing?.saving) return;

    // Start save loop — handles rapid clicks by always sending the last intent
    pending.set(row.rowKey, { latest: nextConcluido, saving: true });
    let intent = nextConcluido;

    while (true) {
      try {
        const result = await saveFilaConclusao({
          numeroProcesso: row.numeroProcesso,
          solPagamento: row.solPagamento,
          concluido: intent,
        });
        // Sync with server-confirmed values
        updateRowMeta(row.rowKey, {
          __concluido: result.concluido ? "1" : "",
          __concluido_por: result.concluidoPor || "",
          __concluido_em: result.concluidoEm || "",
        });
        setQueueConclusaoOverrides((current) => ({
          ...current,
          [row.rowKey]: {
            concluido: result.concluido,
            concluidoPor: result.concluidoPor || "",
            concluidoEm: result.concluidoEm || "",
          },
        }));
      } catch (error) {
        // Roll back to the state before the first click in this chain
        updateRowMeta(row.rowKey, rollbackMeta);
        setQueueConclusaoOverrides((current) => {
          const next = { ...current };
          if (rollbackOverride) {
            next[row.rowKey] = rollbackOverride;
          } else {
            delete next[row.rowKey];
          }
          return next;
        });
        setErroFila(error instanceof Error ? error.message : "Não foi possível marcar o processo como concluído.");
        pending.delete(row.rowKey);
        return;
      }

      // Check if a new intent arrived while we were saving
      const current = pending.get(row.rowKey);
      if (!current || current.latest === intent) {
        pending.delete(row.rowKey);
        return;
      }
      // New intent — loop again with the updated value and apply optimistic immediately
      intent = current.latest;
      pending.set(row.rowKey, { latest: intent, saving: true });
      applyOptimistic(intent);
    }
  };

  const persistQueueAlert = async (row: QueueDisplayRow) => {
    const mensagem = normalizeQueueCell(queueAlertDrafts[row.rowKey]);
    if (!mensagem) return;

    const optimisticAlert: FilaAlerta = {
      id: -Date.now(),
      mensagem,
      autor: nomeUsuario || "Você",
      criadoEm: new Date().toISOString(),
    };

    setQueueAlertDrafts((current) => ({
      ...current,
      [row.rowKey]: "",
    }));
    setFilaProcessos((current) => {
      if (!current) return current;
      return {
        ...current,
        rows: current.rows.map((item) => {
          const currentKey = `${normalizeQueueCell(item["Número Processo"])}::${normalizeQueueCell(item["Sol. Pagamento"])}`;
          if (currentKey !== row.rowKey) return item;
          const alertas = parseFilaAlertas(item["__alertas_json"]);
          return {
            ...item,
            __alertas_json: JSON.stringify([optimisticAlert, ...alertas]),
          };
        }),
      };
    });

    setSavingAlertKey(row.rowKey);
    try {
      const result = await saveFilaAlerta({
        numeroProcesso: row.numeroProcesso,
        solPagamento: row.solPagamento,
        mensagem,
      });
      setFilaProcessos((current) => {
        if (!current || !result.alerta) return current;
        return {
          ...current,
          rows: current.rows.map((item) => {
            const currentKey = `${normalizeQueueCell(item["Número Processo"])}::${normalizeQueueCell(item["Sol. Pagamento"])}`;
            if (currentKey !== row.rowKey) return item;
            const alertas = parseFilaAlertas(item["__alertas_json"]);
            const withoutOptimistic = alertas.filter((alerta) => alerta.id !== optimisticAlert.id);
            return {
              ...item,
              __alertas_json: JSON.stringify([result.alerta, ...withoutOptimistic]),
            };
          }),
        };
      });
    } catch (error) {
      setFilaProcessos((current) => {
        if (!current) return current;
        return {
          ...current,
          rows: current.rows.map((item) => {
            const currentKey = `${normalizeQueueCell(item["Número Processo"])}::${normalizeQueueCell(item["Sol. Pagamento"])}`;
            if (currentKey !== row.rowKey) return item;
            const alertas = parseFilaAlertas(item["__alertas_json"]).filter(
              (alerta) => alerta.id !== optimisticAlert.id
            );
            return {
              ...item,
              __alertas_json: JSON.stringify(alertas),
            };
          }),
        };
      });
      setQueueAlertDrafts((current) => ({
        ...current,
        [row.rowKey]: mensagem,
      }));
      setErroFila(error instanceof Error ? error.message : "Não foi possível salvar o alerta.");
    } finally {
      setSavingAlertKey(null);
    }
  };

  const persistResponsavel = async (row: QueueDisplayRow) => {
    const nextResponsavel = (queueResponsavelDrafts[row.rowKey] ?? row.responsavel).trim();
    if (nextResponsavel === row.responsavel && !queueResponsavelDrafts[row.rowKey]) return;

    const previous = {
      __responsavel_manual: row.responsavel,
      __responsavel_alterado: row.responsavelAlterado ? "1" : "",
      __responsavel_alterado_por: row.responsavelAlteradoPor,
      __responsavel_alterado_em: row.responsavelAlteradoEm,
    };
    updateRowMeta(row.rowKey, {
      __responsavel_manual: nextResponsavel,
      __responsavel_alterado: nextResponsavel ? "1" : "",
      __responsavel_alterado_por: nextResponsavel ? (nomeUsuario || "Você") : "",
      __responsavel_alterado_em: nextResponsavel ? new Date().toISOString() : "",
    });
    setSavingResponsavelKey(row.rowKey);
    try {
      const result = await saveFilaResponsavel({
        numeroProcesso: row.numeroProcesso,
        solPagamento: row.solPagamento,
        responsavel: nextResponsavel,
      });
      setFilaProcessos((current) => {
        if (!current) return current;
        return {
          ...current,
          rows: current.rows.map((item) => {
            const currentKey = `${normalizeQueueCell(item["Número Processo"])}::${normalizeQueueCell(item["Sol. Pagamento"])}`;
            if (currentKey !== row.rowKey) return item;
            return {
              ...item,
              __responsavel_manual: nextResponsavel,
              __responsavel_alterado: nextResponsavel ? "1" : "",
              __responsavel_alterado_por: nextResponsavel ? result.alteradoPor : "",
              __responsavel_alterado_em: nextResponsavel ? result.alteradoEm ?? "" : "",
            };
          }),
        };
      });
    } catch (error) {
      updateRowMeta(row.rowKey, previous);
      setErroFila(
        error instanceof Error ? error.message : "Não foi possível salvar o responsável."
      );
    } finally {
      setSavingResponsavelKey(null);
    }
  };

  const persistNfServicoAlertSetting = async () => {
    try {
      const current = await fetchAppSettings();
      await saveAppSettings({
        ...current,
        nfServicoAlertaDiasUteis,
      });
    } catch (error) {
      setErroFila(error instanceof Error ? error.message : "Não foi possível salvar o alerta de NF Serviço.");
    }
  };

  const beginResizeQueueColumn = (
    columnKey: keyof QueueDisplayRow,
    event: React.MouseEvent<HTMLSpanElement>
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const th = event.currentTarget.closest("th");
    const startWidth = queueColumnWidths[columnKey] ?? th?.getBoundingClientRect().width ?? 120;

    const handleMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(MIN_QUEUE_COLUMN_WIDTH, Math.min(520, Math.round(startWidth + moveEvent.clientX - startX)));
      setQueueColumnWidths((current) => ({
        ...current,
        [columnKey]: nextWidth,
      }));
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const handleQueueColumnDragStart = (
    event: React.DragEvent<HTMLDivElement>,
    columnKey: keyof QueueDisplayRow
  ) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(columnKey));
  };

  const handleQueueColumnDrop = (
    event: React.DragEvent<HTMLDivElement>,
    targetKey: keyof QueueDisplayRow
  ) => {
    event.preventDefault();
    const sourceKey = event.dataTransfer.getData("text/plain") as keyof QueueDisplayRow;
    if (!sourceKey || sourceKey === targetKey) return;
    setVisibleQueueColumns((current) => {
      if (!current.includes(sourceKey) || !current.includes(targetKey)) return current;
      const withoutSource = current.filter((key) => key !== sourceKey);
      const targetIndex = withoutSource.indexOf(targetKey);
      const next = [...withoutSource];
      next.splice(targetIndex, 0, sourceKey);
      return next;
    });
  };

  const resetQueueColumnWidths = () => {
    setQueueColumnWidths({});
  };

  const toggleQueueColumn = (columnKey: keyof QueueDisplayRow) => {
    setVisibleQueueColumns((current) => {
      if (current.includes(columnKey)) {
        return current.length > 1 ? current.filter((key) => key !== columnKey) : current;
      }
      return [...current, columnKey];
    });
  };

  const moveQueueColumn = (columnKey: keyof QueueDisplayRow, direction: -1 | 1) => {
    setVisibleQueueColumns((current) => {
      const index = current.indexOf(columnKey);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const resetQueueColumnOrder = () => {
    setVisibleQueueColumns(QUEUE_DISPLAY_COLUMNS.map((column) => column.key));
  };

  const activateQueueColumn = (columnKey: keyof QueueDisplayRow) => {
    setVisibleQueueColumns((current) => current.includes(columnKey) ? current : [...current, columnKey]);
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
    if (!startupConcluido || !apiDisponivel) return;
    let ativo = true;
    loadRemoteQueueServers().catch(() => {
      if (ativo) {
        queueServersSyncedRef.current = true;
      }
    });
    return () => {
      ativo = false;
    };
  }, [startupConcluido, apiDisponivel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(QUEUE_SERVER_STORAGE_KEY, JSON.stringify(queueServers));

    if (!apiDisponivel || !queueServersSyncedRef.current) return;
    if (skipNextQueueServersSaveRef.current) {
      skipNextQueueServersSaveRef.current = false;
      return;
    }

    // Ações discretas (mudar modo, remover) salvam quase imediatamente.
    // Edição de nome usa debounce maior para evitar spam enquanto o usuário digita.
    const debounce = queueServerActionRef.current === "typing" ? 700 : 80;

    const timeoutId = window.setTimeout(() => {
      void saveQueueServersConfig(queueServers).catch((error) => {
        setErroFila(error instanceof Error ? error.message : "Não foi possível sincronizar servidores do sorteio.");
      });
    }, debounce);

    return () => window.clearTimeout(timeoutId);
  }, [queueServers, apiDisponivel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(QUEUE_VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(visibleQueueColumns));
  }, [visibleQueueColumns]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(QUEUE_COMPACT_COLUMNS_STORAGE_KEY, compactQueueColumns ? "1" : "0");
  }, [compactQueueColumns]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(QUEUE_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(queueColumnWidths));
  }, [queueColumnWidths]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(QUEUE_MOSTRAR_TIPO_BADGES_KEY, mostrarTipoBadges ? "1" : "0");
  }, [mostrarTipoBadges]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(QUEUE_MOSTRAR_SIMPLES_KEY, mostrarSimples ? "1" : "0");
  }, [mostrarSimples]);

  useEffect(() => {
    if (!mostrarSimples || !filaCnpjsKey) {
      setQueueSimplesMap({});
      setIsLoadingSimples(false);
      return;
    }
    const cnpjs: string[] = JSON.parse(filaCnpjsKey);
    if (cnpjs.length === 0) return;
    let ativo = true;
    setIsLoadingSimples(true);
    setQueueSimplesMap({});
    fetchSimplesBatch(cnpjs).then((result) => {
      if (ativo) {
        setQueueSimplesMap(result);
        setIsLoadingSimples(false);
      }
    }).catch(() => {
      if (ativo) setIsLoadingSimples(false);
    });
    return () => { ativo = false; };
  // filaCnpjsKey muda apenas quando os CNPJs da fila mudam — não quando metadados locais são atualizados.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filaCnpjsKey, mostrarSimples]);

  // Lookup de IC para linhas com contrato mas sem IC cadastrado na fila.
  // filaContratosKey muda apenas quando os contratos-sem-IC da fila mudam.
  useEffect(() => {
    if (!filaContratosKey) {
      setQueueIcOverrides({});
      return;
    }
    const sarfs: string[] = JSON.parse(filaContratosKey);
    if (sarfs.length === 0) {
      setQueueIcOverrides({});
      return;
    }
    let ativo = true;
    fetchContratosIcLookup(sarfs).then((resultado) => {
      if (ativo) setQueueIcOverrides(resultado);
    });
    return () => { ativo = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filaContratosKey]);

  useEffect(() => {
    let ativo = true;
    let ultimoStartup = INITIAL_STARTUP_STATE;

    const carregarTela = async () => {
      // Se o startup já foi concluído nesta sessão do app, faz apenas uma
      // verificação rápida em background sem mostrar o banner de loading.
      const jaFezStartup = (() => { try { return sessionStorage.getItem("startup_ok") === "1"; } catch { return false; } })();
      if (jaFezStartup) {
        try {
          const backendStatus = await waitForBackendReady({
            timeoutMs: 15000,
            retryDelayMs: 500,
          });
          if (!ativo) return;
          setChromeStatus(backendStatus.chromeStatus);
          setApiDisponivel(true);
          apiStatusFailuresRef.current = 0;
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

      const [datesGlobaisResult, settingsResult] = await Promise.allSettled([
        fetchDatasGlobais(),
        fetchAppSettings(),
      ]);

      if (datesGlobaisResult.status === "fulfilled") {
        if (!ativo) return;
        const datesGlobais = datesGlobaisResult.value;
        if (datesGlobais.vencimento || datesGlobais.apuracao) {
          setDates(datesGlobais);
          lastSavedDatesRef.current = JSON.stringify(datesGlobais);
        } else {
          // fallback para config local caso Supabase não esteja configurado
          try {
            const localDates = await fetchProcessDates();
            if (!ativo) return;
            setDates(localDates);
            lastSavedDatesRef.current = JSON.stringify(localDates);
          } catch {
            // ignora silenciosamente
          }
        }
      } else {
        // Supabase indisponível → tenta config local
        console.warn("Datas globais indisponíveis; usando config local:", datesGlobaisResult.reason);
        try {
          const localDates = await fetchProcessDates();
          if (!ativo) return;
          setDates(localDates);
          lastSavedDatesRef.current = JSON.stringify(localDates);
        } catch {
          // ignora silenciosamente
        }
      }

      if (settingsResult.status === "fulfilled" && ativo) {
        setBrowserName(settingsResult.value.navegador === "edge" ? "Edge" : "Chrome");
        setNomeUsuario(settingsResult.value.nomeUsuario || "");
        setNfServicoAlertaDiasUteis(settingsResult.value.nfServicoAlertaDiasUteis ?? 3);
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

  // Datas vêm do Supabase (datas_globais) e são somente leitura para o servidor.
  // Edições do usuário ficam em memória apenas (não são persistidas).
  // O useEffect de auto-save foi intencionalmente removido.

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
        apiStatusFailuresRef.current = 0;
        return true;
      } catch (error) {
        if (!ativo) return false;
        console.error("Erro ao consultar status do backend:", error);
        apiStatusFailuresRef.current += 1;
        if (apiStatusFailuresRef.current >= 3) {
          setChromeStatus("erro");
          setApiDisponivel(false);
          setErroInicializacao(
            error instanceof Error
              ? error.message
              : "Não foi possível consultar o status do Chrome."
          );
        }
        return false;
      }
    };

    const handleFocus = () => {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      void atualizarChrome();
    };

    const handleVisibility = () => {
      if (!document.hidden) {
        void atualizarChrome();
      }
    };

    const handlePageShow = () => {
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
        const data = await fetchDashboard(dashboardPeriodo, nomeUsuario || undefined);
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

  useEffect(() => {
    if (!startupConcluido || !apiDisponivel || activeMainTab !== "painel") {
      return;
    }

    let ativo = true;
    const carregarFila = async (refresh = false) => {
      setCarregandoFila(true);
      setErroFila("");
      try {
        const data = await fetchFilaProcessos(refresh);
        if (!ativo) return;
        setFilaProcessos(data);
        if (!refresh && data.source === "postgres-loading") {
          window.setTimeout(() => {
            if (ativo) void carregarFila(false);
          }, 1800);
        }
      } catch (error) {
        if (!ativo) return;
        setErroFila(error instanceof Error ? error.message : "Falha ao carregar fila.");
      } finally {
        if (ativo) setCarregandoFila(false);
      }
    };

    void carregarFila(false);
    return () => {
      ativo = false;
    };
  }, [startupConcluido, apiDisponivel, activeMainTab]);

  useEffect(() => {
    if (!startupConcluido || !apiDisponivel || activeMainTab !== "painel") {
      return;
    }

    let cancelled = false;
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    const source = createFilaProcessosEventSource();

    const scheduleRefresh = () => {
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      refreshTimeout = setTimeout(async () => {
        try {
          const data = await fetchFilaProcessos(false);
          if (!cancelled) {
            setFilaProcessos(data);
            setErroFila("");
          }
        } catch (error) {
          if (!cancelled) {
            setErroFila(error instanceof Error ? error.message : "Falha ao sincronizar fila.");
          }
        }
      }, 250);
    };

    const handleFilaEvent = (event: Event) => {
      const data = (() => {
        try {
          return JSON.parse((event as MessageEvent<string>).data || "{}");
        } catch {
          return {};
        }
      })();
      if (data?.type === "servidores-sorteio-atualizados") {
        void loadRemoteQueueServers();
        return;
      }
      scheduleRefresh();
    };

    source.addEventListener("fila", handleFilaEvent);
    source.onerror = () => {
      if (!cancelled) {
        scheduleRefresh();
      }
    };

    return () => {
      cancelled = true;
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      source.removeEventListener("fila", handleFilaEvent);
      source.close();
    };
  }, [startupConcluido, apiDisponivel, activeMainTab]);

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
        onGoHome={() => setActiveMainTab("dashboard")}
        onOpenTabelas={() => {
          setTabelasInitialTab("contratos");
          setTabelasVisibleTabs(undefined);
          setIsTabelasOpen(true);
        }}
        onOpenConfiguracoes={() => setIsConfiguracoesOpen(true)}
        onOpenChrome={handleAbrirChrome}
        chromeActionDisabled={abrindoChrome || !apiDisponivel}
        onOpenDashboard={() => setIsDashboardOpen(true)}
        onOpenFerias={() => setIsFeriasOpen(true)}
        rocketChatUnreadCount={rocketChatUnreadCount}
      />

      <DashboardModal
        open={isDashboardOpen}
        onClose={() => setIsDashboardOpen(false)}
        rows={filaDistribuida}
      />
      <FeriasModal
        open={isFeriasOpen}
        onClose={() => setIsFeriasOpen(false)}
        servidoresSugeridos={[...new Set(filaDistribuida.map((r) => r.responsavel).filter(Boolean))].sort()}
      />

      <main className="relative mx-auto w-full max-w-[96vw] px-4 py-6 sm:px-5 sm:py-8 2xl:max-w-[1700px]">
        <section className="mb-5 rounded-[28px] border border-glass-border bg-glass-bg px-5 py-5 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.4)] backdrop-blur-xl sm:px-6">

          {/* ── Cabeçalho + Abas ── */}
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">
                AutoLiquid
              </p>
              <h1 className="mt-2 text-balance text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {activeMainTab === "dashboard"
                  ? "Dashboard"
                  : activeMainTab === "painel"
                    ? "Fila de Processos"
                    : activeMainTab === "liquidacao"
                      ? "Liquidação"
                      : "Registro"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeMainTab === "dashboard"
                  ? "Análise histórica de todos os processos executados."
                  : activeMainTab === "painel"
                    ? "Acompanhe a fila consolidada de processos do Solar."
                    : activeMainTab === "liquidacao"
                      ? "Acesse os portais municipais e execute a liquidação no SIAFI."
                      : "Envie o PDF da liquidação para extrair e conferir os dados antes de executar."}
              </p>
            </div>

            {/* Seletor de abas */}
            <div className="flex shrink-0 gap-1 rounded-xl border border-glass-border bg-background/60 p-1">
              {(["painel", "liquidacao", "registro"] as MainTab[]).map((tab) => (
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
                  {tab === "painel" ? "Fila de Processos" : tab === "liquidacao" ? "Liquidação" : "Registro"}
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

          {/* ── Aba: Dashboard histórico ── */}
          {activeMainTab === "dashboard" && (
            <DashboardHistorico visible={activeMainTab === "dashboard"} />
          )}

          {/* ── Aba: Painel (Fila de Processos) ── */}
          {activeMainTab === "painel" && (
            <div className="space-y-4">
              <section className="rounded-2xl border border-glass-border bg-background/55 p-4 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.4)]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">Fila de Processos (Solar)</h3>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="rounded-full border border-glass-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                          >
                            {filaFiltrada.length} processos
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-80 p-0 shadow-xl">
                          {(() => {
                            const totalValor = filaFiltrada.reduce((s, r) => s + parseValorBRL(r.valor), 0);
                            const totalConcluidos = filaFiltrada.filter((r) => r.concluido).length;

                            // Agrupa por primeiro nome do responsável
                            const byResp = new Map<string, { count: number; valor: number; concluidos: number }>();
                            for (const row of filaFiltrada) {
                              const nome = formatFirstNameLabel(firstNameOf(row.responsavel)) || "—";
                              const cur = byResp.get(nome) ?? { count: 0, valor: 0, concluidos: 0 };
                              byResp.set(nome, {
                                count: cur.count + 1,
                                valor: cur.valor + parseValorBRL(row.valor),
                                concluidos: cur.concluidos + (row.concluido ? 1 : 0),
                              });
                            }
                            const sorted = Array.from(byResp.entries()).sort((a, b) => b[1].count - a[1].count);
                            const maxCount = sorted[0]?.[1]?.count ?? 1;

                            return (
                              <>
                                {/* Totais */}
                                <div className="border-b border-glass-border px-4 py-3">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary/70">
                                    Resumo da fila
                                  </p>
                                  <div className="mt-2 grid grid-cols-3 gap-2">
                                    <div className="rounded-xl border border-glass-border bg-muted/30 px-2.5 py-2 text-center">
                                      <p className="text-base font-bold text-foreground">{filaFiltrada.length}</p>
                                      <p className="text-[10px] text-muted-foreground">processos</p>
                                    </div>
                                    <div className="rounded-xl border border-glass-border bg-muted/30 px-2.5 py-2 text-center">
                                      <p className="text-base font-bold text-foreground">{formatValorCompact(totalValor)}</p>
                                      <p className="text-[10px] text-muted-foreground">valor total</p>
                                    </div>
                                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-2.5 py-2 text-center">
                                      <p className="text-base font-bold text-emerald-700">{totalConcluidos}</p>
                                      <p className="text-[10px] text-emerald-600/70">concluídos</p>
                                    </div>
                                  </div>
                                </div>

                                {/* Por responsável */}
                                <div className="px-4 py-3">
                                  <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                                    Por responsável
                                  </p>
                                  <div className="space-y-2.5">
                                    {sorted.map(([nome, stats]) => (
                                      <div key={nome}>
                                        <div className="mb-1 flex items-center justify-between gap-2">
                                          <span className="text-xs font-medium text-foreground">{nome}</span>
                                          <div className="flex items-center gap-2">
                                            {stats.concluidos > 0 && (
                                              <span className="text-[10px] font-medium text-emerald-600">
                                                {stats.concluidos} ✓
                                              </span>
                                            )}
                                            <span className="text-[10px] text-muted-foreground">
                                              {formatValorCompact(stats.valor)}
                                            </span>
                                            <span className="w-5 text-right text-xs font-semibold text-foreground">
                                              {stats.count}
                                            </span>
                                          </div>
                                        </div>
                                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
                                          <div
                                            className="h-full rounded-full bg-primary/50 transition-all"
                                            style={{ width: `${(stats.count / maxCount) * 100}%` }}
                                          />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </>
                            );
                          })()}
                        </PopoverContent>
                      </Popover>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {filaProcessos?.updatedAt
                        ? `Última atualização: ${new Date(filaProcessos.updatedAt).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}`
                        : "Tabela consolidada carregada do Solar."}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 rounded-lg border border-glass-border bg-background px-3 py-1.5 text-sm text-foreground">
                      <span className="text-xs text-muted-foreground">Responsável</span>
                      <select
                        value={responsavelFilter}
                        onChange={(event) => setResponsavelFilter(event.target.value)}
                        className="bg-transparent text-sm outline-none"
                      >
                        <option value="todos">Todos</option>
                        {responsavelOptions.map((nome) => (
                          <option key={nome} value={nome}>
                            {formatFirstNameLabel(nome)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => setQueueSettingsOpen(true)}
                      className="inline-flex items-center gap-2 rounded-lg border border-glass-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-background/80"
                    >
                      <Settings2 className="h-4 w-4" />
                      Ajustes
                    </button>
                    <GlassButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        setCarregandoFila(true);
                        setErroFila("");
                        try {
                          const data = await fetchFilaProcessos(true);
                          setFilaProcessos(data);
                        } catch (error) {
                          setErroFila(error instanceof Error ? error.message : "Falha ao atualizar fila.");
                        } finally {
                          setCarregandoFila(false);
                        }
                      }}
                      disabled={carregandoFila || !apiDisponivel}
                    >
                      <RefreshCw className={`h-4 w-4 ${carregandoFila ? "animate-spin" : ""}`} />
                      {carregandoFila ? "Atualizando..." : "Atualizar fila"}
                    </GlassButton>
                  </div>
                </div>

                {erroFila && (
                  <div className="mb-3 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {erroFila}
                  </div>
                )}

                {carregandoFila && !filaProcessos ? (
                  <div className="rounded-xl border border-glass-border bg-background/70 px-4 py-8 text-center text-sm text-muted-foreground">
                    Carregando fila de processos...
                  </div>
                ) : filaFiltrada.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-glass-border bg-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
                    <table className={`${queueTableMinWidth} table-fixed text-sm leading-5`}>
                      <thead className="bg-muted/65">
                        <tr>
                          {queueColumnsToRender.map((column) => (
                            <th
                              key={column.key}
                              style={{ width: queueColumnWidths[column.key] ?? column.defaultWidth }}
                              className={`group relative select-none whitespace-nowrap border-b border-glass-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${compactQueueColumns ? "px-2 py-2" : "px-3 py-2.5"}`}
                            >
                              {column.label}
                              <span
                                role="separator"
                                aria-orientation="vertical"
                                title="Arraste para redimensionar"
                                onMouseDown={(event) => beginResizeQueueColumn(column.key, event)}
                                className="absolute right-0 top-0 h-full w-3 cursor-col-resize opacity-0 group-hover:opacity-100 after:absolute after:right-1 after:top-1/2 after:h-4 after:w-0.5 after:-translate-y-1/2 after:rounded-full after:bg-primary/40 after:content-['']"
                              />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filaFiltrada.map((row, idx) => (
                          <tr
                            key={`fila-${idx}`}
                            className={[
                              "border-b border-glass-border/60 last:border-0",
                              row.concluido
                                ? "bg-emerald-500/10 hover:bg-emerald-500/15"
                                : "odd:bg-background/35 even:bg-background/10 hover:bg-primary/5",
                            ].join(" ")}
                          >
                            {queueColumnsToRender.map((column) => (
                              <td
                                key={`${idx}-${column.key}`}
                                style={{ width: queueColumnWidths[column.key] ?? column.defaultWidth, maxWidth: queueColumnWidths[column.key] ?? column.defaultWidth }}
                                className={`overflow-hidden whitespace-nowrap align-top text-foreground ${compactQueueColumns ? "px-2 py-2 text-[13px]" : "px-3 py-2.5"}`}
                              >
                                {column.key === "responsavel" ? (
                                  <div className={queueColumnWidths[column.key] ? "w-full min-w-0 overflow-hidden" : compactQueueColumns ? "min-w-[132px]" : "min-w-[180px]"}>
                                    <div className="flex min-w-0 items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => void toggleQueueConclusao(row)}
                                        title={
                                          row.concluido
                                            ? `Concluído${row.concluidoPor ? ` por ${row.concluidoPor}` : ""}`
                                            : "Marcar processo como concluído"
                                        }
                                        className={[
                                          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50",
                                          row.concluido
                                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700"
                                            : "border-glass-border bg-transparent text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-700",
                                        ].join(" ")}
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                      </button>
                                      <input
                                        type="text"
                                        value={queueResponsavelDrafts[row.rowKey] ?? row.responsavel}
                                        onChange={(event) =>
                                          updateResponsavelDraft(row.rowKey, event.target.value)
                                        }
                                        onBlur={() => void persistResponsavel(row)}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter") {
                                            event.currentTarget.blur();
                                          }
                                        }}
                                        className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-foreground outline-none transition-colors focus:border-primary focus:bg-background/80"
                                      />
                                      {row.responsavelAlterado ? (
                                        <span
                                          title={formatResponsavelTooltip(
                                            row.responsavelAlteradoPor,
                                            row.responsavelAlteradoEm,
                                          )}
                                          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-[11px] font-semibold text-amber-700"
                                        >
                                          !
                                        </span>
                                      ) : null}
                                      <Popover>
                                        <PopoverTrigger asChild>
                                          <button
                                            type="button"
                                            title={row.alertas.length ? "Ver alertas" : "Adicionar alerta"}
                                            className={[
                                              "inline-flex h-5 shrink-0 items-center justify-center rounded-full border text-[11px] transition-colors",
                                              row.alertas.length
                                                ? "min-w-5 border-sky-500/35 bg-sky-500/10 px-1.5 text-sky-700 hover:bg-sky-500/15"
                                                : "w-5 border-glass-border bg-transparent text-muted-foreground hover:border-sky-500/35 hover:text-sky-700",
                                            ].join(" ")}
                                          >
                                            {row.alertas.length ? (
                                              <>
                                                <MessageSquare className="h-3 w-3" />
                                                <span className="ml-1">{row.alertas.length}</span>
                                              </>
                                            ) : (
                                              <Plus className="h-3 w-3" />
                                            )}
                                          </button>
                                        </PopoverTrigger>
                                        <PopoverContent align="start" className="w-80 p-3">
                                          <div className="space-y-3">
                                            {row.alertas.length > 0 ? (
                                              <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                                                {row.alertas.map((alerta) => (
                                                  <div
                                                    key={alerta.id}
                                                    className="rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2"
                                                  >
                                                    <p className="whitespace-pre-wrap text-sm leading-5 text-foreground">
                                                      {alerta.mensagem}
                                                    </p>
                                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                                      {[alerta.autor, formatAlertaCriadoEm(alerta.criadoEm)]
                                                        .filter(Boolean)
                                                        .join(" • ")}
                                                    </p>
                                                  </div>
                                                ))}
                                              </div>
                                            ) : null}
                                            <div className="space-y-2">
                                              <textarea
                                                value={queueAlertDrafts[row.rowKey] ?? ""}
                                                onChange={(event) =>
                                                  updateAlertDraft(row.rowKey, event.target.value)
                                                }
                                                placeholder="Adicionar alerta..."
                                                rows={3}
                                                className="w-full resize-none rounded-lg border border-glass-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-sky-500"
                                              />
                                              <div className="flex justify-end">
                                                <button
                                                  type="button"
                                                  onClick={() => void persistQueueAlert(row)}
                                                  disabled={
                                                    savingAlertKey === row.rowKey ||
                                                    !normalizeQueueCell(queueAlertDrafts[row.rowKey])
                                                  }
                                                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/25 bg-sky-500/10 px-2.5 py-1.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                  <Plus className="h-3.5 w-3.5" />
                                                  Adicionar
                                                </button>
                                              </div>
                                            </div>
                                          </div>
                                        </PopoverContent>
                                      </Popover>
                                    </div>
                                  </div>
                                ) : column.key === "competencia" ? (
                                  <div className="flex w-full min-w-0 items-center overflow-hidden">
                                    {row.nfServicoAlerta ? (
                                      <span
                                        title={row.nfServicoAlertaTooltip}
                                        className="min-w-0 truncate rounded border border-red-500/40 bg-red-500/8 px-1.5 py-0.5 text-[12px] font-medium text-red-700"
                                      >
                                        {row.competencia}
                                      </span>
                                    ) : (
                                      <span className="min-w-0 truncate">{row.competencia}</span>
                                    )}
                                  </div>
                                ) : column.key === "tipo" ? (
                                  <div className="flex w-full min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
                                    {mostrarTipoBadges && row.tipo ? (() => {
                                      const tipos = parseTipos(row.tipo);
                                      return tipos.map((entry, i) => (
                                        <span
                                          key={i}
                                          title={entry.label}
                                          className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none ${entry.style}`}
                                        >
                                          {entry.abbr}
                                        </span>
                                      ));
                                    })() : (
                                      <span className="min-w-0 truncate text-foreground" title={row.tipo}>
                                        {row.tipo}
                                      </span>
                                    )}
                                    {mostrarSimples && (() => {
                                      const cnpjLimpo = row.cpfCnpj.replace(/\D/g, "");
                                      if (cnpjLimpo.length !== 14) return null;
                                      if (isLoadingSimples && !(cnpjLimpo in queueSimplesMap)) {
                                        return <span className="h-2 w-2 animate-pulse rounded-full bg-muted-foreground/30" />;
                                      }
                                      const status = queueSimplesMap[cnpjLimpo];
                                      if (status === true) return (
                                        <span title="Optante pelo Simples Nacional" className="inline-flex shrink-0 items-center rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold leading-none text-emerald-700">
                                          SN
                                        </span>
                                      );
                                      if (status === false) return (
                                        <span title="Não optante pelo Simples Nacional" className="inline-flex shrink-0 items-center rounded-full border border-orange-500/30 bg-orange-500/8 px-2 py-0.5 text-[10px] font-semibold leading-none text-orange-700">
                                          NS
                                        </span>
                                      );
                                      return null;
                                    })()}
                                  </div>
                                ) : column.key === "cpfCnpj" ? (() => {
                                  const cnpjLimpo = row.cpfCnpj.replace(/\D/g, "");
                                  const clicavel = cnpjLimpo.length === 14;
                                  return clicavel ? (
                                    <button
                                      type="button"
                                      className="block w-full min-w-0 truncate text-left underline-offset-2 hover:text-primary hover:underline"
                                      title={`${row.cpfCnpj} — clique para ver histórico`}
                                      onClick={() => {
                                        setBuscaHistorico({ cnpj: cnpjLimpo, contrato: row.contrato || undefined });
                                        setActiveMainTab("liquidacao");
                                      }}
                                    >
                                      {row.cpfCnpj}
                                    </button>
                                  ) : (
                                    <span className="block min-w-0 truncate">{row.cpfCnpj}</span>
                                  );
                                })() : column.key === "credor" ? (
                                  <button
                                    type="button"
                                    className="block w-full min-w-0 truncate text-left text-foreground underline-offset-2 hover:text-primary hover:underline"
                                    title={`${row.credor} — clique para ver histórico`}
                                    onClick={() => {
                                      const cnpj = row.cpfCnpj.replace(/\D/g, "");
                                      if (cnpj.length === 14) {
                                        setBuscaHistorico({ cnpj, contrato: row.contrato || undefined });
                                        setActiveMainTab("liquidacao");
                                      }
                                    }}
                                  >
                                    {row.credor}
                                  </button>
                                ) : column.key === "valor" ? (
                                  <span className="block w-full min-w-0 truncate text-right tabular-nums" title={row.valor}>
                                    {row.valor}
                                  </span>
                                ) : column.key === "ic" ? (() => {
                                  // Se já tem IC na fila, exibe normalmente
                                  if (row.ic) {
                                    return (
                                      <span className="block min-w-0 truncate" title={row.ic}>
                                        {row.ic}
                                      </span>
                                    );
                                  }
                                  // Se tem contrato, tenta o lookup na tabela de contratos
                                  if (row.contrato) {
                                    const icLookup = queueIcOverrides[row.contrato];
                                    if (icLookup === null) {
                                      // Cadastrado na tabela mas sem IC, ou não encontrado
                                      return (
                                        <span className="block min-w-0 truncate text-[11px] italic text-muted-foreground/60" title="Não cadastrado na tabela de contratos">
                                          Não cadastrado
                                        </span>
                                      );
                                    }
                                    if (icLookup) {
                                      return (
                                        <span className="block min-w-0 truncate" title={icLookup}>
                                          {icLookup}
                                        </span>
                                      );
                                    }
                                  }
                                  return <span className="block min-w-0 truncate text-muted-foreground/40">—</span>;
                                })() : (
                                  <span className="block min-w-0 truncate" title={String(row[column.key] ?? "")}>
                                    {String(row[column.key] ?? "")}
                                  </span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-xl border border-glass-border bg-background/70 px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhum processo na fila para exibir.
                  </div>
                )}
              </section>
            </div>
          )}

          {/* ── Aba: Liquidação ── */}
          {activeMainTab === "liquidacao" && (
            <div className="space-y-4">
              <IssPortais />
              <CnpjChecker />
              <NfeConsulta />
              <HistoricoBusca buscaInicial={buscaProcesso} buscaInicialCnpj={buscaHistorico} />
            </div>
          )}

          {/* ── Aba: Registro ── */}
          {activeMainTab === "registro" && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            {/* Coluna esquerda: datas + upload (cards separados) */}
            <div className="flex flex-col gap-4">
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

            {/* Coluna direita: dashboard */}
            <div className="rounded-3xl border border-glass-border bg-background/55 p-5 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.4)] flex flex-col gap-4">
              {/* Cabeçalho do dashboard */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                    Meus processos
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {nomeUsuario || "Servidor"}
                  </p>
                </div>
                <select
                  value={dashboardPeriodo}
                  onChange={(event) =>
                    setDashboardPeriodo(event.target.value as keyof typeof DASHBOARD_LABELS)
                  }
                  className="rounded-xl border border-glass-border bg-background/80 px-3 py-2 text-xs text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  {Object.entries(DASHBOARD_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              {/* Métricas */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-glass-border/70 bg-background/70 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Bruto</p>
                  <p className="mt-1 whitespace-nowrap text-base font-bold tabular-nums text-foreground sm:text-lg">
                    {carregandoDashboard ? "—" : formatCurrency(dashboard?.valorBruto ?? 0)}
                  </p>
                </div>
                <div className="rounded-2xl border border-glass-border/70 bg-background/70 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Processos</p>
                  <p className="mt-1 text-xl font-bold text-foreground">
                    {carregandoDashboard ? "—" : dashboard?.quantidadeProcessos ?? 0}
                  </p>
                </div>
              </div>

              {/* Lista de processos recentes */}
              <div className="flex flex-col gap-1 flex-1">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Recentes
                  </p>
                  {dashboard?.habilitado === false && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                      BD indisponível
                    </span>
                  )}
                </div>

                {carregandoDashboard ? (
                  <p className="text-sm text-muted-foreground py-2">Carregando...</p>
                ) : (dashboard?.ultimosProcessos?.length ?? 0) > 0 ? (
                  dashboard!.ultimosProcessos.map((processo, index) => (
                    <button
                      key={processo.numeroProcesso || `processo-${index}`}
                      type="button"
                      onClick={() => {
                        setBuscaProcesso(processo.numeroProcesso);
                        setActiveMainTab("liquidacao");
                      }}
                      className="group flex w-full items-center gap-3 rounded-xl border border-glass-border/50 bg-secondary/20 px-3 py-2.5 text-left transition-all hover:border-primary/30 hover:bg-primary/5"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground group-hover:bg-primary/15 group-hover:text-primary">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-foreground font-mono">
                          {processo.numeroProcesso}
                        </p>
                        {processo.fornecedor && (
                          <p className="truncate text-[11px] text-muted-foreground">
                            {processo.fornecedor}
                          </p>
                        )}
                      </div>
                      {processo.bruto != null && processo.bruto > 0 && (
                        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">
                          {formatCurrency(processo.bruto)}
                        </span>
                      )}
                    </button>
                  ))
                ) : (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {nomeUsuario
                      ? "Nenhum processo registrado ainda."
                      : "Configure seu nome para ver seus processos."}
                  </p>
                )}
              </div>
            </div>
          </div>
          )}
        </section>
      </main>

      {queueSettingsOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Fechar ajustes"
            className="absolute inset-0 bg-background/65 backdrop-blur-sm"
            onClick={() => setQueueSettingsOpen(false)}
          />
          <div className="relative z-10 w-full max-w-5xl overflow-hidden rounded-[28px] border border-glass-border bg-background/95 shadow-[0_30px_100px_-45px_rgba(15,23,42,0.45)]">
            <div className="flex items-start justify-between gap-4 border-b border-glass-border px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary/80">
                  Ajustes da Fila
                </p>
                <h2 className="mt-1.5 text-xl font-semibold text-foreground">
                  Visualização e sorteio
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ajuste as colunas e o sorteio sem ocupar a tela inteira.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQueueSettingsOpen(false)}
                className="rounded-full border border-glass-border bg-background p-2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[76vh] overflow-y-auto px-5 py-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <section className="rounded-2xl border border-glass-border bg-muted/20 p-4">
                  <div className="mb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">Colunas visíveis</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Oculte colunas ou arraste as divisórias do cabeçalho para redimensionar.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={resetQueueColumnWidths}
                        className="rounded-lg border border-glass-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Resetar larguras
                      </button>
                    </div>
                  </div>
                  <label className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-glass-border bg-background px-3 py-2.5 text-sm text-foreground">
                    <span>
                      <span className="block font-medium">Colunas compactas</span>
                      <span className="text-xs text-muted-foreground">
                        Reduz larguras e espaçamentos apenas neste computador.
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={compactQueueColumns}
                      onChange={(event) => setCompactQueueColumns(event.target.checked)}
                    />
                  </label>
                  <label className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-red-500/15 bg-red-500/5 px-3 py-2.5 text-sm text-foreground">
                    <span>
                      <span className="block font-medium">Alerta para NF Serviço</span>
                      <span className="text-xs text-muted-foreground">
                        Dias úteis antes do dia 20 útil, ou dia útil anterior, do mês seguinte à competência.
                      </span>
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={nfServicoAlertaDiasUteis}
                      onChange={(event) =>
                        setNfServicoAlertaDiasUteis(Number(event.target.value || 0))
                      }
                      onBlur={() => void persistNfServicoAlertSetting()}
                      className="w-20 rounded-xl border border-glass-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
                    />
                  </label>
                  <label className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-glass-border bg-background px-3 py-2.5 text-sm text-foreground">
                    <span>
                      <span className="block font-medium">Badges de tipo</span>
                      <span className="text-xs text-muted-foreground">
                        Exibe etiquetas coloridas por tipo (NF Serviço, Boleto, Proc. Origem…) na coluna Tipo.
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={mostrarTipoBadges}
                      onChange={(event) => setMostrarTipoBadges(event.target.checked)}
                    />
                  </label>
                  <label className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-glass-border bg-background px-3 py-2.5 text-sm text-foreground">
                    <span>
                      <span className="block font-medium">Indicador Simples Nacional</span>
                      <span className="text-xs text-muted-foreground">
                        Exibe badge "SN" no credor quando o CNPJ estiver no cache do Supabase. Órgãos federais não exibem badge.
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={mostrarSimples}
                      onChange={(event) => setMostrarSimples(event.target.checked)}
                    />
                  </label>
                  <div className="mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={resetQueueColumnOrder}
                      className="rounded-lg border border-glass-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Ordem padrão
                    </button>
                  </div>
                  <div className="space-y-2">
                    {visibleQueueColumns.map((columnKey, index) => {
                      const column = queueColumnsByKey.get(columnKey);
                      if (!column) return null;
                      return (
                        <div
                          key={column.key}
                          draggable
                          onDragStart={(event) => handleQueueColumnDragStart(event, column.key)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => handleQueueColumnDrop(event, column.key)}
                          className="grid cursor-grab grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border border-glass-border bg-background px-3 py-2 text-sm text-foreground active:cursor-grabbing"
                        >
                          <button
                            type="button"
                            onClick={() => toggleQueueColumn(column.key)}
                            disabled={visibleQueueColumns.length === 1}
                            className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-[11px] font-bold text-primary disabled:opacity-40"
                            title="Desativar coluna"
                          >
                            ✓
                          </button>
                          <span className="min-w-0 truncate">{column.label}</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => moveQueueColumn(column.key, -1)}
                              disabled={index === 0}
                              title="Mover para a esquerda"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-glass-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-35"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveQueueColumn(column.key, 1)}
                              disabled={index === visibleQueueColumns.length - 1}
                              title="Mover para a direita"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-glass-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-35"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 rounded-2xl border border-dashed border-glass-border bg-background/60 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Colunas desativadas
                    </p>
                    {inactiveQueueColumns.length ? (
                      <div className="flex flex-wrap gap-2">
                        {inactiveQueueColumns.map((column) => (
                          <button
                            key={column.key}
                            type="button"
                            onClick={() => activateQueueColumn(column.key)}
                            className="rounded-full border border-glass-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                          >
                            + {column.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Todas as colunas estão ativas.</p>
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-glass-border bg-muted/20 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">Servidores no sorteio</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Configure os servidores ativos, em `1/2` ou fora do sorteio.
                      </p>
                    </div>
                    <GlassButton type="button" variant="secondary" size="sm" onClick={addQueueServer}>
                      <Plus className="h-4 w-4" />
                      Adicionar
                    </GlassButton>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-glass-border bg-background">
                    <div className="hidden grid-cols-[minmax(0,1fr)_120px_140px_52px] gap-3 border-b border-glass-border bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground md:grid">
                      <span>Servidor</span>
                      <span className="text-center">Fila</span>
                      <span>Status</span>
                      <span className="text-center">Ação</span>
                    </div>
                    <div className="divide-y divide-glass-border">
                      {queueServers.map((server) => (
                        <div
                          key={server.id}
                          className="grid gap-2 px-3 py-3 md:grid-cols-[minmax(0,1fr)_120px_140px_52px] md:items-center md:gap-3"
                        >
                          <input
                            type="text"
                            value={server.nome}
                            onChange={(event) =>
                              updateQueueServer(server.id, { nome: event.target.value })
                            }
                            placeholder="Nome do servidor"
                            className="min-w-0 rounded-xl border border-glass-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
                          />
                          <div className="flex md:justify-center">
                            <span className="inline-flex rounded-full border border-glass-border bg-muted/30 px-2.5 py-1 text-xs font-medium text-foreground">
                              {queueProcessCounts.get(normalizeServerKey(server.nome)) ?? 0} processos
                            </span>
                          </div>
                          <select
                            value={server.modo}
                            onChange={(event) =>
                              updateQueueServer(server.id, {
                                modo: event.target.value as QueueServerMode,
                              })
                            }
                            className="rounded-xl border border-glass-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
                          >
                            <option value="ativo">Ativo</option>
                            <option value="metade">1/2</option>
                            <option value="fora">Fora</option>
                          </select>
                          <div className="flex md:justify-center">
                            <button
                              type="button"
                              onClick={() => removeQueueServer(server.id)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-glass-border text-muted-foreground transition-colors hover:border-destructive/30 hover:text-destructive"
                              title="Remover servidor"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
            setNomeUsuario(settings.nomeUsuario || "");
            setNfServicoAlertaDiasUteis(settings.nfServicoAlertaDiasUteis ?? 3);
            try {
              const rocket = await fetchRocketChatNotifications();
              setRocketChatUnreadCount(rocket.configured ? rocket.count : null);
            } catch {
              setRocketChatUnreadCount(null);
            }
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
      />

      {/* Tela de boas-vindas — aparece apenas na primeira abertura */}
      {startupConcluido && nomeUsuario === "" && (
        <WelcomeScreen onConcluido={(nome) => setNomeUsuario(nome)} />
      )}
    </div>
  );
}

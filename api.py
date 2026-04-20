"""API FastAPI para integrar o frontend Next.js com a automacao Python."""

from __future__ import annotations

import importlib
import json
import logging
import os
import shutil
import sys
import tempfile
import inspect
import unicodedata
from copy import deepcopy
from pathlib import Path
from typing import Any
from uuid import uuid4

# ── Carrega variáveis de ambiente do arquivo .env ─────────────────────────────
# Procura o .env em ordem:
#   1. ~/.autoliquid/.env   (pasta do usuário — recomendado)
#   2. Pasta do executável  (ao lado do .app no macOS / .exe no Windows)
#   3. Diretório de trabalho atual
try:
    from dotenv import load_dotenv
    _env_candidates = [
        Path.home() / ".autoliquid" / ".env",
        Path(sys.executable).parent / ".env",
        Path(".env"),
    ]
    for _env_path in _env_candidates:
        if _env_path.exists():
            load_dotenv(_env_path)
            break
except Exception:
    pass

import requests
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from consulta_cnpj import verificar_simples_nacional
from comprasnet_base import conectar as conectar_comprasnet
from comprasnet_base import extrair_codigo_situacao, extrair_siafi_completo
from core.app_paths import URL_INICIAL
from core.runtime_config import obter_datas_salvas, obter_porta_chrome
from datas_impostos import calcular_datas_documento, dias_uteis_ate
from extrator import extrair_dados_pdf
from services.chrome_service import abrir_chrome, chrome_esta_aberto
from services.web_config_service import (
    TABLE_DEFINITIONS,
    carregar_configuracoes_web,
    carregar_tabela_web,
    salvar_configuracoes_web,
    salvar_tabela_web,
)
from services.postgres_service import (
    obter_dashboard,
    persistir_documento_com_log,
    postgres_habilitado,
)

log = logging.getLogger(__name__)

DEFAULT_APP_VERSION = "1.0.14"


def _candidatos_tauri_conf() -> list[Path]:
    base_dir = Path(__file__).resolve().parent
    candidatos = [
        base_dir / "src-tauri" / "tauri.conf.json",
        base_dir / "tauri.conf.json",
    ]
    meipass = getattr(sys, "_MEIPASS", "")
    if meipass:
        bundle_dir = Path(meipass)
        candidatos.extend(
            [
                bundle_dir / "src-tauri" / "tauri.conf.json",
                bundle_dir / "tauri.conf.json",
            ]
        )
    return candidatos


def _obter_app_version() -> str:
    for caminho in _candidatos_tauri_conf():
        try:
            if not caminho.exists():
                continue
            config = json.loads(caminho.read_text(encoding="utf-8"))
            versao = str(config.get("version", "") or "").strip().lstrip("v")
            if versao:
                return versao
        except Exception:
            continue
    return DEFAULT_APP_VERSION


APP_VERSION = _obter_app_version()
app = FastAPI(title="Automacao DCF API", version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ETAPAS_BASE = [
    {"id": 0, "nome": "Apropriar Instrumento", "status": "aguardando", "icone": "ClipboardCheck"},
    {"id": 1, "nome": "Dados Básicos", "status": "aguardando", "icone": "FileText"},
    {"id": 2, "nome": "Principal com Orçamento", "status": "aguardando", "icone": "DollarSign"},
    {"id": 3, "nome": "Dedução", "status": "aguardando", "icone": "MinusCircle"},
    {"id": 4, "nome": "Dados de Pagamento", "status": "aguardando", "icone": "CreditCard"},
    {"id": 5, "nome": "Centro de Custo", "status": "aguardando", "icone": "Building"},
]

DOCUMENTOS_PROCESSADOS: dict[str, dict[str, Any]] = {}


class ExecucaoInterrompida(Exception):
    """Sinaliza interrupção cooperativa de uma etapa em andamento."""


class TableSaveRequest(BaseModel):
    rows: list[dict[str, Any]]


class WebConfigPayload(BaseModel):
    chromePorta: int
    navegador: str = "chrome"
    perguntarLimparMes: bool
    temaWeb: str = "light"
    nivelLog: str = "desenvolvedor"


class ChromeOpenResponse(BaseModel):
    success: bool
    chromeStatus: str
    chromePorta: int
    url: str
    mensagem: str


class ExecucaoPayload(BaseModel):
    lfNumero: str = ""
    ugrNumero: str = ""
    vencimentoDocumento: str = ""
    usarContaPdf: bool = True
    contaBanco: str = ""
    contaAgencia: str = ""
    contaConta: str = ""
    # Datas específicas por dedução (sobrepõem as datas globais do documento)
    dataApuracao: str = ""
    dataVencimento: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _brl_para_float(s: str) -> float:
    """Converte string numérica para float, suportando formato BRL (1.234,56)
    e formato inglês (1,234.56).

    A detecção usa a posição do último separador:
    - Se a última vírgula vem depois do último ponto → formato BRL (vírgula = decimal)
    - Se o último ponto vem depois da última vírgula → formato inglês (ponto = decimal)
    """
    try:
        txt = str(s or "0").strip()
        if not txt or txt in ("-", "—"):
            return 0.0
        last_dot   = txt.rfind(".")
        last_comma = txt.rfind(",")
        if last_comma > last_dot:
            # Formato BRL: 1.234,56
            return float(txt.replace(".", "").replace(",", "."))
        elif last_dot > last_comma:
            # Formato inglês: 1,234.56
            return float(txt.replace(",", ""))
        else:
            # Sem separador de milhar, só números (ou só vírgulas/pontos)
            return float(txt.replace(".", "").replace(",", "."))
    except Exception:
        return 0.0


def _atualizar_etapa(doc: dict, etapa_id: int, status: str) -> None:
    for etapa in doc["etapas"]:
        if etapa["id"] == etapa_id:
            etapa["status"] = status
            break


def _log(doc: dict, mensagem: str) -> None:
    doc["logs"].append(mensagem)


def _log_s(doc: dict, mensagem: str) -> None:
    """Adiciona mensagem ao log simplificado (legível por usuário comum)."""
    doc["logs_simples"].append(mensagem)


def _s_campo(dados: dict, *chaves: str) -> str:
    """Lê um campo do dicionário tentando a chave UTF-8 e a versão garbled (latin-1)."""
    for chave in chaves:
        v = dados.get(chave)
        if v is not None:
            return str(v).strip()
        try:
            garbled = chave.encode("utf-8").decode("latin-1")
            v = dados.get(garbled)
            if v is not None:
                return str(v).strip()
        except Exception:
            pass
    return ""


def _gerar_logs_simples_conferencia(dados: dict) -> list:
    """Retorna lista vazia — mensagens de conferência são geradas por etapa durante a execução."""
    return []


def _gerar_logs_etapa_sucesso(dados: dict, etapa_id: int, venc: str = "") -> list:
    """Gera mensagens para o log simplificado após cada etapa concluída.

    Formato das linhas:
      HEADER <nome da seção>
      OK <mensagem de confirmação>
    """
    msgs: list = []

    if etapa_id == 0:
        msgs.append("HEADER Apropriar Instrumento")
        msgs.append("OK Instrumento de cobrança pesquisado e apropriado com sucesso")

    elif etapa_id == 1:
        msgs.append("HEADER Dados Básicos")

        ateste = _s_campo(dados, "Data de Ateste")
        if ateste:
            msgs.append(f"OK Data de ateste conferida — {ateste}")

        cnpj = _s_campo(dados, "CNPJ")
        if cnpj:
            msgs.append(f"OK CNPJ {cnpj} conferido")

        processo = _s_campo(dados, "Processo")
        if processo:
            msgs.append(f"OK Processo {processo} conferido")

        for nf in dados.get("Notas Fiscais", []):
            num    = _s_campo(nf, "Número da Nota", "Nº", "N.Nota", "Numero da Nota")
            valor  = _s_campo(nf, "Valor")
            emissao = _s_campo(nf, "Data de Emissão", "Emissão")
            tipo   = _s_campo(nf, "Tipo") or "NF"
            label  = f"{tipo} {num}".strip() if num else tipo
            if valor and valor not in ("0", "0,00"):
                linha = f"{label} — {valor}" + (f" — emissão {emissao}" if emissao else "")
            elif emissao:
                linha = f"{label} — emissão {emissao}"
            else:
                linha = label
            msgs.append(f"OK {linha} conferida")

    elif etapa_id == 2:
        msgs.append("HEADER Principal com Orçamento")
        resumo = dados.get("Resumo", {})
        bruto = _s_campo(resumo, "Valor Bruto")
        if bruto and bruto not in ("0", "0,00"):
            msgs.append(f"OK Crédito {bruto} registrado")
        else:
            msgs.append("OK Crédito principal registrado")

    elif etapa_id == 3:
        msgs.append("HEADER Deduções")
        deducoes = dados.get("Deduções", [])
        if not deducoes:
            msgs.append("OK Deduções registradas")
        for ded in deducoes:
            siafi    = _s_campo(ded, "Situação SIAFI")
            tipo_ded = _s_campo(ded, "Situação") or "Dedução"
            valor_ded = _s_campo(ded, "Valor")
            label = f"{siafi} — {tipo_ded}" if siafi else tipo_ded
            if valor_ded and valor_ded not in ("0", "0,00"):
                msgs.append(f"OK {label} — {valor_ded} registrada")
            else:
                msgs.append(f"OK {label} registrada")

    elif etapa_id == 4:
        msgs.append("HEADER Dados de Pagamento")
        if venc:
            msgs.append(f"OK Vencimento {venc} preenchido")
        msgs.append("OK Dados de pagamento preenchidos")

    elif etapa_id == 5:
        msgs.append("HEADER Centro de Custo")
        msgs.append("OK Centro de custo preenchido")

    return msgs


def _normalizar_texto_status(valor: str) -> str:
    return (
        unicodedata.normalize("NFD", str(valor or ""))
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
        .strip()
    )


def _montar_pendencias_documento(
    dados: dict,
    dados_extraidos: dict,
    deducoes: list[dict[str, Any]],
    etapas: list[dict[str, Any]],
) -> list[dict[str, str]]:
    pendencias: list[dict[str, str]] = []
    vistos: set[tuple[str, str]] = set()

    def adicionar(tipo: str, titulo: str, descricao: str, origem: str = "automacao") -> None:
        chave = (tipo, titulo.strip())
        if not titulo.strip() or chave in vistos:
            return
        vistos.add(chave)
        pendencias.append(
            {
                "id": f"{tipo}-{len(pendencias) + 1}",
                "tipo": tipo,
                "titulo": titulo.strip(),
                "descricao": descricao.strip(),
                "origem": origem,
            }
        )

    if dados.get("requires_centro_custo") and not str(dados.get("ugr_numero", "") or "").strip():
        adicionar(
            "bloqueio",
            "UGR obrigatória para seguir",
            "O documento exige centro de custo, mas a UGR ainda não foi informada.",
            "configuracao",
        )

    if any(str(ded.get("siafi", "") or "") == "DOB001" for ded in deducoes) and not str(
        dados.get("lf_numero", "") or ""
    ).strip():
        adicionar(
            "bloqueio",
            "LF obrigatória para a OB",
            "Há dedução DOB001 no documento e o número da LF ainda não foi preenchido.",
            "configuracao",
        )

    for etapa in etapas:
        if str(etapa.get("status", "") or "") == "erro":
            adicionar(
                "bloqueio",
                f"Etapa com erro: {etapa.get('nome', 'Automação')}",
                "A automação registrou erro nesta etapa e precisa de revisão antes de prosseguir.",
                "automacao",
            )

    for ded in deducoes:
        if str(ded.get("status", "") or "") == "erro":
            rotulo = str(ded.get("siafi", "") or ded.get("tipo", "") or "Dedução").strip()
            adicionar(
                "bloqueio",
                f"Dedução com erro: {rotulo}",
                "Uma dedução falhou durante a execução e deve ser refeita ou conferida manualmente.",
                "automacao",
            )

    for alerta in dados.get("alertas", []) or []:
        alerta_txt = str(alerta or "").strip()
        if alerta_txt:
            adicionar(
                "atencao",
                "Atenção na análise inicial",
                alerta_txt,
                "pdf",
            )

    mensagens = [*dados.get("logs", []), *dados.get("logs_simples", [])]
    for mensagem in mensagens:
        mensagem_txt = str(mensagem or "").strip()
        mensagem_norm = _normalizar_texto_status(mensagem_txt)
        if not mensagem_txt:
            continue
        if "requer conferencia manual" in mensagem_norm:
            adicionar(
                "divergencia",
                "Conferência manual necessária",
                mensagem_txt,
                "portal",
            )
        elif "diverg" in mensagem_norm:
            adicionar(
                "divergencia",
                "Divergência detectada",
                mensagem_txt,
                "portal",
            )

    notas = dados_extraidos.get("Notas Fiscais", []) or []
    if len(notas) > 1:
        adicionar(
            "atencao",
            "Documento com múltiplas notas fiscais",
            f"Foram identificadas {len(notas)} notas fiscais no PDF. Vale conferir se o portal refletiu todas elas corretamente.",
            "pdf",
        )

    return pendencias


def _montar_status_geral(
    dados: dict,
    pendencias: list[dict[str, str]],
) -> dict[str, str]:
    if bool(dados.get("is_running", False)):
        return {
            "tipo": "em_execucao",
            "titulo": "Automação em andamento",
            "descricao": "O AutoLiquid está executando etapas neste documento agora.",
        }

    bloqueios = [item for item in pendencias if item.get("tipo") == "bloqueio"]
    divergencias = [item for item in pendencias if item.get("tipo") == "divergencia"]
    atencoes = [item for item in pendencias if item.get("tipo") == "atencao"]

    if bloqueios:
        return {
            "tipo": "bloqueado",
            "titulo": "Documento com bloqueios",
            "descricao": f"{len(bloqueios)} item(ns) exigem ação antes de seguir com segurança.",
        }
    if divergencias:
        return {
            "tipo": "atencao",
            "titulo": "Documento com divergências",
            "descricao": f"{len(divergencias)} divergência(s) foram detectadas e devem ser conferidas.",
        }
    if atencoes:
        return {
            "tipo": "atencao",
            "titulo": "Documento com atenções",
            "descricao": f"{len(atencoes)} observação(ões) merecem revisão, embora não bloqueiem a execução.",
        }
    return {
        "tipo": "pronto",
        "titulo": "Documento pronto para execução",
        "descricao": "Nenhum bloqueio ou divergência relevante foi identificado até aqui.",
    }

def _montar_documento_processado(doc_id: str, dados: dict) -> dict[str, Any]:
    """Converte o estado interno de um documento para a resposta da API."""
    d = dados.get("dados_extraidos", {})
    resumo_raw = d.get("Resumo", {})

    notas = [
        {
            "id": i + 1,
            "tipo": n.get("Tipo", ""),
            "nota": n.get("Número da Nota", ""),
            "emissao": n.get("Data de Emissão", ""),
            "ateste": n.get("Data de Ateste", ""),
            "valor": _brl_para_float(n.get("Valor", "0")),
        }
        for i, n in enumerate(d.get("Notas Fiscais", []))
    ]

    empenhos = [
        {
            "id": i + 1,
            "numero": e.get("Empenho", ""),
            "situacao": e.get("Situação", ""),
            "recurso": e.get("Recurso", ""),
        }
        for i, e in enumerate(d.get("Empenhos", []))
    ]

    _ded_status_map: dict = dados.get("deducoes_status", {})

    # Calcula datas por código de imposto usando a lógica real da automação
    try:
        from datas_impostos import calcular_datas_documento
        _datas_calc = calcular_datas_documento(
            d,
            vencimento_usuario=str(dados.get("dates", {}).get("vencimento", "") or ""),
            apuracao_usuario=str(dados.get("dates", {}).get("apuracao", "") or ""),
        )
    except Exception:
        _datas_calc = {}

    def _normalizar_codigo(codigo: str) -> str:
        c = str(codigo or "").strip()
        return c.lstrip("0") or c

    deducoes = [
        {
            "id": i + 1,
            "tipo": ded.get("Situação", ""),
            "codigo": ded.get("Código", ""),
            "siafi": ded.get("Situação SIAFI", ""),
            "baseCalculo": _brl_para_float(ded.get("Base Cálculo", "0")),
            "valor": _brl_para_float(ded.get("Valor", "0")),
            "status": _ded_status_map.get(i + 1, "aguardando"),
            "datasCalculadas": (lambda c: {
                "apuracao": _datas_calc.get(c, {}).get("apuracao", ""),
                "vencimento": _datas_calc.get(c, {}).get("vencimento", ""),
            })(_normalizar_codigo(ded.get("Código", ""))),
        }
        for i, ded in enumerate(d.get("Deduções", []))
    ]

    # Tipo de liquidação: derivado da situação do primeiro empenho
    tipo_liquidacao = ""
    empenhos_raw = d.get("Empenhos", [])
    if empenhos_raw:
        sit_raw = empenhos_raw[0].get("Situação", "")
        tipo_liquidacao = extrair_siafi_completo(sit_raw) or extrair_codigo_situacao(sit_raw)

    etapas = deepcopy(dados.get("etapas", ETAPAS_BASE))
    pendencias = _montar_pendencias_documento(dados, d, deducoes, etapas)
    status_geral = _montar_status_geral(dados, pendencias)

    return {
        "id": doc_id,
        "lfNumero": dados.get("lf_numero", ""),
        "ugrNumero": dados.get("ugr_numero", ""),
        "vencimentoDocumento": dados.get("vencimento_documento", ""),
        "requiresCentroCusto": bool(dados.get("requires_centro_custo", False)),
        "dates": dados.get("dates", {"apuracao": "", "vencimento": ""}),
        "documento": {
            "cnpj": d.get("CNPJ", ""),
            "processo": d.get("Processo", ""),
            "solPagamento": d.get("Solicitação de Pagamento", ""),
            "convenio": d.get("Tem Convênio", ""),
            "natureza": d.get("Natureza", ""),
            "ateste": d.get("Data de Ateste", ""),
            "contrato": d.get("Número do Contrato", ""),
            "codigoIG": d.get("IG", ""),
            "tipoLiquidacao": tipo_liquidacao,
            "optanteSimples": bool(dados.get("optante_simples", False)),
            "alertas": dados.get("alertas", []),
            "bancoPdf": d.get("Banco", ""),
            "agenciaPdf": d.get("Agência", ""),
            "contaPdf": d.get("Conta", ""),
        },
        "resumo": {
            "bruto": _brl_para_float(resumo_raw.get("Valor Bruto", "0")),
            "deducoes": _brl_para_float(resumo_raw.get("Total Deduções", "0")),
            "liquido": _brl_para_float(resumo_raw.get("Valor Líquido", "0")),
        },
        "notasFiscais": notas,
        "empenhos": empenhos,
        "deducoes": deducoes,
        "etapas": etapas,
        "pendencias": pendencias,
        "statusGeral": status_geral,
        "logs": dados.get("logs", []),
        "logsSimples": dados.get("logs_simples", []),
        "isRunning": dados.get("is_running", False),
        "cancelRequested": dados.get("cancel_requested", False),
    }


def _sincronizar_documento_postgres(doc_id: str, dados: dict) -> None:
    snapshot = _montar_documento_processado(doc_id, dados)
    execucao_id = persistir_documento_com_log(snapshot)
    if execucao_id is not None:
        dados["postgres_execucao_id"] = execucao_id


def _executar_uma_etapa(
    doc: dict,
    etapa_id: int,
    playwright_obj: Any,
    pagina: Any,
) -> None:
    """Executa UMA etapa de automação, atualizando status e logs no dict doc."""
    import comprasnet_apropriar
    import comprasnet_dados_basicos
    import comprasnet_principal_orcamento
    import comprasnet_deducao
    import comprasnet_dados_pagamento
    import comprasnet_centro_custo

    dados = doc["dados_extraidos"]
    venc = str(doc.get("vencimento_documento") or doc["dates"].get("vencimento", "") or "")
    venc_deducao = str(doc["dates"].get("vencimento", "") or "")
    apuracao = str(doc["dates"].get("apuracao", "") or "")
    lf_numero = str(doc.get("lf_numero", "") or "")
    ugr_numero = str(doc.get("ugr_numero", "") or "")
    usar_conta_pdf = bool(doc.get("usar_conta_pdf", True))
    conta_banco = str(doc.get("conta_banco", "") or "")
    conta_agencia = str(doc.get("conta_agencia", "") or "")
    conta_conta = str(doc.get("conta_conta", "") or "")
    deve_parar = lambda: bool(doc.get("cancel_requested", False))

    def _verificar_resultado(resultado: Any, nome: str) -> None:
        """Levanta exceção se o módulo retornou status de erro ou interrupção."""
        if not isinstance(resultado, dict):
            return
        status = resultado.get("status", "")
        mensagem = resultado.get("mensagem", "")
        if status == "erro":
            raise RuntimeError(f"{nome}: {mensagem}")
        if status == "interrompido":
            raise ExecucaoInterrompida(mensagem or f"{nome} interrompido.")
        if status == "alerta" and mensagem:
            _log(doc, f"⚠ {nome}: {mensagem}")

    _ETAPAS_NOMES = {
        0: "Apropriar Instrumento",
        1: "Dados Básicos",
        2: "Principal com Orçamento",
        3: "Deduções",
        4: "Dados de Pagamento",
        5: "Centro de Custo",
    }

    _atualizar_etapa(doc, etapa_id, "executando")
    _log_s(doc, f"RUN {_ETAPAS_NOMES.get(etapa_id, f'Etapa {etapa_id}')}")

    try:
        if etapa_id == 0:
            _log(doc, "→ Pesquisando e apropriando instrumento de cobrança...")
            resultado = comprasnet_apropriar.executar(
                dados, pagina=pagina, playwright=playwright_obj
            )
            _verificar_resultado(resultado, "Apropriar Instrumento")
        elif etapa_id == 1:
            _log(doc, "→ Iniciando Dados Básicos...")
            resultado = comprasnet_dados_basicos.executar(
                dados, venc, pagina=pagina, playwright=playwright_obj
            )
            _verificar_resultado(resultado, "Dados Básicos")
        elif etapa_id == 2:
            _log(doc, "→ Iniciando Principal com Orçamento...")
            resultado = comprasnet_principal_orcamento.executar(
                dados, deve_parar=deve_parar, pagina=pagina, playwright=playwright_obj
            )
            _verificar_resultado(resultado, "Principal com Orçamento")
        elif etapa_id == 3:
            _log(doc, "→ Iniciando Dedução...")
            resultado = comprasnet_deducao.executar(
                dados, venc_deducao, apuracao, lf_numero,
                deve_parar=deve_parar, pagina=pagina, playwright=playwright_obj,
            )
            _verificar_resultado(resultado, "Dedução")
        elif etapa_id == 4:
            _log(doc, "→ Iniciando Dados de Pagamento...")
            resultado = comprasnet_dados_pagamento.executar(
                dados, venc,
                usar_conta_pdf=usar_conta_pdf,
                conta_banco=conta_banco,
                conta_agencia=conta_agencia,
                conta_conta=conta_conta,
                pagina=pagina, playwright=playwright_obj
            )
            _verificar_resultado(resultado, "Dados de Pagamento")
        elif etapa_id == 5:
            _log(doc, "→ Iniciando Centro de Custo...")
            resultado = comprasnet_centro_custo.executar(
                dados, ugr_numero, deve_parar=deve_parar,
                pagina=pagina, playwright=playwright_obj,
            )
            _verificar_resultado(resultado, "Centro de Custo")
        else:
            raise ValueError(f"Etapa desconhecida: {etapa_id}")

        _atualizar_etapa(doc, etapa_id, "concluido")
        _log(doc, f"✓ Etapa {etapa_id} concluída.")
        for msg in _gerar_logs_etapa_sucesso(dados, etapa_id, venc):
            _log_s(doc, msg)

    except Exception as exc:
        _atualizar_etapa(doc, etapa_id, "erro")
        _log(doc, f"✗ Etapa {etapa_id}: {exc}")
        _log_s(doc, f"ERR {_ETAPAS_NOMES.get(etapa_id, f'Etapa {etapa_id}')}: {exc}")
        raise


# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/status")
def status_backend() -> dict[str, Any]:
    porta = obter_porta_chrome()
    aberto = chrome_esta_aberto(porta)
    return {
        "chromeStatus": "pronto" if aberto else "erro",
        "chromePorta": porta,
        "postgresEnabled": postgres_habilitado(),
    }


@app.get("/api/dashboard")
def dashboard(periodo: str = Query(default="semana")) -> dict[str, Any]:
    return obter_dashboard(periodo)


@app.post("/api/chrome/abrir")
def abrir_chrome_endpoint() -> dict[str, Any]:
    porta = obter_porta_chrome()
    try:
        if not chrome_esta_aberto(porta):
            abrir_chrome(porta, aguardar=True, timeout_s=15)
        aberto = chrome_esta_aberto(porta)
        return {
            "success": aberto,
            "chromeStatus": "pronto" if aberto else "erro",
            "chromePorta": porta,
            "url": URL_INICIAL,
            "mensagem": "Chrome pronto." if aberto else "Chrome não respondeu na porta esperada.",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/processar")
async def processar_pdf(
    file: UploadFile = File(...),
    apuracao: str = Form(default=""),
    vencimento: str = Form(default=""),
) -> dict[str, Any]:
    tmp_path = None
    try:
        sufixo = os.path.splitext(file.filename or ".pdf")[1] or ".pdf"
        with tempfile.NamedTemporaryFile(delete=False, suffix=sufixo) as tmp:
            tmp_path = tmp.name
            conteudo = await file.read()
            tmp.write(conteudo)

        dados_extraidos = extrair_dados_pdf(tmp_path, nome_arquivo=file.filename)
        if not dados_extraidos:
            raise HTTPException(
                status_code=422,
                detail="Não foi possível extrair dados do PDF. Verifique se é um documento LF válido.",
            )

        from comprasnet_centro_custo import requer_centro_custo

        doc_id = str(uuid4())
        alertas: list[str] = []
        simples = False

        # Verifica Simples Nacional
        cnpj_limpo = "".join(c for c in str(dados_extraidos.get("CNPJ", "")) if c.isdigit())
        if cnpj_limpo:
            try:
                simples = verificar_simples_nacional(cnpj_limpo)
                if simples:
                    alertas.append("Empresa optante pelo Simples Nacional — verifique retenções.")
            except Exception:
                pass

        DOCUMENTOS_PROCESSADOS[doc_id] = {
            "dados_extraidos": dados_extraidos,
            "lf_numero": "",
            "ugr_numero": "",
            "vencimento_documento": "",
            "optante_simples": bool(simples) if cnpj_limpo else False,
            "requires_centro_custo": requer_centro_custo(dados_extraidos),
            "dates": {"apuracao": apuracao, "vencimento": vencimento},
            "etapas": deepcopy(ETAPAS_BASE),
            "logs": [],
            "logs_simples": _gerar_logs_simples_conferencia(dados_extraidos),
            "alertas": alertas,
            "is_running": False,
            "cancel_requested": False,
        }

        _sincronizar_documento_postgres(doc_id, DOCUMENTOS_PROCESSADOS[doc_id])

        return {"success": True, "documentoId": doc_id}

    except HTTPException:
        raise
    except Exception as exc:
        log.exception("Erro ao processar PDF")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@app.get("/api/documentos/{doc_id}")
def obter_documento(doc_id: str) -> dict[str, Any]:
    if doc_id not in DOCUMENTOS_PROCESSADOS:
        raise HTTPException(status_code=404, detail="Documento não encontrado.")
    return _montar_documento_processado(doc_id, DOCUMENTOS_PROCESSADOS[doc_id])


@app.post("/api/documentos/{doc_id}/salvar-preenchimento")
def salvar_preenchimento_documento(doc_id: str, payload: ExecucaoPayload) -> dict[str, Any]:
    if doc_id not in DOCUMENTOS_PROCESSADOS:
        raise HTTPException(status_code=404, detail="Documento não encontrado.")

    doc = DOCUMENTOS_PROCESSADOS[doc_id]
    if doc.get("is_running"):
        raise HTTPException(status_code=409, detail="Não é possível salvar durante uma execução em andamento.")

    doc["lf_numero"] = payload.lfNumero
    doc["ugr_numero"] = payload.ugrNumero
    doc["vencimento_documento"] = payload.vencimentoDocumento
    doc["usar_conta_pdf"] = payload.usarContaPdf
    doc["conta_banco"] = payload.contaBanco
    doc["conta_agencia"] = payload.contaAgencia
    doc["conta_conta"] = payload.contaConta
    _sincronizar_documento_postgres(doc_id, doc)
    return _montar_documento_processado(doc_id, doc)


@app.post("/api/documentos/{doc_id}/executar-todas")
def executar_todas(doc_id: str, payload: ExecucaoPayload) -> dict[str, Any]:
    if doc_id not in DOCUMENTOS_PROCESSADOS:
        raise HTTPException(status_code=404, detail="Documento não encontrado.")

    doc = DOCUMENTOS_PROCESSADOS[doc_id]
    if doc.get("is_running"):
        raise HTTPException(status_code=409, detail="Execução já em andamento.")

    doc["is_running"] = True
    doc["cancel_requested"] = False
    doc["lf_numero"] = payload.lfNumero
    doc["ugr_numero"] = payload.ugrNumero
    doc["vencimento_documento"] = payload.vencimentoDocumento
    doc["usar_conta_pdf"] = payload.usarContaPdf
    doc["conta_banco"] = payload.contaBanco
    doc["conta_agencia"] = payload.contaAgencia
    doc["conta_conta"] = payload.contaConta
    doc["etapas"] = deepcopy(ETAPAS_BASE)
    doc["logs"] = []
    doc["logs_simples"] = _gerar_logs_simples_conferencia(doc["dados_extraidos"])

    playwright_obj = None
    try:
        playwright_obj, pagina = conectar_comprasnet()
        for etapa_id in range(0, 6):
            if doc.get("cancel_requested"):
                raise ExecucaoInterrompida("Cancelado pelo usuário.")
            _executar_uma_etapa(doc, etapa_id, playwright_obj, pagina)
    except ExecucaoInterrompida:
        _log(doc, "Execução interrompida pelo usuário.")
    except Exception as exc:
        _log(doc, f"Erro inesperado: {exc}")
        log.exception("Erro na execução de todas as etapas")
    finally:
        doc["is_running"] = False
        if playwright_obj is not None:
            try:
                playwright_obj.stop()
            except Exception:
                pass
    _sincronizar_documento_postgres(doc_id, doc)
    return _montar_documento_processado(doc_id, doc)


@app.post("/api/documentos/{doc_id}/executar-etapa/{etapa_id}")
def executar_etapa(doc_id: str, etapa_id: int, payload: ExecucaoPayload) -> dict[str, Any]:
    if doc_id not in DOCUMENTOS_PROCESSADOS:
        raise HTTPException(status_code=404, detail="Documento não encontrado.")
    if etapa_id not in range(0, 6):
        raise HTTPException(status_code=400, detail=f"Etapa inválida: {etapa_id}")

    doc = DOCUMENTOS_PROCESSADOS[doc_id]
    if doc.get("is_running"):
        raise HTTPException(status_code=409, detail="Execução já em andamento.")

    doc["is_running"] = True
    doc["cancel_requested"] = False
    if payload.lfNumero:
        doc["lf_numero"] = payload.lfNumero
    if payload.ugrNumero:
        doc["ugr_numero"] = payload.ugrNumero
    if payload.vencimentoDocumento:
        doc["vencimento_documento"] = payload.vencimentoDocumento
    doc["usar_conta_pdf"] = payload.usarContaPdf
    if payload.contaBanco:
        doc["conta_banco"] = payload.contaBanco
    if payload.contaAgencia:
        doc["conta_agencia"] = payload.contaAgencia
    if payload.contaConta:
        doc["conta_conta"] = payload.contaConta

    playwright_obj = None
    try:
        playwright_obj, pagina = conectar_comprasnet()
        _executar_uma_etapa(doc, etapa_id, playwright_obj, pagina)
    except Exception as exc:
        _log(doc, f"Erro: {exc}")
        log.exception("Erro na execução da etapa %s", etapa_id)
    finally:
        doc["is_running"] = False
        if playwright_obj is not None:
            try:
                playwright_obj.stop()
            except Exception:
                pass
    _sincronizar_documento_postgres(doc_id, doc)
    return _montar_documento_processado(doc_id, doc)


@app.post("/api/documentos/{doc_id}/executar-deducao/{ded_id}")
def executar_deducao_individual(doc_id: str, ded_id: int, payload: ExecucaoPayload) -> dict[str, Any]:
    """Executa uma única dedução (identificada por ded_id 1-based) sem tocar nas demais."""
    if doc_id not in DOCUMENTOS_PROCESSADOS:
        raise HTTPException(status_code=404, detail="Documento não encontrado.")

    doc = DOCUMENTOS_PROCESSADOS[doc_id]
    deducoes_raw = doc["dados_extraidos"].get("Deduções", [])

    if ded_id < 1 or ded_id > len(deducoes_raw):
        raise HTTPException(status_code=404, detail=f"Dedução {ded_id} não encontrada.")

    if doc.get("is_running"):
        raise HTTPException(status_code=409, detail="Execução já em andamento.")

    doc["is_running"] = True
    doc["cancel_requested"] = False
    if payload.lfNumero:
        doc["lf_numero"] = payload.lfNumero
    if payload.ugrNumero:
        doc["ugr_numero"] = payload.ugrNumero
    if payload.vencimentoDocumento:
        doc["vencimento_documento"] = payload.vencimentoDocumento

    playwright_obj = None
    try:
        import comprasnet_deducao

        dados = doc["dados_extraidos"]

        # Datas: usa override por dedução se fornecido; se não, calcula pela lógica real
        if payload.dataVencimento or payload.dataApuracao:
            venc_deducao = str(payload.dataVencimento or "")
            apuracao     = str(payload.dataApuracao    or "")
        else:
            # Recalcula as datas específicas para esta dedução
            try:
                from datas_impostos import calcular_datas_documento
                _datas_calc = calcular_datas_documento(
                    dados,
                    vencimento_usuario=str(doc["dates"].get("vencimento", "") or ""),
                    apuracao_usuario=str(doc["dates"].get("apuracao", "") or ""),
                )
                ded = deducoes_raw[ded_id - 1]
                cod = str(ded.get("Código", "") or "").strip().lstrip("0") or str(ded.get("Código", "") or "").strip()
                _d = _datas_calc.get(cod, {})
                venc_deducao = str(_d.get("vencimento", "") or doc["dates"].get("vencimento", "") or "")
                apuracao     = str(_d.get("apuracao",    "") or doc["dates"].get("apuracao",    "") or "")
            except Exception:
                venc_deducao = str(doc["dates"].get("vencimento", "") or "")
                apuracao     = str(doc["dates"].get("apuracao", "") or "")
        lf_numero    = str(doc.get("lf_numero", "") or "")
        deve_parar   = lambda: bool(doc.get("cancel_requested", False))

        # Monta um dados_extraidos temporário com APENAS a dedução alvo
        ded = deducoes_raw[ded_id - 1]
        dados_fake = {**dados, "Deduções": [ded]}

        # Marca status como "executando"
        if "deducoes_status" not in doc:
            doc["deducoes_status"] = {}
        doc["deducoes_status"][ded_id] = "executando"
        _log(doc, f"→ Executando dedução {ded_id}: {ded.get('Situação', '')} ({ded.get('Situação SIAFI', '')})")

        playwright_obj, pagina = conectar_comprasnet()
        resultado = comprasnet_deducao.executar(
            dados_fake, venc_deducao, apuracao, lf_numero,
            deve_parar=deve_parar, pagina=pagina, playwright=playwright_obj,
            pular_confirmar_aba=True,
        )

        status_res = resultado.get("status", "") if isinstance(resultado, dict) else ""
        mensagem_res = resultado.get("mensagem", "") if isinstance(resultado, dict) else ""

        if status_res == "erro":
            doc["deducoes_status"][ded_id] = "erro"
            _log(doc, f"✗ Dedução {ded_id}: {mensagem_res or 'erro desconhecido'}")
        elif status_res == "pulado":
            doc["deducoes_status"][ded_id] = "erro"
            _log(doc, f"✗ Dedução {ded_id}: tipo não reconhecido pelo classificador "
                      f"({ded.get('Situação SIAFI', '')} / cod={ded.get('Código', '')}). "
                      f"Mensagem: {mensagem_res}")
        elif status_res == "interrompido":
            doc["deducoes_status"][ded_id] = "aguardando"
            _log(doc, f"⏸ Dedução {ded_id} interrompida.")
        elif status_res == "alerta":
            # Concluído com avisos não-fatais (ex: outras deduções com erro parcial)
            doc["deducoes_status"][ded_id] = "concluido"
            _log(doc, f"⚠ Dedução {ded_id} concluída com alertas: {mensagem_res}")
            _log_s(doc, f"OK Dedução {ded_id} — {ded.get('Situação', '')} registrada (com alertas)")
        else:
            doc["deducoes_status"][ded_id] = "concluido"
            _log(doc, f"✓ Dedução {ded_id} concluída.")
            _log_s(doc, f"OK Dedução {ded_id} — {ded.get('Situação', '')} registrada")

    except Exception as exc:
        if "deducoes_status" not in doc:
            doc["deducoes_status"] = {}
        doc["deducoes_status"][ded_id] = "erro"
        _log(doc, f"Erro na dedução {ded_id}: {exc}")
        log.exception("Erro ao executar dedução individual %s", ded_id)
    finally:
        doc["is_running"] = False
        if playwright_obj is not None:
            try:
                playwright_obj.stop()
            except Exception:
                pass
    _sincronizar_documento_postgres(doc_id, doc)
    return _montar_documento_processado(doc_id, doc)


@app.post("/api/documentos/{doc_id}/apropriar-siafi")
def apropriar_siafi(doc_id: str) -> dict[str, Any]:
    if doc_id not in DOCUMENTOS_PROCESSADOS:
        raise HTTPException(status_code=404, detail="Documento não encontrado.")

    logs: list[str] = []
    try:
        import comprasnet_finalizar
        comprasnet_finalizar.executar()
        logs.append("✓ Apropriação SIAFI concluída.")
        return {"success": True, "mensagem": "Apropriação SIAFI concluída com sucesso.", "logs": logs}
    except Exception as exc:
        logs.append(f"✗ Erro: {exc}")
        log.exception("Erro ao apropriar SIAFI")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/documentos/{doc_id}/parar-execucao")
def parar_execucao(doc_id: str) -> dict[str, Any]:
    if doc_id not in DOCUMENTOS_PROCESSADOS:
        raise HTTPException(status_code=404, detail="Documento não encontrado.")

    doc = DOCUMENTOS_PROCESSADOS[doc_id]
    doc["cancel_requested"] = True
    _sincronizar_documento_postgres(doc_id, doc)
    resultado = _montar_documento_processado(doc_id, doc)
    return {**resultado, "success": True, "mensagem": "Solicitação de parada enviada."}


@app.get("/api/process-dates")
def process_dates() -> dict[str, str]:
    dados = obter_datas_salvas()
    return {
        "apuracao": str(dados.get("apuracao", "")),
        "vencimento": str(dados.get("vencimento", "")),
    }


@app.get("/api/configuracoes")
def configuracoes_web() -> dict[str, Any]:
    return carregar_configuracoes_web()


@app.put("/api/configuracoes")
def salvar_configuracoes(payload: WebConfigPayload) -> dict[str, Any]:
    try:
        return salvar_configuracoes_web(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


_MODULOS_AUTOMACAO = [
    "comprasnet_base",
    "comprasnet_apropriar",
    "comprasnet_deducao",
    "comprasnet_deducao_ddr001",
    "comprasnet_deducao_dob001",
    "comprasnet_deducao_ddf021",
    "comprasnet_deducao_ddf025",
    "comprasnet_dados_basicos",
    "comprasnet_dados_pagamento",
    "comprasnet_principal_orcamento",
    "comprasnet_centro_custo",
    "comprasnet_finalizar",
    "datas_impostos",
    "extrator",
    "de_para_contratos",
    "consulta_cnpj",
]


@app.post("/api/recarregar")
def recarregar_modulos() -> dict[str, Any]:
    """Recarrega os módulos de automação sem reiniciar o servidor.

    Usa sys.modules.pop() em vez de importlib.reload() para garantir que o
    Python releia o arquivo .py do disco, ignorando qualquer cache .pyc.
    """
    recarregados: list[str] = []
    erros: dict[str, str] = {}

    # Passo 1: remove todos os módulos do cache de uma vez
    for nome in _MODULOS_AUTOMACAO:
        sys.modules.pop(nome, None)

    # Passo 2: reimporta cada módulo individualmente para detectar erros de sintaxe
    for nome in _MODULOS_AUTOMACAO:
        try:
            importlib.import_module(nome)
            recarregados.append(nome)
        except Exception as exc:
            erros[nome] = str(exc)

    return {
        "recarregados": recarregados,
        "erros": erros,
        "mensagem": (
            f"{len(recarregados)} módulo(s) recarregado(s) com sucesso."
            if not erros
            else f"{len(recarregados)} recarregado(s), {len(erros)} com erro."
        ),
    }


@app.get("/api/tabelas/{table_key}")
def obter_tabela_web(table_key: str, search: str = Query(default="")) -> dict[str, Any]:
    if table_key not in TABLE_DEFINITIONS:
        raise HTTPException(status_code=404, detail="Tabela não encontrada.")
    return carregar_tabela_web(table_key, search)


@app.put("/api/tabelas/{table_key}")
def atualizar_tabela_web(table_key: str, payload: TableSaveRequest) -> dict[str, Any]:
    if table_key not in TABLE_DEFINITIONS:
        raise HTTPException(status_code=404, detail="Tabela não encontrada.")
    return salvar_tabela_web(table_key, payload.rows)


# ─────────────────────────────────────────────────────────────────────────────
# VERSÃO / ATUALIZAÇÃO
# ─────────────────────────────────────────────────────────────────────────────

_GITHUB_REPO  = "diegodutraramos-maker/AutoLiquid"
_GITHUB_API   = f"https://api.github.com/repos/{_GITHUB_REPO}/releases/latest"
_RELEASES_URL = f"https://github.com/{_GITHUB_REPO}/releases/latest"


def _comparar_versao(a: str, b: str) -> int:
    """Retorna 1 se a > b, -1 se a < b, 0 se iguais."""
    def _partes(v: str):
        return tuple(int(x) for x in v.lstrip("v").split(".") if x.isdigit())
    pa, pb = _partes(a), _partes(b)
    return (pa > pb) - (pa < pb)


@app.get("/versao")
def obter_versao() -> dict[str, Any]:
    return {"versao": APP_VERSION}


@app.get("/versao/verificar")
def verificar_atualizacao() -> dict[str, Any]:
    try:
        r = requests.get(_GITHUB_API, timeout=6,
                         headers={"Accept": "application/vnd.github+json"})
        r.raise_for_status()
        data = r.json()
        versao_nova = data.get("tag_name", "").lstrip("v")
        url_download = data.get("html_url", _RELEASES_URL)
        tem_atualizacao = bool(versao_nova) and _comparar_versao(versao_nova, APP_VERSION) > 0
        return {
            "versao_atual": APP_VERSION,
            "versao_nova": versao_nova,
            "url_download": url_download,
            "tem_atualizacao": tem_atualizacao,
        }
    except Exception as exc:
        return {
            "versao_atual": APP_VERSION,
            "versao_nova": "",
            "url_download": _RELEASES_URL,
            "tem_atualizacao": False,
            "erro": str(exc),
        }


@app.post("/api/abrir-url")
def abrir_url(body: dict[str, Any]) -> dict[str, Any]:
    """Abre uma URL no navegador padrão do sistema."""
    import webbrowser
    url = str(body.get("url", "")).strip()
    if url:
        webbrowser.open(url)
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)

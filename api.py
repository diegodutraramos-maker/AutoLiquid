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

import re
import requests
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from core.app_paths import URL_INICIAL
from core.runtime_config import obter_datas_salvas, obter_porta_chrome, salvar_datas_processo

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


def _chrome_service():
    from services import chrome_service
    return chrome_service


def _web_config_service():
    from services import web_config_service
    return web_config_service


def _postgres_service():
    from services import postgres_service
    return postgres_service



def _comprasnet_base():
    import comprasnet.base as comprasnet_base
    return comprasnet_base


def _consulta_cnpj():
    import core.consulta_cnpj as consulta_cnpj
    return consulta_cnpj


def _extrator():
    import core.extrator as extrator
    return extrator


def _datas_impostos():
    import core.datas_impostos as datas_impostos
    return datas_impostos


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
    vpd: str = ""
    # Datas específicas por dedução (sobrepõem as datas globais do documento)
    dataApuracao: str = ""
    dataVencimento: str = ""


class ProcessDatesPayload(BaseModel):
    apuracao: str = ""
    vencimento: str = ""


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


def _valor_ou_traco(valor: Any) -> str:
    texto = str(valor or "").strip()
    if not texto or texto.lower() == "não encontrado":
        return "—"
    return texto


def _normalizar_texto_legivel(valor: str) -> str:
    return (
        str(valor or "")
        .replace("DeduÃ§Ã£o", "Dedução")
        .replace("ExecuÃ§Ã£o", "Execução")
        .replace("ConfirmaÃ§Ã£o", "Confirmação")
        .replace("SituaÃ§Ã£o", "Situação")
        .replace("nÃ£o", "não")
        .replace("NÃ£o", "Não")
        .replace("estÃ¡", "está")
        .replace("CÃ³digo", "Código")
        .replace("MunicÃ­pio", "Município")
        .replace("Ã¡", "á")
        .replace("Ã¢", "â")
        .replace("Ã£", "ã")
        .replace("Ã§", "ç")
        .replace("Ã©", "é")
        .replace("Ãª", "ê")
        .replace("Ã­", "í")
        .replace("Ã³", "ó")
        .replace("Ã´", "ô")
        .replace("Ãµ", "õ")
        .replace("Ãº", "ú")
        .replace("Âº", "º")
        .replace("Âª", "ª")
        .strip()
    )


def _detalhar_erro_execucao(nome: str, exc: Exception | str) -> str:
    bruto = _normalizar_texto_legivel(str(exc or "")).strip()
    normalizado = _normalizar_texto_status(bruto)

    if not bruto:
        return f"{nome}: erro sem detalhe retornado pela automação."

    if "confirmar dados de pagamento" in normalizado and "nao encontrado" in normalizado:
        return (
            f"{nome}: o botão de confirmação final dos dados de pagamento não apareceu na tela. "
            f"Detalhe: {bruto}"
        )

    if "timeout" in normalizado or "exceeded" in normalizado:
        return (
            f"{nome}: o portal demorou mais do que o esperado para responder. "
            f"Detalhe: {bruto}"
        )

    if "nao encontrado" in normalizado or "não encontrado" in bruto.lower():
        return (
            f"{nome}: um campo, botão ou bloco esperado não foi localizado na página. "
            f"Detalhe: {bruto}"
        )

    if "falha ao coletar documentos de origem" in normalizado:
        return (
            f"{nome}: os documentos de origem não puderam ser lidos corretamente no portal. "
            f"Detalhe: {bruto}"
        )

    return f"{nome}: {bruto}"


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
            "UGR não informada",
            "Informe a UGR no painel abaixo para liberar o Centro de Custo.",
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

    empenhos_raw = dados_extraidos.get("Empenhos", []) or []
    if empenhos_raw:
        situacao_empenho = str(empenhos_raw[0].get("Situação", "") or "")
        try:
            base = _comprasnet_base()
            tipo_liquidacao = (
                base.extrair_siafi_completo(situacao_empenho)
                or base.extrair_codigo_situacao(situacao_empenho)
                or ""
            )
        except Exception:
            tipo_liquidacao = situacao_empenho
        tipo_liquidacao_norm = _normalizar_texto_status(tipo_liquidacao).upper()
        if tipo_liquidacao_norm in {"DSP201", "201"}:
            # Calcular campos do IMB050 com os dados reais do documento
            _natureza = str(dados_extraidos.get("Natureza", "") or "").strip()
            _subitem = _natureza.split(".")[-1] if "." in _natureza else "??"
            _bens_almox = "1.2.3.1.1.08.01"
            try:
                from services.config_service import carregar_tabelas_config as _ctc
                _tabelas = _ctc()
                _nat_bens = _tabelas.get("natureza_bens_moveis", {})
                _NATUREZA_PADRAO_IMB = {
                    "449052.04": "1.2.3.1.1.01.01", "449052.06": "1.2.3.1.1.01.02",
                    "449052.08": "1.2.3.1.1.01.03", "449052.10": "1.2.3.1.1.01.04",
                    "449052.12": "1.2.3.1.1.03.01", "449052.18": "1.2.3.1.1.04.02",
                    "449052.20": "1.2.3.1.1.05.06", "449052.24": "1.2.3.1.1.01.05",
                    "449052.28": "1.2.3.1.1.01.06", "449052.30": "1.2.3.1.1.01.07",
                    "449052.32": "1.2.3.1.1.01.08", "449052.33": "1.2.3.1.1.04.05",
                    "449052.34": "1.2.3.1.1.01.25", "449052.35": "1.2.3.1.1.02.01",
                    "449052.36": "1.2.3.1.1.03.02", "449052.38": "1.2.3.1.1.01.09",
                    "449052.39": "1.2.3.1.1.01.21", "449052.40": "1.2.3.1.1.01.20",
                    "449052.41": "1.2.3.1.1.02.01", "449052.42": "1.2.3.1.1.03.03",
                    "449052.44": "1.2.3.1.1.04.06", "449052.46": "1.2.3.1.1.01.10",
                    "449052.48": "1.2.3.1.1.05.01", "449052.49": "1.2.3.1.1.01.11",
                    "449052.51": "1.2.3.1.1.99.09", "449052.52": "1.2.3.1.1.05.03",
                    "449052.54": "1.2.3.1.1.01.14", "449052.57": "1.2.3.1.1.01.12",
                    "449052.60": "1.2.3.1.1.01.13", "449052.96": "1.2.3.1.1.07.03",
                }
                _nat_bens = _nat_bens or _NATUREZA_PADRAO_IMB
                _bens_uso = _nat_bens.get(_natureza, "")
            except Exception:
                _bens_uso = ""
            _bens_nao_mapeado = not _bens_uso
            _bens_uso = _bens_uso or "Não mapeado — consulte Configurações → Tabelas"

            try:
                _total_nfs = sum(
                    _brl_para_float(n.get("Valor", "0"))
                    for n in dados_extraidos.get("Notas Fiscais", [])
                )
                _valor_str = f"R$ {_total_nfs:_.2f}".replace("_", ".").replace(".", ",", 1) if _total_nfs else "—"
                # Formatação BRL correta
                _valor_str = f"R$ {_total_nfs:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
            except Exception:
                _valor_str = "—"

            _aviso_nat = (
                f" ⚠ Natureza '{_natureza}' não encontrada na tabela — verifique em Configurações → Tabelas."
                if _bens_nao_mapeado else ""
            )

            adicionar(
                "atencao",
                "Lançar Outros Lançamentos no SIAFI (IMB050)",
                f"Situação DSP201 — após a automação, acesse o SIAFI e lance manualmente: "
                f"Outros Lançamentos → Situação IMB050. "
                f"Campos: "
                f"① Situação = IMB050 | "
                f"② Subitem da Despesa = {_subitem} | "
                f"③ Bens Móveis em Uso = {_bens_uso} | "
                f"④ Bens Móveis em Almoxarifado = {_bens_almox} | "
                f"⑤ Contas a Pagar = 2.1.3.1.1.04.00 (cód. 1104) | "
                f"⑥ Valor = {_valor_str}."
                + _aviso_nat,
                "automacao",
            )

        # VPD ausente: verificar se situação DSP requer VPD e se não foi informado
        _DSP_SITUACOES_VPD = {"DSP001", "DSP101", "DSP102", "DSP201"}
        if tipo_liquidacao_norm in _DSP_SITUACOES_VPD:
            vpd_manual = str(dados.get("vpd_manual", "") or "").strip()
            if not vpd_manual:
                natureza_vpd = str(dados_extraidos.get("Natureza", "") or "").strip()
                vpd_tabela = ""
                try:
                    import comprasnet.principal_orcamento as _cpo
                    vpd_tabela = _cpo._buscar_vpd(natureza_vpd, tipo_liquidacao_norm)
                except Exception:
                    pass
                if not vpd_tabela:
                    nat_label = f" para a natureza '{natureza_vpd}'" if natureza_vpd else ""
                    adicionar(
                        "atencao",
                        "VPD não encontrado — informar manualmente",
                        f"A situação {tipo_liquidacao_norm} requer VPD, mas nenhum foi localizado{nat_label}. "
                        "Informe o código VPD no painel de preenchimento antes de executar.",
                        "automacao",
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

    # Consistência Simples Nacional × DDF025 (retenção federal: IR, CSLL, COFINS, PIS)
    _optante = bool(dados.get("optante_simples", False))
    _tem_ddf025 = any(str(d.get("siafi", "")).upper() == "DDF025" for d in deducoes)
    if _optante and _tem_ddf025:
        adicionar(
            "divergencia",
            "Optante pelo Simples com DDF025 identificada",
            "A empresa consta como optante pelo Simples Nacional, mas a dedução DDF025 (retenção federal: IR, CSLL, COFINS, PIS) foi identificada no documento. "
            "Empresas optantes pelo Simples geralmente são isentas dessas retenções federais — verifique se a retenção é devida.",
            "pdf",
        )
    elif not _optante and not _tem_ddf025:
        adicionar(
            "atencao",
            "Não optante sem DDF025",
            "A empresa não consta como optante pelo Simples Nacional e nenhuma dedução DDF025 (retenção federal: IR, CSLL, COFINS, PIS) foi identificada. "
            "Verifique se a retenção federal deveria estar presente neste documento.",
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

def _vincular_iss_notas(deducoes: list[dict], notas: list[dict], tolerancia: float = 0.02) -> None:
    """
    Para cada dedução DDR001 ou DOB001 (ISS municipal), encontra as NFs cujos
    valores somam exatamente à base de cálculo do ISS (subset sum).

    Cada município pode ter seu próprio lançamento de ISS e sua base de cálculo
    corresponde a um subconjunto das NFs liquidadas naquele município.
    O resultado é gravado em `ded["notasFiscaisVinculadas"]` in-place.
    """
    from itertools import combinations

    iss_entries = [d for d in deducoes if str(d.get("siafi", "")).upper() in {"DDR001", "DOB001"}]
    if not iss_entries or not notas:
        return

    nf_pool = [(nf["id"], str(nf.get("nota", "")), float(nf.get("valor", 0))) for nf in notas if float(nf.get("valor", 0)) > 0]

    for ded in iss_entries:
        base = float(ded.get("baseCalculo", 0))
        if base <= 0:
            continue

        vinculadas: list[dict] = []
        # Testa subconjuntos do menor para o maior (primeiro match ganha)
        for r in range(1, len(nf_pool) + 1):
            for combo in combinations(nf_pool, r):
                if abs(sum(v for _, _, v in combo) - base) <= tolerancia:
                    vinculadas = [{"id": id_, "nota": nota, "valor": round(v, 2)} for id_, nota, v in combo]
                    break
            if vinculadas:
                break

        ded["notasFiscaisVinculadas"] = vinculadas


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
            "natureza": e.get("Natureza", "") or d.get("Natureza", ""),
            "valor": _brl_para_float(e.get("Valor", "0") or "0"),
            "saldo": _brl_para_float(e.get("Saldo", "0") or "0"),
        }
        for i, e in enumerate(d.get("Empenhos", []))
    ]

    _ded_status_map: dict = dados.get("deducoes_status", {})

    # Calcula datas por código de imposto usando a lógica real da automação
    try:
        _datas_calc = _datas_impostos().calcular_datas_documento(
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
            "notasFiscaisVinculadas": [],
        }
        for i, ded in enumerate(d.get("Deduções", []))
    ]

    # Para DDR001/DOB001 (ISS municipal), vincula cada lançamento às NFs
    # correspondentes via subset sum: a base de cálculo = soma dos valores
    # das NFs liquidadas naquele município.
    _vincular_iss_notas(deducoes, notas)

    # Tipo de liquidação: derivado da situação do primeiro empenho
    tipo_liquidacao = ""
    empenhos_raw = d.get("Empenhos", [])
    if empenhos_raw:
        sit_raw = empenhos_raw[0].get("Situação", "")
        base = _comprasnet_base()
        tipo_liquidacao = base.extrair_siafi_completo(sit_raw) or base.extrair_codigo_situacao(sit_raw)

    etapas = deepcopy(dados.get("etapas", ETAPAS_BASE))
    pendencias = _montar_pendencias_documento(dados, d, deducoes, etapas)
    status_geral = _montar_status_geral(dados, pendencias)

    return {
        "id": doc_id,
        "lfNumero": dados.get("lf_numero", ""),
        "ugrNumero": dados.get("ugr_numero", ""),
        "vencimentoDocumento": dados.get("vencimento_documento", ""),
        "usarContaPdf": bool(dados.get("usar_conta_pdf", True)),
        "contaBanco": dados.get("conta_banco", ""),
        "contaAgencia": dados.get("conta_agencia", ""),
        "contaConta": dados.get("conta_conta", ""),
        "requiresCentroCusto": bool(dados.get("requires_centro_custo", False)),
        "vpd": dados.get("vpd_manual", ""),
        "dates": dados.get("dates", {"apuracao": "", "vencimento": ""}),
        "documento": {
            "cnpj": _valor_ou_traco(d.get("CNPJ", "")),
            "nomeCredor": _valor_ou_traco(d.get("Nome do Credor", "") or d.get("Nome Credor", "")),
            "processo": _valor_ou_traco(d.get("Processo", "")),
            "solPagamento": _valor_ou_traco(d.get("Solicitação de Pagamento", "")),
            "convenio": _valor_ou_traco(d.get("Tem Convênio", "")),
            "natureza": _valor_ou_traco(d.get("Natureza", "")),
            "ateste": _valor_ou_traco(d.get("Data de Ateste", "")),
            "contrato": _valor_ou_traco(d.get("Número do Contrato", "")),
            "codigoIG": _valor_ou_traco(d.get("IG", "")),
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
    execucao_id = _postgres_service().persistir_documento_com_log(snapshot)
    if execucao_id is not None:
        dados["postgres_execucao_id"] = execucao_id


def _executar_uma_etapa(
    doc: dict,
    etapa_id: int,
    playwright_obj: Any,
    pagina: Any,
) -> None:
    """Executa UMA etapa de automação, atualizando status e logs no dict doc."""
    import comprasnet.apropriar as comprasnet_apropriar
    import comprasnet.dados_basicos as comprasnet_dados_basicos
    import comprasnet.principal_orcamento as comprasnet_principal_orcamento
    import comprasnet.deducao as comprasnet_deducao
    import comprasnet.dados_pagamento as comprasnet_dados_pagamento
    import comprasnet.centro_custo as comprasnet_centro_custo

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
            raise RuntimeError(_detalhar_erro_execucao(nome, mensagem or "erro não detalhado"))
        if status == "interrompido":
            raise ExecucaoInterrompida(mensagem or f"{nome} interrompido.")
        if status == "alerta" and mensagem:
            _log(doc, f"⚠ {_detalhar_erro_execucao(nome, mensagem)}")

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
            # Injeta VPD informado manualmente pelo usuário nos dados extraídos
            vpd_manual = str(doc.get("vpd_manual", "") or "").strip()
            if vpd_manual:
                dados["VPD_MANUAL"] = vpd_manual
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
        mensagem = _detalhar_erro_execucao(
            _ETAPAS_NOMES.get(etapa_id, f"Etapa {etapa_id}"),
            exc,
        )
        _log(doc, f"✗ {mensagem}")
        _log_s(doc, f"ERR {mensagem}")
        raise


# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/status")
def status_backend() -> dict[str, Any]:
    chrome_service = _chrome_service()
    postgres_service = _postgres_service()
    porta = obter_porta_chrome()
    aberto = chrome_service.chrome_esta_aberto(porta)
    return {
        "chromeStatus": "pronto" if aberto else "erro",
        "chromePorta": porta,
        "postgresEnabled": postgres_service.postgres_habilitado(),
    }


@app.get("/api/dashboard")
def dashboard(periodo: str = Query(default="semana")) -> dict[str, Any]:
    return _postgres_service().obter_dashboard(periodo)


@app.post("/api/chrome/abrir")
def abrir_chrome_endpoint() -> dict[str, Any]:
    chrome_service = _chrome_service()
    porta = obter_porta_chrome()
    try:
        if not chrome_service.chrome_esta_aberto(porta):
            chrome_service.abrir_chrome(porta, aguardar=True, timeout_s=15)
        aberto = chrome_service.chrome_esta_aberto(porta)
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

        dados_extraidos = _extrator().extrair_dados_pdf(tmp_path, nome_arquivo=file.filename)
        if not dados_extraidos:
            raise HTTPException(
                status_code=422,
                detail="Não foi possível extrair dados do PDF. Verifique se é um documento LF válido.",
            )

        from comprasnet.centro_custo import requer_centro_custo

        doc_id = str(uuid4())
        alertas: list[str] = []
        simples = False

        # Consulta BrasilAPI: Simples Nacional + razão social quando o PDF não trouxe o nome
        cnpj_limpo = "".join(c for c in str(dados_extraidos.get("CNPJ", "")) if c.isdigit())
        if cnpj_limpo:
            try:
                empresa = _consulta_cnpj().obter_dados_empresa(cnpj_limpo)
                optante = empresa.get("optante_simples")
                simples = bool(optante) if optante is not None else False
                if simples:
                    alertas.append("Empresa optante pelo Simples Nacional — verifique retenções.")
                # Preenche nome do credor se o extrator não encontrou no PDF
                nome_pdf = str(dados_extraidos.get("Nome do Credor", "") or "").strip()
                if not nome_pdf:
                    razao = empresa.get("razao_social", "")
                    if razao:
                        dados_extraidos["Nome do Credor"] = razao
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
        raise HTTPException(
            status_code=500,
            detail=_detalhar_erro_execucao("Processamento do PDF", exc),
        ) from exc
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
    doc["vpd_manual"] = payload.vpd
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
    doc["vpd_manual"] = payload.vpd
    doc["etapas"] = deepcopy(ETAPAS_BASE)
    doc["logs"] = []
    doc["logs_simples"] = _gerar_logs_simples_conferencia(doc["dados_extraidos"])

    playwright_obj = None
    try:
        playwright_obj, pagina = _comprasnet_base().conectar()
        for etapa_id in range(0, 6):
            if doc.get("cancel_requested"):
                raise ExecucaoInterrompida("Cancelado pelo usuário.")
            _executar_uma_etapa(doc, etapa_id, playwright_obj, pagina)
    except ExecucaoInterrompida:
        _log(doc, "Execução interrompida pelo usuário.")
    except Exception as exc:
        _log(doc, _detalhar_erro_execucao("Execução completa", exc))
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
    if payload.vpd:
        doc["vpd_manual"] = payload.vpd

    playwright_obj = None
    try:
        playwright_obj, pagina = _comprasnet_base().conectar()
        _executar_uma_etapa(doc, etapa_id, playwright_obj, pagina)
    except Exception as exc:
        _log(doc, _detalhar_erro_execucao(f"Etapa {etapa_id}", exc))
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
        import comprasnet.deducao as comprasnet_deducao

        dados = doc["dados_extraidos"]

        # Datas: usa override por dedução se fornecido; se não, calcula pela lógica real
        if payload.dataVencimento or payload.dataApuracao:
            venc_deducao = str(payload.dataVencimento or "")
            apuracao     = str(payload.dataApuracao    or "")
        else:
            # Recalcula as datas específicas para esta dedução
            try:
                _datas_calc = _datas_impostos().calcular_datas_documento(
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

        playwright_obj, pagina = _comprasnet_base().conectar()
        resultado = comprasnet_deducao.executar(
            dados_fake, venc_deducao, apuracao, lf_numero,
            deve_parar=deve_parar, pagina=pagina, playwright=playwright_obj,
            pular_confirmar_aba=True,
        )

        status_res = resultado.get("status", "") if isinstance(resultado, dict) else ""
        mensagem_res = resultado.get("mensagem", "") if isinstance(resultado, dict) else ""

        if status_res == "erro":
            doc["deducoes_status"][ded_id] = "erro"
            _log(
                doc,
                f"✗ {_detalhar_erro_execucao(f'Dedução {ded_id}', mensagem_res or 'erro desconhecido')}",
            )
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
            _log(
                doc,
                f"⚠ {_detalhar_erro_execucao(f'Dedução {ded_id}', mensagem_res)}",
            )
            _log_s(doc, f"OK Dedução {ded_id} — {ded.get('Situação', '')} registrada (com alertas)")
        else:
            doc["deducoes_status"][ded_id] = "concluido"
            _log(doc, f"✓ Dedução {ded_id} concluída.")
            _log_s(doc, f"OK Dedução {ded_id} — {ded.get('Situação', '')} registrada")

    except Exception as exc:
        if "deducoes_status" not in doc:
            doc["deducoes_status"] = {}
        doc["deducoes_status"][ded_id] = "erro"
        _log(doc, _detalhar_erro_execucao(f"Dedução {ded_id}", exc))
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
        import comprasnet.finalizar as comprasnet_finalizar
        comprasnet_finalizar.executar()
        logs.append("✓ Apropriação SIAFI concluída.")
        return {"success": True, "mensagem": "Apropriação SIAFI concluída com sucesso.", "logs": logs}
    except Exception as exc:
        logs.append(f"✗ {_detalhar_erro_execucao('Apropriação SIAFI', exc)}")
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


@app.put("/api/process-dates")
def salvar_process_dates(payload: ProcessDatesPayload) -> dict[str, str]:
    dados = salvar_datas_processo(payload.apuracao, payload.vencimento)
    return {
        "apuracao": str(dados.get("apuracao", "")),
        "vencimento": str(dados.get("vencimento", "")),
    }


@app.get("/api/configuracoes")
def configuracoes_web() -> dict[str, Any]:
    return _web_config_service().carregar_configuracoes_web()


@app.put("/api/configuracoes")
def salvar_configuracoes(payload: WebConfigPayload) -> dict[str, Any]:
    try:
        return _web_config_service().salvar_configuracoes_web(payload.model_dump())
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
    if table_key not in _web_config_service().TABLE_DEFINITIONS:
        raise HTTPException(status_code=404, detail="Tabela não encontrada.")
    return _web_config_service().carregar_tabela_web(table_key, search)


@app.put("/api/tabelas/{table_key}")
def atualizar_tabela_web(table_key: str, payload: TableSaveRequest) -> dict[str, Any]:
    if table_key not in _web_config_service().TABLE_DEFINITIONS:
        raise HTTPException(status_code=404, detail="Tabela não encontrada.")
    return _web_config_service().salvar_tabela_web(table_key, payload.rows)


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


@app.post("/api/debug/detectar-paginacao")
def debug_detectar_paginacao() -> dict[str, Any]:
    """
    Conecta ao Chrome, navega para /gescon/fatura e inspeciona exaustivamente
    todos os elementos de controle de paginação (selects, botões, DataTables).
    Retorna um relatório JSON para diagnóstico.
    """
    playwright_obj, pagina = _comprasnet_base().conectar()
    try:
        # Não navega — inspeciona qualquer página que estiver aberta no momento
        resultado = pagina.evaluate("""
            () => {
                var relatorio = {
                    url: window.location.href,
                    titulo: document.title,
                    selects: [],
                    botoes_todos: [],
                    datatables_length: null,
                    tabela_existe: false,
                    linhas_tabela: 0
                };

                // 1. Varrer todos os <select> da página
                var selects = document.querySelectorAll('select');
                for (var i = 0; i < selects.length; i++) {
                    var sel = selects[i];
                    var rect = sel.getBoundingClientRect();
                    var opts = [];
                    for (var j = 0; j < sel.options.length; j++) {
                        opts.push({ value: sel.options[j].value, text: sel.options[j].text.trim() });
                    }
                    relatorio.selects.push({
                        index: i,
                        name: sel.name || null,
                        id: sel.id || null,
                        className: sel.className || null,
                        value_atual: sel.value,
                        visivel: rect.width > 0 && rect.height > 0,
                        options: opts,
                        parent_classes: sel.parentElement ? sel.parentElement.className : null
                    });
                }

                // 2. Botões/links/spans com texto "todos"
                var todos_els = Array.from(document.querySelectorAll('button, a, li, span, option'));
                for (var k = 0; k < todos_els.length; k++) {
                    var el = todos_els[k];
                    var txt = (el.textContent || '').trim();
                    if (txt.toLowerCase() === 'todos' || txt.toLowerCase() === 'all') {
                        var r = el.getBoundingClientRect();
                        relatorio.botoes_todos.push({
                            tag: el.tagName,
                            text: txt,
                            className: el.className || null,
                            id: el.id || null,
                            visivel: r.width > 0 && r.height > 0,
                            value: el.value || null
                        });
                    }
                }

                // 3. Div DataTables length
                var dtLen = document.querySelector('.dataTables_length');
                if (dtLen) {
                    relatorio.datatables_length = {
                        html: dtLen.innerHTML.substring(0, 500),
                        className: dtLen.className
                    };
                }

                // 4. Tabela principal
                var linhas = document.querySelectorAll('table tbody tr');
                relatorio.tabela_existe = linhas.length > 0;
                relatorio.linhas_tabela = linhas.length;

                return relatorio;
            }
        """)

        return {"ok": True, "relatorio": resultado}

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        try:
            playwright_obj.stop()
        except Exception:
            pass


@app.post("/api/abrir-url")
def abrir_url(body: dict[str, Any]) -> dict[str, Any]:
    """Abre uma URL no navegador padrão do sistema."""
    import webbrowser
    url = str(body.get("url", "")).strip()
    if url:
        webbrowser.open(url)
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# CNPJ / SIMPLES NACIONAL
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/simples/consultar")
def consultar_simples(body: dict[str, Any]) -> dict[str, Any]:
    """Consulta nome + optante Simples Nacional via BrasilAPI."""
    import core.consulta_cnpj as _cnpj_mod
    cnpj_raw = str(body.get("cnpj", ""))
    cnpj_limpo = "".join(c for c in cnpj_raw if c.isdigit())
    if len(cnpj_limpo) != 14:
        raise HTTPException(status_code=422, detail="CNPJ deve ter 14 dígitos.")
    dados = _cnpj_mod.obter_dados_empresa(cnpj_limpo)
    if dados.get("nao_encontrado"):
        raise HTTPException(status_code=404, detail="CNPJ não encontrado na base da Receita Federal.")
    return {
        "cnpj": cnpj_limpo,
        "razaoSocial": dados.get("razao_social") or "",
        "optanteSimples": dados.get("optante_simples"),  # True / False / None
    }


# ─────────────────────────────────────────────────────────────────────────────
# CONSULTA NF-e POR CHAVE DE ACESSO (44 dígitos)
# ─────────────────────────────────────────────────────────────────────────────

class ConsultaChavePayload(BaseModel):
    chave: str


@app.post("/api/nfe/consultar-chave")
async def consultar_nfe_chave(payload: ConsultaChavePayload) -> dict[str, Any]:
    """
    Recebe uma chave de acesso de 44 dígitos, consulta a SEFAZ via
    DistribuicaoDFe (requer certificado digital configurado) e retorna
    os dados da NF-e parseados por nfelib ou ElementTree.
    """
    from core.consulta_nfe import consultar_chave_acesso, validar_chave

    try:
        chave = validar_chave(payload.chave)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Lê configurações do certificado do arquivo de configurações da app
    cfg = _web_config_service().carregar_configuracoes_web()
    cert_path     = cfg.get("nfCertPath") or os.getenv("NF_CERT_PATH")
    cert_senha    = cfg.get("nfCertSenha") or os.getenv("NF_CERT_SENHA")
    cnpj_receptor = cfg.get("nfCnpj") or os.getenv("NF_CNPJ")

    try:
        dados = consultar_chave_acesso(
            chave,
            cert_path=cert_path,
            cert_senha=cert_senha,
            cnpj_receptor=cnpj_receptor,
        )
        return dados
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao consultar SEFAZ: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# ANÁLISE DE XML NF-e
# ─────────────────────────────────────────────────────────────────────────────

def _parse_nfe_xml(conteudo: bytes) -> dict:
    """
    Tenta parsear com nfelib; cai para xml.etree.ElementTree se indisponível.
    Retorna dict com: numero, serie, emitente, cnpjEmitente, dataEmissao,
    valorBruto e deduções (irrf, pis, cofins, csll, inss, iss).
    """
    import xml.etree.ElementTree as ET

    NS = "http://www.portalfiscal.inf.br/nfe"

    def _f(v) -> float:
        try:
            return float(v or 0)
        except Exception:
            return 0.0

    def _tag(el, path: str):
        """Busca com e sem namespace."""
        r = el.find(f".//{{{NS}}}{path}")
        if r is None:
            r = el.find(f".//{path}")
        return r

    def _txt(el, path: str) -> str:
        t = _tag(el, path)
        return (t.text or "").strip() if t is not None else ""

    try:
        root = ET.fromstring(conteudo)
    except ET.ParseError as e:
        raise ValueError(f"XML inválido: {e}")

    # Encontra infNFe
    inf = _tag(root, "infNFe")
    if inf is None:
        raise ValueError("Elemento <infNFe> não encontrado — verifique se é uma NF-e válida.")

    numero   = _txt(inf, "nNF")
    serie    = _txt(inf, "serie")
    cnpj_em  = _txt(inf, "emit/CNPJ") or _txt(inf, "emit/CPF")
    nome_em  = _txt(inf, "emit/xNome") or _txt(inf, "emit/xFant")
    dt_emis  = _txt(inf, "ide/dhEmi") or _txt(inf, "ide/dEmi")

    # Valor total
    v_nf = _f(_txt(inf, "total/ICMSTot/vNF"))
    if v_nf == 0:
        # Tenta vProd como fallback
        v_nf = _f(_txt(inf, "total/ICMSTot/vProd"))

    # Retenções federais (retTrib)
    v_irrf   = _f(_txt(inf, "total/retTrib/vIRRF"))
    v_pis    = _f(_txt(inf, "total/retTrib/vRetPIS"))
    v_cofins = _f(_txt(inf, "total/retTrib/vRetCOFINS"))
    v_csll   = _f(_txt(inf, "total/retTrib/vRetCSLL"))
    v_inss   = _f(_txt(inf, "total/retTrib/vRetPrev"))

    # ISS (infNFe/total/ICMSTot/vISS ou infNFeSupl/qrCode…)
    v_iss = (
        _f(_txt(inf, "total/ICMSTot/vISS"))
        or _f(_txt(inf, "total/ISSQNtot/vISSRet"))
    )

    return {
        "numero":       numero,
        "serie":        serie,
        "emitente":     nome_em,
        "cnpjEmitente": cnpj_em,
        "dataEmissao":  dt_emis[:10] if dt_emis else "",
        "valorBruto":   round(v_nf, 2),
        "deducoes": {
            "irrf":   round(v_irrf, 2),
            "pis":    round(v_pis, 2),
            "cofins": round(v_cofins, 2),
            "csll":   round(v_csll, 2),
            "inss":   round(v_inss, 2),
            "iss":    round(v_iss, 2),
        },
    }


@app.post("/api/xml/analisar")
async def analisar_xmls(files: list[UploadFile] = File(...)) -> dict[str, Any]:
    """
    Recebe 1-N arquivos XML de NF-e, parseia cada um e retorna o somatório
    de valor bruto e de cada dedução.
    """
    notas = []
    erros = []

    for arq in files:
        conteudo = await arq.read()
        try:
            nota = _parse_nfe_xml(conteudo)
            nota["arquivo"] = arq.filename or ""
            notas.append(nota)
        except Exception as e:
            erros.append({"arquivo": arq.filename or "", "erro": str(e)})

    # Somatórios
    def _soma(campo: str) -> float:
        return round(sum(n.get(campo, 0) for n in notas), 2)

    def _soma_ded(codigo: str) -> float:
        return round(sum(n.get("deducoes", {}).get(codigo, 0) for n in notas), 2)

    totais = {
        "valorBruto": _soma("valorBruto"),
        "deducoes": {
            "irrf":   _soma_ded("irrf"),
            "pis":    _soma_ded("pis"),
            "cofins": _soma_ded("cofins"),
            "csll":   _soma_ded("csll"),
            "inss":   _soma_ded("inss"),
            "iss":    _soma_ded("iss"),
        },
    }

    return {"notas": notas, "totais": totais, "erros": erros}


# ─────────────────────────────────────────────────────────────────────────────
# ANÁLISE DE PDF NF-e / NFS-e
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/pdf/debug-texto")
async def debug_texto_pdf(file: UploadFile = File(...)) -> dict[str, Any]:
    """Retorna o texto bruto extraído pelo pdfplumber — usado para calibrar parser."""
    import pdfplumber, io
    conteudo = await file.read()
    with pdfplumber.open(io.BytesIO(conteudo)) as pdf:
        paginas = []
        for i, page in enumerate(pdf.pages):
            texto = page.extract_text() or ""
            tabelas = page.extract_tables() or []
            paginas.append({"pagina": i + 1, "texto": texto, "tabelas": tabelas})
    return {"paginas": paginas}

@app.post("/api/pdf/analisar-nf")
async def analisar_pdf_nf(file: UploadFile = File(...)) -> dict[str, Any]:
    """
    Recebe um PDF de NF-e ou NFS-e e extrai via pdfplumber:
    CNPJ, razão social, valor bruto, deduções (ISS, IRRF, PIS, COFINS, CSLL, INSS),
    município de incidência e valor líquido.
    Também consulta o Simples Nacional para o CNPJ extraído.
    """
    from core.parser_nf_pdf import extrair_dados_nf_pdf
    import core.consulta_cnpj as _cnpj_mod

    conteudo = await file.read()
    if not conteudo:
        raise HTTPException(status_code=422, detail="Arquivo PDF vazio.")

    try:
        dados = extrair_dados_nf_pdf(conteudo)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao processar PDF: {e}")

    # Consulta Simples Nacional para o CNPJ extraído
    simples: bool | None = None
    cnpj_limpo = re.sub(r"[^0-9]", "", dados.get("cnpj", ""))
    if len(cnpj_limpo) == 14:
        try:
            empresa = _cnpj_mod.obter_dados_empresa(cnpj_limpo)
            simples = empresa.get("optante_simples")
            if not dados.get("razaoSocial") and empresa.get("razao_social"):
                dados["razaoSocial"] = empresa["razao_social"]
        except Exception:
            pass

    return {**dados, "optanteSimples": simples}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)

"""Persistencia de processos e execucoes no PostgreSQL."""

from __future__ import annotations

import logging
import os
import socket
from typing import Any

log = logging.getLogger(__name__)

try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:  # pragma: no cover - dependencia opcional em ambiente local
    psycopg = None
    dict_row = None


def _database_url() -> str:
    return os.getenv("DATABASE_URL", "").strip()


def postgres_habilitado() -> bool:
    return bool(psycopg is not None and _database_url())


def _get_connection():
    if psycopg is None:
        raise RuntimeError("psycopg nao esta instalado no ambiente.")
    url = _database_url()
    if not url:
        raise RuntimeError("DATABASE_URL nao configurada.")
    return psycopg.connect(url, row_factory=dict_row)


def _servidor_contexto() -> dict[str, str]:
    login = (
        os.getenv("AUTO_LIQUID_USER")
        or os.getenv("USER")
        or os.getenv("USERNAME")
        or "desconhecido"
    ).strip()
    nome = (
        os.getenv("AUTO_LIQUID_NOME")
        or os.getenv("FULLNAME")
        or login
    ).strip()
    setor = (os.getenv("AUTO_LIQUID_SETOR") or socket.gethostname() or "").strip()
    return {
        "login": login,
        "nome": nome,
        "email": (os.getenv("AUTO_LIQUID_EMAIL") or "").strip(),
        "setor": setor,
    }


def _upsert_servidor(cur, contexto: dict[str, str]) -> int:
    cur.execute(
        """
        insert into servidores (nome, login, email, setor, ativo)
        values (%s, %s, %s, %s, true)
        on conflict (login)
        do update set
          nome = excluded.nome,
          email = excluded.email,
          setor = excluded.setor,
          ativo = true
        returning id
        """,
        (
            contexto["nome"],
            contexto["login"],
            contexto["email"] or None,
            contexto["setor"] or None,
        ),
    )
    row = cur.fetchone()
    return int(row["id"])


def _upsert_processo(cur, snapshot: dict[str, Any]) -> int:
    documento = snapshot.get("documento", {}) or {}
    numero_processo = str(documento.get("processo") or snapshot.get("id") or "").strip()
    if not numero_processo:
        raise RuntimeError("Nao foi possivel identificar o numero do processo para persistencia.")

    cur.execute(
        """
        insert into processos (
          numero_processo, cnpj, fornecedor, contrato, natureza, tipo_liquidacao
        )
        values (%s, %s, %s, %s, %s, %s)
        on conflict (numero_processo)
        do update set
          cnpj = excluded.cnpj,
          fornecedor = excluded.fornecedor,
          contrato = excluded.contrato,
          natureza = excluded.natureza,
          tipo_liquidacao = excluded.tipo_liquidacao,
          atualizado_em = now()
        returning id
        """,
        (
            numero_processo,
            str(documento.get("cnpj") or "").strip() or None,
            str(documento.get("nomeCredor") or documento.get("fornecedor") or "").strip() or None,
            str(documento.get("contrato") or "").strip() or None,
            str(documento.get("natureza") or "").strip() or None,
            str(documento.get("tipoLiquidacao") or "").strip() or None,
        ),
    )
    row = cur.fetchone()
    return int(row["id"])


def _resolver_status_execucao(snapshot: dict[str, Any]) -> str:
    if bool(snapshot.get("isRunning")):
        return "executando"

    etapas = snapshot.get("etapas", []) or []
    deducoes = snapshot.get("deducoes", []) or []
    if any(str(item.get("status") or "") == "erro" for item in [*etapas, *deducoes]):
        return "erro"
    if etapas and all(str(etapa.get("status") or "") == "concluido" for etapa in etapas):
        return "concluido"
    return "aguardando"


def _upsert_execucao(cur, snapshot: dict[str, Any], processo_id: int, servidor_id: int) -> int:
    documento_id = str(snapshot.get("id") or "").strip() or None
    resumo = snapshot.get("resumo", {}) or {}
    pendencias = snapshot.get("pendencias", []) or []
    status = _resolver_status_execucao(snapshot)
    usar_conta_pdf = bool(snapshot.get("usarContaPdf", True))
    conta_banco = str(snapshot.get("contaBanco") or "").strip() or None
    conta_agencia = str(snapshot.get("contaAgencia") or "").strip() or None
    conta_conta = str(snapshot.get("contaConta") or "").strip() or None

    execucao_id = None
    # Consolidamos por processo + servidor para evitar duplicacao por reanexo
    # do mesmo PDF/documento ao longo do dia.
    cur.execute(
        """
        select id
        from execucoes
        where processo_id = %s and servidor_id = %s
        order by data_execucao desc, id desc
        limit 1
        """,
        (processo_id, servidor_id),
    )
    row = cur.fetchone()
    if row:
        execucao_id = int(row["id"])
    elif documento_id:
        cur.execute(
            "select id from execucoes where documento_id = %s order by id desc limit 1",
            (documento_id,),
        )
        row = cur.fetchone()
        if row:
            execucao_id = int(row["id"])

    payload = (
        processo_id,
        servidor_id,
        documento_id,
        float(resumo.get("bruto") or 0),
        float(resumo.get("deducoes") or 0),
        float(resumo.get("liquido") or 0),
        status,
        any(p.get("tipo") == "divergencia" for p in pendencias),
        int(len(snapshot.get("notasFiscais", []) or [])),
        int(len(snapshot.get("deducoes", []) or [])),
        any(p.get("tipo") in {"bloqueio", "divergencia"} for p in pendencias),
        str(snapshot.get("lfNumero") or "").strip() or None,
        str(snapshot.get("ugrNumero") or "").strip() or None,
        str(snapshot.get("vencimentoDocumento") or "").strip() or None,
        usar_conta_pdf,
        conta_banco,
        conta_agencia,
        conta_conta,
        str((snapshot.get("statusGeral", {}) or {}).get("descricao") or "").strip() or None,
    )

    _garantir_colunas_operacionais(cur)

    if execucao_id is None:
        cur.execute(
            """
            insert into execucoes (
              processo_id, servidor_id, documento_id, bruto, deducoes, liquido,
              status, possui_divergencia, qtd_notas, qtd_deducoes,
              exige_intervencao_manual, lf_numero, ugr_numero,
              vencimento_documento, usar_conta_pdf, conta_banco,
              conta_agencia, conta_conta, observacoes
            )
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            returning id
            """,
            payload,
        )
        row = cur.fetchone()
        return int(row["id"])

    cur.execute(
        """
        update execucoes
        set
          processo_id = %s,
          servidor_id = %s,
          documento_id = %s,
          bruto = %s,
          deducoes = %s,
          liquido = %s,
          status = %s,
          possui_divergencia = %s,
          qtd_notas = %s,
          qtd_deducoes = %s,
          exige_intervencao_manual = %s,
          lf_numero = %s,
          ugr_numero = %s,
          vencimento_documento = %s,
          usar_conta_pdf = %s,
          conta_banco = %s,
          conta_agencia = %s,
          conta_conta = %s,
          observacoes = %s,
          data_execucao = now()
        where id = %s
        """,
        (*payload, execucao_id),
    )
    return execucao_id


def _replace_etapas(cur, execucao_id: int, etapas: list[dict[str, Any]]) -> None:
    cur.execute("delete from execucao_etapas where execucao_id = %s", (execucao_id,))
    if not etapas:
        return
    cur.executemany(
        """
        insert into execucao_etapas (execucao_id, etapa_nome, status, mensagem)
        values (%s, %s, %s, %s)
        """,
        [
            (
                execucao_id,
                str(etapa.get("nome") or "").strip(),
                str(etapa.get("status") or "aguardando").strip(),
                None,
            )
            for etapa in etapas
        ],
    )


def _replace_pendencias(cur, execucao_id: int, pendencias: list[dict[str, Any]]) -> None:
    cur.execute("delete from execucao_pendencias where execucao_id = %s", (execucao_id,))
    if not pendencias:
        return
    cur.executemany(
        """
        insert into execucao_pendencias (execucao_id, tipo, titulo, descricao, resolvida)
        values (%s, %s, %s, %s, false)
        """,
        [
            (
                execucao_id,
                str(item.get("tipo") or "").strip(),
                str(item.get("titulo") or "").strip(),
                str(item.get("descricao") or "").strip() or None,
            )
            for item in pendencias
        ],
    )


def _replace_notas(cur, execucao_id: int, notas: list[dict[str, Any]]) -> None:
    cur.execute("delete from notas_fiscais_execucao where execucao_id = %s", (execucao_id,))
    if not notas:
        return
    cur.executemany(
        """
        insert into notas_fiscais_execucao (execucao_id, numero_nota, tipo, emissao, ateste, valor)
        values (%s, %s, %s, %s, %s, %s)
        """,
        [
            (
                execucao_id,
                str(item.get("nota") or "").strip() or None,
                str(item.get("tipo") or "").strip() or None,
                str(item.get("emissao") or "").strip() or None,
                str(item.get("ateste") or "").strip() or None,
                float(item.get("valor") or 0),
            )
            for item in notas
        ],
    )


def _replace_deducoes(cur, execucao_id: int, deducoes: list[dict[str, Any]]) -> None:
    cur.execute("delete from deducoes_execucao where execucao_id = %s", (execucao_id,))
    if not deducoes:
        return
    cur.executemany(
        """
        insert into deducoes_execucao (execucao_id, codigo, siafi, tipo, valor, base_calculo, status)
        values (%s, %s, %s, %s, %s, %s, %s)
        """,
        [
            (
                execucao_id,
                str(item.get("codigo") or "").strip() or None,
                str(item.get("siafi") or "").strip() or None,
                str(item.get("tipo") or "").strip() or None,
                float(item.get("valor") or 0),
                float(item.get("baseCalculo") or 0),
                str(item.get("status") or "aguardando").strip(),
            )
            for item in deducoes
        ],
    )


def _garantir_colunas_operacionais(cur) -> None:
    cur.execute(
        """
        alter table execucoes
        add column if not exists usar_conta_pdf boolean not null default true
        """
    )
    cur.execute(
        """
        alter table execucoes
        add column if not exists conta_banco text
        """
    )
    cur.execute(
        """
        alter table execucoes
        add column if not exists conta_agencia text
        """
    )
    cur.execute(
        """
        alter table execucoes
        add column if not exists conta_conta text
        """
    )


def persistir_documento(snapshot: dict[str, Any]) -> int | None:
    """Salva ou atualiza o snapshot atual do documento no PostgreSQL."""
    if not postgres_habilitado():
        return None

    with _get_connection() as conn:
        with conn.cursor() as cur:
            servidor_id = _upsert_servidor(cur, _servidor_contexto())
            processo_id = _upsert_processo(cur, snapshot)
            execucao_id = _upsert_execucao(cur, snapshot, processo_id, servidor_id)
            _replace_etapas(cur, execucao_id, snapshot.get("etapas", []) or [])
            _replace_pendencias(cur, execucao_id, snapshot.get("pendencias", []) or [])
            _replace_notas(cur, execucao_id, snapshot.get("notasFiscais", []) or [])
            _replace_deducoes(cur, execucao_id, snapshot.get("deducoes", []) or [])
        conn.commit()
        return execucao_id


def persistir_documento_com_log(snapshot: dict[str, Any]) -> int | None:
    try:
        return persistir_documento(snapshot)
    except Exception:
        log.exception("Falha ao persistir documento no PostgreSQL")
        return None


def _where_periodo(periodo: str) -> str:
    periodo = str(periodo or "semana").strip().lower()
    if periodo == "dia":
        return "e.data_execucao >= date_trunc('day', now())"
    if periodo == "mes":
        return "e.data_execucao >= now() - interval '30 days'"
    if periodo == "este-mes":
        return "e.data_execucao >= date_trunc('month', now())"
    return "e.data_execucao >= date_trunc('week', now())"


def obter_dashboard(periodo: str = "semana") -> dict[str, Any]:
    if not postgres_habilitado():
        return {
            "habilitado": False,
            "periodo": periodo,
            "valorBruto": 0,
            "quantidadeProcessos": 0,
            "ultimosProcessos": [],
        }

    where_periodo = _where_periodo(periodo)
    with _get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                with execucoes_unicas as (
                  select distinct on (e.processo_id)
                    e.processo_id,
                    e.bruto,
                    e.data_execucao
                  from execucoes e
                  where {where_periodo}
                  order by e.processo_id, e.data_execucao desc, e.id desc
                )
                select
                  coalesce(sum(bruto), 0) as valor_bruto,
                  count(*) as quantidade_processos
                from execucoes_unicas
                """
            )
            bruto_row = cur.fetchone() or {}

            cur.execute(
                """
                with execucoes_unicas as (
                  select distinct on (e.processo_id)
                    e.processo_id,
                    e.data_execucao
                  from execucoes e
                  order by e.processo_id, e.data_execucao desc, e.id desc
                )
                select p.numero_processo, eu.data_execucao
                from execucoes_unicas eu
                join processos p on p.id = eu.processo_id
                order by eu.data_execucao desc
                limit 5
                """
            )
            ultimos = [
                {
                    "numeroProcesso": str(row["numero_processo"] or ""),
                    "dataExecucao": row["data_execucao"].isoformat() if row["data_execucao"] else None,
                }
                for row in cur.fetchall()
            ]

    return {
        "habilitado": True,
        "periodo": periodo,
        "valorBruto": float(bruto_row.get("valor_bruto") or 0),
        "quantidadeProcessos": int(bruto_row.get("quantidade_processos") or 0),
        "ultimosProcessos": ultimos,
    }

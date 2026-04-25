"""Persistencia de processos e execucoes no PostgreSQL."""

from __future__ import annotations

import json
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


_SIMPLES_CACHE_DIAS = 30  # Re-verifica após este número de dias


def _garantir_coluna_optante_simples(cur) -> None:
    """Adiciona colunas de Simples Nacional à tabela processos se não existirem."""
    cur.execute(
        "alter table processos add column if not exists optante_simples boolean"
    )
    cur.execute(
        "alter table processos add column if not exists simples_consultado_em timestamptz"
    )


def _upsert_processo(cur, snapshot: dict[str, Any]) -> int:
    documento = snapshot.get("documento", {}) or {}
    numero_processo = str(documento.get("processo") or snapshot.get("id") or "").strip()
    if not numero_processo:
        raise RuntimeError("Nao foi possivel identificar o numero do processo para persistencia.")

    _garantir_coluna_optante_simples(cur)

    optante = snapshot.get("optante_simples")
    optante_val = bool(optante) if optante is not None else None

    cur.execute(
        """
        insert into processos (
          numero_processo, cnpj, fornecedor, contrato, natureza, tipo_liquidacao, optante_simples
        )
        values (%s, %s, %s, %s, %s, %s, %s)
        on conflict (numero_processo)
        do update set
          cnpj = excluded.cnpj,
          fornecedor = excluded.fornecedor,
          contrato = excluded.contrato,
          natureza = excluded.natureza,
          tipo_liquidacao = excluded.tipo_liquidacao,
          optante_simples = coalesce(excluded.optante_simples, processos.optante_simples),
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
            optante_val,
        ),
    )
    row = cur.fetchone()
    return int(row["id"])


def consultar_simples_por_cnpj(cnpj_limpo: str) -> dict | None:
    """
    Consulta o status Simples Nacional de um CNPJ no histórico de processos.

    Retorna dict com 'razao_social', 'optante_simples' e 'cache_expirado'
    se o CNPJ estiver no banco, ou None se não estiver.

    cache_expirado = True quando o status existe mas foi consultado há mais
    de _SIMPLES_CACHE_DIAS dias — sinal para re-verificar nas APIs externas.
    """
    if not postgres_habilitado():
        return None

    try:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                _garantir_coluna_optante_simples(cur)
                cur.execute(
                    """
                    select fornecedor, optante_simples, simples_consultado_em
                    from processos
                    where regexp_replace(cnpj, '[^0-9]', '', 'g') = %s
                    order by
                      (optante_simples is not null) desc,
                      (simples_consultado_em is not null) desc,
                      simples_consultado_em desc
                    limit 1
                    """,
                    (cnpj_limpo,),
                )
                row = cur.fetchone()
                if not row:
                    return None

                consultado_em = row["simples_consultado_em"]
                cache_expirado = True  # padrão: expirado se não soubermos quando foi
                if consultado_em is not None:
                    import datetime
                    delta = datetime.datetime.now(tz=datetime.timezone.utc) - consultado_em.replace(
                        tzinfo=datetime.timezone.utc
                    ) if consultado_em.tzinfo is None else \
                    datetime.datetime.now(tz=datetime.timezone.utc) - consultado_em
                    cache_expirado = delta.days >= _SIMPLES_CACHE_DIAS

                return {
                    "razao_social":    str(row["fornecedor"] or ""),
                    "optante_simples": row["optante_simples"],  # True / False / None
                    "cache_expirado":  cache_expirado,
                }
    except Exception:
        log.exception("Falha ao consultar simples por CNPJ no Supabase")
        return None


def salvar_simples_cnpj(cnpj_limpo: str, razao_social: str, optante: bool | None) -> None:
    """
    Persiste resultado de consulta Simples no histórico de processos.
    Atualiza todos os processos existentes desse CNPJ com o novo status
    e registra o timestamp da consulta para controle de TTL.
    """
    if not postgres_habilitado() or optante is None:
        return

    try:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                _garantir_coluna_optante_simples(cur)
                cur.execute(
                    """
                    update processos
                    set optante_simples        = %s,
                        simples_consultado_em  = now(),
                        fornecedor = coalesce(nullif(trim(%s), ''), fornecedor)
                    where regexp_replace(cnpj, '[^0-9]', '', 'g') = %s
                    """,
                    (optante, razao_social or "", cnpj_limpo),
                )
            conn.commit()
    except Exception:
        log.exception("Falha ao salvar simples por CNPJ no Supabase")


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


def _garantir_tabelas_operacionais(cur) -> None:
    cur.execute(
        """
        create table if not exists tabelas_operacionais (
          chave text primary key,
          dados jsonb not null default '[]'::jsonb,
          atualizado_em timestamptz not null default now()
        )
        """
    )
    cur.execute(
        """
        create index if not exists idx_tabelas_operacionais_atualizado_em
        on tabelas_operacionais (atualizado_em desc)
        """
    )


def _garantir_regras_operacionais(cur) -> None:
    cur.execute(
        """
        create table if not exists regras_operacionais (
          chave text primary key,
          dados jsonb not null default '{}'::jsonb,
          ativo boolean not null default true,
          atualizado_em timestamptz not null default now()
        )
        """
    )
    cur.execute(
        """
        create index if not exists idx_regras_operacionais_atualizado_em
        on regras_operacionais (atualizado_em desc)
        """
    )


def obter_tabela_operacional(chave: str) -> list[dict[str, Any]] | None:
    if not postgres_habilitado():
        return None

    with _get_connection() as conn:
        with conn.cursor() as cur:
            _garantir_tabelas_operacionais(cur)
            cur.execute(
                """
                select dados
                from tabelas_operacionais
                where chave = %s
                """,
                (str(chave or "").strip(),),
            )
            row = cur.fetchone()
            if not row:
                return None

            dados = row.get("dados")
            if isinstance(dados, str):
                try:
                    dados = json.loads(dados)
                except Exception:
                    dados = []
            return dados if isinstance(dados, list) else []


def obter_regras_operacionais() -> list[dict[str, Any]] | None:
    if not postgres_habilitado():
        return None

    with _get_connection() as conn:
        with conn.cursor() as cur:
            _garantir_regras_operacionais(cur)
            cur.execute(
                """
                select chave, dados, ativo
                from regras_operacionais
                order by chave
                """
            )
            rows = cur.fetchall()

    regras: list[dict[str, Any]] = []
    for row in rows:
        dados = row.get("dados")
        if isinstance(dados, str):
            try:
                dados = json.loads(dados)
            except Exception:
                dados = {}
        if not isinstance(dados, dict):
            dados = {}
        regra = dict(dados)
        regra["id"] = str(regra.get("id") or row.get("chave") or "").strip()
        regra["ativa"] = bool(row.get("ativo"))
        if regra["id"]:
            regras.append(regra)
    return regras


def salvar_tabela_operacional(chave: str, rows: list[dict[str, Any]]) -> None:
    if not postgres_habilitado():
        return

    payload = json.dumps(rows or [], ensure_ascii=False)
    with _get_connection() as conn:
        with conn.cursor() as cur:
            _garantir_tabelas_operacionais(cur)
            cur.execute(
                """
                insert into tabelas_operacionais (chave, dados, atualizado_em)
                values (%s, %s::jsonb, now())
                on conflict (chave)
                do update set
                  dados = excluded.dados,
                  atualizado_em = now()
                """,
                (str(chave or "").strip(), payload),
            )
        conn.commit()


def salvar_regras_operacionais(rows: list[dict[str, Any]]) -> None:
    if not postgres_habilitado():
        return

    with _get_connection() as conn:
        with conn.cursor() as cur:
            _garantir_regras_operacionais(cur)
            chaves_validas: list[str] = []
            for row in rows or []:
                if not isinstance(row, dict):
                    continue
                chave = str(row.get("id") or "").strip()
                if not chave:
                    continue
                payload = dict(row)
                payload["id"] = chave
                ativo = bool(payload.get("ativa", True))
                chaves_validas.append(chave)
                cur.execute(
                    """
                    insert into regras_operacionais (chave, dados, ativo, atualizado_em)
                    values (%s, %s::jsonb, %s, now())
                    on conflict (chave)
                    do update set
                      dados = excluded.dados,
                      ativo = excluded.ativo,
                      atualizado_em = now()
                    """,
                    (chave, json.dumps(payload, ensure_ascii=False), ativo),
                )

            if chaves_validas:
                cur.execute(
                    "delete from regras_operacionais where not (chave = any(%s))",
                    (chaves_validas,),
                )
        conn.commit()


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


def buscar_historico_por_cnpj(
    cnpj_limpo: str,
    contrato_filtro: str | None = None,
    limite: int = 40,
) -> list[dict[str, Any]]:
    """
    Busca histórico de processos por CNPJ (+ contrato opcional).

    Retorna lista de processos ordenados pela execução mais recente,
    cada um contendo suas execuções com NFs, deduções e pendências.
    """
    if not postgres_habilitado():
        return []

    with _get_connection() as conn:
        with conn.cursor() as cur:

            # ── 1. Processos + execuções ──────────────────────────────────
            params_base: list[Any] = [cnpj_limpo]
            where_contrato = ""
            if contrato_filtro and contrato_filtro.strip():
                where_contrato = "AND upper(p.contrato) LIKE upper(%s)"
                params_base.append(f"%{contrato_filtro.strip()}%")

            cur.execute(
                f"""
                SELECT
                  p.id                      AS processo_id,
                  p.numero_processo,
                  p.cnpj,
                  p.fornecedor,
                  p.contrato,
                  p.natureza,
                  p.tipo_liquidacao,
                  p.atualizado_em,
                  e.id                      AS execucao_id,
                  e.data_execucao,
                  e.status,
                  e.bruto,
                  e.deducoes                AS total_deducoes,
                  e.liquido,
                  e.lf_numero,
                  e.ugr_numero,
                  e.vencimento_documento,
                  e.possui_divergencia,
                  e.exige_intervencao_manual,
                  e.observacoes,
                  s.nome                    AS servidor_nome,
                  s.setor                   AS servidor_setor
                FROM processos p
                JOIN execucoes e ON e.processo_id = p.id
                LEFT JOIN servidores s ON s.id = e.servidor_id
                WHERE regexp_replace(p.cnpj, '[^0-9]', '', 'g') = %s
                  {where_contrato}
                ORDER BY e.data_execucao DESC, e.id DESC
                LIMIT %s
                """,
                [*params_base, limite],
            )
            rows_exec = cur.fetchall()

            if not rows_exec:
                return []

            exec_ids = [int(r["execucao_id"]) for r in rows_exec]

            # ── 2. Notas fiscais ──────────────────────────────────────────
            cur.execute(
                """
                SELECT execucao_id, numero_nota, tipo, emissao, ateste, valor
                FROM notas_fiscais_execucao
                WHERE execucao_id = ANY(%s)
                ORDER BY execucao_id, emissao
                """,
                (exec_ids,),
            )
            notas_map: dict[int, list[dict]] = {}
            for r in cur.fetchall():
                eid = int(r["execucao_id"])
                notas_map.setdefault(eid, []).append({
                    "numero":  str(r["numero_nota"] or ""),
                    "tipo":    str(r["tipo"] or ""),
                    "emissao": str(r["emissao"] or ""),
                    "ateste":  str(r["ateste"] or ""),
                    "valor":   float(r["valor"] or 0),
                })

            # ── 3. Deduções ───────────────────────────────────────────────
            cur.execute(
                """
                SELECT execucao_id, codigo, siafi, tipo, valor, base_calculo, status
                FROM deducoes_execucao
                WHERE execucao_id = ANY(%s)
                ORDER BY execucao_id, tipo
                """,
                (exec_ids,),
            )
            deducoes_map: dict[int, list[dict]] = {}
            for r in cur.fetchall():
                eid = int(r["execucao_id"])
                deducoes_map.setdefault(eid, []).append({
                    "codigo":      str(r["codigo"] or ""),
                    "siafi":       str(r["siafi"] or ""),
                    "tipo":        str(r["tipo"] or ""),
                    "valor":       float(r["valor"] or 0),
                    "baseCalculo": float(r["base_calculo"] or 0),
                    "status":      str(r["status"] or ""),
                })

            # ── 4. Pendências ─────────────────────────────────────────────
            cur.execute(
                """
                SELECT execucao_id, tipo, titulo, descricao, resolvida
                FROM execucao_pendencias
                WHERE execucao_id = ANY(%s)
                ORDER BY execucao_id, tipo
                """,
                (exec_ids,),
            )
            pendencias_map: dict[int, list[dict]] = {}
            for r in cur.fetchall():
                eid = int(r["execucao_id"])
                pendencias_map.setdefault(eid, []).append({
                    "tipo":      str(r["tipo"] or ""),
                    "titulo":    str(r["titulo"] or ""),
                    "descricao": str(r["descricao"] or ""),
                    "resolvida": bool(r["resolvida"]),
                })

    # ── Montar estrutura agrupada por processo ────────────────────────────────
    def _fmt(v: Any) -> str | None:
        if v is None:
            return None
        return v.isoformat() if hasattr(v, "isoformat") else str(v)

    processos: dict[int, dict] = {}
    for row in rows_exec:
        pid = int(row["processo_id"])
        eid = int(row["execucao_id"])

        if pid not in processos:
            processos[pid] = {
                "numeroProcesso": str(row["numero_processo"] or ""),
                "cnpj":           str(row["cnpj"] or ""),
                "fornecedor":     str(row["fornecedor"] or ""),
                "contrato":       str(row["contrato"] or ""),
                "natureza":       str(row["natureza"] or ""),
                "tipoLiquidacao": str(row["tipo_liquidacao"] or ""),
                "atualizadoEm":   _fmt(row["atualizado_em"]),
                "execucoes":      [],
            }

        processos[pid]["execucoes"].append({
            "id":                  eid,
            "dataExecucao":        _fmt(row["data_execucao"]),
            "status":              str(row["status"] or ""),
            "bruto":               float(row["bruto"] or 0),
            "totalDeducoes":       float(row["total_deducoes"] or 0),
            "liquido":             float(row["liquido"] or 0),
            "lfNumero":            str(row["lf_numero"] or ""),
            "ugrNumero":           str(row["ugr_numero"] or ""),
            "vencimentoDocumento": str(row["vencimento_documento"] or ""),
            "possuiDivergencia":   bool(row["possui_divergencia"]),
            "exigeIntervencao":    bool(row["exige_intervencao_manual"]),
            "observacoes":         str(row["observacoes"] or ""),
            "servidorNome":        str(row["servidor_nome"] or ""),
            "servidorSetor":       str(row["servidor_setor"] or ""),
            "notasFiscais":        notas_map.get(eid, []),
            "deducoes":            deducoes_map.get(eid, []),
            "pendencias":          pendencias_map.get(eid, []),
        })

    # Ordena processos pelo data_execucao mais recente
    resultado = list(processos.values())
    resultado.sort(
        key=lambda p: p["execucoes"][0]["dataExecucao"] or "" if p["execucoes"] else "",
        reverse=True,
    )
    return resultado


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

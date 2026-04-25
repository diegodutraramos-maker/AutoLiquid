"""
comprasnet_deducao_ddf025.py
DDF025 — IRRF apurado conforme IN 1234/12 (DARF).

Importado e chamado por comprasnet_deducao.executar().
As funções auxiliares são importadas de comprasnet_deducao com import tardio (lazy)
para evitar importação circular.

NOTA IMPORTANTE — transição DDF021 → DDF025
--------------------------------------------
Quando ambos os tipos estão presentes no mesmo documento, o DDF021 é sempre
executado primeiro. Antes de chamar este módulo, comprasnet_deducao.executar()
invoca _aguardar_portal_limpo_entre_tipos() para garantir que o portal está
completamente livre (nenhum formulário aberto, overlay ausente, botão '+' visível).
Só então este módulo clica no '+' e preenche o DDF025.
"""
import logging

log = logging.getLogger(__name__)


def executar_ddf025(
    pagina,
    ddf025_list: list,
    *,
    data_vencimento_processo: str = "",
    apuracao_usuario: str = "",
    processo: str = "",
    cnpj_fmt: str = "",
    dados_extraidos: dict,
    erros: list,
    recurso_darf: str = "1",
    deve_parar=None,
) -> bool:
    """
    Processa todas as deduções DDF025 (IRRF IN 1234/12 — DARF).

    Ao contrário do DDF021, a data de vencimento é informada diretamente pelo
    usuário (data_vencimento_processo) — não é calculada a partir das NFs.

    Parâmetros
    ----------
    pagina                   : instância Playwright da página atual
    ddf025_list              : lista de dicts de dedução do tipo DDF025
    data_vencimento_processo : data de vencimento informada pelo usuário
    apuracao_usuario         : data de apuração informada pelo usuário
    processo                 : número do processo (para pré-doc)
    cnpj_fmt                 : CNPJ do fornecedor já formatado
    dados_extraidos          : dicionário completo do PDF
    erros                    : lista mutável onde erros são acumulados
    recurso_darf             : código de recurso (do empenho)
    deve_parar               : callable opcional de interrupção cooperativa

    Retorna
    -------
    bool  True se todas as deduções foram concluídas sem erro crítico.
    """
    # Import tardio — evita circular com comprasnet_deducao
    from comprasnet.deducao import (
        _verificar_interrupcao,
        _preencher_deducao_darf_total,
    )

    if not ddf025_list:
        return True

    print(
        f"\n  ══ DDF025 ({len(ddf025_list)} retenção/ões · IRRF IN 1234/12) ══════"
    )

    # DDF025 usa sempre a data informada pelo usuário (não calcula por emissão de NF)
    data_venc     = str(data_vencimento_processo or "").strip()
    data_apuracao = str(apuracao_usuario or "").strip()

    if not data_venc:
        erros.append("DDF025: data de vencimento não informada — preencha a data na tela inicial.")
        return False

    todos_ok = True

    for idx, ded in enumerate(ddf025_list):
        _verificar_interrupcao(deve_parar)

        erros_antes = len(erros)
        ok = _preencher_deducao_darf_total(
            pagina,
            ded,
            idx,
            len(ddf025_list),
            "DDF025",
            data_venc=data_venc,
            data_apuracao=data_apuracao,
            processo=processo,
            cnpj_fmt=cnpj_fmt,
            dados=dados_extraidos,
            erros=erros,
            recurso=recurso_darf,
            deve_parar=deve_parar,
        )

        if not ok or len(erros) > erros_antes:
            print(f"  ✗ DDF025 [{idx+1}/{len(ddf025_list)}]: erro — parando este bloco.")
            todos_ok = False
            break

    if todos_ok:
        print(f"  ✓ DDF025 concluído ({len(ddf025_list)} lançamento/s).")

    return todos_ok

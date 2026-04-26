"""Serviços de carregamento e persistência de configuração."""

import json
import shutil
from typing import Any

from core.app_paths import (
    CAMINHO_CONFIG,
    CAMINHO_TABELAS,
    PORTA_CHROME,
    caminho_recurso,
)


CONFIG_APP_PADRAO = {
    "apuracao": "",
    "vencimento": "",
    "chrome_porta": PORTA_CHROME,
    "navegador": "chrome",
    "perguntar_limpar_mes": True,
    "tema_web": "light",
    "nivel_log": "desenvolvedor",
    "database_url": "",
    "nome_usuario": "",
    "nf_servico_alerta_dias_uteis": 3,
    "rocket_chat_url": "https://chat.ufsc.br",
    "rocket_chat_user_id": "",
    "rocket_chat_auth_token": "",
    "rocket_chat_contar": "tudo",
}


def carregar_json(caminho, padrao: Any):
    if not caminho.exists():
        recurso_padrao = caminho_recurso(caminho.name)
        if recurso_padrao.exists():
            caminho.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(recurso_padrao, caminho)

    if caminho.exists():
        with open(caminho, encoding="utf-8") as arquivo:
            return json.load(arquivo)
    return padrao


def salvar_json(caminho, dados: Any) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with open(caminho, "w", encoding="utf-8") as arquivo:
        json.dump(dados, arquivo, indent=2, ensure_ascii=False)


def carregar_config_app():
    dados = carregar_json(CAMINHO_CONFIG, dict(CONFIG_APP_PADRAO))
    if not isinstance(dados, dict):
        return dict(CONFIG_APP_PADRAO)
    return {**CONFIG_APP_PADRAO, **dados}


def salvar_config_app(dados):
    atual = carregar_config_app()
    atual.update(dados)
    salvar_json(CAMINHO_CONFIG, atual)


def carregar_tabelas_config():
    dados = carregar_json(CAMINHO_TABELAS, {})
    if not isinstance(dados, dict):
        dados = {}

    recurso_padrao = caminho_recurso(CAMINHO_TABELAS.name)
    if not recurso_padrao.exists():
        return dados

    try:
        with open(recurso_padrao, encoding="utf-8") as arquivo:
            padrao = json.load(arquivo)
    except Exception:
        return dados

    if not isinstance(padrao, dict):
        return dados

    alterado = False
    for chave, valor in padrao.items():
        atual = dados.get(chave)
        if atual in (None, [], {}):
            dados[chave] = valor
            alterado = True

    if alterado:
        salvar_json(CAMINHO_TABELAS, dados)

    return dados


def salvar_tabelas_config(dados):
    salvar_json(CAMINHO_TABELAS, dados)

"""Serviços de carregamento e persistência de configuração."""

import json
from typing import Any

from core.app_paths import CAMINHO_CONFIG, CAMINHO_TABELAS, PORTA_CHROME


CONFIG_APP_PADRAO = {
    "apuracao": "",
    "vencimento": "",
    "chrome_porta": PORTA_CHROME,
    "navegador": "chrome",
    "perguntar_limpar_mes": True,
    "tema_web": "light",
    "nivel_log": "desenvolvedor",
}


def carregar_json(caminho, padrao: Any):
    if caminho.exists():
        with open(caminho, encoding="utf-8") as arquivo:
            return json.load(arquivo)
    return padrao


def salvar_json(caminho, dados: Any) -> None:
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
    return carregar_json(CAMINHO_TABELAS, {})


def salvar_tabelas_config(dados):
    salvar_json(CAMINHO_TABELAS, dados)

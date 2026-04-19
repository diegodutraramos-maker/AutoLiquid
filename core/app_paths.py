"""Caminhos e constantes base da aplicação."""

from pathlib import Path

ARQUIVO_CONFIG = "configuracoes.json"
ARQUIVO_TABELAS = "tabelas_config.json"
PORTA_CHROME = 9222
URL_INICIAL = "https://contratos.comprasnet.gov.br/gescon/fatura"
DIR_PERFIL = str(Path.home() / ".chrome-comprasnet")
DIR_APP = Path(__file__).resolve().parent.parent
CAMINHO_CONFIG = DIR_APP / ARQUIVO_CONFIG
CAMINHO_TABELAS = DIR_APP / ARQUIVO_TABELAS
CAMINHO_LOG = DIR_APP / "erros.log"

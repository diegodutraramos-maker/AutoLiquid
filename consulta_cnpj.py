import requests

# Timeout curto — não pode bloquear o upload do PDF
_TIMEOUT_SEGUNDOS = 5


def verificar_simples_nacional(cnpj_limpo):
    """Consulta Simples Nacional via BrasilAPI. Retorna True/False/None (falha)."""
    url = f"https://brasilapi.com.br/api/cnpj/v1/{cnpj_limpo}"
    try:
        resposta = requests.get(url, timeout=_TIMEOUT_SEGUNDOS)
        if resposta.status_code == 200:
            dados = resposta.json()
            optante = dados.get("opcao_pelo_simples")
            print(f"  CNPJ {cnpj_limpo}: {dados.get('razao_social','')} — Simples={optante}")
            return bool(optante)
        print(f"  CNPJ lookup: HTTP {resposta.status_code}")
    except Exception as e:
        print(f"  CNPJ lookup falhou (ignorado): {e}")
    return None


# Código de teste — só executa quando rodado diretamente, nunca ao importar
if __name__ == "__main__":
    cnpj_teste = "49161411000158"
    resultado = verificar_simples_nacional(cnpj_teste)
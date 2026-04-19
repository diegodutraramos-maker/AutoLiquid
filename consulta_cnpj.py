import time

import requests

_TIMEOUT_SEGUNDOS = 10
_MAX_TENTATIVAS = 3
_ESPERA_RETRY_SEGUNDOS = 5


def verificar_simples_nacional(cnpj_limpo):
    print(f"Consultando o CNPJ {cnpj_limpo} na base de dados...")
    url = f"https://brasilapi.com.br/api/cnpj/v1/{cnpj_limpo}"

    for tentativa in range(1, _MAX_TENTATIVAS + 1):
        print(f"Tentativa {tentativa}/{_MAX_TENTATIVAS}...")
        try:
            resposta = requests.get(url, timeout=_TIMEOUT_SEGUNDOS)
            if resposta.status_code == 200:
                dados = resposta.json()
                nome_empresa = dados.get('razao_social', 'Nome não encontrado')
                optante_simples = dados.get('opcao_pelo_simples')
                print(f"Empresa: {nome_empresa}")
                if optante_simples:
                    print("Situação: É optante pelo Simples Nacional!")
                    return True
                else:
                    print("Situação: NÃO é optante pelo Simples Nacional.")
                    return False
            else:
                print(f"Erro ao consultar o CNPJ. Código: {resposta.status_code}")
                if tentativa < _MAX_TENTATIVAS:
                    print(f"Aguardando {_ESPERA_RETRY_SEGUNDOS} segundos antes de tentar novamente...")
                    time.sleep(_ESPERA_RETRY_SEGUNDOS)
        except Exception as e:
            print(f"Erro de conexão: {e}")
            if tentativa < _MAX_TENTATIVAS:
                print(f"Aguardando {_ESPERA_RETRY_SEGUNDOS} segundos antes de tentar novamente...")
                time.sleep(_ESPERA_RETRY_SEGUNDOS)

    return None


# Código de teste — só executa quando rodado diretamente, nunca ao importar
if __name__ == "__main__":
    cnpj_teste = "49161411000158"
    resultado = verificar_simples_nacional(cnpj_teste)
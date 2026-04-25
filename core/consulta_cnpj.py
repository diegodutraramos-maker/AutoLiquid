"""
Consulta de CNPJ e Simples Nacional.

Tenta múltiplas fontes EM PARALELO — retorna assim que a primeira responder.
Compartilhado entre os módulos de Registro e Liquidação.
"""
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

_TIMEOUT = 5  # segundos por fonte

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; AutoLiquid/1.0)",
    "Accept": "application/json",
}


def _brasilapi(cnpj: str) -> dict | None:
    try:
        r = requests.get(f"https://brasilapi.com.br/api/cnpj/v1/{cnpj}", timeout=_TIMEOUT, headers=_HEADERS)
        if r.status_code == 200:
            d = r.json()
            return {"razao_social": str(d.get("razao_social") or "").strip(),
                    "optante_simples": d.get("opcao_pelo_simples")}
    except Exception:
        pass
    return None


def _cnpjws(cnpj: str) -> dict | None:
    try:
        r = requests.get(f"https://publica.cnpj.ws/cnpj/{cnpj}", timeout=_TIMEOUT, headers=_HEADERS)
        if r.status_code == 200:
            d = r.json()
            s = str((d.get("simples") or {}).get("simples") or "").lower()
            return {"razao_social": str(d.get("razao_social") or "").strip(),
                    "optante_simples": True if s == "sim" else (False if s in ("não","nao") else None)}
    except Exception:
        pass
    return None


def _receitaws(cnpj: str) -> dict | None:
    try:
        r = requests.get(f"https://receitaws.com.br/v1/cnpj/{cnpj}", timeout=_TIMEOUT, headers=_HEADERS)
        if r.status_code == 200:
            d = r.json()
            if d.get("status") == "ERROR":
                return None
            s = str(d.get("simples") or "").upper()
            return {"razao_social": str(d.get("nome") or "").strip(),
                    "optante_simples": True if s == "SIM" else (False if s in ("NÃO","NAO") else None)}
    except Exception:
        pass
    return None


def obter_dados_empresa(cnpj_limpo: str) -> dict:
    """
    Consulta em paralelo nas 3 fontes.
    Prioridade de retorno:
      1. Primeiro resultado com optante_simples definido (True ou False).
      2. Qualquer resultado não-None com razão social (mesmo sem Simples).
    Aguarda todas as fontes antes de desistir.
    """
    fontes = [_brasilapi, _cnpjws, _receitaws]
    melhor: dict | None = None  # tem razão social mas optante_simples=None

    with ThreadPoolExecutor(max_workers=len(fontes)) as pool:
        futuros = {pool.submit(fn, cnpj_limpo): fn.__name__ for fn in fontes}
        for futuro in as_completed(futuros):
            try:
                resultado = futuro.result()
                if resultado is None:
                    continue

                simples = resultado.get("optante_simples")

                if simples is not None:
                    # Resultado completo — retorna imediatamente
                    for f in futuros:
                        f.cancel()
                    print(f"  CNPJ {cnpj_limpo}: {resultado['razao_social']} — Simples={simples}")
                    return {**resultado, "nao_encontrado": False}

                # Resultado parcial (tem razão social, mas sem info do Simples)
                if melhor is None and resultado.get("razao_social"):
                    melhor = resultado

            except Exception:
                pass

    # Nenhuma fonte retornou o status do Simples; usa resultado parcial se houver
    if melhor is not None:
        print(f"  CNPJ {cnpj_limpo}: {melhor['razao_social']} — Simples=indisponível")
        return {**melhor, "nao_encontrado": False}

    print(f"  CNPJ {cnpj_limpo}: não encontrado em nenhuma fonte.")
    return {"razao_social": "", "optante_simples": None, "nao_encontrado": True}


def verificar_simples_nacional(cnpj_limpo: str) -> bool | None:
    """Retorna True/False/None (falha)."""
    return obter_dados_empresa(cnpj_limpo).get("optante_simples")


if __name__ == "__main__":
    print(obter_dados_empresa("49161411000158"))

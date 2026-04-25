"""
Consulta de CNPJ e Simples Nacional.

Estratégia:
  1. Tenta as 3 fontes EM PARALELO por rodada.
  2. Se a primeira fonte que responder já trouxer optante_simples definido
     (True ou False), retorna imediatamente.
  3. Se todas as fontes da rodada retornarem optante_simples=None,
     aguarda _DELAY_RETRY segundos e tenta novamente (até _MAX_TENTATIVAS).
  4. Resultado bem-sucedido fica em cache de memória (_CACHE) para
     evitar chamadas repetidas durante a mesma sessão.
"""
from __future__ import annotations

import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

_TIMEOUT = 5          # segundos por chamada HTTP
_MAX_TENTATIVAS = 3   # tentativas quando simples=None
_DELAY_RETRY = 1.5    # segundos entre tentativas

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; AutoLiquid/1.0)",
    "Accept": "application/json",
}

# ── Cache em memória (TTL de 1 hora) ─────────────────────────────────────────
_CACHE: dict[str, tuple[dict, float]] = {}
_CACHE_TTL = 3600  # segundos
_cache_lock = threading.Lock()


def _cache_get(cnpj: str) -> dict | None:
    with _cache_lock:
        entry = _CACHE.get(cnpj)
        if entry and (time.time() - entry[1]) < _CACHE_TTL:
            return entry[0]
    return None


def _cache_set(cnpj: str, dados: dict) -> None:
    # Só cacheia se trouxer resultado completo (simples definido)
    if dados.get("optante_simples") is not None:
        with _cache_lock:
            _CACHE[cnpj] = (dados, time.time())


# ── Fontes externas ───────────────────────────────────────────────────────────

def _brasilapi(cnpj: str) -> dict | None:
    try:
        r = requests.get(
            f"https://brasilapi.com.br/api/cnpj/v1/{cnpj}",
            timeout=_TIMEOUT, headers=_HEADERS,
        )
        if r.status_code == 200:
            d = r.json()
            simples = d.get("opcao_pelo_simples")
            # BrasilAPI devolve True/False/None — normaliza None→False só quando
            # a empresa está "ativa" (campo situacao_cadastral == "ATIVA")
            if simples is None and str(d.get("situacao_cadastral") or "").upper() == "ATIVA":
                simples = False  # ativa mas sem adesão = não optante
            return {
                "razao_social": str(d.get("razao_social") or "").strip(),
                "optante_simples": simples,
            }
    except Exception:
        pass
    return None


def _cnpjws(cnpj: str) -> dict | None:
    try:
        r = requests.get(
            f"https://publica.cnpj.ws/cnpj/{cnpj}",
            timeout=_TIMEOUT, headers=_HEADERS,
        )
        if r.status_code == 200:
            d = r.json()
            s = str((d.get("simples") or {}).get("simples") or "").lower()
            optante = True if s == "sim" else (False if s in ("não", "nao", "não") else None)
            return {
                "razao_social": str(d.get("razao_social") or "").strip(),
                "optante_simples": optante,
            }
    except Exception:
        pass
    return None


def _receitaws(cnpj: str) -> dict | None:
    try:
        r = requests.get(
            f"https://receitaws.com.br/v1/cnpj/{cnpj}",
            timeout=_TIMEOUT, headers=_HEADERS,
        )
        if r.status_code == 200:
            d = r.json()
            if d.get("status") == "ERROR":
                return None
            s = str(d.get("simples") or "").upper()
            return {
                "razao_social": str(d.get("nome") or "").strip(),
                "optante_simples": True if s == "SIM" else (False if s in ("NÃO", "NAO") else None),
            }
    except Exception:
        pass
    return None


# ── Lógica principal ──────────────────────────────────────────────────────────

def _uma_rodada(cnpj_limpo: str) -> dict | None:
    """
    Executa uma rodada de consulta paralela nas 3 fontes.

    Retorna:
      - dict com optante_simples definido → resultado completo
      - dict com optante_simples=None     → tem razão social mas sem info Simples
      - None                              → todas as fontes falharam
    """
    fontes = [_brasilapi, _cnpjws, _receitaws]
    melhor: dict | None = None  # razão social mas optante_simples=None

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
                    return resultado
                if melhor is None and resultado.get("razao_social"):
                    melhor = resultado
            except Exception:
                pass

    return melhor  # None ou dict sem optante_simples


def obter_dados_empresa(cnpj_limpo: str) -> dict:
    """
    Consulta nome e status Simples Nacional com retry automático.

    Retorna dict com chaves:
      razao_social     str
      optante_simples  True | False | None
      nao_encontrado   bool
    """
    # 1. Tenta o cache
    cached = _cache_get(cnpj_limpo)
    if cached is not None:
        print(f"  CNPJ {cnpj_limpo}: cache hit — Simples={cached['optante_simples']}")
        return cached

    melhor_parcial: dict | None = None  # resultado sem optante_simples

    for tentativa in range(1, _MAX_TENTATIVAS + 1):
        resultado = _uma_rodada(cnpj_limpo)

        if resultado is None:
            # Nenhuma fonte respondeu
            if tentativa < _MAX_TENTATIVAS:
                print(f"  CNPJ {cnpj_limpo}: todas as fontes falharam, retry {tentativa}/{_MAX_TENTATIVAS}…")
                time.sleep(_DELAY_RETRY)
                continue
            break

        simples = resultado.get("optante_simples")

        if simples is not None:
            # Sucesso
            dados = {**resultado, "nao_encontrado": False}
            _cache_set(cnpj_limpo, dados)
            print(f"  CNPJ {cnpj_limpo}: {resultado['razao_social']} — Simples={simples} (tentativa {tentativa})")
            return dados

        # Tem razão social mas sem info do Simples
        if melhor_parcial is None:
            melhor_parcial = resultado

        if tentativa < _MAX_TENTATIVAS:
            print(f"  CNPJ {cnpj_limpo}: simples indisponível na tentativa {tentativa}, aguardando retry…")
            time.sleep(_DELAY_RETRY)

    # Esgotou tentativas
    if melhor_parcial is not None:
        dados = {**melhor_parcial, "nao_encontrado": False}
        print(f"  CNPJ {cnpj_limpo}: {melhor_parcial['razao_social']} — Simples=indisponível após {_MAX_TENTATIVAS} tentativas")
        return dados

    print(f"  CNPJ {cnpj_limpo}: não encontrado em nenhuma fonte.")
    return {"razao_social": "", "optante_simples": None, "nao_encontrado": True}


def verificar_simples_nacional(cnpj_limpo: str) -> bool | None:
    """Retorna True / False / None (falha)."""
    return obter_dados_empresa(cnpj_limpo).get("optante_simples")


if __name__ == "__main__":
    import json
    import sys
    cnpj = sys.argv[1] if len(sys.argv) > 1 else "49161411000158"
    print(json.dumps(obter_dados_empresa(cnpj), ensure_ascii=False, indent=2))

"""
comprasnet_principal_orcamento.py
Preenche a aba Principal Com Orçamento.
Situações implementadas: DSP001, DSP101, DSP102, BPV001, 201, 101, 102, 001 (legado).
"""
import re, time, logging
from comprasnet_base import (conectar, achar_elemento,
                              extrair_codigo_situacao, extrair_siafi_completo,
                              config_situacao, _PREFERENCIA_SITUACAO,
                              clicar_aba_generica, aguardar_aba_ativa)
from services.config_service import carregar_tabelas_config

log = logging.getLogger(__name__)


class ExecucaoInterrompida(Exception):
    """Interrupção cooperativa da etapa atual."""


# ─────────────────────────────────────────────────────────────────────────────
# VPD LOOKUP
# ─────────────────────────────────────────────────────────────────────────────

def _normalizar_situacao_vpd(situacao: str) -> str:
    return re.sub(r"[^A-Z0-9/]+", "", str(situacao or "").upper())


def _situacao_vpd_compativel(situacao_linha: str, situacao_alvo: str) -> bool:
    linha = _normalizar_situacao_vpd(situacao_linha)
    alvo = _normalizar_situacao_vpd(situacao_alvo)
    if not alvo:
        return True
    if not linha:
        return False
    if linha == alvo or alvo in linha or linha in alvo:
        return True

    codigos_linha = set(re.findall(r"[A-Z]{2,4}\d{3}", linha))
    codigos_alvo = set(re.findall(r"[A-Z]{2,4}\d{3}", alvo))
    if codigos_linha and codigos_alvo:
        return bool(codigos_linha & codigos_alvo)

    return False


def _buscar_vpd(natureza: str, situacao: str = "") -> str:
    """
    Retorna o código VPD (Conta Variação Patrimonial Diminutiva) para a natureza dada.
    Lê primeiro de tabelas_config.json (sobreposições do usuário), depois usa o padrão
    embutido em interface_estilos._VPD_PADRAO.

    Parâmetros de busca:
        natureza – código no formato "NNNNNN.XX" (ex: "339092.39") ou "NNNNNN" (ex: "339092")
    Retorna '' se não encontrado.
    """
    nat = str(natureza).strip()

    # Carrega tabela do JSON de configuração (prevalece sobre o padrão)
    vpd_lista = []
    try:
        cfg = carregar_tabelas_config()
        vpd_lista = cfg.get("vpd_lista", [])
    except Exception as e:
        log.warning("VPD: falha ao ler tabelas_config.json: %s", e)

    # Fallback: usa o padrão embutido se a lista estiver vazia
    if not vpd_lista:
        try:
            from interface_estilos import _VPD_PADRAO
            vpd_lista = _VPD_PADRAO
        except ImportError:
            pass

    # Busca exata por natureza priorizando a situação correspondente
    for row in vpd_lista:
        if len(row) < 3:
            continue
        row_nat = str(row[0]).strip()
        row_situacao = str(row[1]).strip() if len(row) > 1 else ""
        row_vpd = str(row[2]).strip()
        if row_nat.upper() == nat.upper() and _situacao_vpd_compativel(row_situacao, situacao):
            return row_vpd

    # Fallback por natureza, independentemente da situação
    for row in vpd_lista:
        if len(row) < 3:
            continue
        row_nat = str(row[0]).strip()
        row_vpd = str(row[2]).strip()
        if row_nat.upper() == nat.upper():
            return row_vpd

    # Busca sem sub-elemento: "339092" encontra "339092.XX", priorizando situação
    nat_base = nat.split(".")[0]
    for row in vpd_lista:
        if len(row) < 3:
            continue
        row_nat = str(row[0]).strip().split(".")[0]
        row_situacao = str(row[1]).strip() if len(row) > 1 else ""
        if row_nat == nat_base and _situacao_vpd_compativel(row_situacao, situacao):
            return str(row[2]).strip()

    # Último fallback: família da natureza sem considerar situação
    for row in vpd_lista:
        if len(row) < 3:
            continue
        row_nat = str(row[0]).strip().split(".")[0]
        if row_nat == nat_base:
            return str(row[2]).strip()

    return ""


# ─────────────────────────────────────────────────────────────────────────────
# UTILITÁRIO: expander barra do empenho (compartilhado entre handlers)
# ─────────────────────────────────────────────────────────────────────────────

def _empenho_expandido(pagina, num_empenho: str) -> bool:
    """Confere se o bloco do empenho foi expandido e expôs os inputs da área."""
    try:
        return bool(
            pagina.evaluate(
                r"""(numEmp) => {
                    const normalizar = (txt) => (txt || '').replace(/\s+/g, '').toUpperCase();
                    const alvo = normalizar(numEmp);
                    return Array.from(document.querySelectorAll('input')).some((el) => {
                        const valor = normalizar(el.value || '');
                        if (!valor.includes(alvo)) return false;
                        const rect = el.getBoundingClientRect();
                        const estilo = window.getComputedStyle(el);
                        return rect.width > 0
                            && rect.height > 0
                            && estilo.visibility !== 'hidden'
                            && estilo.display !== 'none';
                    });
                }""",
                num_empenho,
            )
        )
    except Exception:
        return False


def _expandir_barra_empenho(pagina, num_empenho_pdf: str, erros: list) -> bool:
    """
    Localiza e clica na barra azul do empenho para expandi-la.
    Retorna True se bem-sucedido.
    """
    num_fmt = re.sub(r"^(\d{4})(\d{6})$", r"\1NE\2", num_empenho_pdf)
    candidatos_numero = [num_fmt]
    numero_bruto = str(num_empenho_pdf or "").strip()
    if numero_bruto and numero_bruto not in candidatos_numero:
        candidatos_numero.append(numero_bruto)

    try:
        pagina.wait_for_function(
            r"""(numEmp) => {
                const normalizar = (txt) => (txt || '').replace(/\s+/g, ' ').trim().toUpperCase();
                const alvo = normalizar(numEmp);
                const visivel = (el) => {
                    if (!el) return false;
                    const rect = el.getBoundingClientRect();
                    const estilo = window.getComputedStyle(el);
                    return rect.width > 0
                        && rect.height > 0
                        && estilo.visibility !== 'hidden'
                        && estilo.display !== 'none';
                };
                return Array.from(document.querySelectorAll('.row.pointer-hand, .box-header, .count-poo-item, [data-count-poo-item]'))
                    .some((el) => visivel(el) && normalizar(el.innerText || el.textContent).includes(alvo));
            }""",
            arg=num_fmt,
            timeout=2500,
        )
    except Exception:
        time.sleep(1.0)

    try:
        pagina.wait_for_load_state("networkidle", timeout=5000)
    except Exception:
        pass

    ultimo_erro = None
    for numero in candidatos_numero:
        try:
            handle = pagina.evaluate_handle(
                r"""(numEmp) => {
                    const normalizar = (txt) => (txt || '').replace(/\s+/g, ' ').trim().toUpperCase();
                    const alvo = normalizar(numEmp);
                    const visivel = (el) => {
                        if (!el) return false;
                        const rect = el.getBoundingClientRect();
                        const estilo = window.getComputedStyle(el);
                        return rect.width > 0
                            && rect.height > 0
                            && estilo.visibility !== 'hidden'
                            && estilo.display !== 'none';
                    };

                    const roots = Array.from(document.querySelectorAll('.count-poo-item, [data-count-poo-item], .box.box-solid, .box-header, .row.pointer-hand'));
                    for (const root of roots) {
                        const txt = normalizar(root.innerText || root.textContent);
                        if (!txt || !txt.includes(alvo) || !txt.includes('EMPENHO') || !visivel(root)) {
                            continue;
                        }

                        const container =
                            root.closest('.count-poo-item, [data-count-poo-item], .box.box-solid, .box')
                            || root;
                        const alvoClique =
                            container.querySelector('.row.pointer-hand')
                            || container.querySelector('.box-header')
                            || container.querySelector('.title-item-acordion')
                            || root;

                        if (visivel(alvoClique)) {
                            return alvoClique;
                        }
                    }
                    return null;
                }""",
                numero,
            )

            elemento = handle.as_element()
            if elemento is not None:
                elemento.scroll_into_view_if_needed(timeout=2000)
                time.sleep(0.2)
                caixa = elemento.bounding_box()
                if caixa:
                    pagina.mouse.click(
                        caixa["x"] + min(max(caixa["width"] * 0.18, 32), 140),
                        caixa["y"] + (caixa["height"] / 2),
                    )
                    time.sleep(0.6)
                    if _empenho_expandido(pagina, num_fmt):
                        print(f"    Barra expandida rapidamente ({num_fmt}).")
                        return True

            handle = pagina.evaluate_handle(
                r"""(numEmp) => {
                    const normalizar = (txt) => (txt || '').replace(/\s+/g, ' ').trim().toUpperCase();
                    const alvo = normalizar(numEmp);
                    const visivel = (el) => {
                        if (!el) return false;
                        const rect = el.getBoundingClientRect();
                        const estilo = window.getComputedStyle(el);
                        return rect.width > 0
                            && rect.height > 0
                            && estilo.visibility !== 'hidden'
                            && estilo.display !== 'none';
                    };
                    const pontuar = (el, txt) => {
                        let score = 0;
                        if (txt.includes('EMPENHO')) score += 4;
                        if (txt.includes('Nº DO EMPENHO') || txt.includes('N DO EMPENHO')) score += 6;
                        if (txt.includes('SUBELEMENTO')) score += 4;
                        if (txt.includes('LIQUIDADO')) score += 4;
                        if (txt.includes('R$')) score += 2;
                        if (el.matches('.row.pointer-hand, .box-header, .title-item-acordion')) score += 10;
                        if (el.matches('[data-widget="collapse"], [aria-expanded]')) score += 6;
                        const cls = String(el.className || '').toLowerCase();
                        if (/(pointer-hand|box-header|header|heading|accordion|collapse|card|panel|title|bar|custom-shadow)/.test(cls)) score += 6;
                        score -= Math.min(txt.length, 400) / 120;
                        return score;
                    };

                    const candidatos = new Map();
                    for (const el of document.querySelectorAll('div, section, article, li, tr, td, button, a, span')) {
                        const txt = normalizar(el.innerText || el.textContent);
                        if (!txt || !txt.includes(alvo) || !txt.includes('EMPENHO') || !visivel(el)) {
                            continue;
                        }

                        let alvoClique =
                            el.closest('.row.pointer-hand, .box-header, .title-item-acordion, [data-widget="collapse"], [aria-expanded], .panel-heading, .card-header, .accordion-header, .panel-title, .card-title')
                            || el.closest('div, section, article, li, tr')
                            || el;

                        if (!visivel(alvoClique)) {
                            alvoClique = el;
                        }

                        const textoAlvo = normalizar(alvoClique.innerText || alvoClique.textContent || txt);
                        const atual = candidatos.get(alvoClique);
                        const score = pontuar(alvoClique, textoAlvo);
                        if (!atual || atual.score < score) {
                            candidatos.set(alvoClique, { alvo: alvoClique, score });
                        }
                    }

                    return Array.from(candidatos.values())
                        .sort((a, b) => b.score - a.score)[0]?.alvo || null;
                }""",
                numero,
            )

            elemento = handle.as_element()
            if elemento is None:
                continue

            elemento.scroll_into_view_if_needed(timeout=3000)
            time.sleep(0.4)

            pagina.evaluate(
                """(el) => {
                    el.scrollIntoView({ block: 'center', inline: 'center' });
                }""",
                elemento,
            )

            try:
                pagina.evaluate(
                    """(el) => {
                        const alvo =
                            el.matches('.row.pointer-hand, .box-header, .title-item-acordion')
                                ? el
                                : el.querySelector('.row.pointer-hand, .title-item-acordion')
                                    || el;
                        alvo.click();
                    }""",
                    elemento,
                )
            except Exception as exc:
                ultimo_erro = exc

            time.sleep(1.0)
            if _empenho_expandido(pagina, num_fmt):
                print(f"    Barra expandida ({num_fmt}).")
                return True

            try:
                elemento.click(timeout=3000, force=True)
            except Exception as exc:
                ultimo_erro = exc

            time.sleep(1.0)
            if _empenho_expandido(pagina, num_fmt):
                print(f"    Barra expandida ({num_fmt}).")
                return True

            caixa = elemento.bounding_box()
            if caixa:
                pagina.mouse.click(
                    caixa["x"] + (caixa["width"] / 2),
                    caixa["y"] + min(caixa["height"] / 2, 24),
                )
                time.sleep(1.0)
                if _empenho_expandido(pagina, num_fmt):
                    print(f"    Barra expandida ({num_fmt}).")
                    return True

        except Exception as exc:
            ultimo_erro = exc

    erros.append(
        f"Não foi possível expandir a barra do empenho {num_fmt}: "
        f"{ultimo_erro or 'cabeçalho não encontrado ou não reagiu ao clique'}"
    )
    return False


def _verificar_empenho(pagina, num_empenho_pdf: str, erros: list):
    """Confere se o número do empenho visível bate com o do PDF."""
    num_fmt = re.sub(r"^(\d{4})(\d{6})$", r"\1NE\2", num_empenho_pdf)
    try:
        campo = pagina.locator(
            f"xpath=//input[@value='{num_fmt}' or contains(@value,'{num_fmt}')]"
        ).first
        val = campo.input_value().strip()
        print(f"    Verificação empenho → Web: {val} | PDF: {num_fmt}")
        if val != num_fmt:
            erros.append(f"Empenho divergente! Web: {val} | PDF: {num_fmt}")
    except Exception:
        print("    Aviso: não foi possível verificar o campo do empenho.")


def _preencher_contas_a_pagar(pagina, codigo: str, erros: list, desc: str = ""):
    """Preenche o campo 'Contas a Pagar' com o código informado."""
    def _normalizar_codigo(valor: str) -> str:
        return re.sub(r"\D+", "", str(valor or ""))

    def _codigo_equivalente(valor_campo: str, valor_esperado: str) -> bool:
        atual = _normalizar_codigo(valor_campo)
        esperado = _normalizar_codigo(valor_esperado)
        if not atual or not esperado:
            return False
        if atual == esperado:
            return True
        equivalencias = {
            "1104": {"213110400"},
        }
        return atual in equivalencias.get(esperado, set())

    try:
        campo = pagina.locator(
            "xpath=//*[normalize-space(text())='Contas a Pagar']"
            "/following::input[1]"
        ).first
        codigo_str = str(codigo or "").strip()
        valor_final = ""

        for tentativa in range(1, 4):
            campo.click(click_count=3)
            campo.fill("")
            try:
                campo.press_sequentially(codigo_str, delay=110)
            except Exception:
                campo.fill(codigo_str)
            pagina.keyboard.press("Tab")
            time.sleep(0.8)
            valor_final = campo.input_value().strip()

            if not _codigo_equivalente(valor_final, codigo_str):
                try:
                    campo.evaluate(
                        """(el, valor) => {
                            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
                            el.focus();
                            if (setter) {
                                setter.call(el, valor);
                            } else {
                                el.value = valor;
                            }
                            el.defaultValue = valor;
                            el.setAttribute('value', valor);
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }""",
                        codigo_str,
                    )
                    pagina.keyboard.press("Tab")
                    time.sleep(0.8)
                    valor_final = campo.input_value().strip()
                except Exception:
                    pass

            if _codigo_equivalente(valor_final, codigo_str):
                print(
                    f"    Contas a Pagar: '{valor_final}' → 2.1.3.1.1.04.00"
                    f"{' ' + desc if desc else ''}"
                )
                return
            print(
                f"    Contas a Pagar: valor ficou '{valor_final or 'vazio'}' "
                f"(esperado '{codigo_str}', tentativa {tentativa})."
            )

        erros.append(
            f"Contas a Pagar: campo terminou com '{valor_final or 'vazio'}' "
            f"em vez de '{codigo_str}'."
        )
    except Exception as e:
        erros.append(f"Erro ao preencher Contas a Pagar: {e}")


def _preencher_campo_com_retry(pagina, locator, valor: str, erros: list,
                               descricao: str = "campo", tentativas: int = 2,
                               delay_entre: float = 1.0):
    """
    Preenche um campo e verifica se o valor ficou depois do Tab.
    Se o campo reverter (JS reset), tenta novamente até `tentativas` vezes.
    Comum em campos de código SIAFI que disparam onBlur para buscar dados.
    """
    for t in range(1, tentativas + 1):
        try:
            locator.click(click_count=3)
            locator.fill("")
            locator.press_sequentially(valor, delay=80)
            pagina.keyboard.press("Tab")
            time.sleep(delay_entre)
            val_atual = locator.input_value().strip()
            # Considera sucesso se o campo não está vazio ou se contém o valor digitado
            if val_atual:
                print(f"    {descricao} → '{val_atual}' (tentativa {t})")
                return val_atual
            print(f"    {descricao}: campo vazio após Tab (tentativa {t}), tentando novamente...")
        except Exception as e:
            if t == tentativas:
                erros.append(f"Erro ao preencher {descricao}: {e}")
    return ""


def _preencher_vpd(pagina, vpd_codigo: str, erros: list):
    """Preenche 'Conta Variação Patrimonial Diminutiva' com o código VPD.

    Se o campo VPD não existir na página (ex: tipo DH DSP 101), ignora
    silenciosamente — o campo é opcional dependendo do tipo de empenho.
    """
    if not vpd_codigo:
        # Sem código VPD mapeado — verifica se o campo sequer existe antes de
        # reportar como erro; alguns tipos DH (DSP 101) não têm o campo.
        try:
            loc_check = pagina.locator(
                "xpath=//*[contains(normalize-space(text()),'Variação Patrimonial')]"
                "/following::input[1]"
            ).first
            loc_check.wait_for(state="visible", timeout=2000)
            existe = True
        except Exception:
            existe = False
        if existe:
            erros.append("VPD não encontrado para a natureza — preencha manualmente.")
        else:
            print("    VPD: campo não presente na página (tipo DH sem VPD) — ignorado.")
        return
    if "De acordo" in vpd_codigo:
        erros.append(
            f"VPD '{vpd_codigo}' requer conferência manual (código variável ou 'De acordo c/ NF')."
        )
        return
    try:
        vpd_normalizado = re.sub(r"(?i)x", "1", str(vpd_codigo or ""))
        vpd_partes = [parte.strip() for parte in vpd_normalizado.split(".") if parte.strip()]
        if len(vpd_partes) >= 7:
            vpd_editavel = ".".join(vpd_partes[4:-1])
            vpd_digitos = "".join(vpd_partes[4:-1])
        elif len(vpd_partes) >= 6:
            vpd_editavel = ".".join(vpd_partes[4:-1])
            vpd_digitos = "".join(vpd_partes[4:-1])
        else:
            vpd_editavel = re.sub(r"\D+", "", vpd_normalizado)
            vpd_digitos = vpd_editavel

        # Verifica rapidamente se o campo existe antes de tentar preencher.
        locator_vpd = pagina.locator(
            "xpath=//*[contains(normalize-space(text()),'Variação Patrimonial')]"
            "/following::input[1]"
        ).first
        try:
            locator_vpd.wait_for(state="visible", timeout=3000)
        except Exception:
            print(f"    VPD: campo não encontrado na página (tipo DH sem VPD) — código '{vpd_codigo}' ignorado.")
            return

        campo = locator_vpd
        valor_atual = campo.input_value(timeout=5000).strip()
        campo.click()

        if valor_atual and vpd_editavel:
            selecao_ok = campo.evaluate(
                """(el) => {
                    const valor = String(el.value || '');
                    const primeiro = valor.indexOf('_');
                    if (primeiro >= 0) {
                        let ultimo = primeiro;
                        while (ultimo + 1 < valor.length && valor[ultimo + 1] === '_') {
                            ultimo += 1;
                        }
                        el.focus();
                        el.setSelectionRange(primeiro, ultimo + 1);
                        return true;
                    }

                    const match = valor.match(/^(\\d+\\.\\d+\\.\\d+\\.\\d+\\.)(.*?)(\\.\\d+)$/);
                    if (match) {
                        const inicio = match[1].length;
                        const fim = valor.length - match[3].length;
                        el.focus();
                        el.setSelectionRange(inicio, fim);
                        return true;
                    }

                    return false;
                }""",
            )
            if selecao_ok:
                campo.press_sequentially(vpd_digitos, delay=80)
            else:
                campo.press_sequentially(vpd_digitos or vpd_normalizado.replace(".", ""), delay=80)
        else:
            campo.press_sequentially(vpd_digitos or vpd_normalizado.replace(".", ""), delay=80)

        pagina.keyboard.press("Tab")
        time.sleep(0.8)
        val = campo.input_value().strip()
        print(f"    VPD preenchida: '{val}' (complemento: '{vpd_digitos or vpd_editavel or vpd_normalizado}')")
    except Exception as e:
        erros.append(f"Erro ao preencher VPD ({vpd_codigo}): {e}")


def _verificar_interrupcao(deve_parar=None):
    if deve_parar and deve_parar():
        raise ExecucaoInterrompida("Execução interrompida pelo usuário durante Principal com Orçamento.")


# ─────────────────────────────────────────────────────────────────────────────
# HANDLERS POR SITUAÇÃO
# ─────────────────────────────────────────────────────────────────────────────

def _preencher_situacao_DSP001(pagina, num_empenho_pdf, cfg, erros, dados_extraidos=None, deve_parar=None):
    """
    Situação DSP001 — Aquisição de Serviços Pessoas Jurídicas (com contrato).

    Fluxo após seleção da situação:
        1. Preenche Tem Contrato? (SIM/NÃO)
        2. Se SIM: Conta de Contrato = "02" + Favorecido do Contrato = IG
        3. Expande barra do empenho
        4. Preenche VPD (lookup por natureza)
        5. Preenche Contas a Pagar = "1104" → 2.1.3.1.1.04.00
    """
    print("    [DSP001] Preenchendo campos de contrato...")
    _verificar_interrupcao(deve_parar)
    dados = dados_extraidos or {}

    tem_contrato = dados.get("Tem Contrato?", dados.get("Tem Contrato", "Não"))
    ig_code      = dados.get("IG", "").strip()
    natureza     = dados.get("Natureza", "").strip()

    # 1. Tem Contrato?
    try:
        sel_tc = pagina.locator(
            "xpath=//*[normalize-space(text())='Tem Contrato?']"
            "/following::select[1]"
        ).first
        opcao_tc = "SIM" if tem_contrato == "Sim" else "NÃO"
        sel_tc.select_option(label=opcao_tc)
        time.sleep(1.2)   # aguarda campos de contrato aparecerem
        print(f"    Tem Contrato? → {opcao_tc}")
    except Exception as e:
        erros.append(f"Erro ao preencher 'Tem Contrato?' (DSP001): {e}")

    # 2. Conta de Contrato e Favorecido do Contrato (só se SIM)
    if tem_contrato == "Sim":
        _verificar_interrupcao(deve_parar)
        # 2a. Conta de Contrato → "02"
        # Usa retry porque o SIAFI às vezes redefine o campo ao fazer onBlur.
        conta_contrato = cfg.get("conta_contrato", "02")
        try:
            campo_cc = pagina.locator(
                "xpath=//*[normalize-space(text())='Conta de Contrato']"
                "/following::input[1]"
            ).first
            _preencher_campo_com_retry(
                pagina, campo_cc, conta_contrato, erros,
                descricao="Conta de Contrato",
                tentativas=3,
                delay_entre=1.2,
            )
        except Exception as e:
            erros.append(f"Erro ao localizar 'Conta de Contrato' (DSP001): {e}")

        # 2b. Favorecido do Contrato → IG code (com retry pelo mesmo motivo)
        if ig_code:
            try:
                campo_fav = pagina.locator(
                    "xpath=//*[normalize-space(text())='Favorecido do Contrato']"
                    "/following::input[1]"
                ).first
                _preencher_campo_com_retry(
                    pagina, campo_fav, ig_code, erros,
                    descricao="Favorecido do Contrato",
                    tentativas=3,
                    delay_entre=1.0,
                )
            except Exception as e:
                erros.append(f"Erro ao localizar 'Favorecido do Contrato' (DSP001): {e}")
        else:
            erros.append("IG não disponível — preencha 'Favorecido do Contrato' manualmente.")

    # 3. Expande barra do empenho
    if not _expandir_barra_empenho(pagina, num_empenho_pdf, erros):
        return
    _verificar_interrupcao(deve_parar)
    _verificar_empenho(pagina, num_empenho_pdf, erros)

    # 4. VPD — busca pelo código da natureza
    vpd = _buscar_vpd(natureza, "DSP001")
    if vpd:
        print(f"    VPD para natureza '{natureza}': {vpd}")
    else:
        print(f"    VPD não encontrado para natureza '{natureza}' — preencher manualmente.")
    _preencher_vpd(pagina, vpd, erros)
    _verificar_interrupcao(deve_parar)

    # 5. Contas a Pagar → "1104"
    _preencher_contas_a_pagar(pagina, cfg["contas_a_pagar"], erros)


def _preencher_conta_estoque(pagina, codigo: str, erros: list):
    """Preenche o campo 'Conta de Estoque' com o código informado (ex: '60100' → 1.1.5.6.1.01.00)."""
    try:
        campo = pagina.locator(
            "xpath=//*[normalize-space(text())='Conta de Estoque']"
            "/following::input[1]"
        ).first
        campo.click(click_count=3)
        campo.fill("")
        campo.press_sequentially(codigo, delay=80)
        pagina.keyboard.press("Tab")
        time.sleep(0.8)
        val = campo.input_value().strip()
        print(f"    Conta de Estoque: '{val}' (digitado: '{codigo}')")
    except Exception as e:
        erros.append(f"Erro ao preencher Conta de Estoque ({codigo}): {e}")


def _preencher_situacao_DSP101_102(pagina, num_empenho_pdf, cfg, erros, dados_extraidos=None, deve_parar=None):
    """
    Situação DSP101 / DSP102 — Material de Consumo (Almoxarifado / Entrega Direta).

    Fluxo após seleção da situação:
        1. Expande barra do empenho
        2. Preenche VPD (lookup por natureza)
        3. Preenche Conta de Estoque = "60100" → 1.1.5.6.1.01.00
        4. Preenche Contas a Pagar  = "1104"  → 2.1.3.1.1.04.00
    """
    cod = "DSP101/102"
    print(f"    [{cod}] Expandindo barra do empenho...")
    dados = dados_extraidos or {}
    natureza = dados.get("Natureza", "").strip()

    if not _expandir_barra_empenho(pagina, num_empenho_pdf, erros):
        return
    _verificar_interrupcao(deve_parar)
    _verificar_empenho(pagina, num_empenho_pdf, erros)

    # VPD
    vpd = _buscar_vpd(natureza, "DSP101/102")
    if vpd:
        print(f"    VPD para natureza '{natureza}': {vpd}")
    else:
        print(f"    VPD não encontrado para natureza '{natureza}' — preencher manualmente.")
    _preencher_vpd(pagina, vpd, erros)
    _verificar_interrupcao(deve_parar)

    # Conta de Estoque → "60100"
    _preencher_conta_estoque(pagina, cfg.get("conta_estoque", "60100"), erros)

    # Contas a Pagar → "1104"
    _preencher_contas_a_pagar(pagina, cfg["contas_a_pagar"], erros)


def _preencher_situacao_201(pagina, num_empenho_pdf, cfg, erros, dados_extraidos=None, deve_parar=None):
    """Situação 201 — Material Permanente (Bens Móveis)."""
    print("    [201] Expandindo barra do empenho...")
    if not _expandir_barra_empenho(pagina, num_empenho_pdf, erros):
        return
    _verificar_interrupcao(deve_parar)
    _verificar_empenho(pagina, num_empenho_pdf, erros)

    # Conta de Bens Móveis — clica para disparar auto-preenchimento
    try:
        campo_cbm = pagina.locator(
            "xpath=//*[contains(normalize-space(text()),'Conta de Bens')]"
            "/following::input[1]"
        ).first
        campo_cbm.click()
        time.sleep(0.5)
        pagina.keyboard.press("Tab")
        time.sleep(1.5)
        val = campo_cbm.input_value().strip()
        print(f"    Conta de Bens Móveis auto-preenchida: '{val}'")
    except Exception as e:
        erros.append(f"Erro ao acionar Conta de Bens Móveis (201): {e}")

    _preencher_contas_a_pagar(pagina, cfg["contas_a_pagar"], erros)


def _preencher_situacao_001_bpv(pagina, num_empenho_pdf, cfg, erros, dados_extraidos=None, deve_parar=None):
    """Situação 001/BPV001 — Serviços de Terceiros (sem contrato)."""
    print("    [BPV001/001] Expandindo barra do empenho...")
    if not _expandir_barra_empenho(pagina, num_empenho_pdf, erros):
        return
    _verificar_interrupcao(deve_parar)
    _verificar_empenho(pagina, num_empenho_pdf, erros)
    _preencher_contas_a_pagar(pagina, cfg["contas_a_pagar"], erros)


def _preencher_situacao_101_102(pagina, num_empenho_pdf, cfg, erros, dados_extraidos=None, deve_parar=None):
    """Situação 101/102 — Material de Consumo."""
    print("    [101/102] Expandindo barra do empenho...")
    if not _expandir_barra_empenho(pagina, num_empenho_pdf, erros):
        return
    _verificar_interrupcao(deve_parar)
    _verificar_empenho(pagina, num_empenho_pdf, erros)
    _preencher_contas_a_pagar(pagina, cfg["contas_a_pagar"], erros)


# Mapa: código SIAFI completo ou numérico → handler
_HANDLERS = {
    "DSP001": _preencher_situacao_DSP001,
    "DSP101": _preencher_situacao_DSP101_102,
    "DSP102": _preencher_situacao_DSP101_102,
    "BPV001": _preencher_situacao_001_bpv,
    "201":    _preencher_situacao_201,
    "101":    _preencher_situacao_101_102,
    "102":    _preencher_situacao_101_102,
    "001":    _preencher_situacao_001_bpv,   # legado (quando não identificamos BPV/DSP)
}


# ─────────────────────────────────────────────────────────────────────────────
# SELEÇÃO DE SITUAÇÃO NO DROPDOWN
# ─────────────────────────────────────────────────────────────────────────────

def _selecionar_situacao_dropdown(pagina, cod_completo: str, cod_numerico: str) -> bool:
    """
    Seleciona a situação no dropdown da aba Principal Com Orçamento.
    Tenta primeiro pela combinação letra+número (ex: 'DSP001'), depois pelo
    código numérico puro (ex: '001') como fallback.
    Retorna True se selecionou com sucesso.
    """
    sel = achar_elemento(pagina, "Situação:")

    # Estratégia 1 — código SIAFI completo (ex: DSP001, BPV001)
    if cod_completo:
        valor = pagina.evaluate(
            """([el, txt]) => {
                const op = Array.from(el.options).find(
                    o => o.text.toUpperCase().includes(txt.toUpperCase())
                );
                return op ? op.value : null;
            }""",
            [sel.element_handle(), cod_completo]
        )
        if valor:
            sel.select_option(value=valor)
            time.sleep(1.5)
            print(f"    Situação selecionada: {cod_completo}")
            return True

    # Estratégia 2 — código numérico (fallback — pode pegar a primeira opção com esse número)
    if cod_numerico:
        preferido = _PREFERENCIA_SITUACAO.get(cod_numerico, cod_numerico)
        for buscar in ([preferido, cod_numerico] if preferido != cod_numerico else [cod_numerico]):
            valor = pagina.evaluate(
                """([el, txt]) => {
                    const op = Array.from(el.options).find(
                        o => o.text.toUpperCase().includes(txt.toUpperCase())
                    );
                    return op ? op.value : null;
                }""",
                [sel.element_handle(), buscar]
            )
            if valor:
                sel.select_option(value=valor)
                time.sleep(1.5)
                print(f"    Situação selecionada (fallback numérico): {buscar}")
                return True

    return False


# ─────────────────────────────────────────────────────────────────────────────
# ENTRADA PRINCIPAL
# ─────────────────────────────────────────────────────────────────────────────

def _revalidar_favorecido_contrato(pagina, ig_code: str, erros: list) -> None:
    ig_esperado = str(ig_code or "").strip()
    if not ig_esperado:
        return
    try:
        campo_fav = pagina.locator(
            "xpath=//*[normalize-space(text())='Favorecido do Contrato']"
            "/following::input[1]"
        ).first
        valor_atual = ""
        try:
            valor_atual = campo_fav.input_value().strip()
        except Exception:
            pass

        if valor_atual == ig_esperado:
            return

        print(
            f"    Favorecido do Contrato divergente antes da confirmação "
            f"(atual: '{valor_atual or 'vazio'}', esperado: '{ig_esperado}'). Repreenchendo..."
        )
        _preencher_campo_com_retry(
            pagina,
            campo_fav,
            ig_esperado,
            erros,
            descricao="Favorecido do Contrato",
            tentativas=3,
            delay_entre=1.0,
        )
    except Exception as e:
        erros.append(f"Erro ao revalidar 'Favorecido do Contrato': {e}")


def _abrir_aba_principal_orcamento(pagina, timeout_ms: int = 10000) -> None:
    """Navega para a aba Principal Com Orçamento de forma resiliente."""
    import time as _time

    # Verifica se já está na aba certa (campo diagnóstico visível)
    seletores_conteudo = [
        "button[name='confirma-dados-pco']",
        "#pco-situacao",
        "select[name='pco-situacao']",
        "[id*='situacao'][id*='pco'], [name*='situacao'][name*='pco']",
    ]
    if aguardar_aba_ativa(pagina, seletores_conteudo, timeout_ms=800):
        return

    # Textos candidatos para a aba (diferentes versões do portal)
    textos = [
        "Principal Com Orçamento",
        "Principal com Orçamento",
        "Principal Com Orcamento",
        "Principal com Orcamento",
        "Principal",
    ]

    # Tenta seletores CSS diretos primeiro
    css_candidatos = [
        "#principal-com-orcamento-tab",
        "#pco-tab",
        "a[href='#principal-com-orcamento']",
        "a[href='#pco']",
        "a[data-target='#principal-com-orcamento']",
        "button[aria-controls='principal-com-orcamento']",
        "a[aria-controls='pco']",
    ]
    clicou = pagina.evaluate(
        """(candidatos) => {
            const visivel = (el) => {
                if (!el) return false;
                const r = el.getBoundingClientRect();
                const s = window.getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
            };
            for (const sel of candidatos) {
                try {
                    const el = document.querySelector(sel);
                    if (visivel(el)) { el.click(); return sel; }
                } catch {}
            }
            return '';
        }""",
        css_candidatos,
    )
    if clicou and aguardar_aba_ativa(pagina, seletores_conteudo, timeout_ms=3000):
        return

    # Fallback: busca pelo texto
    for texto in textos:
        if clicar_aba_generica(pagina, texto, timeout_ms=3000):
            _time.sleep(0.4)
            if aguardar_aba_ativa(pagina, seletores_conteudo, timeout_ms=3000):
                return

    # Último recurso: espera mais tempo pelo texto original
    try:
        pagina.locator("text=Principal Com Orçamento").first.click(timeout=5000)
        _time.sleep(0.8)
        return
    except Exception:
        pass

    raise RuntimeError(
        "Aba Principal Com Orçamento não encontrada. "
        "Verifique se o documento está aberto no portal Comprasnet."
    )


def executar(dados_extraidos, deve_parar=None, *, pagina=None, playwright=None):
    sessao_propria = pagina is None
    if sessao_propria:
        playwright, pagina = conectar()

    try:
        print("=== PRINCIPAL COM ORÇAMENTO ===")
        erros = []

        _abrir_aba_principal_orcamento(pagina)
        time.sleep(0.3)

        for idx, emp in enumerate(dados_extraidos.get('Empenhos', [])):
            _verificar_interrupcao(deve_parar)
            num = emp.get('Empenho', '')
            raw = emp.get('Situação', '')

            # Extrai código completo (ex: 'DSP001') e numérico (ex: '001')
            cod_completo = extrair_siafi_completo(raw)   # '' se não achar
            cod_numerico = extrair_codigo_situacao(raw)  # '001', '201', etc.

            # Chave de lookup: preferir completo, senão numérico
            chave = cod_completo if cod_completo else cod_numerico
            cfg   = config_situacao(chave)

            print(f"\n  [{idx+1}] Empenho: {num} | raw: '{raw}' | completo: '{cod_completo}' | numérico: '{cod_numerico}'")

            if cfg is None:
                erros.append(
                    f"Situação '{chave}' (raw: '{raw}') ainda não implementada. "
                    "Preencha manualmente."
                )
                continue

            # Seleciona situação no dropdown
            ok = _selecionar_situacao_dropdown(pagina, cod_completo, cod_numerico)
            if not ok:
                erros.append(f"Empenho {num}: não foi possível selecionar situação '{chave}'.")
                continue

            # Chama handler — usa chave completa primeiro, numérica como fallback
            handler = _HANDLERS.get(cod_completo) or _HANDLERS.get(cod_numerico)
            if handler:
                handler(
                    pagina,
                    num,
                    cfg,
                    erros,
                    dados_extraidos=dados_extraidos,
                    deve_parar=deve_parar,
                )
            else:
                erros.append(f"Handler para situação '{chave}' não implementado.")

        # Confirma aba
        if not erros:
            try:
                _revalidar_favorecido_contrato(pagina, dados_extraidos.get("IG", ""), erros)
                btn = pagina.locator("button[name='confirma-dados-pco']").first
                btn.wait_for(state="visible", timeout=5000)
                btn.click()
                time.sleep(2.0)
                print("\n  Confirmado.")
            except Exception as e:
                erros.append(f"Erro ao confirmar Principal Com Orçamento: {e}")

        if erros:
            return {"status": "alerta", "mensagem": "\n".join(erros)}
        return {"status": "sucesso", "mensagem": "Principal Com Orçamento preenchido!"}

    except ExecucaoInterrompida as e:
        return {"status": "interrompido", "mensagem": str(e)}
    except Exception as e:
        return {"status": "erro", "mensagem": str(e)}
    finally:
        if sessao_propria and playwright is not None:
            playwright.stop()

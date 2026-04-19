"""
comprasnet_dados_basicos.py
Preenche e valida a aba Dados Básicos.
"""
import re
import time

from comprasnet_base import (
    conectar,
    preencher_data,
    selecionar_opcao,
    ler_campo_data,
    normalizar_data,
    normalizar_valor,
    clicar_aba_generica,
)


def _normalizar_numero_documento(valor: str) -> str:
    digitos = "".join(ch for ch in str(valor or "") if ch.isdigit())
    return digitos.lstrip("0") or "0"


def _documentos_para_observacao(dados_extraidos: dict) -> list[tuple[str, str]]:
    documentos: list[tuple[str, str]] = []
    for nota in dados_extraidos.get('Notas Fiscais', []):
        numero = str(nota.get('Número da Nota', '') or '').strip()
        if not numero:
            continue
        tipo = str(nota.get('Tipo', '') or '').upper()
        categoria = 'FATURA' if 'FATURA' in tipo else 'NF'
        documentos.append((categoria, numero))
    return documentos


def _descricao_documentos_pagamento(dados_extraidos: dict) -> str:
    documentos = _documentos_para_observacao(dados_extraidos)
    nfs = [numero for categoria, numero in documentos if categoria == 'NF']
    faturas = [numero for categoria, numero in documentos if categoria == 'FATURA']
    partes: list[str] = []
    if nfs:
        partes.append(f"Pagamento {'NF' if len(nfs) == 1 else 'NFs'} {', '.join(nfs)}")
    if faturas:
        partes.append(f"{'Fatura' if len(faturas) == 1 else 'Faturas'} {', '.join(faturas)}")
    return " e ".join(partes) if partes else "Pagamento NF —"


def _montar_observacao(dados_extraidos: dict) -> str:
    """
    Monta o texto de observação para o campo Dados Básicos.

    Formato com contrato:
        Pagamento NFs 1526, 15353 - Contrato 00160/2020 - Solicitação Pagamento 202602991.

    Formato sem contrato:
        Pagamento NF 1526 - Solicitação Pagamento 202602991.

    Distingue NF de Fatura com base no campo "Tipo" de cada nota fiscal.
    """
    sol = dados_extraidos.get('Solicitação de Pagamento', '').strip()

    tem_contrato = dados_extraidos.get('Tem Contrato?', dados_extraidos.get('Tem Contrato', 'Não'))
    num_contrato = dados_extraidos.get('Número do Contrato', '').strip()

    partes = [_descricao_documentos_pagamento(dados_extraidos)]
    if tem_contrato == 'Sim' and num_contrato:
        partes.append(f"Contrato {num_contrato}")
    if sol:
        partes.append(f"Solicitação Pagamento {sol}")
    return ' - '.join(partes) + '.'


def _abrir_aba_dados_basicos(pagina) -> None:
    def _dados_basicos_prontos(timeout_ms: int) -> bool:
        try:
            pagina.wait_for_function(
                r"""() => {
                    const visivel = (el) => {
                        if (!el) return false;
                        const rect = el.getBoundingClientRect();
                        const estilo = window.getComputedStyle(el);
                        return rect.width > 0
                            && rect.height > 0
                            && estilo.visibility !== 'hidden'
                            && estilo.display !== 'none';
                    };
                    const textoNormalizado = (el) => String(el?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
                    const estaSelecionada = (el) => !!el && (
                        el.getAttribute("aria-selected") === "true"
                        || el.getAttribute("aria-expanded") === "true"
                        || el.classList.contains("active")
                        || el.classList.contains("ui-tabs-active")
                        || el.parentElement?.classList.contains("active")
                        || el.parentElement?.classList.contains("ui-tabs-active")
                    );

                    const campoProcesso = Array.from(document.querySelectorAll("#txtprocesso"))
                        .find((el) => visivel(el));
                    const botaoConfirmar = Array.from(document.querySelectorAll("#btnSubmitFormSfDadosBasicos"))
                        .find((el) => visivel(el));
                    const campoVencimento = Array.from(document.querySelectorAll("#dtvenc, input[name='dtvenc']"))
                        .find((el) => visivel(el));

                    const temMarcadores = !!campoProcesso || !!botaoConfirmar || !!campoVencimento;
                    if (!temMarcadores) {
                        return false;
                    }

                    const abaId = document.querySelector("#dados-basicos-tab");
                    const abaTexto = Array.from(document.querySelectorAll("a, button, [role='tab'], li"))
                        .find((el) => visivel(el) && (
                            textoNormalizado(el).includes('dados básicos')
                            || textoNormalizado(el).includes('dados basicos')
                        ));
                    if (estaSelecionada(abaId) || estaSelecionada(abaTexto)) {
                        return true;
                    }

                    const marcadoresTexto = Array.from(document.querySelectorAll("label, span, div, strong, th, td"))
                        .some((el) => {
                            const texto = textoNormalizado(el);
                            return visivel(el) && (
                                texto.includes('código da ug pagadora')
                                || texto.includes('codigo da ug pagadora')
                                || texto.includes('data de vencimento')
                                || texto.includes('data de emissao contabil')
                                || texto.includes('data de emissão contábil')
                                || texto.includes('dados de documentos de origem')
                                || texto.includes('codigo da ug emitente')
                                || texto.includes('código da ug emitente')
                            );
                        });

                    // Fallback amplo: qualquer input ou button visível dentro da aba ativa
                    const abaAtiva = Array.from(document.querySelectorAll(
                        '[role="tab"][aria-selected="true"], .nav-link.active, .ui-tabs-active a, li.active > a'
                    )).find((el) => textoNormalizado(el).includes('dados b'));
                    const abaAberta = !!abaAtiva && Array.from(document.querySelectorAll('input, select, button'))
                        .some((el) => visivel(el));

                    return !!botaoConfirmar || marcadoresTexto || abaAberta;
                }""",
                timeout=timeout_ms,
            )
            return True
        except Exception:
            return False

    def _clicar_aba_rapido() -> bool:
        try:
            return bool(
                pagina.evaluate(
                    """() => {
                        const visivel = (el) => {
                            if (!el) return false;
                            const rect = el.getBoundingClientRect();
                            const estilo = window.getComputedStyle(el);
                            return rect.width > 0
                                && rect.height > 0
                                && estilo.visibility !== 'hidden'
                                && estilo.display !== 'none';
                        };

                        const candidatos = [
                            '#dados-basicos-tab',
                            "a[href='#dados-basicos']",
                            "a[data-target='#dados-basicos']",
                            "a[data-bs-target='#dados-basicos']",
                            "button[aria-controls='dados-basicos']",
                            "a[aria-controls='dados-basicos']",
                        ];

                        for (const seletor of candidatos) {
                            const alvo = document.querySelector(seletor);
                            if (visivel(alvo)) {
                                alvo.click();
                                return true;
                            }
                        }

                        const porTexto = Array.from(
                            document.querySelectorAll("a, button, [role='tab'], li")
                        ).find((el) => {
                            const texto = String(el.textContent || '').trim().toLowerCase();
                            return visivel(el) && (texto.includes('dados básicos') || texto.includes('dados basicos'));
                        });

                        if (porTexto) {
                            porTexto.click();
                            return true;
                        }

                        return false;
                    }"""
                )
            )
        except Exception:
            return False

    if _dados_basicos_prontos(800):
        return

    if _clicar_aba_rapido() and _dados_basicos_prontos(1200):
        time.sleep(0.1)
        return

    candidatos = [
        pagina.locator("#dados-basicos-tab"),
        pagina.locator("a[href='#dados-basicos'], a[data-target='#dados-basicos']"),
        pagina.locator("button[aria-controls='dados-basicos'], a[aria-controls='dados-basicos']"),
        pagina.get_by_role("tab", name=re.compile(r"dados básicos|dados basicos", re.I)),
        pagina.locator("text=Dados Básicos").first,
    ]

    for loc in candidatos:
        try:
            alvo = loc.first
            alvo.wait_for(state="visible", timeout=1200)
            alvo.scroll_into_view_if_needed()
            alvo.click(timeout=1200)
            if _dados_basicos_prontos(1200):
                time.sleep(0.1)
                return
        except Exception:
            continue

    if _clicar_aba_rapido() and _dados_basicos_prontos(5000):
        time.sleep(0.15)
        return

    # Fallback final: busca genérica pelo texto da aba
    for texto in ("Dados Básicos", "Dados Basicos", "Dados B", "Dados B"):
        if clicar_aba_generica(pagina, texto, timeout_ms=3000):
            time.sleep(0.5)
            if _dados_basicos_prontos(5000):
                return

    # Diagnóstico: loga elementos visíveis para depuração
    try:
        info = pagina.evaluate("""() => {
            const visivel = (el) => { try { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch { return false; } };
            const abas = Array.from(document.querySelectorAll('a, button, [role="tab"], li > a'))
                .filter(visivel).slice(0, 20).map(el => el.textContent.trim().replace(/\s+/g, ' ').slice(0, 50));
            const inputs = Array.from(document.querySelectorAll('input, select'))
                .filter(visivel).slice(0, 10).map(el => `${el.tagName}#${el.id}[${el.name}]`);
            return { abas, inputs };
        }""")
        import logging as _log
        _log.getLogger(__name__).warning("DIAGNÓSTICO Dados Básicos | abas=%s | inputs=%s", info.get('abas'), info.get('inputs'))
        print(f"    [DIAG] Abas visíveis: {info.get('abas')}")
        print(f"    [DIAG] Inputs visíveis: {info.get('inputs')}")
    except Exception as _diag_err:
        print(f"    [DIAG] erro ao coletar diagnóstico: {_diag_err}")

    raise RuntimeError("Aba Dados Básicos não encontrada ou não abriu corretamente.")


def _coletar_linhas_notas_basicos(pagina) -> list[tuple[str, str, str]]:
    try:
        linhas = pagina.evaluate(
            """() => {
                const visivel = (el) => {
                    if (!el) return false;
                    const rect = el.getBoundingClientRect();
                    const estilo = window.getComputedStyle(el);
                    return rect.width > 0
                        && rect.height > 0
                        && estilo.visibility !== 'hidden'
                        && estilo.display !== 'none';
                };

                const localizarPainel = () => {
                    const marcadores = Array.from(document.querySelectorAll(
                        "#btnSubmitFormSfDadosBasicos, #txtprocesso, #dtvenc, input[name='dtvenc']"
                    )).filter((el) => visivel(el));

                    for (const marcador of marcadores) {
                        const painel = marcador.closest("[role='tabpanel'], .tab-pane, .ui-tabs-panel, form, section, .panel");
                        if (painel) {
                            return painel;
                        }
                    }
                    return document;
                };

                const painel = localizarPainel();
                const tabela = Array.from(painel.querySelectorAll('table')).find((el) => {
                    const texto = String(el.innerText || el.textContent || '').toLowerCase();
                    return visivel(el)
                        && texto.includes('dados de documentos de origem')
                        && texto.includes('emitente')
                        && texto.includes('valor');
                });

                return Array.from((tabela || painel).querySelectorAll('table tbody tr, tbody tr'))
                    .map((row) => Array.from(row.querySelectorAll('td'))
                        .map((coluna) => String(coluna.innerText || coluna.textContent || '').trim()))
                    .filter((colunas) => {
                        const texto = colunas.join(' ').trim().toUpperCase();
                        return colunas.length >= 4 && texto && !texto.includes('TOTAL');
                    })
                    .map((colunas) => [colunas[1] || '', colunas[2] || '', colunas[3] || '']);
            }"""
        )
    except Exception:
        return []
    return [tuple(str(valor) for valor in linha) for linha in (linhas or [])]


def _preencher_vencimento_basicos(pagina, data_vencimento_usuario: str) -> str:
    data_venc_normalizada = normalizar_data(data_vencimento_usuario)
    partes = data_venc_normalizada.split("/")
    if len(partes) != 3:
        raise ValueError(f"Data inválida: '{data_vencimento_usuario}'")
    dd, mm, aaaa = partes
    data_iso = f"{aaaa}-{mm}-{dd}"

    candidatos = [
        pagina.locator("#dtvenc:visible"),
        pagina.locator("input[name='dtvenc']:visible"),
        pagina.locator("input[type='date']:visible").filter(has_text=""),
    ]

    ultimo_erro = None
    for loc in candidatos:
        try:
            if loc.count() == 0:
                continue
            campo = loc.first
            campo.wait_for(state="visible", timeout=2500)
            campo.scroll_into_view_if_needed()
            campo.click()
            resultado = campo.evaluate(
                """(el, valorIso) => {
                    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                    el.focus();
                    if (setter) {
                        setter.call(el, valorIso);
                    } else {
                        el.value = valorIso;
                    }
                    el.setAttribute('value', valorIso);
                    el.defaultValue = valorIso;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
                    return String(el.value || '').trim();
                }""",
                data_iso,
            )
            time.sleep(0.35)
            valor_final = (campo.input_value() or resultado or "").strip()
            if normalizar_data(valor_final) == data_venc_normalizada:
                return valor_final
            raise RuntimeError(f"campo ficou com '{valor_final or 'vazio'}'")
        except Exception as exc:
            ultimo_erro = exc

    raise RuntimeError(str(ultimo_erro or "Campo #dtvenc não localizado."))


def executar(dados_extraidos, data_vencimento_usuario, *, pagina=None, playwright=None):
    data_vencimento_usuario = str(
        dados_extraidos.get("_vencimento_documento", "") or data_vencimento_usuario or ""
    ).strip()
    # ── Ajuste automático da data de vencimento ───────────────────────────────
    # Garante que a data não caia em feriado ou fim de semana (Florianópolis).
    try:
        from datas_impostos import ajustar_data_util
        data_ajustada, foi_ajustada = ajustar_data_util(data_vencimento_usuario)
        if foi_ajustada:
            print(f"  ⚠ Vencimento ajustado: {data_vencimento_usuario} → {data_ajustada} (era feriado/fim de semana)")
        data_vencimento_usuario = data_ajustada
    except Exception as _e:
        print(f"  Aviso: ajuste de data falhou ({_e}), usando data original.")

    sessao_propria = pagina is None
    if sessao_propria:
        playwright, pagina = conectar()
    try:
        print("=== DADOS BÁSICOS ===")

        # Garante que a aba correta está aberta antes de procurar qualquer campo.
        _abrir_aba_dados_basicos(pagina)

        # 0. Tipo DH Padrão — NP
        print("[0] Tipo DH Padrão: NP")
        _valor_dh = ""
        _ok_dh = False
        try:
            estado_dh = pagina.evaluate(
                r"""() => {
                    const visivel = (el) => {
                        if (!el) return false;
                        const rect = el.getBoundingClientRect();
                        const style = window.getComputedStyle(el);
                        return rect.width > 0
                            && rect.height > 0
                            && style.visibility !== 'hidden'
                            && style.display !== 'none';
                    };
                    const normalizar = (txt) => String(txt || '').replace(/\s+/g, ' ').trim().toUpperCase();
                    const contexto = (el) => {
                        const partes = [];
                        let atual = el;
                        for (let i = 0; i < 4 && atual; i += 1) {
                            partes.push(atual.innerText || atual.textContent || '');
                            atual = atual.parentElement;
                        }
                        return normalizar(partes.join(' '));
                    };

                    const candidatos = Array.from(document.querySelectorAll('select, input'))
                        .filter((el) => visivel(el) || el.disabled || el.readOnly)
                        .map((el) => ({ el, tag: el.tagName.toLowerCase(), ctx: contexto(el) }))
                        .filter(({ el, ctx }) => {
                            if (ctx.includes('TIPO DH PADR') || ctx.includes('NOTA DE PAGAMENTO')) return true;
                            const idName = normalizar(`${el.id || ''} ${el.name || ''}`);
                            return idName.includes('TIPO') || idName.includes('DH');
                        });

                    for (const { el, tag } of candidatos) {
                        if (tag !== 'input') continue;
                        const valor = normalizar(el.value || '');
                        if (valor.includes('NP') || valor.includes('NOTA DE PAGAMENTO')) {
                            return { ok: true, valor: el.value || '', modo: 'input-existente' };
                        }
                    }

                    for (const { el, tag } of candidatos) {
                        if (tag !== 'select') continue;
                        const atual = normalizar(el.options[el.selectedIndex]?.text || el.value || '');
                        if (atual.includes('NP') || atual.includes('NOTA DE PAGAMENTO')) {
                            return { ok: true, valor: el.options[el.selectedIndex]?.text || el.value || '', modo: 'select-existente' };
                        }

                        const op = Array.from(el.options || []).find((option) => {
                            const texto = normalizar(option.text || '');
                            const valor = normalizar(option.value || '');
                            return texto.includes('NP') || valor === 'NP' || texto.includes('NOTA DE PAGAMENTO');
                        });
                        if (!op) continue;

                        el.value = op.value;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        if (typeof window.$ !== 'undefined') {
                            window.$(el).trigger('change');
                        }
                        return { ok: true, valor: op.text || op.value || '', modo: 'select-ajustado' };
                    }

                    return { ok: false, valor: '', modo: 'nao-encontrado' };
                }"""
            ) or {}
            _ok_dh = bool(estado_dh.get("ok"))
            _valor_dh = str(estado_dh.get("valor", "")).strip()
            if _ok_dh:
                print(f"  → Tipo DH resolvido ({estado_dh.get('modo')}): '{_valor_dh}'.")
        except Exception:
            estado_dh = {"ok": False, "modo": "erro-js"}

        if not _ok_dh:
            print("  → Fallback para seleção por label do campo.")
            try:
                selecionar_opcao(pagina, "Tipo DH Padrão", "NP")
                time.sleep(0.8)
                valor_confirmado = pagina.evaluate(
                    r"""() => {
                        const els = Array.from(document.querySelectorAll('input, select'));
                        const alvo = els.find((el) => {
                            const bloco = el.closest('div, form, section') || el.parentElement;
                            const texto = (bloco.innerText || '').toUpperCase();
                            return texto.includes('TIPO DH PADR') || texto.includes('NOTA DE PAGAMENTO');
                        });
                        if (!alvo) return '';
                        if (alvo.tagName.toLowerCase() === 'select') {
                            return alvo.options[alvo.selectedIndex]?.text || alvo.value || '';
                        }
                        return alvo.value || '';
                    }"""
                )
                valor_confirmado = str(valor_confirmado).strip()
                if valor_confirmado:
                    _ok_dh = "NP" in valor_confirmado.upper() or "NOTA DE PAGAMENTO" in valor_confirmado.upper()
                print(f"  → Tipo DH após fallback: '{valor_confirmado}'.")
            except Exception as exc:
                print(f"  → Aviso: fallback do Tipo DH falhou ({exc}).")

        if not _ok_dh:
            print("  → Aviso: Tipo DH não pôde ser confirmado automaticamente; seguindo o fluxo.")

        # 1. Data de Vencimento
        print(f"[1] Vencimento: {data_vencimento_usuario}")
        try:
            valor_final = _preencher_vencimento_basicos(pagina, data_vencimento_usuario)
            print(f"  → Vencimento confirmado: {valor_final}")
        except Exception as exc:
            print(f"  → Fallback do vencimento por id falhou ({exc}); tentando pelo label.")
            preencher_data(pagina, "Data de Vencimento:", data_vencimento_usuario)

        # 2. Processo — usa locator scoped à aba "Dados Básicos" para evitar
        #    strict mode violation (o id #txtprocesso existe em múltiplas abas).
        proc = dados_extraidos.get('Processo', '')
        print(f"[2] Processo: {proc}")
        try:
            campo_proc = pagina.locator("#txtprocesso:visible").first
            campo_proc.click(click_count=3)
            campo_proc.fill(proc)
            pagina.keyboard.press("Tab")
            time.sleep(0.3)
        except Exception:
            # Fallback: pega o primeiro visível
            campo_proc = pagina.locator("#txtprocesso").first
            campo_proc.click(click_count=3)
            campo_proc.fill(proc)
            pagina.keyboard.press("Tab")
            time.sleep(0.3)

        # 3. Observação — formato completo com contrato (se houver) e distinção NF/Fatura
        obs = _montar_observacao(dados_extraidos)
        print(f"[3] Observação: {obs}")
        pagina.locator("textarea:visible").first.fill(obs)

        # 4. Validações
        erros = []
        notas = dados_extraidos.get('Notas Fiscais', [])
        if notas:
            try:
                ateste_web = ler_campo_data(pagina, "Ateste:")
                ateste_pdf = normalizar_data(notas[0].get('Data de Ateste', ''))
                if ateste_web != ateste_pdf:
                    erros.append(f"Ateste: Web={ateste_web} | PDF={ateste_pdf}")
            except Exception as e:
                erros.append(f"Ateste não verificado: {e}")

            linhas_tabela = _coletar_linhas_notas_basicos(pagina)
            for i, nota in enumerate(notas):
                ew, nw, vw = linhas_tabela[i] if i < len(linhas_tabela) else ("", "", "")
                ep = normalizar_data(nota.get('Data de Emissão', ''))
                np_ = nota.get('Número da Nota', '').strip()
                vp = nota.get('Valor', '')
                if ew and normalizar_data(ew) != ep:
                    erros.append(f"NF {np_} — Emissão: Web={ew} PDF={ep}")
                if nw and _normalizar_numero_documento(nw) != _normalizar_numero_documento(np_):
                    erros.append(f"NF {np_} — Nº Doc: Web={nw} PDF={np_}")
                if vw and normalizar_valor(vw) != normalizar_valor(vp):
                    erros.append(f"NF {np_} — Valor: Web={vw} PDF={vp}")

        # 5. Confirmar Dados Básicos
        print("[5] Confirmando Dados Básicos...")
        try:
            # Botão identificado no DOM: id="btnSubmitFormSfDadosBasicos"
            pagina.locator("#btnSubmitFormSfDadosBasicos:visible").first.click()
            time.sleep(2.0)
            print("  Confirmado.")
        except Exception as e:
            erros.append(f"Erro ao clicar em Confirmar Dados Básicos: {e}")

        if erros:
            return {"status": "alerta", "mensagem": "\n".join(erros)}

        return {"status": "sucesso", "mensagem": "Dados Básicos preenchidos e confirmados!"}

    except Exception as e:
        return {"status": "erro", "mensagem": str(e)}
    finally:
        if sessao_propria and playwright is not None:
            playwright.stop()

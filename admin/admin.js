(function () {
  "use strict";

  // Só o token da sessão fica no celular. A senha é conferida no Apps Script
  // (apps-script/Admin.js) e não aparece em lugar nenhum do código do site.
  var CHAVE_TOKEN = "zaza_admin_token";
  // Cardápio guardado no celular: o admin abre na hora e atualiza por trás
  var CHAVE_CARDAPIO = "zaza_admin_cardapio";
  var NOVA_SECAO = "__nova__";

  var linhas = [];
  var editando = null; // { secao, nome } do item aberto no editor, ou null se é novo

  var $ = function (id) {
    return document.getElementById(id);
  };

  // ---------- utilidades ----------

  function txt(v) {
    return v == null ? "" : String(v).trim();
  }

  function slug(s) {
    return txt(s)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function el(tag, attrs, filhos) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "texto") n.textContent = attrs[k];
      else if (k === "classe") n.className = attrs[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (filhos || []).forEach(function (f) {
      if (f) n.appendChild(typeof f === "string" ? document.createTextNode(f) : f);
    });
    return n;
  }

  function formatarPreco(v) {
    var s = txt(v).replace(/[^\d,.]/g, "");
    if (!s) return "sem preço";
    var n = s.indexOf(",") >= 0 ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
    if (!isFinite(n)) return "R$ " + s;
    var centavos = Math.round(n * 100) % 100 !== 0;
    return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: centavos ? 2 : 0, maximumFractionDigits: 2 });
  }

  function marcado(v) {
    if (v === true) return true;
    var s = slug(v);
    return s === "true" || s === "verdadeiro" || s === "sim" || s === "x";
  }

  var timerAviso;
  function avisar(msg, erro) {
    var a = $("aviso");
    a.textContent = msg;
    a.className = "aviso aviso--visivel" + (erro ? " aviso--erro" : "");
    clearTimeout(timerAviso);
    timerAviso = setTimeout(function () {
      a.className = "aviso" + (erro ? " aviso--erro" : "");
    }, erro ? 5000 : 2200);
  }

  function carregando(sim) {
    $("carregando").hidden = !sim;
  }

  // ---------- API ----------

  function token() {
    try {
      return localStorage.getItem(CHAVE_TOKEN) || "";
    } catch (e) {
      return "";
    }
  }

  function guardarToken(t) {
    try {
      if (t) localStorage.setItem(CHAVE_TOKEN, t);
      else localStorage.removeItem(CHAVE_TOKEN);
    } catch (e) {
      /* sem armazenamento: vai pedir a senha de novo na próxima vez */
    }
  }

  /** text/plain evita a checagem extra de CORS que o Apps Script não responde. */
  function api(acao, dados) {
    var corpo = Object.assign({ acao: acao, token: token() }, dados || {});
    return fetch(window.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(corpo),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("Sem conexão com a planilha (" + r.status + ").");
        return r.json();
      })
      .catch(function (e) {
        if (e instanceof TypeError) throw new Error("Sem internet? Não consegui falar com a planilha.");
        throw e;
      })
      .then(function (r) {
        if (r.ok) return r;
        if (r.erro === "sessao") {
          guardarToken("");
          mostrarLogin(r.mensagem);
        }
        throw new Error(r.mensagem || r.erro || "Algo deu errado.");
      });
  }

  // ---------- telas ----------

  function mostrarLogin(msg) {
    $("tela-app").hidden = true;
    $("tela-login").hidden = false;
    $("erro-login").textContent = msg || "";
    $("senha").value = "";
    $("senha").focus();
  }

  function mostrarApp() {
    $("tela-login").hidden = true;
    $("tela-app").hidden = false;
  }

  // ---------- navegação (#comandas, #comanda/ID, #conta/ID, #cardapio, #vendas) ----------
  // Pelo endereço, pra o "voltar" do celular funcionar.

  function rota() {
    if ($("tela-app").hidden) return;
    var partes = location.hash.replace(/^#/, "").split("/");
    var pagina = partes[0] || "comandas";
    if (!$("pagina-" + pagina)) pagina = "comandas";
    Array.prototype.forEach.call(document.querySelectorAll(".pagina"), function (p) {
      p.hidden = p.id !== "pagina-" + pagina;
    });
    // Dentro de uma comanda o menu some: a tela é só dela
    var dentro = pagina === "comanda" || pagina === "conta";
    $("menu").hidden = dentro;
    $("barra").hidden = dentro;
    Array.prototype.forEach.call($("menu").children, function (a) {
      a.setAttribute("aria-current", a.getAttribute("data-pagina") === pagina ? "page" : "false");
    });
    if (pagina === "cardapio") render();
    else window.Comandas.mostrar(pagina, decodeURIComponent(partes[1] || ""));
    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", rota);

  $("form-login").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var botao = $("botao-entrar");
    botao.disabled = true;
    botao.textContent = "Entrando…";
    $("erro-login").textContent = "";
    api("login", { senha: $("senha").value })
      .then(function (r) {
        guardarToken(r.token);
        return carregar();
      })
      .catch(function (e) {
        $("erro-login").textContent = e.message;
      })
      .then(function () {
        botao.disabled = false;
        botao.textContent = "Entrar";
      });
  });

  $("botao-sair").addEventListener("click", function () {
    api("sair").catch(function () {});
    guardarToken("");
    mostrarLogin();
  });

  function definirLinhas(novas) {
    linhas = novas || [];
    try {
      localStorage.setItem(CHAVE_CARDAPIO, JSON.stringify(linhas));
    } catch (e) {
      /* sem espaço: só abre mais devagar na próxima vez */
    }
  }

  function cardapioGuardado() {
    try {
      return JSON.parse(localStorage.getItem(CHAVE_CARDAPIO) || "null");
    } catch (e) {
      return null;
    }
  }

  function abrirApp() {
    mostrarApp();
    rota();
    window.Comandas.sincronizarAoEntrar();
  }

  /**
   * Com cardápio guardado, abre na hora e busca o atualizado por trás (a
   * planilha leva uns segundos pra responder). Sem ele, espera a planilha.
   */
  function carregar() {
    var guardado = cardapioGuardado();
    if (guardado) {
      linhas = guardado;
      abrirApp();
    } else {
      carregando(true);
    }
    return api("listar")
      .then(function (r) {
        definirLinhas(r.cardapio);
        if (!guardado) abrirApp();
        else if (location.hash.indexOf("#cardapio") === 0) render();
        else window.Comandas.cardapioAtualizado();
      })
      .catch(function (e) {
        if (!$("tela-login").hidden) return;
        avisar(guardado ? "Sem conexão: usando o cardápio salvo no celular." : e.message, !guardado);
      })
      .then(function () {
        carregando(false);
      });
  }

  // ---------- lista ----------

  /** Mesma regra do site: seções na ordem da planilha, linhas de mesmo nome = um item. */
  function agrupar() {
    var secoes = [];
    var porSecao = {};
    linhas.forEach(function (l) {
      if (!txt(l.nome)) return;
      var secao = txt(l.secao) || "Outros";
      var s = porSecao[slug(secao)];
      if (!s) {
        s = porSecao[slug(secao)] = { titulo: secao, id: "s-" + slug(secao), itens: [], porNome: {} };
        secoes.push(s);
      }
      var item = s.porNome[slug(l.nome)];
      if (!item) {
        item = s.porNome[slug(l.nome)] = { secao: secao, nome: txt(l.nome), descricao: "", variacoes: [] };
        s.itens.push(item);
      }
      if (!item.descricao) item.descricao = txt(l.descricao);
      item.variacoes.push({ opcao: txt(l.opcao), preco: txt(l.preco), em_falta: marcado(l.em_falta) });
    });
    return secoes;
  }

  function render() {
    var secoes = agrupar();
    var lista = $("lista");
    var abas = $("abas");
    lista.innerHTML = "";
    abas.innerHTML = "";
    secoes.forEach(function (s) {
      abas.appendChild(
        el("button", {
          classe: "aba",
          type: "button",
          texto: s.titulo,
          onclick: function () {
            $(s.id).scrollIntoView({ behavior: "smooth" });
          },
        }),
      );
      var bloco = el("section", { classe: "admin-secao", id: s.id }, [
        el("h2", { classe: "admin-secao__titulo", texto: s.titulo }),
      ]);
      s.itens.forEach(function (item) {
        bloco.appendChild(renderCartao(item));
      });
      bloco.appendChild(
        el("button", {
          classe: "adicionar",
          type: "button",
          texto: "+ Adicionar item em " + s.titulo,
          onclick: function () {
            abrirEditor(null, s.titulo);
          },
        }),
      );
      lista.appendChild(bloco);
    });
  }

  function renderCartao(item) {
    var tudoEmFalta = item.variacoes.every(function (v) {
      return v.em_falta;
    });
    var cartao = el("article", { classe: "cartao" + (tudoEmFalta ? " cartao--falta" : "") }, [
      el(
        "button",
        {
          classe: "cartao__topo",
          type: "button",
          "aria-label": "Editar " + item.nome,
          onclick: function () {
            abrirEditor(item);
          },
        },
        [
          el("span", { classe: "cartao__nome" }, [
            item.nome,
            item.descricao ? el("small", { texto: item.descricao }) : null,
          ]),
          el("span", { classe: "cartao__editar", texto: "Editar" }),
        ],
      ),
    ]);
    item.variacoes.forEach(function (v) {
      cartao.appendChild(
        el("div", { classe: "variacao" + (v.em_falta ? " variacao--falta" : "") }, [
          el("span", { classe: "variacao__nome", texto: v.opcao || "Preço" }),
          el("span", { classe: "variacao__preco", texto: formatarPreco(v.preco) }),
          renderChave(item, v),
        ]),
      );
    });
    return cartao;
  }

  function renderChave(item, v) {
    var chave = el(
      "button",
      {
        classe: "chave",
        type: "button",
        role: "switch",
        "aria-checked": v.em_falta ? "true" : "false",
        "aria-label": "Em falta: " + item.nome + (v.opcao ? " " + v.opcao : ""),
      },
      [el("span", { texto: "Em falta" }), el("span", { classe: "chave__trilho", "aria-hidden": "true" })],
    );
    chave.addEventListener("click", function () {
      var novo = !v.em_falta;
      chave.setAttribute("aria-checked", novo ? "true" : "false");
      chave.setAttribute("aria-busy", "true");
      api("emFalta", { secao: item.secao, nome: item.nome, opcao: v.opcao, valor: novo })
        .then(function (r) {
          definirLinhas(r.cardapio);
          render();
          avisar(novo ? item.nome + " marcado como em falta" : item.nome + " voltou pro cardápio");
        })
        .catch(function (e) {
          chave.setAttribute("aria-checked", v.em_falta ? "true" : "false");
          chave.removeAttribute("aria-busy");
          avisar(e.message, true);
        });
    });
    return chave;
  }

  // ---------- editor ----------

  var editor = $("editor");

  function nomesDasSecoes() {
    return agrupar().map(function (s) {
      return s.titulo;
    });
  }

  function preencherSecoes(selecionada) {
    var sel = $("campo-secao");
    var depois = $("campo-depois");
    sel.innerHTML = "";
    depois.innerHTML = "";
    nomesDasSecoes().forEach(function (n) {
      sel.appendChild(el("option", { value: n, texto: n }));
      depois.appendChild(el("option", { value: n, texto: n }));
    });
    sel.appendChild(el("option", { value: NOVA_SECAO, texto: "+ Nova seção…" }));
    sel.value = selecionada || NOVA_SECAO;
    if (depois.options.length) depois.value = depois.options[depois.options.length - 1].value;
    atualizarSecaoNova();
  }

  function atualizarSecaoNova() {
    var nova = $("campo-secao").value === NOVA_SECAO;
    $("campo-secao-nova-rotulo").hidden = !nova;
    $("campo-depois-rotulo").hidden = !nova || !$("campo-depois").options.length;
  }

  $("campo-secao").addEventListener("change", function () {
    atualizarSecaoNova();
    if ($("campo-secao").value === NOVA_SECAO) $("campo-secao-nova").focus();
  });

  function linhaDePreco(v) {
    v = v || { opcao: "", preco: "", em_falta: false };
    var linha = el("div", { classe: "linha-preco" }, [
      el("input", {
        type: "text",
        classe: "opcao-campo",
        placeholder: "Opção (ex.: Latão)",
        "aria-label": "Opção",
        autocapitalize: "sentences",
      }),
      el("label", { classe: "preco-campo" }, [
        el("input", { type: "text", inputmode: "decimal", classe: "preco", "aria-label": "Preço", placeholder: "0" }),
      ]),
      el("button", { type: "button", classe: "remover", "aria-label": "Remover este preço", texto: "×" }),
      el("label", { classe: "linha-preco__falta" }, [el("input", { type: "checkbox", classe: "falta" }), "Em falta"]),
    ]);
    linha.querySelector(".opcao-campo").value = v.opcao;
    linha.querySelector(".preco").value = txt(v.preco);
    linha.querySelector(".falta").checked = !!v.em_falta;
    linha.querySelector(".remover").addEventListener("click", function () {
      linha.remove();
      if (!$("variacoes").children.length) $("variacoes").appendChild(linhaDePreco());
    });
    return linha;
  }

  $("botao-variacao").addEventListener("click", function () {
    var nova = linhaDePreco();
    $("variacoes").appendChild(nova);
    nova.querySelector(".opcao-campo").focus();
  });

  function abrirEditor(item, secao) {
    editando = item ? { secao: item.secao, nome: item.nome } : null;
    $("editor-titulo").textContent = item ? "Editar item" : "Novo item";
    $("botao-excluir").hidden = !item;
    preencherSecoes(item ? item.secao : secao);
    $("campo-secao-nova").value = "";
    $("campo-nome").value = item ? item.nome : "";
    $("campo-descricao").value = item ? item.descricao : "";
    var variacoes = $("variacoes");
    variacoes.innerHTML = "";
    (item ? item.variacoes : [null]).forEach(function (v) {
      variacoes.appendChild(linhaDePreco(v));
    });
    editor.showModal();
    if (!item) setTimeout(function () {
      ($("campo-secao").value === NOVA_SECAO ? $("campo-secao-nova") : $("campo-nome")).focus();
    }, 50);
  }

  function fecharEditor() {
    editor.close();
  }

  $("editor-cancelar").addEventListener("click", fecharEditor);

  $("botao-nova-secao").addEventListener("click", function () {
    abrirEditor(null, NOVA_SECAO);
  });

  function salvando(sim) {
    $("editor-salvar").disabled = sim;
    $("botao-excluir").disabled = sim;
    $("editor-salvar").textContent = sim ? "Salvando…" : "Salvar";
  }

  $("form-item").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var nova = $("campo-secao").value === NOVA_SECAO;
    var secao = nova ? txt($("campo-secao-nova").value) : $("campo-secao").value;
    var nome = txt($("campo-nome").value);
    if (!secao) return avisar("Escreva o nome da nova seção.", true);
    if (!nome) return avisar("O item precisa de um nome.", true);

    var variacoes = Array.prototype.map.call($("variacoes").children, function (linha) {
      return {
        opcao: txt(linha.querySelector(".opcao-campo").value),
        preco: txt(linha.querySelector(".preco").value),
        em_falta: linha.querySelector(".falta").checked,
      };
    });
    var semOpcao = variacoes.filter(function (v) {
      return !v.opcao;
    });
    if (variacoes.length > 1 && semOpcao.length > 1) {
      return avisar("Com mais de um preço, só um pode ficar sem nome de opção.", true);
    }
    // A linha sem opção (preço principal) vai primeiro
    variacoes.sort(function (a, b) {
      return (a.opcao ? 1 : 0) - (b.opcao ? 1 : 0);
    });

    var item = {
      secao: secao,
      nome: nome,
      descricao: txt($("campo-descricao").value),
      variacoes: variacoes,
      depoisDe: nova ? $("campo-depois").value : "",
    };
    salvando(true);
    api("salvarItem", { original: editando, item: item })
      .then(function (r) {
        definirLinhas(r.cardapio);
        render();
        fecharEditor();
        avisar("Salvo! Já está no site.");
      })
      .catch(function (e) {
        avisar(e.message, true);
      })
      .then(function () {
        salvando(false);
      });
  });

  $("botao-excluir").addEventListener("click", function () {
    if (!editando) return;
    perguntar({
      titulo: "Excluir " + editando.nome + "?",
      texto: "Sai do cardápio e do site. Isso não tem volta.",
      ok: "Excluir",
      perigo: true,
    }).then(function (sim) {
      if (sim) excluirEditando();
    });
  });

  function excluirEditando() {
    salvando(true);
    api("excluirItem", { original: editando })
      .then(function (r) {
        definirLinhas(r.cardapio);
        render();
        fecharEditor();
        avisar("Item excluído.");
      })
      .catch(function (e) {
        avisar(e.message, true);
      })
      .then(function () {
        salvando(false);
      });
  }

  // ---------- perguntas ----------

  /**
   * Caixa de pergunta do próprio admin. O confirm()/prompt() do navegador
   * mostra o endereço do site ("samara-lana.github.io diz…") e não dá pra
   * mudar.
   *
   *   perguntar({ titulo, texto, campos: [{ rotulo, valor, numero }], ok, perigo })
   *     -> Promise com os valores dos campos (ou true, sem campos); null se cancelou
   */
  var respostaPendente = null;

  function perguntar(o) {
    var dialogo = $("pergunta");
    $("pergunta-titulo").textContent = o.titulo || "";
    $("pergunta-texto").textContent = o.texto || "";
    $("pergunta-texto").hidden = !o.texto;
    $("pergunta-erro").textContent = "";
    $("pergunta-ok").textContent = o.ok || "OK";
    $("pergunta-ok").className = "botao " + (o.perigo ? "botao--perigo-cheio" : "botao--cheio");
    var caixa = $("pergunta-campos");
    caixa.innerHTML = "";
    (o.campos || []).forEach(function (c, i) {
      var input = el("input", {
        type: "text",
        id: "pergunta-campo-" + i,
        autocomplete: "off",
        autocapitalize: c.numero ? "off" : "sentences",
        inputmode: c.numero ? "decimal" : "text",
        placeholder: c.dica || (c.numero ? "R$ (ex.: 12 ou 7,50)" : ""),
      });
      input.value = c.valor || "";
      var rotulo = el("label", { classe: "campo" }, [el("span", { texto: c.rotulo }), input]);
      caixa.appendChild(rotulo);
    });
    if (respostaPendente) respostaPendente(null);
    return new Promise(function (resolve) {
      respostaPendente = function (v) {
        respostaPendente = null;
        if (dialogo.open) dialogo.close();
        resolve(v);
      };
      dialogo.showModal();
      var primeiro = $("pergunta-campo-0");
      if (primeiro) setTimeout(function () {
        primeiro.focus();
        primeiro.select();
      }, 30);
      $("pergunta-form").onsubmit = function (ev) {
        ev.preventDefault();
        var valores = (o.campos || []).map(function (c, i) {
          return txt($("pergunta-campo-" + i).value);
        });
        for (var i = 0; i < valores.length; i++) {
          var c = o.campos[i];
          if (!valores[i] && !c.opcional) return ($("pergunta-erro").textContent = "Preencha: " + c.rotulo.toLowerCase());
          if (c.numero && !/\d/.test(valores[i])) return ($("pergunta-erro").textContent = "Escreva só o número, ex.: 12 ou 7,50");
        }
        respostaPendente(o.campos && o.campos.length ? valores : true);
      };
    });
  }

  $("pergunta-cancelar").addEventListener("click", function () {
    if (respostaPendente) respostaPendente(null);
  });
  // Esc / voltar do Android fecham como "cancelar"
  $("pergunta").addEventListener("cancel", function (ev) {
    ev.preventDefault();
    if (respostaPendente) respostaPendente(null);
  });

  // ---------- o que as comandas (comandas.js) usam daqui ----------

  window.Zaza = {
    api: api,
    el: el,
    txt: txt,
    slug: slug,
    marcado: marcado,
    avisar: avisar,
    perguntar: perguntar,
    linhas: function () {
      return linhas;
    },
  };

  // ---------- início ----------

  if (!txt(window.APPS_SCRIPT_URL)) {
    document.body.textContent = "Falta configurar a planilha (assets/config.js).";
  } else if (token()) {
    carregar();
  } else {
    mostrarLogin();
  }
})();

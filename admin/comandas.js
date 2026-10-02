/**
 * Comandas do admin.
 *
 * As comandas vivem no celular (localStorage): lançar um item é instantâneo e
 * funciona sem internet. Em segundo plano, cada mudança vai pra aba Comandas
 * da planilha (cópia de segurança + histórico de vendas). Ao entrar num
 * celular novo, as comandas da planilha voltam pra cá.
 *
 * Comanda: { id, cliente, status, aberta, fechada, lancamentos, atualizado }
 *   status: "aberta" | "pendurada" (fiado) | "paga" | "excluida"
 *   lancamento: { id, chave, nome, preco, hora } — um por unidade, com o preço
 *   do momento (mudar o cardápio depois não mexe em conta antiga).
 */
(function () {
  "use strict";

  var CHAVE = "zaza_comandas_v1";
  var CHAVE_CLIENTES = "zaza_clientes_v1";
  var DIAS_NO_CELULAR = 45;
  var INICIO_DO_DIA_H = 5; // venda das 0h às 5h conta no dia anterior (noite do bar)

  var Z = function () {
    return window.Zaza;
  };
  var $ = function (id) {
    return document.getElementById(id);
  };

  var comandas = carregarLocal();
  var verCardapioTodo = false;

  // ---------- armazenamento ----------

  function carregarLocal() {
    try {
      return JSON.parse(localStorage.getItem(CHAVE) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function salvarLocal() {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(comandas));
    } catch (e) {
      Z().avisar("O celular está sem espaço: a comanda pode não ficar salva.", true);
    }
  }

  function clientesSalvos() {
    try {
      return JSON.parse(localStorage.getItem(CHAVE_CLIENTES) || "[]") || [];
    } catch (e) {
      return [];
    }
  }

  function lembrarCliente(nome) {
    var lista = clientesSalvos();
    var k = Z().slug(nome);
    if (!k || lista.some(function (n) {
      return Z().slug(n) === k;
    })) return;
    lista.push(nome);
    try {
      localStorage.setItem(CHAVE_CLIENTES, JSON.stringify(lista));
    } catch (e) {
      /* sem espaço: só perde o autocompletar */
    }
  }

  function novoId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /**
   * Toda mudança passa por aqui: marca como pendente, salva no celular e
   * agenda o envio. A marca fica salva junto, então nada se perde se o app
   * for fechado antes de enviar.
   */
  function mudou(c) {
    c.atualizado = Math.max(Date.now(), (c.atualizado || 0) + 1);
    c.sincronizado = false;
    salvarLocal();
    agendarSync();
  }

  // ---------- sincronização com a planilha ----------

  var timerSync = null;
  var sincronizando = false;

  function estadoSync(texto, classe) {
    var s = $("sync");
    if (!s) return;
    s.textContent = texto;
    s.className = "sync" + (classe ? " sync--" + classe : "");
  }

  function pendentes() {
    return Object.keys(comandas)
      .filter(function (id) {
        return comandas[id].sincronizado === false;
      })
      .map(function (id) {
        return comandas[id];
      });
  }

  function agendarSync(ms) {
    clearTimeout(timerSync);
    timerSync = setTimeout(sincronizar, ms == null ? 1500 : ms);
  }

  function sincronizar() {
    if (sincronizando) return agendarSync(2000);
    var lista = pendentes();
    if (!lista.length) return estadoSync("✓ salvo", "ok");
    sincronizando = true;
    estadoSync("salvando…");
    var enviadas = lista.map(function (c) {
      var copia = JSON.parse(JSON.stringify(c));
      delete copia.sincronizado;
      return copia;
    });
    Z()
      .api("salvarComandas", { comandas: enviadas })
      .then(function (r) {
        enviadas.forEach(function (e) {
          var atual = comandas[e.id];
          // Se mudou de novo enquanto enviava, fica pendente pra próxima
          if (atual && atual.atualizado === e.atualizado && r.salvas.indexOf(e.id) >= 0) {
            atual.sincronizado = true;
          }
        });
        salvarLocal();
        estadoSync(pendentes().length ? "salvando…" : "✓ salvo", pendentes().length ? "" : "ok");
        if (pendentes().length) agendarSync(500);
      })
      .catch(function () {
        salvarLocal();
        estadoSync("sem internet · salvo no celular", "alerta");
        agendarSync(30000);
      })
      .then(function () {
        sincronizando = false;
      });
  }

  window.addEventListener("online", function () {
    agendarSync(0);
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && pendentes().length) sincronizar();
  });

  /** Depois do login: traz da planilha o que for mais novo (celular novo, por exemplo). */
  function sincronizarAoEntrar() {
    Z()
      .api("listarComandas", { dias: DIAS_NO_CELULAR })
      .then(function (r) {
        var trouxe = false;
        (r.comandas || []).forEach(function (c) {
          var local = comandas[c.id];
          if (!local || (local.sincronizado !== false && (c.atualizado || 0) > (local.atualizado || 0))) {
            c.sincronizado = true;
            comandas[c.id] = c;
            if (c.cliente) lembrarCliente(c.cliente);
            trouxe = true;
          }
        });
        limparAntigas();
        salvarLocal();
        if (trouxe) rotaAtual();
        sincronizar();
      })
      .catch(function () {
        estadoSync("sem internet · salvo no celular", "alerta");
        agendarSync(30000);
      });
  }

  function limparAntigas() {
    var limite = Date.now() - DIAS_NO_CELULAR * 864e5;
    Object.keys(comandas).forEach(function (id) {
      var c = comandas[id];
      var encerrada = c.status === "paga" || c.status === "excluida";
      if (encerrada && c.sincronizado && (c.fechada || 0) < limite) delete comandas[id];
    });
  }

  // ---------- contas ----------

  function total(c) {
    return (c.lancamentos || []).reduce(function (s, l) {
      return s + (Number(l.preco) || 0);
    }, 0);
  }

  function dinheiro(n) {
    return "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function lerPreco(v) {
    var s = Z().txt(v).replace(/[^\d,.]/g, "");
    if (!s) return null;
    var n = s.indexOf(",") >= 0 ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
    return isFinite(n) ? n : null;
  }

  function hora(ms) {
    return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function dataCurta(ms) {
    return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  }

  function haQuanto(ms) {
    var min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return "agora";
    if (min < 60) return "há " + min + " min";
    var h = Math.floor(min / 60);
    if (h < 24) return "há " + h + "h" + (min % 60 ? String(min % 60).padStart(2, "0") : "");
    return "desde " + dataCurta(ms);
  }

  /** Itens agrupados: [{ chave, nome, qtd, preco, total, horas }] na ordem do 1º lançamento. */
  function resumo(c) {
    var grupos = [];
    var porChave = {};
    (c.lancamentos || []).forEach(function (l) {
      var k = l.chave + "|" + l.preco;
      var g = porChave[k];
      if (!g) {
        g = porChave[k] = { chave: l.chave, nome: l.nome, preco: Number(l.preco) || 0, qtd: 0, total: 0, horas: [] };
        grupos.push(g);
      }
      g.qtd++;
      g.total += Number(l.preco) || 0;
      g.horas.push(hora(l.hora));
    });
    return grupos;
  }

  function lista(status) {
    return Object.keys(comandas)
      .map(function (id) {
        return comandas[id];
      })
      .filter(function (c) {
        return c.status === status;
      });
  }

  // ---------- cardápio pra lançar ----------

  /** Cada linha da planilha vira um botão. Nome repetido em outra seção ganha a seção junto. */
  function itensDoCardapio() {
    var Zz = Z();
    var itens = [];
    var contagem = {};
    Zz.linhas().forEach(function (l) {
      if (!Zz.txt(l.nome)) return;
      // "Torresmo" + "Com batata frita" -> "Torresmo com batata frita"
      var opcao = Zz.txt(l.opcao);
      var nome = Zz.txt(l.nome) + (opcao ? " " + opcao.charAt(0).toLowerCase() + opcao.slice(1) : "");
      contagem[Zz.slug(nome)] = (contagem[Zz.slug(nome)] || 0) + 1;
      itens.push({
        chave: Zz.slug(l.secao + "|" + l.nome + "|" + l.opcao),
        nome: nome,
        secao: Zz.txt(l.secao),
        preco: lerPreco(l.preco),
        falta: Zz.marcado(l.em_falta),
      });
    });
    itens.forEach(function (i) {
      if (contagem[Zz.slug(i.nome)] > 1) i.nome += " (" + i.secao.toLowerCase() + ")";
    });
    return itens;
  }

  /** Os 8 mais lançados nos últimos 30 dias; sem histórico, cervejas e porções. */
  function maisPedidos(itens) {
    var porChave = {};
    itens.forEach(function (i) {
      porChave[i.chave] = i;
    });
    var limite = Date.now() - 30 * 864e5;
    var conta = {};
    Object.keys(comandas).forEach(function (id) {
      (comandas[id].lancamentos || []).forEach(function (l) {
        if (l.hora >= limite && porChave[l.chave]) conta[l.chave] = (conta[l.chave] || 0) + 1;
      });
    });
    var top = Object.keys(conta)
      .sort(function (a, b) {
        return conta[b] - conta[a];
      })
      .map(function (k) {
        return porChave[k];
      });
    if (top.length < 8) {
      // Sem histórico ainda: as cervejas primeiro, depois as porções
      var prioridade = function (i) {
        var s = Z().slug(i.secao);
        return /cerveja/.test(s) ? 0 : /^porc/.test(s) ? 1 : 2;
      };
      var padrao = itens
        .filter(function (i) {
          return prioridade(i) < 2 && top.indexOf(i) < 0;
        })
        .sort(function (a, b) {
          return prioridade(a) - prioridade(b);
        });
      top = top.concat(padrao);
    }
    return top.slice(0, 8);
  }

  // ---------- ações ----------

  function abrirComanda(nome) {
    nome = Z().txt(nome);
    if (!nome) return;
    var k = Z().slug(nome);
    var existente = Object.keys(comandas)
      .map(function (id) {
        return comandas[id];
      })
      .filter(function (c) {
        return (c.status === "aberta" || c.status === "pendurada") && Z().slug(c.cliente) === k;
      })[0];
    if (existente) {
      location.hash = "#comanda/" + existente.id;
      return;
    }
    var c = { id: novoId(), cliente: nome, status: "aberta", aberta: Date.now(), fechada: null, lancamentos: [] };
    comandas[c.id] = c;
    lembrarCliente(nome);
    mudou(c);
    location.hash = "#comanda/" + c.id;
  }

  var timerDesfazer;
  function oferecerDesfazer(texto, acao) {
    var caixa = $("desfazer");
    $("desfazer-texto").textContent = texto;
    caixa.classList.add("desfazer--visivel");
    $("desfazer-botao").onclick = function () {
      caixa.classList.remove("desfazer--visivel");
      acao();
    };
    clearTimeout(timerDesfazer);
    timerDesfazer = setTimeout(function () {
      caixa.classList.remove("desfazer--visivel");
    }, 4500);
  }

  function lancar(c, item, botao) {
    var preco = item.preco;
    if (preco == null) {
      preco = lerPreco(prompt("Quanto custa " + item.nome + "?", ""));
      if (preco == null) return;
    }
    var l = { id: novoId(), chave: item.chave, nome: item.nome, preco: preco, hora: Date.now() };
    c.lancamentos.push(l);
    mudou(c);
    if (botao) {
      botao.classList.remove("lancou");
      void botao.offsetWidth; // reinicia a animação
      botao.classList.add("lancou");
    }
    if (navigator.vibrate) navigator.vibrate(15);
    renderComanda(c.id, true);
    oferecerDesfazer("+1 " + item.nome, function () {
      c.lancamentos = c.lancamentos.filter(function (x) {
        return x.id !== l.id;
      });
      mudou(c);
      renderComanda(c.id, true);
    });
  }

  function tirarUm(c, grupo) {
    for (var i = c.lancamentos.length - 1; i >= 0; i--) {
      var l = c.lancamentos[i];
      if (l.chave === grupo.chave && Number(l.preco) === grupo.preco) {
        var tirado = c.lancamentos.splice(i, 1)[0];
        mudou(c);
        renderComanda(c.id, true);
        oferecerDesfazer("−1 " + grupo.nome, function () {
          c.lancamentos.splice(i, 0, tirado);
          mudou(c);
          renderComanda(c.id, true);
        });
        return;
      }
    }
  }

  function itemAvulso(c) {
    var nome = Z().txt(prompt("Nome do item (ex.: Gelo, Cigarro):", ""));
    if (!nome) return;
    var preco = lerPreco(prompt("Preço de " + nome + ":", ""));
    if (preco == null) return Z().avisar("Preço inválido.", true);
    lancar(c, { chave: "avulso-" + Z().slug(nome), nome: nome, preco: preco });
  }

  function encerrar(c, status) {
    c.status = status;
    if (status !== "pendurada") c.fechada = Date.now();
    mudou(c);
    var msg = {
      paga: "Conta de " + c.cliente + " recebida: " + dinheiro(total(c)),
      pendurada: c.cliente + " foi pro fiado: " + dinheiro(total(c)),
      excluida: "Comanda de " + c.cliente + " excluída.",
    }[status];
    location.hash = "#comandas";
    Z().avisar(msg);
  }

  // ---------- telas ----------

  function el() {
    return Z().el.apply(null, arguments);
  }

  function cartaoComanda(c) {
    var qtd = (c.lancamentos || []).length;
    return el(
      "a",
      { classe: "comanda-cartao", href: "#comanda/" + encodeURIComponent(c.id) },
      [
        el("span", { classe: "comanda-cartao__nome" }, [
          c.cliente,
          el("small", {
            texto: qtd + (qtd === 1 ? " item" : " itens") + " · " + haQuanto(c.aberta),
          }),
        ]),
        el("span", { classe: "comanda-cartao__total", texto: dinheiro(total(c)) }),
      ],
    );
  }

  function renderLista() {
    var pagina = $("pagina-comandas");
    pagina.innerHTML = "";

    var input = el("input", {
      type: "text",
      id: "nome-cliente",
      placeholder: "Nome do cliente",
      autocomplete: "off",
      autocapitalize: "words",
      "aria-label": "Nome do cliente",
    });
    var sugestoes = el("div", { classe: "sugestoes", id: "sugestoes" });
    var form = el("form", { classe: "nova-comanda" }, [
      el("div", { classe: "nova-comanda__linha" }, [
        input,
        el("button", { classe: "botao botao--cheio", type: "submit", texto: "Abrir" }),
      ]),
      sugestoes,
    ]);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      abrirComanda(input.value);
    });
    input.addEventListener("input", function () {
      renderSugestoes(input.value, sugestoes);
    });
    pagina.appendChild(el("div", { classe: "conteudo" }, [form]));

    var abertas = lista("aberta").sort(function (a, b) {
      return b.aberta - a.aberta;
    });
    var fiado = lista("pendurada").sort(function (a, b) {
      return a.cliente.localeCompare(b.cliente);
    });

    var corpo = el("div", { classe: "conteudo" });
    corpo.appendChild(el("h2", { classe: "admin-secao__titulo", texto: "Abertas (" + abertas.length + ")" }));
    if (!abertas.length) {
      corpo.appendChild(el("p", { classe: "vazio-texto", texto: "Nenhuma comanda aberta. Escreva o nome do cliente acima." }));
    }
    abertas.forEach(function (c) {
      corpo.appendChild(cartaoComanda(c));
    });

    if (fiado.length) {
      var totalFiado = fiado.reduce(function (s, c) {
        return s + total(c);
      }, 0);
      corpo.appendChild(
        el("h2", { classe: "admin-secao__titulo admin-secao__titulo--espaco" }, [
          "Fiado (" + fiado.length + ")",
          el("span", { classe: "titulo-valor", texto: dinheiro(totalFiado) }),
        ]),
      );
      fiado.forEach(function (c) {
        corpo.appendChild(cartaoComanda(c));
      });
    }
    pagina.appendChild(corpo);
  }

  function renderSugestoes(texto, caixa) {
    caixa.innerHTML = "";
    var k = Z().slug(texto);
    if (!k) return;
    var abertas = {};
    Object.keys(comandas).forEach(function (id) {
      var c = comandas[id];
      if (c.status === "aberta" || c.status === "pendurada") abertas[Z().slug(c.cliente)] = c;
    });
    var nomes = clientesSalvos().filter(function (n) {
      var s = Z().slug(n);
      return s.indexOf(k) >= 0 && s !== k;
    });
    // quem começa com o que foi digitado vem primeiro
    nomes.sort(function (a, b) {
      return (Z().slug(a).indexOf(k) === 0 ? 0 : 1) - (Z().slug(b).indexOf(k) === 0 ? 0 : 1) || a.localeCompare(b);
    });
    nomes.slice(0, 6).forEach(function (n) {
      var aberta = abertas[Z().slug(n)];
      caixa.appendChild(
        el(
          "button",
          {
            type: "button",
            classe: "sugestao",
            onclick: function () {
              abrirComanda(n);
            },
          },
          [
            n,
            aberta
              ? el("small", {
                  texto: (aberta.status === "pendurada" ? "fiado · " : "aberta · ") + dinheiro(total(aberta)),
                })
              : null,
          ],
        ),
      );
    });
  }

  function botaoItem(c, item, classe) {
    var b = el(
      "button",
      {
        type: "button",
        classe: classe + (item.falta ? " " + classe + "--falta" : ""),
      },
      [
        el("span", { classe: classe + "__nome", texto: item.nome }),
        el("span", {
          classe: classe + "__preco",
          texto: item.falta ? "em falta" : item.preco == null ? "preço?" : dinheiro(item.preco),
        }),
      ],
    );
    b.addEventListener("click", function () {
      lancar(c, item, b);
    });
    return b;
  }

  function renderComanda(id, soAtualizar) {
    var c = comandas[id];
    var pagina = $("pagina-comanda");
    if (!c || c.status === "paga" || c.status === "excluida") {
      location.hash = "#comandas";
      return;
    }
    var busca = $("busca-item");
    // A busca só continua quando é a mesma comanda sendo atualizada
    var textoBusca = soAtualizar && busca ? busca.value : "";
    var rolagem = window.scrollY;
    pagina.innerHTML = "";

    // topo
    var topo = el("header", { classe: "comanda-topo" }, [
      el("a", { classe: "barra__link", href: "#comandas", texto: "← Comandas" }),
    ]);
    pagina.appendChild(topo);
    pagina.appendChild(
      el("div", { classe: "conteudo comanda-cabeca" }, [
        el("h2", { classe: "comanda-nome" }, [
          c.cliente,
          c.status === "pendurada" ? el("span", { classe: "selo-fiado", texto: "fiado" }) : null,
        ]),
        el("p", { classe: "comanda-total", texto: dinheiro(total(c)) }),
      ]),
    );

    // mais pedidos
    var itens = itensDoCardapio();
    var grade = el("div", { classe: "grade-rapida" });
    maisPedidos(itens).forEach(function (i) {
      grade.appendChild(botaoItem(c, i, "rapido"));
    });
    var conteudo = el("div", { classe: "conteudo" }, [
      el("h3", { classe: "rotulo", texto: "Toque pra lançar (+1)" }),
      grade,
    ]);

    // busca + cardápio inteiro
    var campo = el("input", {
      type: "search",
      id: "busca-item",
      placeholder: "Buscar outro item…",
      autocomplete: "off",
      "aria-label": "Buscar item no cardápio",
    });
    campo.value = textoBusca;
    var resultados = el("div", { classe: "resultados" });
    function filtrar() {
      resultados.innerHTML = "";
      var k = Z().slug(campo.value);
      if (!k && !verCardapioTodo) return;
      var secaoAtual = null;
      itens
        .filter(function (i) {
          return !k || Z().slug(i.nome).indexOf(k) >= 0;
        })
        .forEach(function (i) {
          if (i.secao !== secaoAtual) {
            secaoAtual = i.secao;
            resultados.appendChild(el("p", { classe: "resultados__secao", texto: i.secao }));
          }
          resultados.appendChild(botaoItem(c, i, "linha-item"));
        });
      if (!resultados.children.length) resultados.appendChild(el("p", { classe: "vazio-texto", texto: "Nada com esse nome." }));
    }
    campo.addEventListener("input", filtrar);
    filtrar();
    conteudo.appendChild(campo);
    conteudo.appendChild(
      el("div", { classe: "linha-botoes" }, [
        el("button", {
          type: "button",
          classe: "botao botao--pequeno",
          texto: verCardapioTodo ? "Esconder cardápio" : "Ver cardápio todo",
          onclick: function () {
            verCardapioTodo = !verCardapioTodo;
            renderComanda(c.id, true);
          },
        }),
        el("button", {
          type: "button",
          classe: "botao botao--pequeno",
          texto: "+ Item avulso",
          onclick: function () {
            itemAvulso(c);
          },
        }),
      ]),
    );
    conteudo.appendChild(resultados);

    // consumido
    var grupos = resumo(c);
    conteudo.appendChild(el("h3", { classe: "rotulo rotulo--espaco", texto: "Consumido" }));
    if (!grupos.length) conteudo.appendChild(el("p", { classe: "vazio-texto", texto: "Nada lançado ainda." }));
    grupos.forEach(function (g) {
      conteudo.appendChild(
        el("div", { classe: "consumido" }, [
          el("span", { classe: "consumido__qtd", texto: g.qtd + "×" }),
          el("span", { classe: "consumido__nome" }, [g.nome, el("small", { texto: g.horas.join(", ") })]),
          el("span", { classe: "consumido__valor", texto: dinheiro(g.total) }),
          el("button", {
            type: "button",
            classe: "remover",
            "aria-label": "Tirar um " + g.nome,
            texto: "−",
            onclick: function () {
              tirarUm(c, g);
            },
          }),
        ]),
      );
    });
    conteudo.appendChild(
      el("div", { classe: "linha-botoes linha-botoes--fim" }, [
        el("button", {
          type: "button",
          classe: "barra__link",
          texto: "Trocar nome",
          onclick: function () {
            var novo = Z().txt(prompt("Novo nome:", c.cliente));
            if (!novo) return;
            c.cliente = novo;
            lembrarCliente(novo);
            mudou(c);
            renderComanda(c.id, true);
          },
        }),
        el("button", {
          type: "button",
          classe: "barra__link barra__link--perigo",
          texto: "Excluir comanda",
          onclick: function () {
            if (confirm("Excluir a comanda de " + c.cliente + " (" + dinheiro(total(c)) + ")? Ela não conta nas vendas.")) {
              encerrar(c, "excluida");
            }
          },
        }),
      ]),
    );
    pagina.appendChild(conteudo);

    // fechar conta
    pagina.appendChild(
      el("div", { classe: "rodape-fixo" }, [
        el("a", {
          classe: "botao botao--cheio botao--largo",
          href: "#conta/" + encodeURIComponent(c.id),
          texto: (c.status === "pendurada" ? "Ver conta / receber · " : "Fechar conta · ") + dinheiro(total(c)),
        }),
      ]),
    );

    if (soAtualizar) window.scrollTo(0, rolagem);
  }

  /** A conta: tela limpa pra mostrar pro cliente. */
  function renderConta(id) {
    var c = comandas[id];
    var pagina = $("pagina-conta");
    if (!c) {
      location.hash = "#comandas";
      return;
    }
    pagina.innerHTML = "";
    pagina.appendChild(
      el("header", { classe: "comanda-topo" }, [
        el("a", { classe: "barra__link", href: "#comanda/" + encodeURIComponent(c.id), texto: "← Voltar" }),
      ]),
    );
    var tabela = el("div", { classe: "conta" });
    resumo(c).forEach(function (g) {
      tabela.appendChild(
        el("div", { classe: "conta__linha" }, [
          el("span", { classe: "conta__qtd", texto: g.qtd + "×" }),
          el("span", { classe: "conta__nome" }, [
            g.nome,
            el("small", { texto: dinheiro(g.preco) + " cada · " + g.horas.join(", ") }),
          ]),
          el("span", { classe: "conta__valor", texto: dinheiro(g.total) }),
        ]),
      );
    });
    var desde =
      dataCurta(c.aberta) === dataCurta(Date.now()) ? "Aberta às " + hora(c.aberta) : "Aberta em " + dataCurta(c.aberta) + " às " + hora(c.aberta);
    var botoes = [
      el("button", {
        type: "button",
        classe: "botao botao--whats botao--largo",
        texto: (c.status === "pendurada" ? "Recebi " : "Recebido · ") + dinheiro(total(c)),
        onclick: function () {
          if (confirm("Confirmar que recebeu " + dinheiro(total(c)) + " de " + c.cliente + "?")) encerrar(c, "paga");
        },
      }),
    ];
    if (c.status === "aberta") {
      botoes.push(
        el("button", {
          type: "button",
          classe: "botao botao--largo",
          texto: "Pendurar no fiado",
          onclick: function () {
            encerrar(c, "pendurada");
          },
        }),
      );
    }
    pagina.appendChild(
      el("div", { classe: "conteudo" }, [
        el("p", { classe: "hero__eyebrow conta__marca", texto: "Bar do Zazá" }),
        el("h2", { classe: "comanda-nome conta__cliente", texto: c.cliente }),
        el("p", { classe: "nota", texto: desde }),
        tabela,
        el("div", { classe: "conta__total" }, [el("span", { texto: "Total" }), el("strong", { texto: dinheiro(total(c)) })]),
        el("div", { classe: "conta__botoes" }, botoes),
      ]),
    );
  }

  // ---------- vendas ----------

  /** Dia "do bar": até 5h da manhã ainda é a noite anterior. */
  function diaDoBar(ms) {
    var d = new Date(ms - INICIO_DO_DIA_H * 3600e3);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function renderVendas() {
    var pagina = $("pagina-vendas");
    pagina.innerHTML = "";
    var pagas = lista("paga");
    var hoje = diaDoBar(Date.now());
    var ontem = diaDoBar(Date.now() - 864e5);
    var porDia = {};
    pagas.forEach(function (c) {
      var d = diaDoBar(c.fechada);
      porDia[d] = porDia[d] || { total: 0, qtd: 0 };
      porDia[d].total += total(c);
      porDia[d].qtd++;
    });
    function somaDias(n) {
      var s = { total: 0, qtd: 0 };
      for (var i = 0; i < n; i++) {
        var d = porDia[diaDoBar(Date.now() - i * 864e5)];
        if (d) {
          s.total += d.total;
          s.qtd += d.qtd;
        }
      }
      return s;
    }
    var fiado = lista("pendurada");
    var totalFiado = fiado.reduce(function (s, c) {
      return s + total(c);
    }, 0);
    var cartoes = [
      ["Hoje", porDia[hoje] || { total: 0, qtd: 0 }],
      ["Ontem", porDia[ontem] || { total: 0, qtd: 0 }],
      ["Últimos 7 dias", somaDias(7)],
      ["Últimos 30 dias", somaDias(30)],
    ];
    var grade = el("div", { classe: "vendas-grade" });
    cartoes.forEach(function (x) {
      grade.appendChild(
        el("div", { classe: "venda-cartao" }, [
          el("span", { classe: "venda-cartao__rotulo", texto: x[0] }),
          el("strong", { texto: dinheiro(x[1].total) }),
          el("small", { texto: x[1].qtd + (x[1].qtd === 1 ? " comanda" : " comandas") }),
        ]),
      );
    });
    grade.appendChild(
      el("div", { classe: "venda-cartao venda-cartao--fiado" }, [
        el("span", { classe: "venda-cartao__rotulo", texto: "Fiado em aberto" }),
        el("strong", { texto: dinheiro(totalFiado) }),
        el("small", { texto: fiado.length + (fiado.length === 1 ? " pessoa" : " pessoas") }),
      ]),
    );

    // mais vendidos em 7 dias
    var limite = Date.now() - 7 * 864e5;
    var conta = {};
    pagas.forEach(function (c) {
      if (c.fechada < limite) return;
      c.lancamentos.forEach(function (l) {
        conta[l.nome] = (conta[l.nome] || 0) + 1;
      });
    });
    var top = Object.keys(conta)
      .sort(function (a, b) {
        return conta[b] - conta[a];
      })
      .slice(0, 10);

    var dias = Object.keys(porDia).sort().reverse().slice(0, 14);

    var conteudo = el("div", { classe: "conteudo" }, [
      grade,
      el("p", { classe: "nota", texto: "Conta o que foi recebido. Fiado entra no dia em que for pago. Até 5h da manhã ainda conta como a noite anterior." }),
      el("h2", { classe: "admin-secao__titulo admin-secao__titulo--espaco", texto: "Mais vendidos · 7 dias" }),
    ]);
    if (!top.length) conteudo.appendChild(el("p", { classe: "vazio-texto", texto: "Ainda sem vendas nos últimos 7 dias." }));
    top.forEach(function (n) {
      conteudo.appendChild(
        el("div", { classe: "linha-simples" }, [el("span", { texto: n }), el("strong", { texto: conta[n] + "×" })]),
      );
    });
    if (dias.length) {
      conteudo.appendChild(el("h2", { classe: "admin-secao__titulo admin-secao__titulo--espaco", texto: "Por dia" }));
      dias.forEach(function (d) {
        var p = d.split("-");
        conteudo.appendChild(
          el("div", { classe: "linha-simples" }, [
            el("span", { texto: p[2] + "/" + p[1] + " · " + porDia[d].qtd + (porDia[d].qtd === 1 ? " comanda" : " comandas") }),
            el("strong", { texto: dinheiro(porDia[d].total) }),
          ]),
        );
      });
    }
    conteudo.appendChild(el("p", { classe: "nota", texto: "Histórico completo na aba Comandas da planilha." }));
    pagina.appendChild(conteudo);
  }

  // ---------- roteamento (chamado pelo admin.js) ----------

  var atual = { pagina: "comandas", id: "" };

  function mostrar(pagina, id) {
    atual = { pagina: pagina, id: id };
    if (pagina !== "comanda") $("desfazer").classList.remove("desfazer--visivel");
    if (pagina === "comanda") {
      verCardapioTodo = false;
      renderComanda(id);
    } else if (pagina === "conta") renderConta(id);
    else if (pagina === "vendas") renderVendas();
    else renderLista();
  }

  function rotaAtual() {
    if (atual.pagina === "comanda") renderComanda(atual.id, true);
    else mostrar(atual.pagina, atual.id);
  }

  // Atualiza o "há 20 min" das comandas abertas
  setInterval(function () {
    if (atual.pagina === "comandas" && !$("pagina-comandas").hidden && document.activeElement.id !== "nome-cliente") {
      renderLista();
    }
  }, 60000);

  window.Comandas = {
    mostrar: mostrar,
    sincronizarAoEntrar: sincronizarAoEntrar,
  };
})();

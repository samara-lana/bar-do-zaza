/**
 * Comandas do admin.
 *
 * As comandas vivem no celular (localStorage): lançar um item é instantâneo e
 * funciona sem internet. Em segundo plano, cada mudança vai pro banco
 * (Supabase: cópia de segurança + histórico de vendas, um registro por item
 * lançado). Ao entrar num celular novo, as comandas do banco voltam pra cá.
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
  // Marca de que este celular já mandou tudo o que tinha pro Supabase (out/2026)
  var CHAVE_MIGRACAO = "zaza_comandas_no_supabase";
  var DIAS_NO_CELULAR = 45;
  var INICIO_DO_DIA_H = 5; // venda das 0h às 5h conta no dia anterior (noite do bar)
  var POR_ENVIO = 50; // comandas por chamada (a primeira sincronização manda todas)
  var AVISO_PENDENTE_MS = 2 * 60000; // mudança sem chegar no banco depois disso = aviso vermelho

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
    if (c.sincronizado !== false) c.pendenteDesde = Date.now();
    c.sincronizado = false;
    salvarLocal();
    agendarSync();
  }

  // ---------- sincronização com o banco ----------

  var timerSync = null;
  var sincronizando = false;

  /**
   * Se alguma mudança está há mais de 2 minutos sem chegar no banco, o aviso
   * fica vermelho e diz há quanto tempo, por cima de qualquer outro estado.
   */
  function estadoSync(texto, classe) {
    var s = $("sync");
    if (!s) return;
    var desde = pendentes().reduce(function (m, c) {
      return Math.min(m, c.pendenteDesde || c.atualizado || Date.now());
    }, Date.now());
    var parado = Date.now() - desde;
    if (parado > AVISO_PENDENTE_MS) {
      texto = "⚠ não enviado há " + Math.round(parado / 60000) + " min";
      classe = "perigo";
    }
    s.textContent = texto;
    s.className = "sync" + (classe ? " sync--" + classe : "");
    var faixa = $("alerta-envio");
    if (faixa) {
      faixa.hidden = classe !== "perigo";
      faixa.textContent = texto + " · está salvo no celular, confira a internet";
    }
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
    var lista = pendentes().slice(0, POR_ENVIO);
    if (!lista.length) return estadoSync("✓ salvo", "ok");
    sincronizando = true;
    estadoSync("salvando…");
    var enviadas = lista.map(function (c) {
      var copia = JSON.parse(JSON.stringify(c));
      delete copia.sincronizado;
      delete copia.pendenteDesde;
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
            delete atual.pendenteDesde;
          }
        });
        salvarLocal();
        // Comanda que o banco recusou fica pendente (faixa vermelha em 2 min) e tenta de novo mais tarde
        if (r.erros && r.erros.length) {
          console.error("O banco recusou comandas:", r.erros);
          estadoSync("erro ao enviar · salvo no celular", "alerta");
          return agendarSync(30000);
        }
        estadoSync(pendentes().length ? "salvando…" : "✓ salvo", pendentes().length ? "" : "ok");
        if (pendentes().length) agendarSync(500);
      })
      .catch(function (e) {
        salvarLocal();
        var semRede = /internet|servidor fora/i.test((e && e.message) || "");
        estadoSync(semRede ? "sem internet · salvo no celular" : "erro ao enviar · salvo no celular", "alerta");
        if (!semRede) console.error("Erro ao enviar comandas:", e);
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
  // Mantém o "há N min" do aviso vermelho em dia
  setInterval(function () {
    if (pendentes().length) estadoSync($("sync").textContent, ($("sync").className.match(/sync--(\w+)/) || [])[1]);
  }, 30000);

  // Pede ao navegador pra não apagar sozinho o que o app guarda no celular
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  /**
   * Comanda de antes dos pagamentos em partes: conta paga ganha um pagamento
   * "legado" do total no dia em que fechou, e toda conta encerrada ganha o dia
   * da venda. MESMA regra de scripts/importar-comandas.mjs (planilha -> banco):
   * os dois caminhos têm que gerar exatamente os mesmos dados. Não mexe em
   * `atualizado` (não é uma mudança de verdade).
   */
  function completarAntiga(c) {
    if (c.status === "paga" && !(c.pagamentos && c.pagamentos.length) && c.fechada) {
      c.pagamentos = [{ id: "legado", valor: total(c), hora: c.fechada }];
    }
    if (!c.vendaEm && (c.status === "paga" || c.status === "pendurada")) c.vendaEm = dataDaVenda(c);
  }

  /**
   * Primeira vez com o Supabase neste celular: tudo o que está guardado aqui
   * (abertas, fiado e histórico dos últimos dias) vira pendente e sobe pro
   * banco. A marca fica salva junto, então se a internet cair no meio,
   * continua de onde parou.
   */
  function migrarParaSupabase() {
    try {
      if (localStorage.getItem(CHAVE_MIGRACAO)) return;
    } catch (e) {
      return;
    }
    Object.keys(comandas).forEach(function (id) {
      var c = comandas[id];
      completarAntiga(c);
      if (c.sincronizado !== false) c.pendenteDesde = Date.now();
      c.sincronizado = false;
    });
    salvarLocal();
    try {
      localStorage.setItem(CHAVE_MIGRACAO, String(Date.now()));
    } catch (e) {
      /* sem espaço: só repete o envio (o banco não duplica) */
    }
  }

  /** Depois do login: traz do banco o que for mais novo (celular novo, por exemplo). */
  function sincronizarAoEntrar() {
    migrarParaSupabase();
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

  /*
   * Conta = itens (subtotal) − desconto = total. Pagamentos podem vir em
   * partes; o que falta (saldo) fica no fiado.
   *   c.desconto:   { tipo: "valor" | "pct", valor } ou null
   *   c.pagamentos: [{ id, valor, hora }]
   *   c.vendaEm:    quando a conta saiu de "aberta" (paga ou fiado) = dia da venda
   */

  function centavos(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function subtotal(c) {
    return centavos(
      (c.lancamentos || []).reduce(function (s, l) {
        return s + (Number(l.preco) || 0);
      }, 0),
    );
  }

  function valorDesconto(c) {
    var d = c.desconto;
    if (!d || !(d.valor > 0)) return 0;
    var s = subtotal(c);
    return d.tipo === "pct" ? centavos((s * d.valor) / 100) : Math.min(centavos(d.valor), s);
  }

  function total(c) {
    return centavos(subtotal(c) - valorDesconto(c));
  }

  /** Dinheiro que entrou. Conta paga antes de existir pagamento em partes = um pagamento só, no fechamento. */
  function recebimentos(c) {
    if (c.pagamentos && c.pagamentos.length) return c.pagamentos;
    if (c.status === "paga") return [{ id: "unico", valor: total(c), hora: c.fechada }];
    return [];
  }

  function pago(c) {
    return centavos(
      recebimentos(c).reduce(function (s, p) {
        return s + (Number(p.valor) || 0);
      }, 0),
    );
  }

  function saldo(c) {
    return c.status === "excluida" ? 0 : Math.max(0, centavos(total(c) - pago(c)));
  }

  /** Dia da venda (conta fechada ou pendurada). Comanda antiga sem vendaEm: fechamento ou último item. */
  function dataDaVenda(c) {
    if (c.vendaEm) return c.vendaEm;
    if (c.status === "paga" && c.fechada) return c.fechada;
    var ultimo = (c.lancamentos || []).reduce(function (m, l) {
      return Math.max(m, l.hora || 0);
    }, 0);
    return ultimo || c.aberta;
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

  /**
   * Itens agrupados: [{ chave, nome, qtd, preco, total, horas, precoCardapio }] na
   * ordem do 1º lançamento. `precoCardapio` só vem quando o preço foi combinado na comanda.
   */
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
      if (l.precoCardapio != null && Number(l.precoCardapio) !== Number(l.preco)) g.precoCardapio = Number(l.precoCardapio);
      g.qtd++;
      g.total = centavos(g.total + (Number(l.preco) || 0));
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

  /** Cada linha do cardápio vira um botão. Nome repetido em outra seção ganha a seção junto. */
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

  /**
   * Os 8 mais lançados nos 30 dias ANTERIORES ao dia de hoje (sem histórico,
   * cervejas e porções). O que se lança hoje só conta a partir de amanhã: os
   * botões não podem mudar de lugar enquanto ele está tocando neles.
   */
  function maisPedidos(itens) {
    var porChave = {};
    itens.forEach(function (i) {
      porChave[i.chave] = i;
    });
    var fim = inicioDoDiaDoBar();
    var limite = fim - 30 * 864e5;
    var conta = {};
    Object.keys(comandas).forEach(function (id) {
      (comandas[id].lancamentos || []).forEach(function (l) {
        if (l.hora >= limite && l.hora < fim && porChave[l.chave]) conta[l.chave] = (conta[l.chave] || 0) + 1;
      });
    });
    var top = Object.keys(conta)
      .sort(function (a, b) {
        // empate: ordem do cardápio, pra nunca embaralhar
        return conta[b] - conta[a] || itens.indexOf(porChave[a]) - itens.indexOf(porChave[b]);
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
    if (item.preco == null) {
      // Item sem preço no cardápio (ex.: caldos): pergunta na hora
      Z()
        .perguntar({
          titulo: item.nome,
          texto: "Esse item está sem preço no cardápio.",
          campos: [{ rotulo: "Preço", numero: true }],
          ok: "Lançar",
        })
        .then(function (v) {
          if (v) lancar(c, { chave: item.chave, nome: item.nome, preco: lerPreco(v[0]) }, botao);
        });
      return;
    }
    var l = { id: novoId(), chave: item.chave, nome: item.nome, preco: item.preco, hora: Date.now() };
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

  /** O "+" do consumido: mais uma do mesmo item, pelo mesmo preço. */
  function maisUm(c, grupo) {
    lancar(c, { chave: grupo.chave, nome: grupo.nome, preco: grupo.preco });
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
    Z()
      .perguntar({
        titulo: "Item avulso",
        texto: "Pra algo que não está no cardápio.",
        campos: [
          { rotulo: "Nome", dica: "Ex.: Gelo, Cigarro" },
          { rotulo: "Preço", numero: true },
        ],
        ok: "Lançar",
      })
      .then(function (v) {
        if (v) lancar(c, { chave: "avulso-" + Z().slug(v[0]), nome: v[0], preco: lerPreco(v[1]) });
      });
  }

  /** Volta pra lista de comandas com um aviso. */
  function sairDaConta(msg) {
    location.hash = "#comandas";
    Z().avisar(msg);
  }

  /** A conta deixou de ser "aberta": a venda conta neste dia (só a 1ª vez). */
  function marcarVenda(c) {
    if (!c.vendaEm) c.vendaEm = Date.now();
  }

  function registrarPagamento(c, valor) {
    c.pagamentos = c.pagamentos || [];
    c.pagamentos.push({ id: novoId(), valor: centavos(valor), hora: Date.now() });
  }

  /** Recebeu tudo o que falta: conta paga. */
  function receberTudo(c) {
    var falta = saldo(c);
    if (falta > 0) registrarPagamento(c, falta);
    c.status = "paga";
    c.fechada = Date.now();
    marcarVenda(c);
    mudou(c);
    sairDaConta("Conta de " + c.cliente + " recebida: " + dinheiro(falta));
  }

  /** Pagou só uma parte: o resto fica no fiado. */
  function receberParte(c, valor) {
    var falta = saldo(c);
    if (centavos(valor) >= falta) return receberTudo(c);
    registrarPagamento(c, valor);
    c.status = "pendurada";
    marcarVenda(c);
    mudou(c);
    sairDaConta(c.cliente + " pagou " + dinheiro(valor) + ". Falta " + dinheiro(saldo(c)) + " no fiado.");
  }

  function pendurar(c) {
    c.status = "pendurada";
    marcarVenda(c);
    mudou(c);
    sairDaConta(c.cliente + " foi pro fiado: " + dinheiro(saldo(c)));
  }

  function excluir(c) {
    c.status = "excluida";
    c.fechada = Date.now();
    mudou(c);
    sairDaConta("Comanda de " + c.cliente + " excluída.");
  }

  /** "10" = R$ 10 de desconto; "10%" = 10 por cento. 0 ou vazio tira o desconto. */
  function lerDesconto(texto) {
    var pct = /%/.test(texto);
    var n = lerPreco(texto);
    if (n == null) return { erro: "Escreva o desconto, ex.: 5 ou 10%" };
    if (n === 0) return { desconto: null };
    if (pct && n > 100) return { erro: "Desconto em % vai até 100%." };
    return { desconto: { tipo: pct ? "pct" : "valor", valor: centavos(n) } };
  }

  function darDesconto(c) {
    var d = c.desconto;
    Z()
      .perguntar({
        titulo: "Desconto pra " + c.cliente,
        texto: "Em reais (ex.: 5) ou em % (ex.: 10%). 0 tira o desconto.",
        campos: [
          { rotulo: "Desconto", numero: true, dica: "5 ou 10%", valor: d ? String(d.valor).replace(".", ",") + (d.tipo === "pct" ? "%" : "") : "" },
        ],
        ok: "Aplicar",
      })
      .then(function (v) {
        if (!v) return;
        var r = lerDesconto(v[0]);
        if (r.erro) return Z().avisar(r.erro, true);
        var antes = c.desconto || null;
        c.desconto = r.desconto;
        // Desconto não pode deixar a conta menor do que já foi pago
        if (total(c) < pago(c)) {
          c.desconto = antes;
          return Z().avisar("Com esse desconto a conta fica menor do que ele já pagou.", true);
        }
        mudou(c);
        renderConta(c.id);
        Z().avisar(r.desconto ? "Desconto de " + dinheiro(valorDesconto(c)) + " aplicado." : "Desconto retirado.");
      });
  }

  /** Preço combinado (ex.: o conhaque do Zói): vale pros itens daquela linha já lançados. */
  function mudarPreco(c, grupo) {
    Z()
      .perguntar({
        titulo: "Preço de " + grupo.nome,
        texto:
          (grupo.qtd > 1 ? "Muda os " + grupo.qtd + " já lançados. " : "") +
          "Pra lançar mais um com esse preço, use o + desta linha.",
        campos: [{ rotulo: "Preço (cada)", numero: true, valor: String(grupo.preco).replace(".", ",") }],
        ok: "Mudar preço",
      })
      .then(function (v) {
        if (!v) return;
        var novo = lerPreco(v[0]);
        if (novo == null) return Z().avisar("Escreva só o número, ex.: 12 ou 7,50", true);
        novo = centavos(novo);
        if (novo === grupo.preco) return;
        var mudados = [];
        (c.lancamentos || []).forEach(function (l) {
          if (l.chave !== grupo.chave || Number(l.preco) !== grupo.preco) return;
          mudados.push({ l: l, preco: l.preco, precoCardapio: l.precoCardapio });
          if (l.precoCardapio == null) l.precoCardapio = l.preco;
          l.preco = novo;
          if (Number(l.precoCardapio) === novo) delete l.precoCardapio;
        });
        mudou(c);
        renderComanda(c.id, true);
        oferecerDesfazer(grupo.nome + ": " + dinheiro(novo) + " cada", function () {
          mudados.forEach(function (m) {
            m.l.preco = m.preco;
            if (m.precoCardapio == null) delete m.l.precoCardapio;
            else m.l.precoCardapio = m.precoCardapio;
          });
          mudou(c);
          renderComanda(c.id, true);
        });
      });
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
        el("span", { classe: "comanda-cartao__total", texto: dinheiro(saldo(c)) }),
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
        return s + saldo(c);
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
                  texto: (aberta.status === "pendurada" ? "fiado · " : "aberta · ") + dinheiro(saldo(aberta)),
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
        el("p", { classe: "comanda-total", texto: dinheiro(saldo(c)) }),
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
    else conteudo.appendChild(el("p", { classe: "consumido-dica", texto: "Preço combinado? Toque no nome do item." }));
    grupos.forEach(function (g) {
      conteudo.appendChild(
        el("div", { classe: "consumido" }, [
          el(
            "button",
            {
              type: "button",
              classe: "consumido__nome",
              "aria-label": "Mudar o preço de " + g.nome,
              onclick: function () {
                mudarPreco(c, g);
              },
            },
            [
              g.nome,
              el("small", {
                // muitas da mesma: só as últimas horas (a conta mostra todas)
                texto:
                  dinheiro(g.total) +
                  (g.precoCardapio != null ? " · combinado " + dinheiro(g.preco) + " (cardápio " + dinheiro(g.precoCardapio) + ")" : "") +
                  " · " +
                  (g.horas.length > 3 ? "últimas " + g.horas.slice(-3).join(", ") : g.horas.join(", ")),
              }),
            ],
          ),
          el("div", { classe: "passo", role: "group", "aria-label": "Quantidade de " + g.nome }, [
            el("button", {
              type: "button",
              classe: "passo__botao",
              "aria-label": "Tirar um " + g.nome,
              texto: "−",
              onclick: function () {
                tirarUm(c, g);
              },
            }),
            el("span", { classe: "passo__qtd", texto: String(g.qtd) }),
            el("button", {
              type: "button",
              classe: "passo__botao",
              "aria-label": "Mais um " + g.nome,
              texto: "+",
              onclick: function () {
                maisUm(c, g);
              },
            }),
          ]),
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
            Z()
              .perguntar({ titulo: "Trocar nome", campos: [{ rotulo: "Nome do cliente", valor: c.cliente }], ok: "Salvar" })
              .then(function (v) {
                if (!v) return;
                c.cliente = v[0];
                lembrarCliente(v[0]);
                mudou(c);
                renderComanda(c.id, true);
              });
          },
        }),
        el("button", {
          type: "button",
          classe: "barra__link barra__link--perigo",
          texto: "Excluir comanda",
          onclick: function () {
            Z()
              .perguntar({
                titulo: "Excluir a comanda de " + c.cliente + "?",
                texto: dinheiro(total(c)) + " · use só se abriu por engano. Ela não conta nas vendas.",
                ok: "Excluir",
                perigo: true,
              })
              .then(function (sim) {
                if (sim) excluir(c);
              });
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
          texto: (c.status === "pendurada" ? "Ver conta / receber · " : "Fechar conta · ") + dinheiro(saldo(c)),
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
    var falta = saldo(c);
    var pagamentos = recebimentos(c);

    // Subtotal / desconto / total / pagamentos / falta
    var contas = [];
    function linhaValor(rotulo, valor, classe) {
      contas.push(el("div", { classe: "conta__extra" + (classe ? " " + classe : "") }, [el("span", { texto: rotulo }), el("span", { texto: valor })]));
    }
    if (c.desconto) {
      linhaValor("Itens", dinheiro(subtotal(c)));
      linhaValor("Desconto" + (c.desconto.tipo === "pct" ? " (" + String(c.desconto.valor).replace(".", ",") + "%)" : ""), "− " + dinheiro(valorDesconto(c)), "conta__extra--desconto");
    }
    contas.push(el("div", { classe: "conta__total" }, [el("span", { texto: "Total" }), el("strong", { texto: dinheiro(total(c)) })]));
    if (pagamentos.length && c.status !== "paga") {
      pagamentos.forEach(function (p) {
        linhaValor("Pagou em " + dataCurta(p.hora) + " às " + hora(p.hora), "− " + dinheiro(p.valor), "conta__extra--pago");
      });
      contas.push(el("div", { classe: "conta__total conta__total--falta" }, [el("span", { texto: "Falta" }), el("strong", { texto: dinheiro(falta) })]));
    }

    var botoes = [];
    if (c.status === "paga") {
      var ultimo = pagamentos[pagamentos.length - 1];
      botoes.push(
        el("p", {
          classe: "conta__paga",
          texto: "✓ Conta paga" + (ultimo && ultimo.hora ? " em " + dataCurta(ultimo.hora) + " às " + hora(ultimo.hora) : ""),
        }),
      );
    } else {
      botoes.push(
        el("button", {
          type: "button",
          classe: "botao botao--whats botao--largo",
          texto: (c.status === "pendurada" ? "Recebi tudo · " : "Recebido · ") + dinheiro(falta),
          onclick: function () {
            Z()
              .perguntar({
                titulo: "Recebeu " + dinheiro(falta) + "?",
                texto: "A conta de " + c.cliente + " vai ser fechada.",
                ok: "Recebi",
              })
              .then(function (sim) {
                if (sim) receberTudo(c);
              });
          },
        }),
        el("button", {
          type: "button",
          classe: "botao botao--largo",
          texto: "Pagou uma parte",
          onclick: function () {
            Z()
              .perguntar({
                titulo: "Quanto " + c.cliente + " pagou?",
                texto: "De " + dinheiro(falta) + ". O que faltar fica no fiado.",
                campos: [{ rotulo: "Valor pago", numero: true }],
                ok: "Registrar",
              })
              .then(function (v) {
                if (!v) return;
                var valor = centavos(lerPreco(v[0]));
                if (!(valor > 0)) return Z().avisar("Escreva o valor pago, ex.: 20 ou 15,50", true);
                if (valor > falta) return Z().avisar("Ele deve " + dinheiro(falta) + ": o valor pago não pode ser maior.", true);
                receberParte(c, valor);
              });
          },
        }),
      );
      if (c.status === "aberta") {
        botoes.push(
          el("button", {
            type: "button",
            classe: "botao botao--largo",
            texto: "Pendurar tudo no fiado",
            onclick: function () {
              pendurar(c);
            },
          }),
        );
      }
      botoes.push(
        el("button", {
          type: "button",
          classe: "barra__link conta__desconto",
          texto: c.desconto ? "Mudar desconto" : "Dar desconto",
          onclick: function () {
            darDesconto(c);
          },
        }),
      );
    }
    pagina.appendChild(
      el(
        "div",
        { classe: "conteudo" },
        [
          el("p", { classe: "hero__eyebrow conta__marca", texto: "Bar do Zazá" }),
          el("h2", { classe: "comanda-nome conta__cliente", texto: c.cliente }),
          el("p", { classe: "nota", texto: desde }),
          tabela,
        ]
          .concat(contas)
          .concat([el("div", { classe: "conta__botoes" }, botoes)]),
      ),
    );
  }

  // ---------- vendas ----------

  /** Quando começou o dia do bar de hoje (5h da manhã; antes disso, 5h de ontem). */
  function inicioDoDiaDoBar() {
    var d = new Date(Date.now() - INICIO_DO_DIA_H * 3600e3);
    d.setHours(INICIO_DO_DIA_H, 0, 0, 0);
    return d.getTime();
  }

  /** Dia "do bar": até 5h da manhã ainda é a noite anterior. */
  function diaDoBar(ms) {
    var d = new Date(ms - INICIO_DO_DIA_H * 3600e3);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /** 5h da manhã de um dia (o dia do bar começa às 5h). */
  function cincoDaManha(ano, mes, dia) {
    return new Date(ano, mes, dia, INICIO_DO_DIA_H, 0, 0, 0).getTime();
  }

  function somarDias(ms, n) {
    var d = new Date(ms);
    d.setDate(d.getDate() + n);
    return d.getTime();
  }

  function dataLonga(ms) {
    return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }

  /** "2026-10-06" (campo de data) -> 5h daquele dia. */
  function deCampo(v) {
    var p = String(v || "").split("-");
    return p.length === 3 ? cincoDaManha(Number(p[0]), Number(p[1]) - 1, Number(p[2])) : null;
  }

  function paraCampo(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  var PERIODOS = [
    ["hoje", "Hoje"],
    ["ontem", "Ontem"],
    ["7dias", "7 dias"],
    ["mes", "Este mês"],
    ["mespassado", "Mês passado"],
    ["datas", "Escolher datas"],
  ];
  var periodo = { tipo: "hoje", de: null, ate: null };

  /** { de, ate } em ms, com o fim aberto: de <= x < ate. */
  function intervalo() {
    var hoje = inicioDoDiaDoBar();
    var d = new Date(hoje);
    switch (periodo.tipo) {
      case "ontem":
        return { de: somarDias(hoje, -1), ate: hoje };
      case "7dias":
        return { de: somarDias(hoje, -6), ate: somarDias(hoje, 1) };
      case "mes":
        return { de: cincoDaManha(d.getFullYear(), d.getMonth(), 1), ate: somarDias(hoje, 1) };
      case "mespassado":
        return { de: cincoDaManha(d.getFullYear(), d.getMonth() - 1, 1), ate: cincoDaManha(d.getFullYear(), d.getMonth(), 1) };
      case "datas":
        var de = periodo.de || hoje;
        var ate = periodo.ate || hoje;
        if (ate < de) ate = de;
        return { de: de, ate: somarDias(ate, 1) };
      default:
        return { de: hoje, ate: somarDias(hoje, 1) };
    }
  }

  /**
   * As contas pagas ficam 45 dias no celular. Período mais antigo que isso é
   * calculado com as comandas do banco (precisa de internet).
   */
  function comandasDoPeriodo(iv) {
    var locais = Object.keys(comandas).map(function (id) {
      return comandas[id];
    });
    if (iv.de >= Date.now() - (DIAS_NO_CELULAR - 1) * 864e5) return Promise.resolve({ lista: locais, doBanco: false });
    return Z()
      .api("vendasPeriodo", { de: iv.de, ate: iv.ate })
      .then(function (r) {
        // O que está no celular é o mais novo (pode ter mudança ainda não enviada)
        var porId = {};
        (r.comandas || []).forEach(function (c) {
          porId[c.id] = c;
        });
        locais.forEach(function (c) {
          porId[c.id] = c;
        });
        return {
          lista: Object.keys(porId).map(function (id) {
            return porId[id];
          }),
          doBanco: true,
        };
      });
  }

  function cartao(rotulo, valor, detalhe, classe) {
    return el("div", { classe: "venda-cartao" + (classe ? " " + classe : "") }, [
      el("span", { classe: "venda-cartao__rotulo", texto: rotulo }),
      el("strong", { texto: dinheiro(valor) }),
      el("small", { texto: detalhe }),
    ]);
  }

  function plural(n, um, varios) {
    return n + " " + (n === 1 ? um : varios);
  }

  // ---------- lista do fiado (copiar / planilha / compartilhar) ----------

  function quemDeve() {
    return lista("pendurada")
      .filter(function (c) {
        return saldo(c) > 0;
      })
      .sort(function (a, b) {
        return saldo(b) - saldo(a);
      });
  }

  function textoDoFiado() {
    var fiado = quemDeve();
    var soma = fiado.reduce(function (s, c) {
      return s + saldo(c);
    }, 0);
    return (
      "Fiado · Bar do Zazá · " +
      dataLonga(Date.now()) +
      "\n\n" +
      fiado
        .map(function (c) {
          var parte = pago(c) > 0 ? ", já pagou " + dinheiro(pago(c)) : "";
          return "• " + c.cliente + ": " + dinheiro(saldo(c)) + " (desde " + dataLonga(dataDaVenda(c)) + parte + ")";
        })
        .join("\n") +
      "\n\nTotal: " +
      dinheiro(soma) +
      " · " +
      plural(fiado.length, "pessoa", "pessoas")
    );
  }

  /** Copia pro WhatsApp (ou qualquer lugar). Sem HTTPS o navigator.clipboard não existe: usa o jeito antigo. */
  function copiarFiado() {
    var texto = textoDoFiado();
    var copiado = navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(texto) : Promise.reject();
    copiado
      .catch(function () {
        var area = el("textarea", { readonly: "readonly", "aria-hidden": "true", classe: "copiar-fallback" });
        area.value = texto;
        document.body.appendChild(area);
        area.select();
        var ok = document.execCommand("copy");
        area.remove();
        if (!ok) throw new Error();
      })
      .then(
        function () {
          Z().avisar("Lista copiada. Cole no WhatsApp.");
        },
        function () {
          Z().avisar("Não consegui copiar neste celular.", true);
        },
      );
  }

  /** Planilha (CSV) com ";" e vírgula decimal: abre certinho no Excel e no Google Planilhas em português. */
  function baixarFiado() {
    var num = function (n) {
      return centavos(n).toFixed(2).replace(".", ",");
    };
    var campo = function (t) {
      return '"' + String(t).replace(/"/g, '""') + '"';
    };
    var linhas = [["Cliente", "Deve (R$)", "Já pagou (R$)", "Total da conta (R$)", "Desde"].map(campo).join(";")];
    quemDeve().forEach(function (c) {
      linhas.push([campo(c.cliente), num(saldo(c)), num(pago(c)), num(total(c)), campo(dataLonga(dataDaVenda(c)))].join(";"));
    });
    var blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var link = el("a", { href: URL.createObjectURL(blob), download: "fiado-bar-do-zaza-" + paraCampo(Date.now()) + ".csv" });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(link.href);
    }, 5000);
  }

  function compartilharFiado() {
    navigator.share({ title: "Fiado · Bar do Zazá", text: textoDoFiado() }).catch(function () {});
  }

  // ---------- tela de vendas ----------

  function renderVendas() {
    var pagina = $("pagina-vendas");
    pagina.innerHTML = "";
    var conteudo = el("div", { classe: "conteudo" });
    pagina.appendChild(conteudo);

    // escolha do período
    var botoes = el("div", { classe: "periodos", role: "group", "aria-label": "Período" });
    PERIODOS.forEach(function (p) {
      botoes.appendChild(
        el("button", {
          type: "button",
          classe: "periodo",
          "aria-pressed": periodo.tipo === p[0] ? "true" : "false",
          texto: p[1],
          onclick: function () {
            periodo.tipo = p[0];
            if (p[0] === "datas" && !periodo.de) periodo.de = periodo.ate = inicioDoDiaDoBar();
            renderVendas();
          },
        }),
      );
    });
    conteudo.appendChild(botoes);
    if (periodo.tipo === "datas") {
      var campoDe = el("input", { type: "date", "aria-label": "De", max: paraCampo(Date.now()) });
      var campoAte = el("input", { type: "date", "aria-label": "Até", max: paraCampo(Date.now()) });
      campoDe.value = paraCampo(periodo.de);
      campoAte.value = paraCampo(periodo.ate);
      var mudouData = function () {
        periodo.de = deCampo(campoDe.value) || periodo.de;
        periodo.ate = deCampo(campoAte.value) || periodo.ate;
        renderVendas();
      };
      campoDe.addEventListener("change", mudouData);
      campoAte.addEventListener("change", mudouData);
      conteudo.appendChild(
        el("div", { classe: "datas" }, [
          el("label", { classe: "campo" }, [el("span", { texto: "De" }), campoDe]),
          el("label", { classe: "campo" }, [el("span", { texto: "Até" }), campoAte]),
        ]),
      );
    }

    var iv = intervalo();
    var resultado = el("div", {}, [el("p", { classe: "vazio-texto", texto: "Buscando no banco…" })]);
    conteudo.appendChild(resultado);
    comandasDoPeriodo(iv)
      .then(function (r) {
        // Só desenha se o período ainda é o mesmo (a pessoa pode ter trocado no meio)
        var agora = intervalo();
        if (agora.de !== iv.de || agora.ate !== iv.ate || !resultado.isConnected) return;
        resultado.innerHTML = "";
        desenharPeriodo(resultado, r.lista, iv, r.doBanco);
      })
      .catch(function (e) {
        resultado.innerHTML = "";
        resultado.appendChild(
          el("p", { classe: "vazio-texto", texto: "Período com mais de " + DIAS_NO_CELULAR + " dias precisa de internet. (" + e.message + ")" }),
        );
      });
  }

  /**
   * Vendas = dinheiro que entrou no período (como sempre foi): conta paga
   * entra no dia em que foi paga; fiado entra no dia em que for pago (cada
   * parte no seu dia). O fiado em aberto é o de agora, não do período.
   */
  function desenharPeriodo(caixa, todas, iv, doBanco) {
    var dentro = function (ms) {
      return ms >= iv.de && ms < iv.ate;
    };
    var entradas = [];
    var recebido = {}; // id -> quanto entrou no período
    todas.forEach(function (c) {
      if (c.status === "excluida") return;
      recebimentos(c).forEach(function (p) {
        if (!p.hora || !dentro(p.hora)) return;
        entradas.push({ c: c, valor: Number(p.valor) || 0, hora: p.hora });
        recebido[c.id] = centavos((recebido[c.id] || 0) + (Number(p.valor) || 0));
      });
    });
    var pagantes = todas.filter(function (c) {
      return recebido[c.id] != null;
    });
    var totalRecebido = centavos(
      entradas.reduce(function (s, x) {
        return s + x.valor;
      }, 0),
    );
    var fiado = quemDeve();
    var totalFiado = fiado.reduce(function (s, c) {
      return s + saldo(c);
    }, 0);
    var descontos = centavos(
      pagantes.reduce(function (s, c) {
        return s + valorDesconto(c);
      }, 0),
    );

    caixa.appendChild(
      el("div", { classe: "vendas-grade" }, [
        cartao("Vendas", totalRecebido, plural(pagantes.length, "comanda", "comandas")),
        cartao("Fiado em aberto", totalFiado, plural(fiado.length, "pessoa", "pessoas") + " · hoje", "venda-cartao--fiado"),
      ]),
    );
    caixa.appendChild(
      el("p", {
        classe: "nota",
        texto:
          "Conta o que foi recebido. Fiado entra no dia em que for pago. Até 5h da manhã ainda conta como a noite anterior." +
          (descontos > 0 ? " Descontos dados: " + dinheiro(descontos) + "." : "") +
          (doBanco ? " Período antigo: calculado com o histórico do banco." : ""),
      }),
    );
    if (fiado.length) {
      var ferramentas = [
        el("button", { type: "button", classe: "botao botao--pequeno", texto: "Copiar lista do fiado", onclick: copiarFiado }),
        el("button", { type: "button", classe: "botao botao--pequeno", texto: "Baixar planilha", onclick: baixarFiado }),
      ];
      if (navigator.share) {
        ferramentas.push(el("button", { type: "button", classe: "botao botao--pequeno", texto: "Compartilhar", onclick: compartilharFiado }));
      }
      caixa.appendChild(el("div", { classe: "linha-botoes" }, ferramentas));
    }

    // por dia
    var porDia = {};
    entradas.forEach(function (x) {
      var d = diaDoBar(x.hora);
      porDia[d] = porDia[d] || { total: 0, ids: {} };
      porDia[d].total = centavos(porDia[d].total + x.valor);
      porDia[d].ids[x.c.id] = true;
    });
    var dias = Object.keys(porDia).sort().reverse();
    caixa.appendChild(el("h2", { classe: "admin-secao__titulo admin-secao__titulo--espaco", texto: "Por dia" }));
    if (!dias.length) caixa.appendChild(el("p", { classe: "vazio-texto", texto: "Nenhuma venda nesse período." }));
    dias.forEach(function (d) {
      var p = d.split("-");
      var n = Object.keys(porDia[d].ids).length;
      caixa.appendChild(
        el("div", { classe: "linha-simples" }, [
          el("span", { texto: p[2] + "/" + p[1] + " · " + plural(n, "comanda", "comandas") }),
          el("strong", { texto: dinheiro(porDia[d].total) }),
        ]),
      );
    });

    // mais vendidos (itens das comandas pagas no período)
    var conta = {};
    pagantes.forEach(function (c) {
      (c.lancamentos || []).forEach(function (l) {
        conta[l.nome] = (conta[l.nome] || 0) + 1;
      });
    });
    var top = Object.keys(conta)
      .sort(function (a, b) {
        return conta[b] - conta[a];
      })
      .slice(0, 10);
    caixa.appendChild(el("h2", { classe: "admin-secao__titulo admin-secao__titulo--espaco", texto: "Mais vendidos" }));
    if (!top.length) caixa.appendChild(el("p", { classe: "vazio-texto", texto: "Sem vendas nesse período." }));
    top.forEach(function (n) {
      caixa.appendChild(el("div", { classe: "linha-simples" }, [el("span", { texto: n }), el("strong", { texto: conta[n] + "×" })]));
    });

    // comandas pagas no período (quanto entrou de cada uma)
    var LIMITE_LISTA = 60;
    pagantes.sort(function (a, b) {
      return ultimoRecebimento(b, dentro) - ultimoRecebimento(a, dentro);
    });
    caixa.appendChild(el("h2", { classe: "admin-secao__titulo admin-secao__titulo--espaco", texto: "Comandas pagas (" + pagantes.length + ")" }));
    pagantes.slice(0, LIMITE_LISTA).forEach(function (c) {
      var falta = saldo(c);
      var quando = ultimoRecebimento(c, dentro);
      var filhos = [
        el("span", { classe: "venda-linha__nome" }, [c.cliente, el("small", { texto: dataCurta(quando) + " às " + hora(quando) })]),
        el("span", { classe: "venda-linha__valor" }, [
          dinheiro(recebido[c.id]),
          falta > 0 ? el("small", { classe: "selo-situacao selo-situacao--fiado", texto: "pagou parte · falta " + dinheiro(falta) }) : null,
        ]),
      ];
      // Só abre a conta das comandas que estão no celular
      caixa.appendChild(
        comandas[c.id]
          ? el("a", { classe: "venda-linha", href: "#conta/" + encodeURIComponent(c.id) }, filhos)
          : el("div", { classe: "venda-linha" }, filhos),
      );
    });
    if (pagantes.length > LIMITE_LISTA) {
      caixa.appendChild(el("p", { classe: "nota", texto: "E mais " + (pagantes.length - LIMITE_LISTA) + " comandas." }));
    }
  }

  function ultimoRecebimento(c, dentro) {
    return recebimentos(c).reduce(function (m, p) {
      return p.hora && dentro(p.hora) ? Math.max(m, p.hora) : m;
    }, 0);
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

  /** Cardápio novo chegou do banco: só a tela de lançar depende dele. */
  function cardapioAtualizado() {
    if (atual.pagina === "comanda" && !$("pagina-comanda").hidden) renderComanda(atual.id, true);
  }

  window.Comandas = {
    mostrar: mostrar,
    cardapioAtualizado: cardapioAtualizado,
    sincronizarAoEntrar: sincronizarAoEntrar,
  };
})();

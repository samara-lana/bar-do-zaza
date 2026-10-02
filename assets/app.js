(function () {
  "use strict";

  var FUSO = "America/Sao_Paulo";
  var CHAVE_CACHE = "zaza_dados_v2";
  var TEMPO_LIMITE_MS = 45000;

  var DIAS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  var DIAS_EXIBICAO = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

  // ---------- utilidades ----------

  function txt(v) {
    return v == null ? "" : String(v).trim();
  }

  /** Caixa marcada na planilha chega como true, "TRUE", "VERDADEIRO", "sim" ou "x". */
  function marcado(v) {
    if (v === true) return true;
    var s = slug(v);
    return s === "true" || s === "verdadeiro" || s === "sim" || s === "x" || s === "1" || s === "em-falta";
  }

  /** "Almoço e Janta " -> "almoco-e-janta" */
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
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "texto") n.textContent = attrs[k];
        else if (k === "classe") n.className = attrs[k];
        else n.setAttribute(k, attrs[k]);
      });
    }
    (filhos || []).forEach(function (f) {
      if (f) n.appendChild(f);
    });
    return n;
  }

  /** "60", "R$ 60,00", 60 -> "R$ 60" / "R$ 7,50". Vazio -> "". */
  function formatarPreco(v) {
    var s = txt(v).replace(/[^\d,.]/g, "");
    if (!s) return "";
    // "1.234,50" e "7,5" (padrão BR) ou "7.5" (número vindo da planilha)
    var n = s.indexOf(",") >= 0 ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
    if (!isFinite(n)) return "R$ " + s;
    var temCentavos = Math.round(n * 100) % 100 !== 0;
    return (
      "R$ " +
      n.toLocaleString("pt-BR", {
        minimumFractionDigits: temCentavos ? 2 : 0,
        maximumFractionDigits: 2,
      })
    );
  }

  function soDigitos(s) {
    return txt(s).replace(/\D/g, "");
  }

  // ---------- horário ----------

  /** Dia da semana (0 = domingo) e minutos desde meia-noite, no fuso do bar. */
  function agoraNoBar() {
    var partes = new Intl.DateTimeFormat("en-US", {
      timeZone: FUSO,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date());
    var p = {};
    partes.forEach(function (x) {
      p[x.type] = x.value;
    });
    var dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
    return { dia: dia, minutos: Number(p.hour) * 60 + Number(p.minute) };
  }

  function indiceDoDia(nome) {
    var s = slug(nome).replace(/-?feira$/, "");
    for (var i = 0; i < DIAS.length; i++) {
      if (s === DIAS[i] || s === DIAS[i].slice(0, 3)) return i;
    }
    return -1;
  }

  var FAIXA = /(\d{1,2})(?:[:h](\d{2}))?\s*h?\s*(?:às|as|a|-|–|—|até|ate)\s*(\d{1,2})(?:[:h](\d{2}))?/gi;

  /**
   * "12h às 23h", "12:00 - 23:30", "18h–2h" -> [{abre, fecha}] em minutos.
   * Dia com mais de um turno ("12h às 14h; 16h às 23h") vira uma faixa por turno.
   */
  function lerFaixas(horario) {
    var faixas = [];
    var m;
    FAIXA.lastIndex = 0;
    while ((m = FAIXA.exec(txt(horario)))) {
      var abre = Number(m[1]) * 60 + Number(m[2] || 0);
      var fecha = Number(m[3]) * 60 + Number(m[4] || 0);
      if (fecha <= abre) fecha += 24 * 60; // fecha depois da meia-noite
      faixas.push({ abre: abre, fecha: fecha });
    }
    return faixas.sort(function (a, b) {
      return a.abre - b.abre;
    });
  }

  /** Só a primeira faixa (horário das refeições). */
  function lerFaixa(horario) {
    return lerFaixas(horario)[0] || null;
  }

  function horaLegivel(minutos) {
    var h = Math.floor(minutos / 60) % 24;
    var m = minutos % 60;
    return h + "h" + (m ? String(m).padStart(2, "0") : "");
  }

  /** Turnos de cada dia da semana (índice 0..6), ou null quando fechado. */
  function semana(horarios) {
    var s = [null, null, null, null, null, null, null];
    horarios.forEach(function (h) {
      var i = indiceDoDia(h.dia);
      var faixas = lerFaixas(h.horario);
      if (i >= 0 && faixas.length) s[i] = faixas;
    });
    return s;
  }

  /** Situação agora: aberto (dentro de um turno da planilha) ou fechado. */
  function textoStatus(horarios) {
    var sem = semana(horarios);
    if (!sem.some(Boolean)) return null;
    var agora = agoraNoBar();

    function dentro(turnos, minutos) {
      for (var i = 0; i < turnos.length; i++) {
        if (minutos >= turnos[i].abre && minutos < turnos[i].fecha) {
          return { estado: "aberto", texto: "Aberto agora · até " + horaLegivel(turnos[i].fecha) };
        }
      }
      return null;
    }

    // Noite de ontem que passou da meia-noite?
    var ontem = sem[(agora.dia + 6) % 7];
    var st = ontem && dentro(ontem, agora.minutos + 1440);
    if (st) return st;

    var hoje = sem[agora.dia];
    st = hoje && dentro(hoje, agora.minutos);
    if (st) return st;
    var proximo = (hoje || []).filter(function (t) {
      return t.abre > agora.minutos;
    })[0];
    if (proximo) {
      var jaAbriuHoje = hoje[0].abre < agora.minutos;
      return {
        estado: "fechado",
        texto: "Fechado agora · " + (jaAbriuHoje ? "volta hoje às " : "abre hoje às ") + horaLegivel(proximo.abre),
      };
    }
    for (var d = 1; d <= 7; d++) {
      var turnos = sem[(agora.dia + d) % 7];
      if (turnos) {
        var quando = d === 1 ? "amanhã" : DIAS_EXIBICAO[(agora.dia + d) % 7];
        return { estado: "fechado", texto: "Fechado agora · abre " + quando + " às " + horaLegivel(turnos[0].abre) };
      }
    }
    return null;
  }

  /** "almoco", "jantar" ou "". As refeições da Kaká valem nos dias em que o bar abre. */
  function refeicaoAgora(dados) {
    if (!dados) return "";
    var agora = agoraNoBar();
    if (!semana(dados.horarios)[agora.dia]) return "";
    var opcoes = { almoco: dados.sobre.refeicoes_almoco, jantar: dados.sobre.refeicoes_jantar };
    for (var k in opcoes) {
      var f = lerFaixa(opcoes[k]);
      if (f && agora.minutos >= f.abre && agora.minutos < f.fecha) return k;
    }
    return "";
  }

  function horariosRefeicoes(sobre) {
    return [
      ["almoco", "Almoço", txt(sobre.refeicoes_almoco)],
      ["jantar", "Jantar", txt(sobre.refeicoes_jantar)],
    ].filter(function (l) {
      return l[2];
    });
  }

  // ---------- renderização ----------

  function renderStatus(dados) {
    var alvo = document.getElementById("status");
    var st = textoStatus(dados.horarios);
    alvo.className = "status";
    alvo.textContent = "";
    if (!st) return;
    alvo.classList.add("status--" + st.estado);
    alvo.textContent = st.texto;
  }

  function renderHorarios(dados) {
    var lista = document.getElementById("horarios");
    var hoje = agoraNoBar().dia;
    lista.innerHTML = "";
    dados.horarios.forEach(function (h) {
      if (!txt(h.dia)) return;
      var horario = txt(h.horario) || "Fechado";
      var turnos = lerFaixas(horario);
      var classes = [];
      if (!turnos.length) classes.push("fechado");
      if (indiceDoDia(h.dia) === hoje) classes.push("hoje");
      var hora = el("span", { classe: "hora" });
      if (turnos.length > 1) {
        // Almoço e noite: "12h às 14h · 16h às 23h", quebrando só entre os turnos.
        turnos.forEach(function (t, i) {
          if (i) hora.appendChild(document.createTextNode(" · "));
          hora.appendChild(el("span", { classe: "turno", texto: horaLegivel(t.abre) + " às " + horaLegivel(t.fecha) }));
        });
      } else {
        hora.textContent = horario;
      }
      if (txt(h.obs)) hora.appendChild(el("small", { texto: txt(h.obs) }));
      lista.appendChild(
        el("li", { classe: classes.join(" ") }, [el("span", { classe: "dia", texto: txt(h.dia) }), hora]),
      );
    });
    var aviso = document.getElementById("aviso-horario");
    aviso.textContent = txt(dados.sobre.aviso_horario);
    aviso.hidden = !aviso.textContent;
    renderHorarioRefeicoes(dados);
  }

  function renderHorarioRefeicoes(dados) {
    var s = dados.sobre;
    var bloco = document.getElementById("horario-refeicoes");
    var lista = document.getElementById("horarios-refeicoes");
    var linhas = horariosRefeicoes(s);
    bloco.hidden = !linhas.length;
    if (!linhas.length) return;
    var nome = txt(s.refeicoes_nome);
    document.getElementById("titulo-refeicoes").textContent = "Refeições" + (nome ? " · " + nome : "");
    var dias = document.getElementById("dias-refeicoes");
    dias.textContent = txt(s.refeicoes_dias);
    dias.hidden = !dias.textContent;
    var agora = refeicaoAgora(dados);
    lista.innerHTML = "";
    linhas.forEach(function (l) {
      var nomeLinha = el("span", { classe: "dia", texto: l[1] });
      if (agora === l[0]) nomeLinha.appendChild(el("span", { classe: "selo-agora", texto: "servindo agora" }));
      lista.appendChild(el("li", null, [nomeLinha, el("span", { classe: "hora", texto: l[2] })]));
    });
  }

  /**
   * Agrupa as linhas por seção (na ordem em que aparecem na planilha) e, dentro
   * da seção, junta as linhas de mesmo nome num item só com variações.
   */
  function agrupar(cardapio) {
    var grupos = [];
    var porChave = {};
    cardapio.forEach(function (linha) {
      var nome = txt(linha.nome);
      if (!nome) return;
      var secao = txt(linha.secao) || "Outros";
      var chave = slug(secao);
      var g = porChave[chave];
      if (!g) {
        g = porChave[chave] = { titulo: secao, id: "c-" + chave, itens: [], porNome: {} };
        grupos.push(g);
      }
      var item = g.porNome[slug(nome)];
      if (!item) {
        item = g.porNome[slug(nome)] = { nome: nome, descricao: "", base: null, opcoes: [] };
        g.itens.push(item);
      }
      if (!item.descricao) item.descricao = txt(linha.descricao);
      var entrada = {
        opcao: txt(linha.opcao),
        preco: formatarPreco(linha.preco),
        falta: marcado(linha.em_falta),
      };
      if (!entrada.opcao && !item.base) item.base = entrada;
      else item.opcoes.push(entrada);
    });
    return grupos;
  }

  function renderItem(item) {
    var entradas = (item.base ? [item.base] : []).concat(item.opcoes);
    var tudoEmFalta = entradas.every(function (e) {
      return e.falta;
    });

    var nome = el("span", { classe: "item__nome", texto: item.nome });
    if (tudoEmFalta) nome.appendChild(el("span", { classe: "selo-falta", texto: "em falta" }));

    var linha = el("div", { classe: "item__linha" }, [nome]);
    if (item.base) {
      linha.appendChild(
        el("span", {
          classe: "item__preco" + (item.base.preco ? "" : " item__preco--consulte"),
          texto: item.base.preco || "consulte",
        }),
      );
    }

    var opcoes = null;
    if (item.opcoes.length) {
      opcoes = el(
        "ul",
        { classe: "opcoes" },
        item.opcoes.map(function (o) {
          var li = el("li", { classe: "opcao" + (o.falta && !tudoEmFalta ? " opcao--falta" : "") }, [
            el("span", { texto: o.opcao }),
            el("b", { texto: o.preco || "consulte" }),
          ]);
          if (o.falta && !tudoEmFalta) li.appendChild(el("span", { texto: "· em falta" }));
          return li;
        }),
      );
    }

    return el("li", { classe: "item" + (tudoEmFalta ? " item--falta" : "") }, [
      linha,
      item.descricao ? el("p", { classe: "item__desc", texto: item.descricao }) : null,
      opcoes,
    ]);
  }

  /**
   * Seção vira tabela quando todos os itens só têm variações (nenhum preço
   * principal) e as variações se repetem entre itens, tipo as cervejas:
   * 600 ml | Latão | Litrinho. Devolve as colunas, ou null.
   */
  function colunasDaTabela(grupo) {
    var colunas = [];
    var repetida = false;
    var ok = grupo.itens.every(function (item) {
      if (item.base || !item.opcoes.length) return false;
      item.opcoes.forEach(function (o) {
        var k = slug(o.opcao);
        var achou = colunas.filter(function (c) {
          return c.chave === k;
        })[0];
        if (achou) repetida = true;
        else colunas.push({ chave: k, titulo: o.opcao });
      });
      return true;
    });
    if (!ok || !repetida || colunas.length < 2 || colunas.length > 4) return null;
    return colunas;
  }

  function renderTabela(grupo, colunas) {
    var cab = el("tr", null, [el("th", { scope: "col", texto: "" })].concat(
      colunas.map(function (c) {
        return el("th", { scope: "col", texto: c.titulo });
      }),
    ));
    var linhas = grupo.itens.map(function (item) {
      var tudoEmFalta = item.opcoes.every(function (o) {
        return o.falta;
      });
      var nome = el("td", { texto: item.nome });
      if (tudoEmFalta) nome.appendChild(el("span", { classe: "selo-falta", texto: "em falta" }));
      var celulas = colunas.map(function (c) {
        var o = item.opcoes.filter(function (x) {
          return slug(x.opcao) === c.chave;
        })[0];
        if (!o) return el("td", { classe: "vazio", texto: "–", "aria-label": "não tem" });
        return el("td", {
          classe: o.falta ? "falta" : "",
          texto: o.preco || "consulte",
          title: o.falta ? "em falta" : "",
        });
      });
      return el("tr", { classe: tudoEmFalta ? "linha--falta" : "" }, [nome].concat(celulas));
    });
    return el("table", { classe: "tabela" }, [el("thead", null, [cab]), el("tbody", null, linhas)]);
  }

  function notaDaSecao(grupo, sobre) {
    if (!/refeic|almoco/.test(grupo.id)) return null;
    var texto = txt(sobre.refeicoes_texto);
    var ifood = txt(sobre.ifood);
    var horarios = horariosRefeicoes(sobre);
    if (!texto && !ifood && !horarios.length) return null;

    var bloco = el("div", { classe: "grupo__notas" });
    if (texto || ifood) {
      var p = el("p", { classe: "grupo__nota", texto: texto });
      if (ifood) {
        if (texto) p.appendChild(document.createTextNode(" "));
        p.appendChild(el("a", { href: ifood, target: "_blank", rel: "noopener", texto: "Pedir no iFood →" }));
      }
      bloco.appendChild(p);
    }
    if (horarios.length) {
      var agora = refeicaoAgora(dadosAtuais);
      var linha = el("p", { classe: "grupo__horas" });
      horarios.forEach(function (h, i) {
        if (i) linha.appendChild(document.createTextNode(" · "));
        linha.appendChild(el("span", { texto: h[1] + " " + h[2] }));
        if (agora === h[0]) linha.appendChild(el("span", { classe: "selo-agora", texto: "servindo agora" }));
      });
      bloco.appendChild(linha);
    }
    return bloco;
  }

  function renderCardapio(dados) {
    var lista = document.getElementById("cardapio-lista");
    var abas = document.getElementById("abas");
    var grupos = agrupar(dados.cardapio);
    lista.innerHTML = "";
    abas.innerHTML = "";

    grupos.forEach(function (g) {
      var colunas = colunasDaTabela(g);
      var itens = colunas ? renderTabela(g, colunas) : el("ul", { classe: "itens" }, g.itens.map(renderItem));
      lista.appendChild(
        el("section", { classe: "grupo", id: g.id, "aria-labelledby": g.id + "-t" }, [
          el("h3", { classe: "grupo__titulo", id: g.id + "-t", texto: g.titulo }),
          notaDaSecao(g, dados.sobre),
          itens,
        ]),
      );
      abas.appendChild(el("a", { classe: "aba", href: "#" + g.id, "data-alvo": g.id, texto: g.titulo }));
    });

    observarSecoes(grupos);
  }

  var observador = null;

  /** Destaca na barra de abas a seção que está na tela. */
  function observarSecoes(grupos) {
    if (observador) observador.disconnect();
    if (!("IntersectionObserver" in window) || !grupos.length) return;
    var abas = document.getElementById("abas");
    var visiveis = {};
    observador = new IntersectionObserver(
      function (entradas) {
        entradas.forEach(function (e) {
          visiveis[e.target.id] = e.isIntersecting;
        });
        var atual = grupos.filter(function (g) {
          return visiveis[g.id];
        })[0];
        if (!atual) return;
        Array.prototype.forEach.call(abas.children, function (a) {
          var ativa = a.getAttribute("data-alvo") === atual.id;
          if (ativa && a.getAttribute("aria-current") !== "true" && abas.scrollWidth > abas.clientWidth) {
            var dx = a.getBoundingClientRect().left - abas.getBoundingClientRect().left - 16;
            abas.scrollTo({ left: abas.scrollLeft + dx, behavior: "smooth" });
          }
          a.setAttribute("aria-current", ativa ? "true" : "false");
        });
      },
      { rootMargin: "-80px 0px -55% 0px" },
    );
    grupos.forEach(function (g) {
      observador.observe(document.getElementById(g.id));
    });
  }

  function linkWhatsapp(sobre) {
    var n = soDigitos(sobre.whatsapp);
    if (!n) return "";
    if (n.indexOf("55") !== 0) n = "55" + n;
    return "https://wa.me/" + n;
  }

  function definirLink(id, href) {
    var a = document.getElementById(id);
    if (!a) return;
    if (href) {
      a.href = href;
      a.hidden = false;
    } else {
      a.hidden = true;
    }
  }

  function renderContatos(dados) {
    var s = dados.sobre;
    var nome = txt(s.nome) || "Bar do Zazá";
    document.getElementById("rodape-nome").textContent = nome;
    document.getElementById("endereco").textContent = txt(s.endereco);

    var maps = txt(s.maps);
    if (!maps && txt(s.endereco)) {
      maps = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(nome + " " + s.endereco);
    }
    definirLink("link-maps", maps);
    definirLink("link-maps-topo", maps);
    definirLink("link-avaliar", txt(s.avaliar) || maps);

    definirLink("link-whatsapp", linkWhatsapp(s));

    var insta = txt(s.instagram).replace(/^@/, "");
    if (insta && insta.indexOf("http") !== 0) insta = "https://instagram.com/" + insta;
    definirLink("link-instagram", insta);

    document.getElementById("avaliar").hidden = !(txt(s.avaliar) || maps);
  }

  /**
   * Link de compartilhamento do Google Drive não abre como imagem; o endereço
   * lh3.googleusercontent.com/d/ID abre (com o arquivo compartilhado como
   * "qualquer pessoa com o link").
   */
  function urlDaFoto(url) {
    var u = txt(url);
    var drive = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
    if (drive) return "https://lh3.googleusercontent.com/d/" + drive[1] + "=w1200";
    return u;
  }

  function renderFotos(dados) {
    var secao = document.getElementById("fotos");
    var lista = document.getElementById("fotos-lista");
    var fotos = (dados.fotos || []).filter(function (f) {
      return txt(f.foto);
    });
    lista.innerHTML = "";
    secao.hidden = !fotos.length;
    fotos.forEach(function (f) {
      var legenda = txt(f.legenda);
      var img = el("img", { src: urlDaFoto(f.foto), alt: legenda || "Foto do Bar do Zazá", loading: "lazy" });
      // Link quebrado some em vez de deixar um buraco na galeria
      img.addEventListener("error", function () {
        var li = img.closest("li");
        if (li) li.remove();
        if (!lista.children.length) secao.hidden = true;
      });
      lista.appendChild(
        el("li", null, [el("figure", { classe: "foto" }, [img, legenda ? el("figcaption", { texto: legenda }) : null])]),
      );
    });
  }

  var dadosAtuais = null;

  function render(dados) {
    dadosAtuais = dados;
    renderStatus(dados);
    renderCardapio(dados);
    renderFotos(dados);
    renderHorarios(dados);
    renderContatos(dados);
  }

  // ---------- dados ----------

  /**
   * Junta o que veio da planilha com o padrão. Chave da aba Sobre que existe na
   * planilha vale mesmo vazia (é assim que se "desliga" o iFood, por exemplo);
   * chave que não existe lá fica com o valor padrão.
   */
  function mesclar(daPlanilha) {
    var p = window.DADOS_PADRAO;
    var d = daPlanilha || {};
    var sobre = {};
    Object.keys(p.sobre).forEach(function (k) {
      sobre[k] = p.sobre[k];
    });
    if (d.sobre && typeof d.sobre === "object") {
      Object.keys(d.sobre).forEach(function (k) {
        sobre[k] = txt(d.sobre[k]);
      });
    }
    var temCardapio = Array.isArray(d.cardapio) && d.cardapio.some(function (i) {
      return txt(i.nome);
    });
    var temFotos = Array.isArray(d.fotos);
    var temHorarios = Array.isArray(d.horarios) && d.horarios.some(function (h) {
      return txt(h.dia);
    });
    return {
      sobre: sobre,
      cardapio: temCardapio ? d.cardapio : p.cardapio,
      horarios: temHorarios ? d.horarios : p.horarios,
      fotos: temFotos ? d.fotos : p.fotos,
    };
  }

  function lerCache() {
    try {
      var bruto = localStorage.getItem(CHAVE_CACHE);
      return bruto ? JSON.parse(bruto) : null;
    } catch (e) {
      return null;
    }
  }

  function gravarCache(dados) {
    try {
      localStorage.setItem(CHAVE_CACHE, JSON.stringify(dados));
    } catch (e) {
      /* navegação privada etc.: segue sem cache */
    }
  }

  /**
   * Entre o que este celular guardou e a cópia que a Action do GitHub tira da
   * planilha a cada 15 minutos (assets/dados-planilha.js), fica a mais recente.
   * Assim quem abre o site pela primeira vez não cai no padrão velho do código.
   */
  function maisRecente(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return txt(b.atualizado) > txt(a.atualizado) ? b : a;
  }

  function buscarPlanilha(tentativa) {
    tentativa = tentativa || 1;
    var url = txt(window.APPS_SCRIPT_URL);
    if (!url) return;
    var controle = "AbortController" in window ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controle) controle.abort();
    }, TEMPO_LIMITE_MS);
    fetch(url, { signal: controle ? controle.signal : undefined })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (json) {
        if (!json || (!json.cardapio && !json.sobre)) throw new Error("resposta sem dados");
        gravarCache(json);
        render(mesclar(json));
      })
      .catch(function (e) {
        // O Google às vezes demora pra acordar o script ou responde erro: tenta mais uma vez
        if (tentativa < 2) {
          setTimeout(function () {
            buscarPlanilha(tentativa + 1);
          }, 3000);
        } else {
          console.warn("Planilha indisponível, usando o cardápio salvo:", e);
        }
      })
      .then(function () {
        clearTimeout(timer);
      });
  }

  render(mesclar(maisRecente(lerCache(), window.DADOS_PLANILHA)));
  buscarPlanilha();

  // Atualiza "aberto agora" e "servindo agora" sem precisar recarregar a página.
  setInterval(function () {
    if (dadosAtuais) render(dadosAtuais);
  }, 60000);
})();

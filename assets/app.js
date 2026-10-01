(function () {
  "use strict";

  var FUSO = "America/Sao_Paulo";
  var CHAVE_CACHE = "zaza_dados_v1";
  var TEMPO_LIMITE_MS = 10000;

  var DIAS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  var DIAS_EXIBICAO = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

  // ---------- utilidades ----------

  function txt(v) {
    return v == null ? "" : String(v).trim();
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

  /** "12h às 23h", "12:00 - 23:30", "18h–2h" -> {abre, fecha} em minutos. */
  function lerFaixa(horario) {
    var m = txt(horario).match(/(\d{1,2})(?:[:h](\d{2}))?\s*h?\s*(?:às|as|a|-|–|—|até|ate)\s*(\d{1,2})(?:[:h](\d{2}))?/i);
    if (!m) return null;
    var abre = Number(m[1]) * 60 + Number(m[2] || 0);
    var fecha = Number(m[3]) * 60 + Number(m[4] || 0);
    if (fecha <= abre) fecha += 24 * 60; // fecha depois da meia-noite
    return { abre: abre, fecha: fecha };
  }

  function horaLegivel(minutos) {
    var h = Math.floor(minutos / 60) % 24;
    var m = minutos % 60;
    return h + "h" + (m ? String(m).padStart(2, "0") : "");
  }

  /** Faixa de cada dia da semana (índice 0..6), ou null quando fechado. */
  function semana(horarios) {
    var s = [null, null, null, null, null, null, null];
    horarios.forEach(function (h) {
      var i = indiceDoDia(h.dia);
      if (i >= 0) s[i] = lerFaixa(h.horario);
    });
    return s;
  }

  function textoStatus(horarios) {
    var sem = semana(horarios);
    if (!sem.some(Boolean)) return null;
    var agora = agoraNoBar();

    // Ainda aberto desde ontem (horário que passa da meia-noite)?
    var ontem = sem[(agora.dia + 6) % 7];
    if (ontem && ontem.fecha > 1440 && agora.minutos < ontem.fecha - 1440) {
      return { aberto: true, texto: "Aberto agora · até umas " + horaLegivel(ontem.fecha) };
    }

    var hoje = sem[agora.dia];
    if (hoje && agora.minutos >= hoje.abre && agora.minutos < hoje.fecha) {
      return { aberto: true, texto: "Aberto agora · até umas " + horaLegivel(hoje.fecha) };
    }
    if (hoje && agora.minutos < hoje.abre) {
      return { aberto: false, texto: "Fechado agora · abre hoje às " + horaLegivel(hoje.abre) };
    }
    for (var d = 1; d <= 7; d++) {
      var faixa = sem[(agora.dia + d) % 7];
      if (faixa) {
        var quando = d === 1 ? "amanhã" : DIAS_EXIBICAO[(agora.dia + d) % 7];
        return {
          aberto: false,
          texto: "Fechado agora · abre " + quando + " às " + horaLegivel(faixa.abre),
        };
      }
    }
    return null;
  }

  // ---------- renderização ----------

  function renderStatus(dados) {
    var alvo = document.getElementById("status");
    var st = textoStatus(dados.horarios);
    alvo.className = "status";
    if (!st) {
      alvo.textContent = "";
      return;
    }
    alvo.classList.add(st.aberto ? "status--aberto" : "status--fechado");
    alvo.textContent = st.texto;
  }

  function renderHorarios(dados) {
    var lista = document.getElementById("horarios");
    var hoje = agoraNoBar().dia;
    lista.innerHTML = "";
    dados.horarios.forEach(function (h) {
      if (!txt(h.dia)) return;
      var horario = txt(h.horario) || "Fechado";
      var fechado = !lerFaixa(horario);
      var classes = [];
      if (fechado) classes.push("fechado");
      if (indiceDoDia(h.dia) === hoje) classes.push("hoje");
      var hora = el("span", { classe: "hora", texto: horario });
      if (txt(h.obs)) hora.appendChild(el("small", { texto: txt(h.obs) }));
      lista.appendChild(
        el("li", { classe: classes.join(" ") }, [el("span", { classe: "dia", texto: txt(h.dia) }), hora]),
      );
    });
    var aviso = document.getElementById("aviso-horario");
    aviso.textContent = txt(dados.sobre.aviso_horario);
    aviso.hidden = !aviso.textContent;
  }

  /** Agrupa os itens por seção, na ordem em que as seções aparecem na planilha. */
  function agrupar(cardapio) {
    var grupos = [];
    var porChave = {};
    cardapio.forEach(function (item) {
      var nome = txt(item.nome);
      if (!nome) return;
      var secao = txt(item.secao) || "Outros";
      var chave = slug(secao);
      if (!porChave[chave]) {
        porChave[chave] = { titulo: secao, id: "c-" + chave, itens: [] };
        grupos.push(porChave[chave]);
      }
      porChave[chave].itens.push(item);
    });
    return grupos;
  }

  function notaDaSecao(grupo, sobre) {
    if (grupo.id.indexOf("almoco") < 0) return null;
    var texto = txt(sobre.almoco_texto);
    var ifood = txt(sobre.ifood);
    if (!texto && !ifood) return null;
    var p = el("p", { classe: "grupo__nota", texto: texto });
    if (ifood) {
      if (texto) p.appendChild(document.createTextNode(" "));
      p.appendChild(el("a", { href: ifood, target: "_blank", rel: "noopener", texto: "Pedir no iFood →" }));
    }
    return p;
  }

  function renderCardapio(dados) {
    var lista = document.getElementById("cardapio-lista");
    var abas = document.getElementById("abas");
    var grupos = agrupar(dados.cardapio);
    lista.innerHTML = "";
    abas.innerHTML = "";

    grupos.forEach(function (g) {
      var itens = el(
        "ul",
        { classe: "itens" },
        g.itens.map(function (item) {
          var preco = formatarPreco(item.preco);
          return el("li", { classe: "item" }, [
            el("span", { classe: "item__nome", texto: txt(item.nome) }),
            el("span", {
              classe: "item__preco" + (preco ? "" : " item__preco--consulte"),
              texto: preco || "consulte",
            }),
            txt(item.descricao) ? el("span", { classe: "item__desc", texto: txt(item.descricao) }) : null,
          ]);
        }),
      );
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
          if (ativa && a.getAttribute("aria-current") !== "true") {
            abas.scrollTo({ left: a.offsetLeft - 16, behavior: "smooth" });
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

    var tel = soDigitos(s.telefone);
    if (tel && tel.indexOf("55") !== 0) tel = "55" + tel;
    definirLink("link-whatsapp", tel ? "https://wa.me/" + tel : "");
    definirLink("link-telefone", tel ? "tel:+" + tel : "");

    var insta = txt(s.instagram).replace(/^@/, "");
    if (insta && insta.indexOf("http") !== 0) insta = "https://instagram.com/" + insta;
    definirLink("link-instagram", insta);

    document.getElementById("avaliar").hidden = !(txt(s.avaliar) || maps);
  }

  function render(dados) {
    renderStatus(dados);
    renderCardapio(dados);
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
    var temHorarios = Array.isArray(d.horarios) && d.horarios.some(function (h) {
      return txt(h.dia);
    });
    return {
      sobre: sobre,
      cardapio: temCardapio ? d.cardapio : p.cardapio,
      horarios: temHorarios ? d.horarios : p.horarios,
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

  function buscarPlanilha() {
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
        console.warn("Planilha indisponível, usando o cardápio salvo:", e);
      })
      .then(function () {
        clearTimeout(timer);
      });
  }

  render(mesclar(lerCache()));
  buscarPlanilha();

  // Atualiza o "aberto agora" sem precisar recarregar a página.
  setInterval(function () {
    renderStatus(mesclar(lerCache()));
  }, 60000);
})();

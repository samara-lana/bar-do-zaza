/**
 * Abas "Bar" (informações gerais e horários) e "Fotos" (galeria do site).
 * Antes isso só mudava pela planilha; agora vai direto pro banco e aparece
 * no site na hora. Precisa de internet (não é coisa de mexer no meio do bar).
 */
(function () {
  "use strict";

  var Z = function () {
    return window.Zaza;
  };
  var $ = function (id) {
    return document.getElementById(id);
  };
  var el = function () {
    return Z().el.apply(null, arguments);
  };

  var DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

  /** Campos da aba Sobre, na ordem da tela. `vazio` explica o que acontece se ficar em branco. */
  var GRUPOS = [
    {
      titulo: "Informações do bar",
      campos: [
        { chave: "nome", rotulo: "Nome do bar", dica: "Aparece no rodapé do site." },
        { chave: "endereco", rotulo: "Endereço", dica: "Aparece em \"Onde fica\"." },
        { chave: "whatsapp", rotulo: "WhatsApp", dica: "Com DDD, ex.: 31 99999-9999. Vira o botão de WhatsApp.", tipo: "tel" },
        { chave: "maps", rotulo: "Link do Google Maps", dica: "No Maps: Compartilhar → Copiar link.", tipo: "url" },
        { chave: "instagram", rotulo: "Instagram", dica: "Ex.: @bardozaza. Vazio = o botão some." },
        { chave: "ifood", rotulo: "Link do iFood", dica: "Vazio = o botão \"Pedir no iFood\" some.", tipo: "url" },
      ],
    },
    {
      titulo: "Refeições",
      campos: [
        { chave: "refeicoes_nome", rotulo: "Quem faz as refeições", dica: "Aparece no título do horário das refeições." },
        { chave: "refeicoes_dias", rotulo: "Dias das refeições", dica: "Ex.: Terça a domingo." },
        { chave: "refeicoes_almoco", rotulo: "Horário do almoço", dica: "Ex.: 11h às 14h. Vazio = some.", horario: true },
        { chave: "refeicoes_jantar", rotulo: "Horário do jantar", dica: "Ex.: 19h às 21h. Vazio = some.", horario: true },
        { chave: "refeicoes_texto", rotulo: "Frase da seção Refeições", dica: "Vazio = some.", texto: true },
      ],
    },
  ];
  var AVANCADO = [{ chave: "avaliar", rotulo: "Link de avaliação no Google", dica: "Abre a tela de avaliar o bar. Só mude se souber o que é.", tipo: "url" }];

  // ---------- horários ----------

  // Mesma leitura do site (assets/app.js): "11h às 14h", "9:30h às 16h", "18h-2h"
  var FAIXA = /^\s*(\d{1,2})(?:[:h](\d{2}))?\s*h?\s*(?:às|as|a|-|–|—|até|ate)\s*(\d{1,2})(?:[:h](\d{2}))?\s*h?\s*$/i;

  function horaLegivel(h, m) {
    return Number(h) + "h" + (m && Number(m) ? String(m).padStart(2, "0") : "");
  }

  /** { ok, texto } — texto diz como o site vai entender, ou o que está errado. */
  function lerHorario(v) {
    var s = Z().txt(v);
    if (!s) return { ok: false, texto: "Escreva o horário ou toque em Fechado." };
    if (/^fechad[oa]$/i.test(s)) return { ok: true, texto: "Fechado nesse dia." };
    var partes = s.split(/;|\se\s/).filter(function (p) {
      return p.trim();
    });
    var faixas = [];
    for (var i = 0; i < partes.length; i++) {
      var m = partes[i].match(FAIXA);
      if (!m || Number(m[1]) > 24 || Number(m[3]) > 24) {
        return { ok: false, texto: "Não entendi \"" + partes[i].trim() + "\". Ex.: 11h às 23h, ou 11h às 14h; 16h às 23h" };
      }
      faixas.push(horaLegivel(m[1], m[2]) + " às " + horaLegivel(m[3], m[4]));
    }
    return { ok: true, texto: "Abre " + faixas.join(" e ") + "." };
  }

  // ---------- aba Bar ----------

  function campoTexto(c, valor) {
    var entrada = c.texto
      ? el("textarea", { rows: "2", autocapitalize: "sentences", "data-chave": c.chave })
      : el("input", {
          type: c.tipo || "text",
          autocapitalize: c.tipo ? "off" : "sentences",
          inputmode: c.tipo === "tel" ? "tel" : c.tipo === "url" ? "url" : "text",
          "data-chave": c.chave,
        });
    entrada.value = valor || "";
    var aviso = el("small", { classe: "campo__dica", texto: c.dica });
    if (c.horario) {
      var conferir = function () {
        var v = Z().txt(entrada.value);
        var r = v ? lerHorario(v) : { ok: true, texto: c.dica };
        aviso.textContent = r.texto;
        aviso.className = "campo__dica" + (r.ok ? "" : " campo__dica--erro");
      };
      entrada.addEventListener("input", conferir);
    }
    return el("label", { classe: "campo" }, [el("span", { texto: c.rotulo }), entrada, aviso]);
  }

  function linhaHorario(dia, h) {
    var horario = el("input", { type: "text", "aria-label": "Horário de " + dia, placeholder: "Ex.: 11h às 23h, ou Fechado", "data-dia": dia });
    var obs = el("input", { type: "text", "aria-label": "Observação de " + dia, placeholder: "Observação (opcional)", autocapitalize: "sentences" });
    horario.value = (h && h.horario) || "";
    obs.value = (h && h.obs) || "";
    var leitura = el("small", { classe: "campo__dica" });
    var linha = el("div", { classe: "horario" }, [el("strong", { classe: "horario__dia", texto: dia }), horario, leitura, obs]);
    var conferir = function () {
      var r = lerHorario(horario.value);
      leitura.textContent = r.texto;
      leitura.className = "campo__dica" + (r.ok ? "" : " campo__dica--erro");
    };
    horario.addEventListener("input", conferir);
    linha.lerDados = function () {
      return { dia: dia, horario: Z().txt(horario.value), obs: Z().txt(obs.value), leitura: lerHorario(horario.value) };
    };
    conferir();
    return linha;
  }

  /** "Segunda: Fechado · Terça a domingo: 11h às 14h e 16h às 23h" (dias seguidos iguais viram um só). */
  function resumoDaSemana(porDia) {
    var grupos = [];
    DIAS.forEach(function (d) {
      var h = porDia[Z().slug(d)];
      var r = lerHorario(h ? h.horario : "");
      var texto = !h || !Z().txt(h.horario) ? "sem horário" : /^fechad/i.test(Z().txt(h.horario)) ? "Fechado" : r.ok ? r.texto.replace(/^Abre /, "").replace(/\.$/, "") : h.horario;
      var ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo.texto === texto) ultimo.fim = d;
      else grupos.push({ inicio: d, fim: null, texto: texto });
    });
    return grupos.map(function (g) {
      return (g.fim ? g.inicio + " a " + g.fim.toLowerCase() : g.inicio) + ": " + g.texto;
    });
  }

  /** Bloco que abre e fecha (fica fechado até a pessoa tocar). */
  function gaveta(titulo, resumo, filhos) {
    return el(
      "details",
      { classe: "gaveta" },
      [
        el("summary", { classe: "gaveta__topo" }, [
          el("span", { classe: "gaveta__titulo", texto: titulo }),
          resumo ? el("span", { classe: "gaveta__resumo" }, resumo.map(function (l) {
            return el("span", { texto: l });
          })) : null,
        ]),
        el("div", { classe: "gaveta__corpo" }, filhos),
      ],
    );
  }

  function renderBar(site) {
    var pagina = $("pagina-bar");
    pagina.innerHTML = "";
    var conteudo = el("div", { classe: "conteudo" });
    pagina.appendChild(conteudo);
    var sobre = site.sobre || {};

    // Aviso: o jeito certo de avisar um dia diferente (feriado), sem mexer no horário da semana
    conteudo.appendChild(
      campoTexto(
        {
          chave: "aviso_horario",
          rotulo: "Aviso no site",
          dica: "Pra um dia diferente (feriado, evento), avise aqui. Ex.: Fechado no feriado de 15/11. Vazio = some.",
          texto: true,
        },
        sobre.aviso_horario,
      ),
    );

    // horários da semana: sempre os 7 dias, na ordem da semana
    var porDia = {};
    (site.horarios || []).forEach(function (h) {
      porDia[Z().slug(h.dia)] = h;
    });
    var linhas = DIAS.map(function (d) {
      return linhaHorario(d, porDia[Z().slug(d)]);
    });
    conteudo.appendChild(
      gaveta(
        "Horários da semana",
        resumoDaSemana(porDia),
        [
          el("p", {
            classe: "dica",
            texto:
              "Valem toda semana. Com pausa, separe com ponto e vírgula: 11h às 14h; 16h às 23h. Dia que nunca abre: escreva Fechado. Pra fechar só num dia (feriado), use o Aviso acima.",
          }),
        ].concat(linhas),
      ),
    );

    GRUPOS.forEach(function (g, i) {
      var campos = g.campos.map(function (c) {
        return campoTexto(c, sobre[c.chave]);
      });
      // o link de avaliação fica dentro de "Informações", ainda mais escondido
      if (i === 0) {
        campos.push(
          el(
            "details",
            { classe: "avancado" },
            [el("summary", { texto: "Avançado" })].concat(
              AVANCADO.map(function (c) {
                return campoTexto(c, sobre[c.chave]);
              }),
            ),
          ),
        );
      }
      conteudo.appendChild(gaveta(g.titulo, null, campos));
    });

    var salvar = el("button", { type: "button", classe: "botao botao--cheio botao--largo", texto: "Salvar" });
    salvar.addEventListener("click", function () {
      var horarios = linhas.map(function (l) {
        return l.lerDados();
      });
      var errado = horarios.filter(function (h) {
        return !h.leitura.ok;
      })[0];
      if (errado) {
        conteudo.querySelector(".gaveta").open = true;
        return Z().avisar(errado.dia + ": " + errado.leitura.texto, true);
      }
      var dados = {};
      Array.prototype.forEach.call(conteudo.querySelectorAll("[data-chave]"), function (c) {
        dados[c.getAttribute("data-chave")] = Z().txt(c.value);
      });
      var refeicaoErrada = ["refeicoes_almoco", "refeicoes_jantar"].filter(function (k) {
        return dados[k] && !lerHorario(dados[k]).ok;
      })[0];
      if (refeicaoErrada) return Z().avisar("Horário das refeições: " + lerHorario(dados[refeicaoErrada]).texto, true);

      salvar.disabled = true;
      salvar.textContent = "Salvando…";
      Z()
        .api("salvarHorarios", {
          lista: horarios.map(function (h) {
            return { dia: h.dia, horario: /^fechad/i.test(h.horario) ? "Fechado" : h.horario, obs: h.obs };
          }),
        })
        .then(function () {
          return Z().api("salvarSobre", { dados: dados });
        })
        .then(function (r) {
          renderBar(r.site);
          Z().avisar("Salvo! Já está no site.");
        })
        .catch(function (e) {
          Z().avisar(e.message, true);
          salvar.disabled = false;
          salvar.textContent = "Salvar";
        });
    });
    pagina.appendChild(el("div", { classe: "rodape-fixo" }, [salvar]));
  }

  // ---------- aba Fotos ----------

  var fotos = [];
  var enviando = false;

  /** Link do Drive ou arquivo da pasta fotos/ do site (mesma regra do site). */
  function urlDaFoto(u) {
    var drive = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
    if (drive) return "https://lh3.googleusercontent.com/d/" + drive[1] + "=w600";
    return /^https?:/i.test(u) ? u : "../" + u.replace(/^\.?\//, "");
  }

  /** Foto de celular (5-10 MB) vira um JPEG de até 1600 px (~300 KB): o plano gratuito tem limite de espaço e tráfego. */
  function reduzir(arquivo) {
    var LADO = 1600;
    return createImageBitmap(arquivo, { imageOrientation: "from-image" })
      .catch(function () {
        return createImageBitmap(arquivo);
      })
      .then(function (img) {
        var escala = Math.min(1, LADO / Math.max(img.width, img.height));
        var tela = document.createElement("canvas");
        tela.width = Math.round(img.width * escala);
        tela.height = Math.round(img.height * escala);
        tela.getContext("2d").drawImage(img, 0, 0, tela.width, tela.height);
        return new Promise(function (ok, erro) {
          tela.toBlob(
            function (b) {
              b ? ok(b) : erro(new Error("Não consegui ler essa foto."));
            },
            "image/jpeg",
            0.82,
          );
        });
      });
  }

  function salvarFotos(msg) {
    return Z()
      .api("salvarFotos", { lista: fotos })
      .then(function (r) {
        fotos = (r.site.fotos || []).slice();
        renderFotos();
        if (msg) Z().avisar(msg);
      })
      .catch(function (e) {
        Z().avisar(e.message, true);
        carregar("fotos");
      });
  }

  function adicionar(arquivos) {
    arquivos = Array.prototype.slice.call(arquivos || []);
    if (!arquivos.length || enviando) return;
    enviando = true;
    var feitas = 0;
    var status = $("fotos-status");
    var proxima = function () {
      if (!arquivos.length) return Promise.resolve();
      var arq = arquivos.shift();
      status.textContent = "Enviando " + (feitas + 1) + " de " + (feitas + arquivos.length + 1) + "…";
      return reduzir(arq)
        .then(function (blob) {
          var nome = Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + ".jpg";
          return Z().enviarFoto(nome, blob);
        })
        .then(function (url) {
          fotos.push({ foto: url, legenda: "" });
          feitas++;
          return proxima();
        });
    };
    proxima()
      .catch(function (e) {
        Z().avisar(e.message, true);
      })
      .then(function () {
        enviando = false;
        status.textContent = "";
        // Salva mesmo se alguma falhou no meio: as que subiram entram na galeria
        if (feitas) return salvarFotos(feitas === 1 ? "Foto adicionada ao site." : feitas + " fotos adicionadas ao site.");
      });
  }

  function mover(i, passo) {
    var j = i + passo;
    if (j < 0 || j >= fotos.length) return;
    var f = fotos.splice(i, 1)[0];
    fotos.splice(j, 0, f);
    renderFotos();
    salvarFotos();
  }

  function remover(i) {
    Z()
      .perguntar({ titulo: "Tirar essa foto do site?", texto: "Ela sai da galeria e o arquivo é apagado.", ok: "Tirar", perigo: true })
      .then(function (sim) {
        if (!sim) return;
        var f = fotos.splice(i, 1)[0];
        salvarFotos("Foto retirada do site.").then(function () {
          Z()
            .apagarFoto(f.foto)
            .catch(function () {});
        });
      });
  }

  function renderFotos() {
    var pagina = $("pagina-fotos");
    pagina.innerHTML = "";
    var escolher = el("input", { type: "file", accept: "image/*", multiple: "multiple", id: "fotos-arquivo", hidden: "hidden" });
    escolher.addEventListener("change", function () {
      adicionar(escolher.files);
      escolher.value = "";
    });
    var conteudo = el("div", { classe: "conteudo" }, [
      el("h2", { classe: "admin-secao__titulo" }, [
        "Fotos do site",
        el("span", { classe: "titulo-valor", texto: String(fotos.length) }),
      ]),
      el("p", { classe: "dica", texto: "Aparecem na galeria do site, nesta ordem. A legenda é opcional (ex.: Torresmo com batata)." }),
      escolher,
      el("label", { classe: "botao botao--cheio botao--largo", for: "fotos-arquivo", texto: "+ Adicionar fotos" }),
      el("p", { classe: "nota", id: "fotos-status", role: "status" }),
    ]);
    if (!fotos.length) conteudo.appendChild(el("p", { classe: "vazio-texto", texto: "Nenhuma foto ainda. Sem fotos, a galeria não aparece no site." }));
    fotos.forEach(function (f, i) {
      var legenda = el("input", { type: "text", placeholder: "Legenda (opcional)", "aria-label": "Legenda da foto " + (i + 1), autocapitalize: "sentences" });
      legenda.value = f.legenda || "";
      legenda.addEventListener("change", function () {
        f.legenda = Z().txt(legenda.value);
        salvarFotos("Legenda salva.");
      });
      var subir = el("button", { type: "button", classe: "botao botao--pequeno", "aria-label": "Subir", texto: "↑", onclick: function () {
        mover(i, -1);
      } });
      var descer = el("button", { type: "button", classe: "botao botao--pequeno", "aria-label": "Descer", texto: "↓", onclick: function () {
        mover(i, 1);
      } });
      subir.disabled = i === 0;
      descer.disabled = i === fotos.length - 1;
      conteudo.appendChild(
        el("div", { classe: "foto-admin" }, [
          el("img", { src: urlDaFoto(f.foto), alt: f.legenda || "Foto " + (i + 1), loading: "lazy" }),
          el("div", { classe: "foto-admin__campos" }, [
            legenda,
            el("div", { classe: "foto-admin__botoes" }, [
              subir,
              descer,
              el("button", { type: "button", classe: "barra__link barra__link--perigo", texto: "Tirar", onclick: function () {
                remover(i);
              } }),
            ]),
          ]),
        ]),
      );
    });
    pagina.appendChild(conteudo);
  }

  // ---------- abrir as abas ----------

  function carregar(pagina) {
    var alvo = $("pagina-" + pagina);
    alvo.innerHTML = "";
    alvo.appendChild(el("div", { classe: "conteudo" }, [el("p", { classe: "vazio-texto", texto: "Carregando…" })]));
    Z()
      .api("lerSite")
      .then(function (r) {
        if (alvo.hidden) return;
        if (pagina === "bar") renderBar(r.site);
        else {
          fotos = (r.site.fotos || []).slice();
          renderFotos();
        }
      })
      .catch(function (e) {
        alvo.innerHTML = "";
        alvo.appendChild(
          el("div", { classe: "conteudo" }, [
            el("p", { classe: "vazio-texto", texto: "Precisa de internet pra mexer nas informações e fotos do site. (" + e.message + ")" }),
          ]),
        );
      });
  }

  window.Site = {
    mostrar: carregar,
  };
})();

/**
 * Bar do Zazá · API da planilha
 *
 * Lê a planilha onde este script está e devolve um JSON que o site consome.
 * Publicado como Web App ("Qualquer pessoa"), via clasp (veja o README).
 *
 * Abas:
 *   - Cardapio (secao, nome, opcao, descricao, preco, em_falta)
 *   - Horarios (dia, horario, obs)
 *   - Fotos    (foto, legenda)
 *   - Sobre    (chave, valor)  -> textos e links do site
 *
 * Se uma aba não existir, ela é criada já preenchida com o conteúdo padrão
 * (Padrao.js). Isso acontece na primeira vez que o site ou o menu chamam o
 * script, então a planilha nova se monta sozinha.
 */

var ABAS = {
  cardapio: { nome: "Cardapio", aceitos: ["cardapio", "cardapios", "menu"], colunas: ["secao", "nome", "opcao", "descricao", "preco", "em_falta"] },
  horarios: { nome: "Horarios", aceitos: ["horarios", "horario"], colunas: ["dia", "horario", "obs"] },
  fotos: { nome: "Fotos", aceitos: ["fotos", "foto", "galeria"], colunas: ["foto", "legenda"] },
  sobre: { nome: "Sobre", aceitos: ["sobre", "informacoes", "info"], colunas: ["chave", "valor", "para que serve"] },
};

var EXPLICACAO_SOBRE = {
  nome: "Nome que aparece no rodapé.",
  endereco: "Endereço que aparece em \"Onde fica\".",
  whatsapp: "Com DDD. Vira o botão de WhatsApp.",
  maps: "Link do bar no Google Maps (botão Compartilhar do Maps).",
  avaliar: "Link que abre a tela de avaliar no Google. Não mexa se não souber.",
  aviso_horario: "Frase embaixo dos horários. Vazio = some.",
  refeicoes_texto: "Frase que aparece na seção Refeições. Vazio = some.",
  ifood: "Link da Kaká no iFood. Preenchido = aparece o botão \"Pedir no iFood\".",
  instagram: "Ex.: @bardozaza. Preenchido = aparece o botão do Instagram.",
};

var CACHE_KEY = "zaza_v2";
var CACHE_SEGUNDOS = 600;

function doGet(e) {
  var cache = CacheService.getScriptCache();
  var semCache = e && e.parameter && e.parameter.nocache === "1";
  if (!semCache) {
    var guardado = cache.get(CACHE_KEY);
    if (guardado) return json(guardado);
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dados = {
    cardapio: lerTabela(acharOuCriar(ss, "cardapio")),
    horarios: lerTabela(acharOuCriar(ss, "horarios")),
    fotos: lerTabela(acharOuCriar(ss, "fotos")),
    sobre: lerChaveValor(acharOuCriar(ss, "sobre")),
    atualizado: new Date().toISOString(),
  };
  var texto = JSON.stringify(dados);
  cache.put(CACHE_KEY, texto, CACHE_SEGUNDOS);
  return json(texto);
}

/** Toda edição na planilha limpa o cache: o site mostra a mudança na hora. */
function onEdit() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Site do Zazá")
    .addItem("Criar abas que estiverem faltando", "criarAbasQueFaltam")
    .addItem("Atualizar o site agora", "onEdit")
    .addItem("Trocar senha do admin", "trocarSenhaAdmin")
    .addToUi();
}

function criarAbasQueFaltam() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(ABAS).forEach(function (k) {
    acharOuCriar(ss, k);
  });
  onEdit();
}

function json(texto) {
  return ContentService.createTextOutput(texto).setMimeType(ContentService.MimeType.JSON);
}

/** "Cardápio " e "cardapio" são a mesma aba. */
function normalizar(s) {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function acharOuCriar(ss, chave) {
  var conf = ABAS[chave];
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (conf.aceitos.indexOf(normalizar(sheets[i].getName())) >= 0) return sheets[i];
  }
  return criarAba(ss, chave);
}

function criarAba(ss, chave) {
  var conf = ABAS[chave];
  var sh = ss.insertSheet(conf.nome);
  var linhas;
  if (chave === "sobre") {
    linhas = Object.keys(DADOS_PADRAO.sobre).map(function (k) {
      return [k, DADOS_PADRAO.sobre[k], EXPLICACAO_SOBRE[k] || ""];
    });
  } else {
    linhas = DADOS_PADRAO[chave].map(function (item) {
      return conf.colunas.map(function (c) {
        if (c === "em_falta") return item[c] === true;
        var v = item[c] == null ? "" : item[c];
        return c === "preco" && v !== "" ? Number(v) : v;
      });
    });
  }
  sh.getRange(1, 1, 1, conf.colunas.length).setValues([conf.colunas]).setFontWeight("bold").setBackground("#f6a623");
  if (linhas.length) sh.getRange(2, 1, linhas.length, conf.colunas.length).setValues(linhas);
  sh.setFrozenRows(1);

  if (chave === "cardapio") {
    sh.setColumnWidth(1, 130).setColumnWidth(2, 210).setColumnWidth(3, 200).setColumnWidth(4, 320);
    sh.setColumnWidth(5, 70).setColumnWidth(6, 80);
    sh.getRange(2, 6, Math.max(sh.getMaxRows() - 1, 1), 1).insertCheckboxes();
    sh.getRange("A1").setNote(
      "Nome da seção. As seções aparecem no site na ordem em que surgem aqui. Seção nova = é só escrever um nome novo.",
    );
    sh.getRange("B1").setNote("Linha sem nome é ignorada: apague o nome para esconder um item sem perder a linha.");
    sh.getRange("C1").setNote(
      "Variação do mesmo item (Com batata frita, Meia porção, Latão...). Linhas com o mesmo nome na mesma seção viram um item só no site. Deixe vazio na linha do preço principal.",
    );
    sh.getRange("E1").setNote("Só o número (ex.: 23 ou 7,50). Vazio = aparece \"consulte\".");
    sh.getRange("F1").setNote("Marque quando acabar. O item continua no site, apagado e com o selo EM FALTA. Desmarque quando voltar.");
  } else if (chave === "fotos") {
    sh.setColumnWidth(1, 420).setColumnWidth(2, 240);
    sh.getRange("A1").setNote(
      "Link da foto. Pode ser do Google Drive (compartilhada como \"qualquer pessoa com o link\") ou o caminho de um arquivo da pasta fotos/ do site. A ordem aqui é a ordem no site.",
    );
    sh.getRange("B1").setNote("Opcional. Texto curto embaixo da foto (ex.: Torresmo com batata).");
  } else if (chave === "horarios") {
    sh.setColumnWidth(1, 120).setColumnWidth(2, 140).setColumnWidth(3, 320);
    sh.getRange("B1").setNote("Ex.: 12h às 23h. Escreva Fechado nos dias que não abre.");
    sh.getRange("C1").setNote("Opcional. Uma observação curta embaixo do horário daquele dia.");
  } else {
    sh.setColumnWidth(1, 140).setColumnWidth(2, 420).setColumnWidth(3, 420);
    sh.getRange(2, 1, Math.max(linhas.length, 1), 1).setFontColor("#888888");
    sh.getRange(2, 3, Math.max(linhas.length, 1), 1).setFontColor("#888888").setFontStyle("italic");
    sh.getRange("A1").setNote("Não mude os nomes desta coluna: o site procura por eles. Edite só a coluna valor.");
  }

  apagarAbaVaziaPadrao(ss);
  return sh;
}

/** Tira a "Página1"/"Sheet1" vazia que vem em toda planilha nova. */
function apagarAbaVaziaPadrao(ss) {
  ss.getSheets().forEach(function (sh) {
    var n = normalizar(sh.getName());
    if ((n === "pagina1" || n === "sheet1" || n === "planilha1") && sh.getLastRow() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(sh);
    }
  });
}

/** Tabela com cabeçalho na linha 1. Linhas totalmente vazias são puladas. */
function lerTabela(sh) {
  var faixa = sh.getDataRange();
  var valores = faixa.getDisplayValues();
  var brutos = faixa.getValues();
  if (valores.length < 2) return [];
  var cab = valores[0].map(normalizar);
  var saida = [];
  for (var i = 1; i < valores.length; i++) {
    var linha = valores[i];
    // Caixa desmarcada também conta como vazia (a coluna em_falta vem cheia delas)
    var temConteudo = brutos[i].some(function (v) {
      return v !== "" && v !== false && v != null;
    });
    if (!temConteudo) continue;
    var obj = {};
    cab.forEach(function (c, j) {
      if (!c) return;
      // Caixa de seleção vai como true/false de verdade, não "VERDADEIRO"
      obj[c] = typeof brutos[i][j] === "boolean" ? brutos[i][j] : String(linha[j]).trim();
    });
    saida.push(obj);
  }
  return saida;
}

/** Aba chave/valor: coluna A = chave, coluna B = valor. */
function lerChaveValor(sh) {
  var valores = sh.getDataRange().getDisplayValues();
  var saida = {};
  for (var i = 1; i < valores.length; i++) {
    var k = normalizar(valores[i][0]);
    if (k) saida[k] = String(valores[i][1] == null ? "" : valores[i][1]).trim();
  }
  return saida;
}

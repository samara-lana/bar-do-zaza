/**
 * Bar do Zazá · API da planilha
 *
 * Lê a planilha onde este script está e devolve um JSON que o site consome.
 * Publicado como Web App ("Qualquer pessoa"), via clasp (veja o README).
 *
 * Abas:
 *   - Cardapio (secao, nome, descricao, preco)
 *   - Horarios (dia, horario, obs)
 *   - Sobre    (chave, valor)  -> textos e links do site
 *
 * Se uma aba não existir, ela é criada já preenchida com o conteúdo padrão
 * (Padrao.js). Isso acontece na primeira vez que o site ou o menu chamam o
 * script, então a planilha nova se monta sozinha.
 */

var ABAS = {
  cardapio: { nome: "Cardapio", aceitos: ["cardapio", "cardapios", "menu"], colunas: ["secao", "nome", "descricao", "preco"] },
  horarios: { nome: "Horarios", aceitos: ["horarios", "horario"], colunas: ["dia", "horario", "obs"] },
  sobre: { nome: "Sobre", aceitos: ["sobre", "informacoes", "info"], colunas: ["chave", "valor", "para que serve"] },
};

var EXPLICACAO_SOBRE = {
  nome: "Nome que aparece no rodapé.",
  endereco: "Endereço que aparece em \"Onde fica\".",
  telefone: "Com DDD. Vira os botões de WhatsApp e Ligar.",
  maps: "Link do bar no Google Maps (botão Compartilhar do Maps).",
  avaliar: "Link que abre a tela de avaliar no Google. Não mexa se não souber.",
  aviso_horario: "Frase embaixo dos horários. Vazio = some.",
  almoco_texto: "Frase que aparece na seção Almoço e janta. Vazio = some.",
  ifood: "Link da Kaká no iFood. Preenchido = aparece o botão \"Pedir no iFood\".",
  instagram: "Ex.: @bardozaza. Preenchido = aparece o botão do Instagram.",
};

var CACHE_KEY = "zaza_v1";
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
        var v = item[c] == null ? "" : item[c];
        return c === "preco" && v !== "" ? Number(v) : v;
      });
    });
  }
  sh.getRange(1, 1, 1, conf.colunas.length).setValues([conf.colunas]).setFontWeight("bold").setBackground("#f6a623");
  if (linhas.length) sh.getRange(2, 1, linhas.length, conf.colunas.length).setValues(linhas);
  sh.setFrozenRows(1);

  if (chave === "cardapio") {
    sh.setColumnWidth(1, 150).setColumnWidth(2, 260).setColumnWidth(3, 380).setColumnWidth(4, 80);
    sh.getRange("A1").setNote(
      "Nome da seção. As seções aparecem no site na ordem em que surgem aqui. Seção nova = é só escrever um nome novo.",
    );
    sh.getRange("D1").setNote("Só o número (ex.: 23 ou 7,50). Vazio = aparece \"consulte\".");
    sh.getRange("B1").setNote("Linha sem nome é ignorada: apague o nome para esconder um item sem perder a linha.");
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
  var valores = sh.getDataRange().getDisplayValues();
  if (valores.length < 2) return [];
  var cab = valores[0].map(normalizar);
  var saida = [];
  for (var i = 1; i < valores.length; i++) {
    var linha = valores[i];
    if (linha.join("").trim() === "") continue;
    var obj = {};
    cab.forEach(function (c, j) {
      if (c) obj[c] = String(linha[j]).trim();
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

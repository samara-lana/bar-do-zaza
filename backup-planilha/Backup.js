/**
 * Backup diário do Bar do Zazá (script da planilha "Bar do Zazá · Backup").
 *
 * Todo dia às 5h copia o banco inteiro (Supabase) para:
 *  - as abas desta planilha (Comandas, Itens, Pagamentos, Cardápio), pra ler e
 *    somar como qualquer planilha. É reescrita a cada backup: mexer aqui não
 *    muda nada no banco;
 *  - um arquivo JSON por dia na pasta "Bar do Zazá · Backups" do Drive, com
 *    tudo (inclusive horários, fotos e textos do site), guardado por 90 dias.
 *    É o arquivo que serve pra restaurar o banco.
 *
 * A chave do banco (service_role) fica só nas propriedades deste script:
 * menu Backup → Configurar chave do banco (uma vez). Isso também agenda o
 * backup diário. Ler o banco todo dia mantém o projeto gratuito do Supabase
 * acordado (ele pausa depois de 7 dias sem uso).
 */

var SUPABASE_URL = "https://jezxejsellwjyxunsxfn.supabase.co";
var NOME_PASTA = "Bar do Zazá · Backups";
var DIAS_GUARDADOS = 90;
var FORMATO_DATA = "dd/mm/yyyy hh:mm";
var FORMATO_DINHEIRO = '"R$" #,##0.00';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Backup")
    .addItem("Fazer backup agora", "fazerBackup")
    .addItem("Configurar chave do banco", "configurarChave")
    .addToUi();
}

function configurarChave() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt("Chave do banco", "Cole a chave service_role do Supabase:", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var chave = r.getResponseText().trim();
  if (!chave) return;
  PropertiesService.getScriptProperties().setProperty("SUPABASE_SERVICE_ROLE_KEY", chave);
  agendar();
  fazerBackup();
  ui.alert("Pronto: backup feito e agendado para todo dia às 5h.");
}

/** Um gatilho só, todo dia entre 5h e 6h (fuso do script: São Paulo). */
function agendar() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "fazerBackup") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("fazerBackup").timeBased().everyDays(1).atHour(5).create();
}

function fazerBackup() {
  var copia = {
    feito_em: new Date().toISOString(),
    cardapio: tudo("cardapio", "ordem"),
    horarios: tudo("horarios", "ordem"),
    fotos: tudo("fotos", "ordem"),
    sobre: tudo("sobre", "chave"),
    comandas: tudo("comandas", "aberta"),
    lancamentos: tudo("lancamentos", "comanda_id,ordem"),
    pagamentos: tudo("pagamentos", "comanda_id,hora"),
  };
  var arquivo = guardarNoDrive(copia);
  preencherAbas(copia, tudo("comandas_resumo", "aberta.desc"), arquivo);
}

// ---------- banco ----------

/** Todas as linhas de uma tabela, de 1000 em 1000. */
function tudo(tabela, ordem) {
  var chave = PropertiesService.getScriptProperties().getProperty("SUPABASE_SERVICE_ROLE_KEY");
  if (!chave) throw new Error("Falta a chave do banco: menu Backup → Configurar chave do banco.");
  var linhas = [];
  for (var de = 0; ; de += 1000) {
    var r = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/" + tabela + "?select=*&order=" + ordem, {
      headers: { apikey: chave, Authorization: "Bearer " + chave, Range: de + "-" + (de + 999) },
      muteHttpExceptions: true,
    });
    if (r.getResponseCode() >= 300) throw new Error(tabela + ": " + r.getResponseCode() + " " + r.getContentText());
    var parte = JSON.parse(r.getContentText());
    linhas = linhas.concat(parte);
    if (parte.length < 1000) return linhas;
  }
}

// ---------- Drive ----------

function pasta() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("PASTA_ID");
  if (id) {
    try {
      var p = DriveApp.getFolderById(id);
      if (!p.isTrashed()) return p;
    } catch (e) {
      /* apagada: cria outra */
    }
  }
  var nova = DriveApp.createFolder(NOME_PASTA);
  props.setProperty("PASTA_ID", nova.getId());
  return nova;
}

function guardarNoDrive(copia) {
  var p = pasta();
  var nome = "zaza-" + Utilities.formatDate(new Date(), "America/Sao_Paulo", "yyyy-MM-dd-HH'h'mm") + ".json";
  var arquivo = p.createFile(nome, JSON.stringify(copia), "application/json");
  var limite = Date.now() - DIAS_GUARDADOS * 864e5;
  var antigos = p.getFiles();
  while (antigos.hasNext()) {
    var f = antigos.next();
    if (f.getDateCreated().getTime() < limite) f.setTrashed(true);
  }
  return arquivo;
}

// ---------- abas ----------

function preencherAbas(copia, resumo, arquivo) {
  var clientes = {};
  copia.comandas.forEach(function (c) {
    clientes[c.id] = c.cliente;
  });
  var porHora = function (a, b) {
    return String(b.hora || "").localeCompare(String(a.hora || ""));
  };

  aba("Info", ["O quê", "Valor"], [
    ["Último backup", data(copia.feito_em)],
    ["Comandas", copia.comandas.length],
    ["Itens lançados", copia.lancamentos.length],
    ["Pagamentos", copia.pagamentos.length],
    ["Linhas do cardápio", copia.cardapio.length],
    ["Arquivo completo (pra restaurar)", arquivo.getUrl()],
    ["Pasta com os backups (" + DIAS_GUARDADOS + " dias)", pasta().getUrl()],
    ["Atenção", "Esta planilha é reescrita a cada backup. Mudar algo aqui não muda nada no site."],
  ], { datas: [] });

  aba(
    "Comandas",
    ["Cliente", "Situação", "Aberta", "Venda", "Fechada", "Subtotal", "Desconto", "Total", "Pago", "Falta pagar", "Itens", "Itens tirados", "id"],
    resumo.map(function (c) {
      var total = centavos(c.subtotal - c.desconto);
      return [c.cliente, c.status, data(c.aberta), data(c.venda_em), data(c.fechada), +c.subtotal, +c.desconto, total,
        +c.pago, c.status === "excluida" ? 0 : centavos(total - c.pago), c.qtd_itens, c.qtd_tirados, c.id];
    }),
    { datas: [3, 4, 5], dinheiro: [6, 7, 8, 9, 10] }
  );

  aba(
    "Itens",
    ["Cliente", "Item", "Preço", "Lançado", "Tirado em", "Comanda (id)"],
    copia.lancamentos.slice().sort(porHora).map(function (l) {
      return [clientes[l.comanda_id] || "", l.nome, l.preco === null ? "" : +l.preco, data(l.hora), data(l.removido_em), l.comanda_id];
    }),
    { datas: [4, 5], dinheiro: [3] }
  );

  aba(
    "Pagamentos",
    ["Cliente", "Valor", "Hora", "Desfeito em", "Comanda (id)"],
    copia.pagamentos.slice().sort(porHora).map(function (p) {
      return [clientes[p.comanda_id] || "", +p.valor, data(p.hora), data(p.removido_em), p.comanda_id];
    }),
    { datas: [3, 4], dinheiro: [2] }
  );

  aba(
    "Cardápio",
    ["Seção", "Nome", "Opção", "Descrição", "Preço", "Em falta"],
    copia.cardapio.map(function (i) {
      return [i.secao, i.nome, i.opcao, i.descricao, i.preco === null ? "" : +i.preco, i.em_falta ? "sim" : ""];
    }),
    { datas: [], dinheiro: [5] }
  );
}

/** Reescreve uma aba inteira. Colunas em `fmt` contam a partir de 1. */
function aba(nome, cabecalho, linhas, fmt) {
  var planilha = SpreadsheetApp.getActive();
  var sh = planilha.getSheetByName(nome) || planilha.insertSheet(nome);
  sh.clear();
  var valores = [cabecalho].concat(linhas);
  sh.getRange(1, 1, valores.length, cabecalho.length).setValues(valores);
  sh.getRange(1, 1, 1, cabecalho.length).setFontWeight("bold");
  sh.setFrozenRows(1);
  if (linhas.length) {
    (fmt.datas || []).forEach(function (c) {
      sh.getRange(2, c, linhas.length, 1).setNumberFormat(FORMATO_DATA);
    });
    (fmt.dinheiro || []).forEach(function (c) {
      sh.getRange(2, c, linhas.length, 1).setNumberFormat(FORMATO_DINHEIRO);
    });
  }
  sh.autoResizeColumns(1, cabecalho.length);
}

function data(iso) {
  return iso ? new Date(iso) : "";
}

function centavos(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

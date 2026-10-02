/**
 * Comandas do admin. Quem manda é o celular do Zazá (as comandas vivem lá e
 * funcionam sem internet); a aba Comandas é a cópia de segurança e o
 * histórico de vendas. Uma linha por comanda, atualizada no lugar.
 *
 *   { acao: "salvarComandas", token, comandas: [...] } -> { ok, salvas: [id...] }
 *   { acao: "listarComandas", token, dias }            -> { ok, comandas: [...] }
 *
 * `listarComandas` devolve todas as abertas e penduradas, mais as pagas dos
 * últimos `dias` (pra tela de vendas e pra recuperar num celular novo).
 */

var COLUNAS_COMANDAS = ["id", "cliente", "status", "aberta", "fechada", "total", "itens", "dados", "atualizado"];

function abaComandas(ss) {
  var sh = ss.getSheetByName("Comandas");
  if (sh) return sh;
  sh = ss.insertSheet("Comandas");
  sh.getRange(1, 1, 1, COLUNAS_COMANDAS.length)
    .setValues([COLUNAS_COMANDAS])
    .setFontWeight("bold")
    .setBackground("#ffa732");
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 90).setColumnWidth(2, 160).setColumnWidth(3, 90);
  sh.setColumnWidth(4, 130).setColumnWidth(5, 130).setColumnWidth(6, 80).setColumnWidth(7, 420);
  sh.getRange("D:E").setNumberFormat("dd/MM/yyyy HH:mm");
  sh.getRange("F:F").setNumberFormat("R$ #,##0.00");
  sh.getRange("A1").setNote("Escrita pelo admin. Não edite à mão: o celular sobrescreve.");
  sh.getRange("H1").setNote("Cópia completa da comanda (usada pelo admin).");
  sh.hideColumns(8, 2);
  return sh;
}

function textoDosItens(c) {
  var porItem = {};
  var ordem = [];
  (c.lancamentos || []).forEach(function (l) {
    if (!porItem[l.nome]) {
      porItem[l.nome] = 0;
      ordem.push(l.nome);
    }
    porItem[l.nome]++;
  });
  return ordem
    .map(function (n) {
      return porItem[n] + "× " + n;
    })
    .join("; ");
}

function totalDaComanda(c) {
  return (c.lancamentos || []).reduce(function (s, l) {
    return s + (Number(l.preco) || 0);
  }, 0);
}

function salvarComandas(lista) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = abaComandas(ss);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // Só id (A) e atualizado (I): a cópia completa (H) pesa e a aba só cresce
    var n = sh.getLastRow() - 1;
    var ids = n > 0 ? sh.getRange(2, 1, n, 1).getValues() : [];
    var datas = n > 0 ? sh.getRange(2, 9, n, 1).getValues() : [];
    var linhaDoId = {};
    ids.forEach(function (v, i) {
      linhaDoId[String(v[0])] = { linha: i + 2, atualizado: Number(datas[i][0]) || 0 };
    });

    var salvas = [];
    var novas = [];
    (lista || []).forEach(function (c) {
      if (!c || !c.id) return;
      var valores = [
        c.id,
        c.cliente || "",
        c.status || "aberta",
        c.aberta ? new Date(c.aberta) : "",
        c.fechada ? new Date(c.fechada) : "",
        totalDaComanda(c),
        textoDosItens(c),
        JSON.stringify(c),
        Number(c.atualizado) || Date.now(),
      ];
      var atual = linhaDoId[c.id];
      if (atual) {
        // Versão mais velha que a da planilha não sobrescreve
        if (atual.atualizado <= valores[8]) sh.getRange(atual.linha, 1, 1, 9).setValues([valores]);
      } else {
        novas.push(valores);
      }
      salvas.push(c.id);
    });
    if (novas.length) sh.getRange(sh.getLastRow() + 1, 1, novas.length, 9).setValues(novas);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, salvas: salvas };
}

function listarComandas(dias) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = abaComandas(ss);
  var n = sh.getLastRow() - 1;
  if (n < 1) return { ok: true, comandas: [] };
  var limite = Date.now() - (Number(dias) || 40) * 864e5;
  var comandas = [];
  // Filtra pelas colunas leves (id, status, fechada) antes de abrir a cópia completa
  var ids = sh.getRange(2, 1, n, 1).getValues();
  var leves = sh.getRange(2, 3, n, 3).getValues();
  var copias = sh.getRange(2, 8, n, 1).getValues();
  leves.forEach(function (v, i) {
    // Linha com o id apagado = linha apagada à mão (as colunas escondidas
    // H e I ficam pra trás quando se apaga só o que está visível)
    if (!String(ids[i][0]).trim()) return;
    var encerrada = v[0] === "paga" || v[0] === "excluida";
    var fechada = v[2] instanceof Date ? v[2].getTime() : 0;
    if (encerrada && fechada && fechada < limite) return;
    var c;
    try {
      c = JSON.parse(copias[i][0]);
    } catch (err) {
      return;
    }
    if (c && c.id) comandas.push(c);
  });
  return { ok: true, comandas: comandas };
}

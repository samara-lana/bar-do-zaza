/**
 * API do admin (admin/ no site). Tudo chega por POST, com o corpo em JSON:
 *   { acao: "login", senha }                     -> { token }
 *   { acao: "listar", token }                    -> { cardapio }
 *   { acao: "salvarItem", token, original, item } -> { cardapio }
 *   { acao: "excluirItem", token, original }      -> { cardapio }
 *   { acao: "emFalta", token, secao, nome, opcao, valor } -> { cardapio }
 *   { acao: "sair", token }
 *   salvarComandas / listarComandas: ver Comandas.js
 *
 * Segurança:
 *  - A senha nunca fica no código do site nem aqui: só o hash (SHA-256 com
 *    sal) nas Propriedades do script.
 *  - Login devolve um token aleatório que vale 180 dias. O site guarda o
 *    token, não a senha.
 *  - Mais de 10 senhas erradas em 15 minutos travam o login por 15 minutos.
 *  - "Trocar senha do admin" (menu da planilha) derruba todos os tokens.
 *
 * Os itens são achados por seção + nome (+ opção), não pelo número da linha:
 * assim, se alguém mexer na planilha ao mesmo tempo, o admin não edita a
 * linha errada.
 */

var TOKEN_DIAS = 180;
var MAX_TENTATIVAS = 10;
var TRAVA_SEGUNDOS = 15 * 60;

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return resposta({ ok: false, erro: "Pedido inválido." });
  }
  try {
    return resposta(executarAcao(req));
  } catch (err) {
    console.error(err);
    return resposta({ ok: false, erro: String((err && err.message) || err) });
  }
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function executarAcao(req) {
  if (req.acao === "definirSenha") return definirSenhaInicial(req.senha);
  if (req.acao === "login") return login(req.senha);
  if (!tokenValido(req.token)) return { ok: false, erro: "sessao", mensagem: "Sua sessão expirou. Entre de novo." };

  if (req.acao === "salvarComandas") return salvarComandas(req.comandas);
  if (req.acao === "listarComandas") return listarComandas(req.dias);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = acharOuCriar(ss, "cardapio");

  if (req.acao === "listar") return { ok: true, cardapio: lerTabela(sh) };
  if (req.acao === "sair") {
    props().deleteProperty(chaveToken(req.token));
    return { ok: true };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (req.acao === "salvarItem") salvarItem(sh, req.original, req.item);
    else if (req.acao === "excluirItem") excluirItem(sh, req.original);
    else if (req.acao === "emFalta") marcarEmFalta(sh, req);
    else return { ok: false, erro: "Ação desconhecida." };
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  onEdit(); // limpa o cache do site
  return { ok: true, cardapio: lerTabela(sh) };
}

// ---------- senha e sessão ----------

function props() {
  return PropertiesService.getScriptProperties();
}

function hash(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return bytes
    .map(function (b) {
      return ("0" + (b & 0xff).toString(16)).slice(-2);
    })
    .join("");
}

function gravarSenha(senha) {
  senha = String(senha || "").trim();
  if (senha.length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
  var sal = Utilities.getUuid();
  props().setProperties({ senha_sal: sal, senha_hash: hash(sal + senha) });
  // Senha nova derruba todo mundo que estava logado
  Object.keys(props().getProperties()).forEach(function (k) {
    if (k.indexOf("token_") === 0) props().deleteProperty(k);
  });
}

/** Só funciona enquanto não existe senha nenhuma (primeira configuração). */
function definirSenhaInicial(senha) {
  if (props().getProperty("senha_hash")) return { ok: false, erro: "Senha já definida." };
  gravarSenha(senha);
  return { ok: true };
}

function login(senha) {
  var cache = CacheService.getScriptCache();
  var tentativas = Number(cache.get("tentativas") || 0);
  if (tentativas >= MAX_TENTATIVAS) {
    return { ok: false, erro: "Muitas tentativas erradas. Espere 15 minutos." };
  }
  var sal = props().getProperty("senha_sal");
  var certo = props().getProperty("senha_hash");
  if (!certo || hash(sal + String(senha || "").trim()) !== certo) {
    cache.put("tentativas", String(tentativas + 1), TRAVA_SEGUNDOS);
    return { ok: false, erro: "Senha errada." };
  }
  cache.remove("tentativas");
  limparTokensVencidos();
  var token = Utilities.getUuid() + Utilities.getUuid();
  props().setProperty(chaveToken(token), String(Date.now() + TOKEN_DIAS * 864e5));
  return { ok: true, token: token };
}

function chaveToken(token) {
  return "token_" + hash(String(token || "")).slice(0, 40);
}

function tokenValido(token) {
  if (!token) return false;
  var validade = Number(props().getProperty(chaveToken(token)) || 0);
  return validade > Date.now();
}

function limparTokensVencidos() {
  var todas = props().getProperties();
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf("token_") === 0 && Number(todas[k]) < Date.now()) props().deleteProperty(k);
  });
}

/** Menu da planilha: Site do Zazá → Trocar senha do admin. */
function trocarSenhaAdmin() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt("Nova senha do admin", "Pelo menos 6 caracteres. Quem estiver logado vai precisar entrar de novo.", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  try {
    gravarSenha(r.getResponseText());
    ui.alert("Senha trocada.");
  } catch (err) {
    ui.alert(err.message);
  }
}

// ---------- edição do cardápio ----------

var COL = { secao: 1, nome: 2, opcao: 3, descricao: 4, preco: 5, em_falta: 6 };

function linhasDoCardapio(sh) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 6).getValues();
}

/** Números de linha (na planilha) do item seção + nome. */
function acharItem(sh, secao, nome) {
  var s = normalizar(secao);
  var n = normalizar(nome);
  var achadas = [];
  linhasDoCardapio(sh).forEach(function (v, i) {
    if (normalizar(v[0]) === s && normalizar(v[1]) === n) achadas.push(i + 2);
  });
  return achadas;
}

function secaoExiste(sh, secao) {
  var s = normalizar(secao);
  return linhasDoCardapio(sh).some(function (v) {
    return normalizar(v[0]) === s;
  });
}

/** Linha logo depois da última linha da seção; fim da tabela se a seção é nova. */
function fimDaSecao(sh, secao) {
  var s = normalizar(secao);
  var ultimaDaSecao = 0;
  var ultimaPreenchida = 1;
  // getLastRow() não serve: as caixas de seleção vazias contam como conteúdo
  linhasDoCardapio(sh).forEach(function (v, i) {
    if (limpo(v[0]) || limpo(v[1])) ultimaPreenchida = i + 2;
    if (normalizar(v[0]) === s) ultimaDaSecao = i + 2;
  });
  return (ultimaDaSecao || ultimaPreenchida) + 1;
}

function lerPreco(v) {
  var s = String(v == null ? "" : v).replace(/[^\d,.]/g, "");
  if (!s) return "";
  var n = s.indexOf(",") >= 0 ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return isFinite(n) ? n : "";
}

function limpo(v) {
  return String(v == null ? "" : v).trim();
}

/**
 * Troca o item inteiro (todas as linhas dele) pelo que veio do admin. Item
 * novo (sem `original`) entra no fim da seção dele. Seção nova entra depois
 * da seção `item.depoisDe` (ou no fim do cardápio).
 */
function salvarItem(sh, original, item) {
  if (!item || !limpo(item.nome)) throw new Error("O item precisa de um nome.");
  if (!limpo(item.secao)) throw new Error("Escolha a seção.");
  var variacoes = (item.variacoes || []).filter(function (v) {
    return limpo(v.opcao) || limpo(v.preco) !== "";
  });
  if (!variacoes.length) variacoes = [{ opcao: "", preco: "", em_falta: false }];

  var linhas = variacoes.map(function (v, i) {
    return [
      limpo(item.secao),
      limpo(item.nome),
      limpo(v.opcao),
      i === 0 ? limpo(item.descricao) : "",
      lerPreco(v.preco),
      v.em_falta === true,
    ];
  });

  var antigas = original ? acharItem(sh, original.secao, original.nome) : [];
  if (!original) {
    if (acharItem(sh, item.secao, item.nome).length) {
      throw new Error("Já existe \"" + limpo(item.nome) + "\" nessa seção. Edite o que já existe.");
    }
  } else if (!antigas.length) {
    throw new Error("Esse item não está mais na planilha. Atualize a página.");
  }

  // Mesmo lugar se a seção não mudou; senão, fim da seção nova
  var mesmaSecao = original && normalizar(original.secao) === normalizar(item.secao);
  for (var i = antigas.length - 1; i >= 0; i--) sh.deleteRow(antigas[i]);
  var pos;
  if (mesmaSecao) pos = antigas[0];
  else if (!secaoExiste(sh, item.secao) && limpo(item.depoisDe)) pos = fimDaSecao(sh, item.depoisDe);
  else pos = fimDaSecao(sh, item.secao);

  if (pos > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), linhas.length);
  else sh.insertRowsBefore(pos, linhas.length);
  var faixa = sh.getRange(pos, 1, linhas.length, 6);
  faixa.clearDataValidations().setFontWeight("normal").setBackground(null);
  sh.getRange(pos, COL.em_falta, linhas.length, 1).insertCheckboxes();
  faixa.setValues(linhas);
}

function excluirItem(sh, original) {
  var antigas = original ? acharItem(sh, original.secao, original.nome) : [];
  if (!antigas.length) throw new Error("Esse item não está mais na planilha. Atualize a página.");
  for (var i = antigas.length - 1; i >= 0; i--) sh.deleteRow(antigas[i]);
}

function marcarEmFalta(sh, req) {
  var opcao = normalizar(req.opcao);
  var linhas = acharItem(sh, req.secao, req.nome).filter(function (n) {
    return normalizar(sh.getRange(n, COL.opcao).getValue()) === opcao;
  });
  if (!linhas.length) throw new Error("Esse item não está mais na planilha. Atualize a página.");
  linhas.forEach(function (n) {
    var cel = sh.getRange(n, COL.em_falta);
    if (!cel.getDataValidation()) cel.insertCheckboxes();
    cel.setValue(req.valor === true);
  });
}

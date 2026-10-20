// Leva o histórico de comandas da planilha (aba Comandas) pro Supabase.
//
// 1. Na planilha: aba Comandas → Arquivo → Fazer download → Valores separados
//    por vírgula (.csv). Salve o arquivo na pasta backups/ (fica fora do git:
//    tem nome de cliente e fiado).
// 2. node scripts/importar-comandas.mjs backups/<arquivo>.csv
//
// Usa a mesma função do banco que o celular usa (salvar_comandas): versão
// mais nova vence, nada duplica, e pode rodar quantas vezes quiser. Comanda
// antiga é completada com a MESMA regra do celular (completarAntiga em
// admin/comandas.js): conta paga ganha o pagamento "legado" no dia em que fechou.
import { readFileSync } from "node:fs";

process.loadEnvFile(".env.local");
const { SUPABASE_URL: U, SUPABASE_ANON_KEY: A, SUPABASE_SERVICE_ROLE_KEY: S } = process.env;
const svc = { apikey: S, Authorization: `Bearer ${S}`, "Content-Type": "application/json" };
const arquivo = process.argv[2];
if (!arquivo) throw new Error("Uso: node scripts/importar-comandas.mjs backups/<arquivo>.csv");

/** CSV do Google Planilhas: vírgula, aspas duplas, aspas dobradas e quebra de linha dentro de aspas. */
function lerCsv(texto) {
  const linhas = [];
  let linha = [], campo = "", aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ",") { linha.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = "";
    } else campo += ch;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((c) => c.trim()));
}

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const totalDe = (c) => centavos((c.lancamentos || []).reduce((s, l) => s + (Number(l.preco) || 0), 0));

/** Igual a completarAntiga() + dataDaVenda() do admin. */
function completarAntiga(c) {
  if (c.status === "paga" && !(c.pagamentos && c.pagamentos.length) && c.fechada && totalDe(c) > 0) {
    c.pagamentos = [{ id: "legado", valor: totalDe(c), hora: c.fechada }];
  }
  if (!c.vendaEm && (c.status === "paga" || c.status === "pendurada")) {
    if (c.status === "paga" && c.fechada) c.vendaEm = c.fechada;
    else c.vendaEm = (c.lancamentos || []).reduce((m, l) => Math.max(m, l.hora || 0), 0) || c.aberta;
  }
  delete c.sincronizado;
  delete c.pendenteDesde;
  return c;
}

const linhas = lerCsv(readFileSync(arquivo, "utf8").replace(/^﻿/, ""));
const cab = linhas[0].map((c) => c.trim().toLowerCase());
const col = (nome) => cab.indexOf(nome);
if (col("id") < 0 || col("dados") < 0) {
  throw new Error(
    `Não achei as colunas "id" e "dados" (achei: ${cab.join(", ")}). A coluna "dados" fica escondida na planilha: ` +
      "se o download veio sem ela, reexiba as colunas H e I antes de baixar."
  );
}

const comandas = [];
const ruins = [];
for (const l of linhas.slice(1)) {
  const id = (l[col("id")] || "").trim();
  if (!id) continue; // linha apagada à mão (mesma regra do Apps Script)
  try {
    const c = JSON.parse(l[col("dados")]);
    if (!c || c.id !== id) throw new Error("id diferente");
    comandas.push(completarAntiga(c));
  } catch (e) {
    ruins.push(`${id} (${l[col("cliente")] || "?"}): ${e.message}`);
  }
}
console.log(`Planilha: ${comandas.length} comandas lidas${ruins.length ? `, ${ruins.length} com a cópia (coluna dados) ilegível` : ""}.`);
if (ruins.length) console.log("  " + ruins.join("\n  "));

// Admin temporário: salvar_comandas exige login de admin (é a mesma porta do celular)
const email = `importacao-${Date.now()}@bar-do-zaza.app`;
const senha = crypto.randomUUID();
const user = await (await fetch(`${U}/auth/v1/admin/users`, { method: "POST", headers: svc, body: JSON.stringify({ email, password: senha, email_confirm: true }) })).json();
if (!user.id) throw new Error("Não consegui criar o acesso temporário: " + JSON.stringify(user));
let salvas = 0;
const erros = [];
try {
  await fetch(`${U}/rest/v1/admins`, { method: "POST", headers: svc, body: JSON.stringify({ user_id: user.id }) });
  const login = await (await fetch(`${U}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: A, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: senha }) })).json();
  for (let i = 0; i < comandas.length; i += 50) {
    const r = await fetch(`${U}/rest/v1/rpc/salvar_comandas`, {
      method: "POST",
      headers: { apikey: A, Authorization: `Bearer ${login.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ lista: comandas.slice(i, i + 50) }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`lote ${i / 50 + 1}: ${r.status} ${JSON.stringify(j)}`);
    salvas += j.salvas.length;
    erros.push(...j.erros);
  }
} finally {
  await fetch(`${U}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: svc });
}

// Confere: total de cada comanda no banco = soma dos itens da planilha
const ids = comandas.map((c) => c.id);
const noBanco = [];
for (let i = 0; i < ids.length; i += 100) {
  const parte = ids.slice(i, i + 100).map((x) => `"${x}"`).join(",");
  noBanco.push(...(await (await fetch(`${U}/rest/v1/comandas_resumo?id=in.(${encodeURIComponent(parte)})&select=id,subtotal`, { headers: svc })).json()));
}
const porId = Object.fromEntries(noBanco.map((r) => [r.id, Number(r.subtotal)]));
const diferentes = comandas.filter((c) => porId[c.id] !== totalDe(c));
const fiado = comandas.filter((c) => c.status === "pendurada");
console.log(`Banco: ${salvas} salvas${erros.length ? `, ${erros.length} recusadas` : ""}.`);
for (const e of erros) console.log(`  recusada ${e.id}: ${e.erro}`);
console.log(`Fiado: ${fiado.length} contas, ${fiado.reduce((s, c) => s + totalDe(c), 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} no total.`);
if (diferentes.length) {
  console.log(`ATENÇÃO: ${diferentes.length} comandas com total diferente no banco (pode ser versão mais nova vinda do celular):`);
  for (const c of diferentes.slice(0, 10)) console.log(`  ${c.id} ${c.cliente}: planilha ${totalDe(c)} · banco ${porId[c.id]}`);
} else {
  console.log("Conferido: o total de cada comanda no banco bate com a planilha.");
}

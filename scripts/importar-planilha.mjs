// Copia cardápio, horários, fotos e "sobre" da planilha (só leitura, pelo
// mesmo endereço público que o site usava) para o Supabase.
// As comandas não passam por aqui: o próprio celular do Zazá manda as dele
// no primeiro login do admin novo (ver admin/comandas.js, migrarParaSupabase).
//
// Uso (na pasta do projeto, com o .env.local preenchido):
//   node scripts/importar-planilha.mjs              # só se o banco estiver vazio
//   node scripts/importar-planilha.mjs --substituir # apaga o conteúdo do banco e copia de novo
process.loadEnvFile(".env.local");

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyP2LieKMcs6IxjsrjQMBC4_8MsN6k9wWQcrQSIWD8ImnZxF3ta2PS_GqQtxoY0U3St/exec";
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: CHAVE } = process.env;
const substituir = process.argv.includes("--substituir");

async function rest(caminho, opcoes = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    ...opcoes,
    headers: {
      apikey: CHAVE,
      Authorization: `Bearer ${CHAVE}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...opcoes.headers,
    },
  });
  if (!r.ok) throw new Error(`${opcoes.method || "GET"} ${caminho}: ${r.status} ${await r.text()}`);
  return r.status === 204 || r.headers.get("content-length") === "0" ? null : r.json().catch(() => null);
}

/** Mesma leitura do admin, mas preço que não é número para tudo em vez de virar vazio. */
function lerPreco(v, onde) {
  const bruto = String(v ?? "").trim();
  if (!bruto) return null;
  let s = bruto.replace(/[^\d,.]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Preço estranho em ${onde}: "${bruto}"`);
  return Math.round(Number(s) * 100) / 100;
}

const r = await fetch(APPS_SCRIPT_URL, { signal: AbortSignal.timeout(60000) });
if (!r.ok) throw new Error("Planilha respondeu " + r.status);
const d = await r.json();
if (!Array.isArray(d.cardapio) || !d.sobre) throw new Error("Resposta da planilha sem dados");

const cardapio = d.cardapio
  .filter((l) => String(l.nome || "").trim())
  .map((l, i) => ({
    ordem: i + 1,
    secao: String(l.secao || "").trim() || "Outros",
    nome: String(l.nome).trim(),
    opcao: String(l.opcao || "").trim(),
    descricao: String(l.descricao || "").trim(),
    preco: lerPreco(l.preco, `${l.secao} › ${l.nome} ${l.opcao || ""}`.trim()),
    em_falta: l.em_falta === true,
  }));
const horarios = (d.horarios || []).map((h, i) => ({ ordem: i + 1, dia: h.dia || "", horario: h.horario || "", obs: h.obs || "" }));
const fotos = (d.fotos || []).filter((f) => f.foto).map((f, i) => ({ ordem: i + 1, foto: f.foto, legenda: f.legenda || "" }));
const sobre = Object.entries(d.sobre).map(([chave, valor]) => ({ chave, valor: String(valor ?? "") }));

const jaTem = await rest("cardapio?select=id&limit=1");
if (jaTem.length && !substituir) {
  console.log("O banco já tem cardápio. Pra copiar de novo por cima: --substituir");
  process.exit(1);
}

await rest("cardapio?id=gt.0", { method: "DELETE" });
await rest("horarios?ordem=gte.0", { method: "DELETE" });
await rest("fotos?ordem=gte.0", { method: "DELETE" });
await rest("sobre?chave=neq.__nenhuma__", { method: "DELETE" });
await rest("cardapio", { method: "POST", body: JSON.stringify(cardapio) });
if (horarios.length) await rest("horarios", { method: "POST", body: JSON.stringify(horarios) });
if (fotos.length) await rest("fotos", { method: "POST", body: JSON.stringify(fotos) });
if (sobre.length) await rest("sobre", { method: "POST", body: JSON.stringify(sobre) });

// Confere: o que o site vai ler do banco tem que bater com a planilha
const site = await rest("rpc/site", { method: "POST", body: "{}", headers: { Prefer: "" } });
const chaveDe = (l) => [l.secao, l.nome, l.opcao, l.descricao, lerPreco(l.preco, l.nome), !!l.em_falta].join("|");
const antes = cardapio.map((l) => chaveDe({ ...l, preco: l.preco == null ? "" : String(l.preco) }));
const depois = site.cardapio.map(chaveDe);
const diferentes = antes.filter((x, i) => x !== depois[i]);
console.log(
  `Copiados: ${cardapio.length} linhas do cardápio, ${horarios.length} horários, ${fotos.length} fotos, ${sobre.length} infos.`
);
if (diferentes.length || antes.length !== depois.length) {
  console.error("ATENÇÃO: o banco ficou diferente da planilha em", diferentes.length, "linhas:", diferentes.slice(0, 5));
  process.exit(1);
}
console.log("Conferido: o banco bate com a planilha, linha por linha.");

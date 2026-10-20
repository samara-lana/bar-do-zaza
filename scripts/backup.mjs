// Cópia de segurança do banco inteiro (cardápio, horários, fotos, sobre,
// comandas, lançamentos e pagamentos, inclusive os removidos) num arquivo JSON.
// O plano gratuito do Supabase não faz backup sozinho.
//
// Uso: node scripts/backup.mjs   -> backups/zaza-AAAA-MM-DD-HHhMM.json (fora do git)
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { SUPABASE_URL: U, SUPABASE_SERVICE_ROLE_KEY: S } = process.env;
if (!U || !S) throw new Error("Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
const destino = process.argv[2] || "backups";

async function tudo(tabela, ordem) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const r = await fetch(`${U}/rest/v1/${tabela}?select=*&order=${ordem}`, {
      headers: { apikey: S, Authorization: `Bearer ${S}`, Range: `${de}-${de + 999}` },
    });
    if (!r.ok) throw new Error(`${tabela}: ${r.status} ${await r.text()}`);
    const parte = await r.json();
    linhas.push(...parte);
    if (parte.length < 1000) return linhas;
  }
}

const copia = {
  feito_em: new Date().toISOString(),
  cardapio: await tudo("cardapio", "ordem"),
  horarios: await tudo("horarios", "ordem"),
  fotos: await tudo("fotos", "ordem"),
  sobre: await tudo("sobre", "chave"),
  comandas: await tudo("comandas", "aberta"),
  lancamentos: await tudo("lancamentos", "comanda_id,ordem"),
  pagamentos: await tudo("pagamentos", "comanda_id,hora"),
};
const agora = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(" ", "-").replace(/:(\d\d):\d\d$/, "h$1");
mkdirSync(destino, { recursive: true });
const arquivo = `${destino}/zaza-${agora}.json`;
writeFileSync(arquivo, JSON.stringify(copia));
console.log(
  `${arquivo}: ${copia.cardapio.length} itens do cardápio, ${copia.comandas.length} comandas, ${copia.lancamentos.length} lançamentos`
);

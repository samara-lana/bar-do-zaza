// Baixa o conteúdo da planilha e grava em assets/dados-planilha.js, que o site
// usa quando a planilha demora a responder. Só regrava se algo mudou de fato
// (o campo `atualizado` muda a toda leitura e não conta).
// Uso: node .github/scripts/dados-planilha.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ARQUIVO = "assets/dados-planilha.js";
const PREFIXO = "window.DADOS_PLANILHA = ";

const config = readFileSync("assets/config.js", "utf8");
const url = (config.match(/https:\/\/script\.google\.com\/[^"']+/) || [])[0];
if (!url) throw new Error("URL do Apps Script não encontrada em assets/config.js");

async function baixar() {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= 4; tentativa++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const json = await r.json();
      if (!json || !Array.isArray(json.cardapio) || !json.sobre) throw new Error("resposta sem dados");
      return json;
    } catch (e) {
      ultimoErro = e;
      console.warn(`tentativa ${tentativa} falhou: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 10000));
    }
  }
  throw ultimoErro;
}

function semData(d) {
  const { atualizado, ...resto } = d || {};
  return JSON.stringify(resto);
}

const novo = await baixar();
let antigo = null;
if (existsSync(ARQUIVO)) {
  const linha = readFileSync(ARQUIVO, "utf8").split("\n").find((l) => l.startsWith(PREFIXO));
  if (linha) antigo = JSON.parse(linha.slice(PREFIXO.length).replace(/;\s*$/, ""));
}

if (antigo && semData(antigo) === semData(novo)) {
  console.log("Planilha sem mudanças.");
} else {
  writeFileSync(
    ARQUIVO,
    "// GERADO pela Action \"Cópia da planilha\" (.github/workflows/dados-planilha.yml): não edite.\n" +
      PREFIXO + JSON.stringify(novo) + ";\n"
  );
  console.log("Cópia atualizada.");
}

// Cria (ou troca a senha de) o usuário do admin, sem a senha passar por chat
// nem ficar no histórico do terminal: ela é digitada aqui e não aparece na tela.
// O e-mail é o de assets/config.js (ADMIN_EMAIL).
//
// Rodar num PowerShell aberto na pasta do projeto:
//   node scripts/criar-admin.mjs
import { readFileSync } from "node:fs";

process.loadEnvFile(".env.local");
const { SUPABASE_URL: U, SUPABASE_SERVICE_ROLE_KEY: S } = process.env;
const svc = { apikey: S, Authorization: `Bearer ${S}`, "Content-Type": "application/json" };
const email = (readFileSync("assets/config.js", "utf8").match(/ADMIN_EMAIL = "([^"]+)"/) || [])[1];
if (!email) throw new Error("ADMIN_EMAIL não encontrado em assets/config.js");
if (!process.stdin.isTTY) {
  console.error("Rode num PowerShell de verdade (a senha é digitada sem aparecer na tela).");
  process.exit(1);
}

/** Lê uma linha sem mostrar o que é digitado. */
function perguntarEscondido(texto) {
  return new Promise((ok) => {
    process.stdout.write(texto);
    let s = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const tecla = (c) => {
      if (c === "\r" || c === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", tecla);
        process.stdout.write("\n");
        ok(s);
      } else if (c === "\u0003") process.exit(1);
      else if (c === "\u007f" || c === "\b") s = s.slice(0, -1);
      else s += c;
    };
    process.stdin.on("data", tecla);
  });
}

console.log(`Usuário do admin: ${email}`);
const senha = await perguntarEscondido("Senha do Zazá (mínimo 6 caracteres): ");
if (senha.trim().length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
if ((await perguntarEscondido("Repita a senha: ")) !== senha) throw new Error("As senhas não batem. Nada foi feito.");

const lista = await (await fetch(`${U}/auth/v1/admin/users?per_page=200`, { headers: svc })).json();
let user = (lista.users || []).find((u) => u.email === email.toLowerCase());
if (user) {
  const r = await fetch(`${U}/auth/v1/admin/users/${user.id}`, { method: "PUT", headers: svc, body: JSON.stringify({ password: senha }) });
  if (!r.ok) throw new Error("Não consegui trocar a senha: " + (await r.text()));
  console.log("Usuário já existia: senha trocada.");
} else {
  const r = await fetch(`${U}/auth/v1/admin/users`, { method: "POST", headers: svc, body: JSON.stringify({ email, password: senha, email_confirm: true }) });
  user = await r.json();
  if (!r.ok || !user.id) throw new Error("Não consegui criar o usuário: " + JSON.stringify(user));
  console.log("Usuário criado.");
}
const a = await fetch(`${U}/rest/v1/admins`, { method: "POST", headers: { ...svc, Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ user_id: user.id }) });
if (!a.ok) throw new Error("Usuário criado, mas não consegui dar a permissão de admin: " + (await a.text()));
console.log("Pronto: ele já pode entrar no admin com essa senha.");

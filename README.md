# Bar do Zazá

Site do Bar do Zazá (Contagem/MG): cardápio, horário de funcionamento, localização e um convite pra avaliar no Google.

É um site estático (HTML, CSS e JS puros, sem build), publicado pelo GitHub Pages. O conteúdo e as comandas ficam num **banco Supabase** (projeto `bar-do-zaza`, conta da Samara, plano gratuito). Até outubro/2026 ficavam numa planilha do Google; ela continua lá como arquivo, mas ninguém escreve mais nela.

## Como editar o cardápio

**Pelo celular:** abra `/admin/` no site (https://samara-lana.github.io/bar-do-zaza/admin/) e entre com a senha. Dá pra marcar item em falta, editar nome/descrição/preços, criar e excluir itens e seções. No celular, use "Adicionar à tela inicial" pra abrir como app. A mudança aparece no site na hora.

**Comandas:** a aba Comandas do admin substitui o caderninho. Escreva o nome do cliente (nomes já usados aparecem pra tocar), toque nos itens pra lançar (+1) e feche a conta:

- **Recebido**: pagou tudo.
- **Pagou uma parte**: digita quanto pagou; o que falta fica no fiado. Dá pra pagar em quantas partes quiser, e a conta mostra cada pagamento com a data.
- **Pendurar tudo no fiado**.
- **Dar desconto**: em reais (`5`) ou em porcentagem (`10%`). `0` tira o desconto.
- **Preço combinado** (ex.: o conhaque mais barato pro Zói): dentro da comanda, toque no nome do item no "Consumido" e mude o preço. O `+` daquela linha lança mais um com o mesmo preço; o preço do cardápio fica guardado junto.

As comandas ficam salvas no próprio celular e funcionam sem internet; cada mudança vai pro banco logo em seguida. Se alguma coisa ficar mais de 2 minutos sem chegar no banco, aparece uma **faixa vermelha** em todas as telas (o que foi lançado continua salvo no celular).

**Vendas:** escolha o período (hoje, ontem, 7 dias, este mês, mês passado ou datas). **Vendas** = dinheiro recebido no período: conta paga entra no dia em que foi paga, e fiado entra no dia em que for pago (cada parte no seu dia). **Fiado em aberto** = quem deve agora. Depois vêm as vendas por dia, os mais vendidos e as comandas pagas no período. Períodos com mais de 45 dias são calculados com o histórico do banco (precisa de internet). Pra lista de quem deve: **Copiar lista do fiado** (cola no WhatsApp), **Baixar planilha** (CSV que abre no Excel/Google Planilhas) e, no celular, **Compartilhar**.

**Bar (informações e horários):** no topo fica o **Aviso no site**, que é o jeito de avisar um dia diferente (ex.: "Fechado no feriado de 15/11") sem mexer no horário da semana. Embaixo, três gavetas fechadas: **Horários da semana** (mostra o resumo; toque pra editar. Com pausa: `11h às 14h; 16h às 23h`; dia que nunca abre: `Fechado`), **Informações do bar** (endereço, WhatsApp, links) e **Refeições**. Embaixo de cada horário aparece como o site vai entender; horário que o site não entende não deixa salvar. Toque em **Salvar** e já aparece no site.

**Fotos:** a aba **Fotos** envia fotos do celular pra galeria do site (**+ Adicionar fotos**, dá pra escolher várias). O app diminui cada foto antes de enviar (uma foto de 7 MB vira uns 350 KB). Dá pra pôr legenda, mudar a ordem (↑ ↓) e tirar (o arquivo é apagado). Sem nenhuma foto, a galeria não aparece no site.

**Como app no celular (Android):** abra o admin no Chrome e toque em **Instalar app** (no topo) ou, no menu ⋮ do Chrome, em **Instalar app / Adicionar à tela inicial**. O ícone do Zazá fica junto dos outros apps, abre em tela cheia e funciona mesmo sem internet (as telas ficam guardadas no celular).

**Preço:** só o número (`23`, `7,50`). Preço que não é número é recusado na hora de salvar (nunca vira um valor errado calado). Vazio aparece como "consulte" no site e pergunta o preço na hora de lançar.

**Trocar a senha do admin:** no painel do Supabase, Authentication → Users → `zaza@bar-do-zaza.app` → Reset password / editar. Quem estiver logado continua até sair.

## Onde ficam os dados (Supabase)

Painel: https://supabase.com/dashboard/project/jezxejsellwjyxunsxfn. Em **Table editor** dá pra conferir tudo; `comandas_resumo` mostra, por comanda, itens, desconto, quanto já foi pago e quantos pagamentos.

| Tabela        | O que guarda                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `cardapio`    | Uma linha por preço (`secao`, `nome`, `opcao`, `descricao`, `preco`, `em_falta`), na ordem de `ordem`. |
| `horarios`    | Um dia por linha. `horario` tipo `12h às 23h`; com pausa, `12h às 14h; 16h às 23h`; ou `Fechado`.  |
| `fotos`       | Galeria do site (`foto` = link; as enviadas pelo admin ficam no Storage, bucket `fotos`; `legenda`). |
| `sobre`       | Endereço, telefone, links (Maps, avaliação, iFood, Instagram) e frases do site (`chave` / `valor`). |
| `comandas`    | Uma linha por comanda (cliente, status, aberta/fechada).                                           |
| `lancamentos` | **Um registro por item lançado**, com o preço do momento. Item tirado não é apagado: ganha `removido_em`. |
| `pagamentos`  | **Um registro por dinheiro recebido** (pode ser parte da conta). Pagamento desfeito não é apagado: ganha `removido_em`. |
| `admins`      | Quem pode usar o admin (o usuário do Zazá).                                                        |

Tudo isso se edita pelo admin (abas Cardápio, Bar e Fotos); o painel do Supabase fica pra conferência e emergência.

Segurança: as tabelas ficam fechadas (RLS). O site público só consegue chamar `site()`, que devolve o cardápio; tudo o mais exige o login de um usuário que esteja em `admins`. A chave em `assets/config.js` é a pública ("anon"); a `service_role` fica só no `.env.local` (fora do git) e nos segredos do GitHub.

**Backup:** o plano gratuito não faz backup. A Action "Backup do banco" tira uma cópia criptografada todo dia às 5h (artefato, 90 dias). Na mão: `node scripts/backup.mjs` (vai pra `backups/`, fora do git).

**Pausa do plano gratuito:** projeto sem uso por 7 dias é pausado. A Action "Cópia do cardápio" lê o banco a cada 15 minutos, o que já o mantém acordado. Se pausar mesmo assim, é só entrar no painel e clicar em "Restore".

Se o banco demorar ou sair do ar, o site mostra a última versão que aquele celular carregou ou a cópia que o GitHub tira a cada 15 minutos (`assets/dados-planilha.js`), a que for mais nova. Sem nenhuma das duas, usa `assets/dados-padrao.js`.

## Estrutura

```
index.html               página
assets/style.css         visual
assets/app.js            monta o cardápio, horário e "aberto agora"
assets/config.js         endereço e chave pública do Supabase, e-mail do admin
assets/dados-padrao.js   conteúdo padrão (último recurso, se não houver cópia)
assets/dados-planilha.js cópia do banco, GERADA a cada 15 minutos pela Action (não edite)
admin/                   área de edição e comandas pelo celular (sw.js = funciona offline / instalável)
fotos/                   fotos servidas pelo próprio site
supabase/migrations/     tabelas, regras e funções do banco
scripts/                 importar da planilha (cardápio e comandas) e backup (rodam no computador, com o .env.local)
.github/                 Actions "Cópia do cardápio" e "Backup do banco"
apps-script/             código antigo da planilha (aposentado, fica de referência)
```

## Banco: mudanças na estrutura

As mudanças de tabela e função ficam em `supabase/migrations/` e sobem com o CLI (precisa do login: `npx supabase login` num terminal):

```bash
npx supabase migration new nome-da-mudanca   # cria o arquivo .sql
npx supabase db push                          # aplica no banco (pede a senha do banco, que está no .env.local)
```

`.env.local` (fora do git) tem `SUPABASE_DB_PASSWORD`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`.

## Rodar localmente

```bash
python -m http.server 8000
```

E abra http://localhost:8000 (o admin em http://localhost:8000/admin/). Atenção: local fala com o **mesmo banco** do site no ar.

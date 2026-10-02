# Bar do Zazá

Site do Bar do Zazá (Contagem/MG): cardápio, horário de funcionamento, localização e um convite pra avaliar no Google.

É um site estático (HTML, CSS e JS puros, sem build), publicado pelo GitHub Pages. O conteúdo vem de uma **planilha do Google**, então dá pra mudar preço, prato e horário sem mexer no código.

## Como editar o cardápio

**Pelo celular:** abra `/admin/` no site (https://samara-lana.github.io/bar-do-zaza/admin/) e entre com a senha. Dá pra marcar item em falta, editar nome/descrição/preços, criar e excluir itens e seções. No celular, use "Adicionar à tela inicial" pra abrir como app. A senha fica só no Google (hash nas Propriedades do script); pra trocar, use o menu **Site do Zazá → Trocar senha do admin** na planilha.

**Comandas:** a aba Comandas do admin substitui o caderninho. Escreva o nome do cliente (nomes já usados aparecem pra tocar), toque nos itens pra lançar (+1), feche a conta como "Recebido" ou "Pendurar no fiado". As comandas ficam salvas no próprio celular e funcionam sem internet; uma cópia vai pra aba `Comandas` da planilha (não edite essa aba à mão). A aba Vendas mostra o recebido por dia, semana e mês e o fiado em aberto.

**Pela planilha:** abra a planilha **"Bar do Zazá · site"** no Google Drive e edite. A mudança aparece no site em segundos (é só recarregar a página).

| Aba        | O que controla                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| `Cardapio` | Os itens. Colunas `secao`, `nome`, `opcao`, `descricao`, `preco`, `em_falta`.                        |
| `Fotos`    | Galeria do site. `foto` = link (Google Drive compartilhado serve) ou arquivo da pasta `fotos/`; `legenda` opcional. |
| `Horarios` | Um dia por linha. `horario` tipo `12h às 23h`; com pausa, `12h às 14h; 16h às 23h`; ou `Fechado`. `obs` é opcional. |
| `Sobre`    | Endereço, telefone, links (Maps, avaliação, iFood, Instagram) e frases do site. Edite só a coluna `valor`. |

Dicas:

- **Preço**: só o número (`23`, `7,50`). Vazio aparece como "consulte".
- **Variações** (com batata, meia porção, latão…): repita o `nome` em outra linha da mesma seção e escreva a variação em `opcao`. No site vira um item só. A linha sem `opcao` é o preço principal.
- **Em falta**: marque a caixa `em_falta`. O item continua no site, apagado e com o selo "em falta". Desmarque quando voltar.
- **Seções** aparecem no site na ordem em que surgem na planilha. Pra criar uma seção nova, escreva um nome novo na coluna `secao`.
- **Esconder um item** sem perder a linha: apague o `nome`.
- **iFood / Instagram**: preencha na aba `Sobre` e o botão aparece sozinho.
- Não renomeie as abas nem os cabeçalhos. Se apagar uma aba sem querer, use o menu **Site do Zazá → Criar abas que estiverem faltando** (ela volta com o conteúdo padrão).
- Se a planilha demorar ou sair do ar, o site mostra a última versão que aquele celular carregou ou a cópia que o GitHub tira da planilha a cada 15 minutos (`assets/dados-planilha.js`), a que for mais nova. Sem nenhuma das duas, usa `assets/dados-padrao.js`.

## Estrutura

```
index.html              página
assets/style.css        visual
assets/app.js           monta o cardápio, horário e "aberto agora"
assets/config.js        URL do Web App da planilha
assets/dados-padrao.js  conteúdo padrão (último recurso, se não houver cópia da planilha)
assets/dados-planilha.js cópia da planilha, GERADA a cada 15 minutos pela Action (não edite)
.github/               Action "Cópia da planilha" (rodar na hora: aba Actions → Run workflow)
admin/                  área de edição pelo celular (fala com o Apps Script)
fotos/                  fotos servidas pelo próprio site
apps-script/            código da planilha (Google Apps Script, enviado com clasp)
```

## Apps Script (clasp)

O código em `apps-script/` vive dentro da planilha e devolve o conteúdo em JSON para o site.

```bash
npm i -g @google/clasp
clasp login
cd apps-script
clasp push                                   # envia o código
clasp deploy -i <ID_DA_IMPLANTACAO> -d "v2"  # publica mantendo a mesma URL
```

O ID da implantação atual é `AKfycbyP2LieKMcs6IxjsrjQMBC4_8MsN6k9wWQcrQSIWD8ImnZxF3ta2PS_GqQtxoY0U3St` (ou veja em `clasp deployments`). A URL `/exec` fica em `assets/config.js`.

`apps-script/Padrao.js` é gerado a partir de `assets/dados-padrao.js` e só serve para preencher abas novas. Se mudar o padrão, gere de novo:

```bash
{ echo "// GERADO a partir de assets/dados-padrao.js: não edite aqui."; sed -n '/^window.DADOS_PADRAO/,$p' assets/dados-padrao.js | sed 's/^window.DADOS_PADRAO =/var DADOS_PADRAO =/'; } > apps-script/Padrao.js
```

## Rodar localmente

```bash
python -m http.server 8000
```

E abra http://localhost:8000.

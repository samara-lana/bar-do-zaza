# Bar do Zazá

Site do Bar do Zazá (Contagem/MG): cardápio, horário de funcionamento, localização e um convite pra avaliar no Google.

É um site estático (HTML, CSS e JS puros, sem build), publicado pelo GitHub Pages. O conteúdo vem de uma **planilha do Google**, então dá pra mudar preço, prato e horário sem mexer no código.

## Como editar o cardápio

Abra a planilha **"Bar do Zazá · site"** no Google Drive e edite. A mudança aparece no site em segundos (é só recarregar a página).

| Aba        | O que controla                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| `Cardapio` | Os itens. Colunas `secao`, `nome`, `opcao`, `descricao`, `preco`, `em_falta`.                        |
| `Horarios` | Um dia por linha. `horario` tipo `12h às 23h`, ou `Fechado`. `obs` é opcional.                       |
| `Sobre`    | Endereço, telefone, links (Maps, avaliação, iFood, Instagram) e frases do site. Edite só a coluna `valor`. |

Dicas:

- **Preço**: só o número (`23`, `7,50`). Vazio aparece como "consulte".
- **Variações** (com batata, meia porção, latão…): repita o `nome` em outra linha da mesma seção e escreva a variação em `opcao`. No site vira um item só. A linha sem `opcao` é o preço principal.
- **Em falta**: marque a caixa `em_falta`. O item continua no site, apagado e com o selo "em falta". Desmarque quando voltar.
- **Seções** aparecem no site na ordem em que surgem na planilha. Pra criar uma seção nova, escreva um nome novo na coluna `secao`.
- **Esconder um item** sem perder a linha: apague o `nome`.
- **iFood / Instagram**: preencha na aba `Sobre` e o botão aparece sozinho.
- Não renomeie as abas nem os cabeçalhos. Se apagar uma aba sem querer, use o menu **Site do Zazá → Criar abas que estiverem faltando** (ela volta com o conteúdo padrão).
- Se a planilha sair do ar, o site continua funcionando com a última versão que carregou (ou com `assets/dados-padrao.js`).

## Estrutura

```
index.html              página
assets/style.css        visual
assets/app.js           monta o cardápio, horário e "aberto agora"
assets/config.js        URL do Web App da planilha
assets/dados-padrao.js  conteúdo padrão (usado enquanto a planilha não responde)
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

O ID da implantação está em `clasp deployments`. A URL `/exec` fica em `assets/config.js`.

`apps-script/Padrao.js` é gerado a partir de `assets/dados-padrao.js` e só serve para preencher abas novas. Se mudar o padrão, gere de novo:

```bash
{ echo "// GERADO a partir de assets/dados-padrao.js: não edite aqui."; sed -n '/^window.DADOS_PADRAO/,$p' assets/dados-padrao.js | sed 's/^window.DADOS_PADRAO =/var DADOS_PADRAO =/'; } > apps-script/Padrao.js
```

## Rodar localmente

```bash
python -m http.server 8000
```

E abra http://localhost:8000.

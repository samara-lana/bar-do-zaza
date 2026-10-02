/**
 * Conteúdo padrão do site.
 *
 * É o que aparece enquanto a planilha não responde (ou se ela estiver fora do
 * ar). Quando a planilha carrega, ela substitui tudo isto. Para mudar o
 * cardápio no dia a dia, edite a PLANILHA, não este arquivo.
 *
 * Linhas com a mesma `secao` + `nome` viram um item só no site: a linha sem
 * `opcao` é o preço principal e as outras aparecem como variações
 * ("Com batata frita", "Latão"...).
 *
 * Mesma estrutura que o Apps Script devolve (apps-script/Code.js).
 */
window.DADOS_PADRAO = {
  sobre: {
    nome: "Bar do Zazá",
    endereco: "Rua Vista Alegre, 595 · Vila Belém · Contagem/MG",
    whatsapp: "(31) 99540-8146",
    maps: "https://maps.app.goo.gl/gTWJhmhasQZLFybF7",
    avaliar: "https://search.google.com/local/writereview?placeid=ChIJI2dlEI3rpgARwIliNaXXrlI",
    aviso_horario: "A hora de fechar varia: normalmente por volta das 23h.",
    refeicoes_texto:
      "O almoço e a janta são da Kaká Comida Caseira, servidos aqui no bar e também no iFood.",
    ifood: "",
    instagram: "",
  },
  horarios: [
    { dia: "Segunda", horario: "Fechado", obs: "" },
    { dia: "Terça", horario: "12h às 23h", obs: "" },
    { dia: "Quarta", horario: "12h às 23h", obs: "" },
    { dia: "Quinta", horario: "12h às 23h", obs: "" },
    { dia: "Sexta", horario: "12h às 23h", obs: "" },
    { dia: "Sábado", horario: "12h às 23h", obs: "" },
    { dia: "Domingo", horario: "12h às 23h", obs: "" },
  ],
  // `foto`: caminho de um arquivo da pasta fotos/ ou link (Google Drive compartilhado também serve)
  fotos: [{ foto: "fotos/almondegas.jpg", legenda: "Almôndegas" }],
  // prettier-ignore
  cardapio: [
    { secao: "Porções", nome: "Filé de tilápia", opcao: "", descricao: "", preco: "50" },
    { secao: "Porções", nome: "Filé de tilápia", opcao: "Com batata frita", descricao: "", preco: "60" },
    { secao: "Porções", nome: "Contrafilé", opcao: "", descricao: "", preco: "50" },
    { secao: "Porções", nome: "Contrafilé", opcao: "Com batata frita", descricao: "", preco: "60" },
    { secao: "Porções", nome: "Torresmo", opcao: "", descricao: "", preco: "20" },
    { secao: "Porções", nome: "Torresmo", opcao: "Com batata frita", descricao: "", preco: "35" },
    { secao: "Porções", nome: "Pernil", opcao: "Acebolado", descricao: "", preco: "35" },
    { secao: "Porções", nome: "Pernil", opcao: "Com batata frita", descricao: "", preco: "45" },
    { secao: "Porções", nome: "Batata frita", opcao: "", descricao: "", preco: "20" },
    { secao: "Porções", nome: "Batata frita", opcao: "Com queijo e bacon", descricao: "", preco: "25" },
    { secao: "Porções", nome: "Fígado de boi acebolado", opcao: "", descricao: "", preco: "20" },
    { secao: "Porções", nome: "Linguiça caseira", opcao: "", descricao: "", preco: "30" },

    { secao: "Meia porção", nome: "Filé de tilápia", opcao: "", descricao: "", preco: "30" },
    { secao: "Meia porção", nome: "Torresmo", opcao: "", descricao: "", preco: "10" },

    { secao: "Tira-gosto", nome: "Bife de filé de tilápia", opcao: "", descricao: "", preco: "12" },
    { secao: "Tira-gosto", nome: "Carne cozida", opcao: "", descricao: "", preco: "10" },
    { secao: "Tira-gosto", nome: "Língua de boi", opcao: "", descricao: "", preco: "8" },
    { secao: "Tira-gosto", nome: "Almôndegas", opcao: "", descricao: "", preco: "7" },
    { secao: "Tira-gosto", nome: "Jiló recheado", opcao: "", descricao: "Com bacon e linguiça calabresa", preco: "6" },
    { secao: "Tira-gosto", nome: "Frango frito", opcao: "", descricao: "", preco: "6" },
    { secao: "Tira-gosto", nome: "Pé de porco", opcao: "", descricao: "", preco: "6" },
    { secao: "Tira-gosto", nome: "Linguiça", opcao: "", descricao: "", preco: "6" },

    { secao: "Refeições", nome: "Filé de tilápia", opcao: "", descricao: "Purê de batata, arroz, feijão e salada", preco: "23" },
    { secao: "Refeições", nome: "Bife de boi acebolado", opcao: "", descricao: "Batata frita, arroz, feijão e salada", preco: "23" },
    { secao: "Refeições", nome: "Fígado de boi", opcao: "", descricao: "Batata frita, arroz, feijão e salada", preco: "22" },
    { secao: "Refeições", nome: "Macarrão à bolonhesa", opcao: "", descricao: "Molho de carne moída e queijo", preco: "22" },

    { secao: "Caldos", nome: "Caldo de mandioca", opcao: "", descricao: "Com carne, linguiça, bacon e torresmo", preco: "" },
    { secao: "Caldos", nome: "Dobradinha", opcao: "", descricao: "", preco: "" },

    { secao: "Cervejas", nome: "Heineken", opcao: "600 ml", descricao: "", preco: "15" },
    { secao: "Cervejas", nome: "Heineken", opcao: "Latão", descricao: "", preco: "9" },
    { secao: "Cervejas", nome: "Spaten", opcao: "600 ml", descricao: "", preco: "13" },
    { secao: "Cervejas", nome: "Original", opcao: "600 ml", descricao: "", preco: "12" },
    { secao: "Cervejas", nome: "Original", opcao: "Latão", descricao: "", preco: "8" },
    { secao: "Cervejas", nome: "Original", opcao: "Litrinho", descricao: "", preco: "6" },
    { secao: "Cervejas", nome: "Brahma", opcao: "600 ml", descricao: "", preco: "11" },
    { secao: "Cervejas", nome: "Brahma", opcao: "Latão", descricao: "", preco: "7" },
    { secao: "Cervejas", nome: "Brahma", opcao: "Litrinho", descricao: "", preco: "5" },
    { secao: "Cervejas", nome: "Amstel", opcao: "600 ml", descricao: "", preco: "11" },
    { secao: "Cervejas", nome: "Kaiser", opcao: "Latão", descricao: "", preco: "6" },

    { secao: "Drinks", nome: "Caipivodka", opcao: "", descricao: "", preco: "12" },
    { secao: "Drinks", nome: "Caipirinha", opcao: "", descricao: "", preco: "10" },
    { secao: "Drinks", nome: "Copão de whisky", opcao: "Cavalo Branco ou Red Label", descricao: "Com gelinho e energético", preco: "22" },
    { secao: "Drinks", nome: "Copão de whisky", opcao: "Chanceler", descricao: "", preco: "15" },

    { secao: "Destilados", nome: "Whisky", opcao: "Red Label", descricao: "", preco: "18" },
    { secao: "Destilados", nome: "Whisky", opcao: "Cavalo Branco", descricao: "", preco: "16" },
    { secao: "Destilados", nome: "Pinga", opcao: "Seleta", descricao: "", preco: "7" },
    { secao: "Destilados", nome: "Pinga", opcao: "Da Rosa", descricao: "", preco: "4" },
    { secao: "Destilados", nome: "Campari", opcao: "", descricao: "", preco: "12" },
    { secao: "Destilados", nome: "Vodka", opcao: "", descricao: "", preco: "8" },
    { secao: "Destilados", nome: "Jurubeba", opcao: "", descricao: "", preco: "5" },
    { secao: "Destilados", nome: "Conhaque", opcao: "", descricao: "", preco: "4" },
    { secao: "Destilados", nome: "Paratudo", opcao: "", descricao: "", preco: "4" },
    { secao: "Destilados", nome: "Selvagem", opcao: "", descricao: "", preco: "4" },
    { secao: "Destilados", nome: "Vinho", opcao: "", descricao: "", preco: "4" },
  ],
};

# Conciliação Bancária + Baixa de Parcelas no ERP M8

Minisistema em **Next.js + TypeScript** para importar extratos CSV (Viacredi) e XLS/XLSX (Sicredi), mapear layouts diferentes por banco, localizar Contas a Pagar/Parcelas no ERP M8 e executar a baixa após revisão.

## Fluxo implementado

1. **ETAPA 1 — Autenticação:** `POST /v1/auth/token`
2. **ETAPA 2 — Contas a Pagar:** `GET /v1/financeiro/contapagar`
3. **ETAPA 3 — Parcelas:** `GET /v1/financeiro/contapagar/{tituloId}/parcela`
4. **Revisão da conciliação:** nenhuma baixa é feita automaticamente na importação.
5. **ETAPA 4 — Baixa:** `POST /v1/financeiro/contapagar/{tituloId}/baixa/parcela/{tituloParcelaId}`

## Segurança

Credenciais e token M8 ficam somente no servidor. **Nunca coloque a senha no código do frontend ou em arquivos commitados no GitHub.**

Copie `.env.example` para `.env.local`:

```bash
cp .env.example .env.local
```

Preencha:

```env
M8_BASE_URL=https://api.integra.m8sistemas.com.br
M8_TENANT=rjcompressores
M8_USERNAME=api.rj
M8_PASSWORD=SUA_SENHA
M8_DOMAIN=app.erpm8.cloud
```

> Como uma credencial foi compartilhada anteriormente em texto, é recomendável rotacionar a senha antes de colocar o sistema em produção.

## Instalação

Requer Node.js 18.17+ (recomendado Node 20 LTS).

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Layouts de bancos

Os bancos e seus layouts são definidos em `data/bancos.json`. Nome, primeira linha de dados e mapeamento das colunas são somente leitura na interface. Para cadastrar um banco ou alterar um layout, edite esse arquivo e publique a aplicação novamente.

O **Viacredi** é selecionado por padrão. A linha 1 contém o cabeçalho; os dados começam na **linha 2**, com as colunas identificadas pela posição, independentemente do texto do cabeçalho:

1. Data do pagamento
2. Cliente / Fornecedor
3. Documento
4. Valor pago
5. Tipo (`D` = débito; `C` = crédito)

O layout não possui data de vencimento. O campo Tipo é independente da data de vencimento. Linhas vazias são ignoradas, preservando a numeração original do arquivo.

### Sicredi — XLS/XLSX

Selecione **Sicredi** antes de escolher o arquivo. A importação lê a primeira aba da planilha e procura a primeira **data válida na coluna 1**. A linha 11 é apenas uma referência do layout: os dados podem começar antes ou depois dela. O aviso de importação informa a linha detectada.

1. Data do pagamento
2. Cliente / Fornecedor
3. Documento
4. Valor pago

Datas podem ser células de data do Excel ou textos `DD/MM/AAAA` / `AAAA-MM-DD`. Linhas sem data válida são ignoradas, preservando a numeração original; o aviso informa quantas linhas não vazias foram ignoradas após o início dos dados. A leitura termina ao encontrar as seções “Saldo da Conta” ou “Lançamentos Futuros”, que não são movimentações efetivadas. Se nenhuma data válida for encontrada, a importação é recusada.

O Tipo é calculado pelo sinal: **positivo = crédito**, **negativo = débito**. Os débitos são convertidos em valores positivos para comparação e baixa no M8; os créditos recebem o status Crédito. Valores inválidos impedem a importação, e valores zerados ficam sinalizados como erro por não permitirem identificar o tipo.

Os padrões do Sicredi são: conta **103066 — Sicredi - RJ**, ID **14700**, Histórico ID **2** e Meio de Pagamento ID **4**. O ID da conta foi confirmado no retorno da API para a empresa 1. Os parâmetros continuam editáveis pela engrenagem do banco. Ao trocar de banco, o extrato anterior é limpo para evitar aplicar outro layout ao mesmo arquivo.

A leitura das planilhas usa [SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/), carregado apenas ao importar XLS/XLSX.

### Padrões M8 do Viacredi

- Conta Contábil: **100038 — ViaCredi Alto Vale - RJ IND.**, ID **1033** (confirmado na API para a empresa 1).
- Histórico ID: **2**
- Meio Pagamento ID: **4**
- Observação interna: **Baixa automática via conciliação bancária**
- Complemento: **Banco Viacredi**

O botão de **engrenagem ao lado do banco selecionado** permite editar esses parâmetros, mesmo antes de importar um CSV. As alterações M8 são salvas somente neste navegador. O layout sempre vem do arquivo; configurações antigas de layout salvas no navegador não são mais carregadas. Na primeira abertura desta versão, os parâmetros M8 partem dos padrões do arquivo.

A seleção inicial segue a ordem **Banco → Arquivo CSV/XLS → Empresa M8**. As empresas disponíveis são **1 - RJ Industria** (padrão), **2 - Serrana** e **27404 - Criciúma**.

### Configuração M8 por banco

Antes de baixar, preencha:

- Conta Contábil ID
- Histórico ID
- Meio de Pagamento ID
- Observação interna
- Complemento

O sistema bloqueia a ETAPA 4 enquanto os três IDs obrigatórios estiverem zerados.

## Juros por item

A coluna **Valor juros (R$)**, entre **Valor do extrato** e **Título M8**, permite informar os juros já incluídos no extrato. O padrão é zero; valores negativos e mais de duas casas decimais não são aceitos.

A conciliação compara **Valor do extrato − Valor juros = Valor da parcela M8**. Exemplo: extrato de R$ 105,00 e juros de R$ 5,00 correspondem a um principal de R$ 100,00. O principal precisa ser maior que zero.

Ao encontrar uma correspondência, os juros ficam travados, inclusive durante a revisão por proximidade de datas. Para corrigir juros de uma linha conciliada, importe o extrato novamente. Créditos e parcelas já baixadas não permitem edição.

Na baixa, o POST envia **valor = principal** e **valorJuros = juros informados**. No exemplo, `valor: 100` e `valorJuros: 5`. O backend confere os juros confirmados na conciliação e a correspondência do principal com a parcela antes de enviar a baixa. O valor original do extrato e sua data de pagamento são preservados.

## Regra de conciliação

Os títulos candidatos continuam sendo localizados pelo fornecedor ou complemento. As parcelas precisam ter o mesmo valor de **Valor do extrato − Valor juros**, com tolerância de R$ 0,01. Para as datas:

1. Vencimento e pagamento iguais: correspondência exata.
2. Vencimento em sábado, domingo ou feriado cadastrado: aceita o pagamento no próximo dia útil.
3. Pagamento posterior ao vencimento, dentro de `toleranciaDiasConciliacao` em `data/bancos.json` (padrão: **5 dias corridos**): **Possível correspondência — revisar**.
4. Pagamento antecipado, datas inválidas ou fora das regras: não encontrado.

Mais de uma parcela compatível, inclusive uma exata e outra próxima, gera **Conflito**. Falha ao consultar qualquer título candidato impede liberar a linha, pois pode esconder outra correspondência. Parcelas já baixadas ou com baixa parcial mantêm seus estados específicos.

Em **Revisar correspondência**, confira fornecedor, documento, título/parcela, valor, vencimento e data do extrato. **Confirmar correspondência** apenas libera a parcela para a etapa de baixa; não envia uma baixa ao ERP. A API exige essa confirmação para datas próximas, vinculada à empresa, banco, parcela, valor e datas revisados. Uma nova conciliação remove a aprovação anterior. Trocar de banco ou empresa limpa o extrato e a revisão anterior.

A baixa mantém a **data real do pagamento no extrato**, inclusive quando o vencimento foi ajustado para um dia útil.

### Calendário por empresa

O arquivo `data/calendarios.json` reúne feriados nacionais, estaduais e locais:

- **1 — RJ Industria:** Rio do Sul/SC.
- **2 — Serrana:** Otacílio Costa/SC.
- **27404 — Criciúma:** Criciúma/SC.

Datas recorrentes usam `MM-DD`; datas móveis ou transferidas usam `AAAA-MM-DD`. O calendário inicial tem referência **2026**: revise as datas móveis e eventuais transferências para outros anos. O feriado de Otacílio Costa observado em 2026 está cadastrado em **11/05**, conforme o calendário do TJSC. Pontos facultativos administrativos não são automaticamente considerados feriados.

Fontes: [calendário nacional de 2026](https://agenciagov.ebc.com.br/noticias/202512/confira-o-calendario-oficial-de-feriados-nacionais-e-pontos-facultativos-em-2026), [decreto estadual de SC](https://leis.alesc.sc.gov.br/ato-normativo/53811), [calendário do TJSC — feriados municipais](https://busca.tjsc.jus.br/dje-consulta/rest/diario/caderno?cdCaderno=4&edicao=4739), [Corpus Christi em Rio do Sul](https://www.riodosul.sc.gov.br/cidadao/noticia/prefeitura-de-rio-do-sul-divulga-funcionamento-dos-servicos-publicos-durante-o-feriado-de-corpus-christi) e [calendário IFSC Criciúma](https://www.ifsc.edu.br/documents/d/campus-criciuma/resolucao_015_2025_-_aprova_o_calendario_academico_2026_assinado-pdf).

Testes locais, com respostas M8 simuladas e sem baixas reais: `node --test tests/*.test.cjs`.

## Status

- Aguardando
- Conciliando
- Pronto para baixa
- Não encontrado
- Conflito
- Possível correspondência — revisar
- Baixando
- Parcela Baixada
- Erro ao Baixar Parcela (com mensagem retornada)

## Observação sobre a data da baixa

A `DATA DO PAGAMENTO` do CSV é enviada no payload da baixa. Nesta versão ela é convertida para `YYYY-MM-DDT12:00:00Z` para evitar mudança de dia por fuso horário. Valide esse comportamento com o ambiente de teste do M8 antes de produção.

## Arquivos principais

- `components/MainApp.tsx` — interface e fluxo da tela
- `components/BankConfigModal.tsx` — cadastro/layout dos bancos
- `lib/csv.ts` — parser e normalização do CSV
- `lib/m8.ts` — cliente da API M8
- `lib/conciliacao.ts` — regras para encontrar título/parcela
- `app/api/m8/conciliar/route.ts` — etapas 1 a 3
- `app/api/m8/baixar/route.ts` — etapa 4

## Antes de produção

Faça primeiro testes com uma empresa/conta M8 de homologação ou com registros controlados. A ETAPA 4 altera dados financeiros reais do ERP.

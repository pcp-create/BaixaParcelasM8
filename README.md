# Conciliação Bancária + Baixa de Parcelas no ERP M8

Minisistema em **Next.js + TypeScript** para importar extratos CSV, mapear layouts diferentes por banco, localizar Contas a Pagar/Parcelas no ERP M8 e executar a baixa após revisão.

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

## Banco Teste

O projeto inclui `public/modelo-banco-teste.csv` com o layout:

- `CLIENTE`
- `DATA VENCIMENTO`
- `DATA DO PAGAMENTO`
- `DOCUMENTO`
- `VALOR`

O cadastro **Banco Teste** já vem mapeado para essas colunas.

## Layouts de bancos

Na tela, clique em **Configurar banco** para apontar qual coluna do CSV representa cada informação interna. O seletor mostra `número da coluna - nome da coluna`.

Os layouts criados/editados são armazenados em `localStorage` do navegador nesta versão. Isso permite começar sem banco de dados. Em uma versão multiusuário, migre essas configurações para Supabase/PostgreSQL.

### Campos do layout

- Cliente / fornecedor
- Data de vencimento
- Data de pagamento
- Documento
- Valor pago

### Configuração M8 por banco

Antes de baixar, preencha:

- Conta Contábil ID
- Histórico ID
- Meio de Pagamento ID
- Observação interna
- Complemento

O sistema bloqueia a ETAPA 4 enquanto os três IDs obrigatórios estiverem zerados.

## Regra de conciliação desta versão

Por segurança, o sistema **não baixa somente por documento**.

1. Localiza títulos cujo `documento` coincide com o CSV.
2. Consulta as parcelas em aberto desses títulos.
3. Exige coincidência de **valor/saldo** e **data de vencimento** quando fornecidos.
4. Se houver uma única parcela possível: `Pronto para baixa`.
5. Nenhuma: `Não encontrado`.
6. Mais de uma: `Conflito`, exigindo revisão.

O nome do cliente/fornecedor é exibido para conferência, mas não elimina automaticamente a correspondência porque descrições bancárias podem ter abreviações diferentes.

## Status

- Aguardando
- Conciliando
- Pronto para baixa
- Não encontrado
- Conflito
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

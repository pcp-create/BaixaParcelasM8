export type IntegrationStatus =
  | "aguardando"
  | "conciliando"
  | "pronto"
  | "baixando"
  | "baixada"
  | "ja_baixada"
  | "parcialmente_baixada"
  | "nao_encontrado"
  | "conflito"
  | "erro";

export type CanonicalField =
  | "cliente"
  | "dataVencimento"
  | "dataPagamento"
  | "documento"
  | "valor";

/* ============================================================
   CONFIGURAÇÃO DE MAPEAMENTO DO BANCO
============================================================ */

export interface BankMapping {
  cliente: string;
  dataVencimento: string;
  dataPagamento: string;
  documento: string;
  valor: string;
}

/* ============================================================
   CONFIGURAÇÃO M8 POR BANCO
============================================================ */

export interface BankM8Config {
  contaContabilId: number;
  historicoId: number;
  meioPagamentoId: number;
  observacaoInterna: string;
  complemento: string;
}

/* ============================================================
   BANCO
============================================================ */

export interface BankConfig {
  id: string;
  nome: string;

  mapping: BankMapping;

  m8: BankM8Config;
}

/* ============================================================
   LINHA NORMALIZADA DO CSV
============================================================ */

export interface NormalizedCsvRow {
  rowId: string;

  numeroLinha: number;

  original: Record<string, string>;

  cliente: string;

  dataVencimento: string;

  dataPagamento: string;

  documento: string;

  valor: number | null;

  status: IntegrationStatus;

  statusMensagem: string;

  tituloId?: number;

  parcelaId?: number;

  fornecedorNome?: string;

  parcelaValor?: number;

  parcelaSaldo?: number;

  apiError?: string;

  /*
   * Payload completo retornado na ETAPA 2.
   */
  tituloM8?: Record<string, any>;

  /*
   * Payload completo da parcela retornado na ETAPA 3.
   */
  parcelaM8?: Record<string, any>;

  /*
   * Retorno da ETAPA 4.
   */
  baixaM8?: Record<string, any>;
}

/* ============================================================
   CONTA A PAGAR M8
============================================================ */

export interface M8ContaPagar {
  id: number;

  empresaId?: number;

  fornecedorId?: number;

  fornecedorNome?: string;

  documento?: string;

  valor?: number;

  saldo?: number;

  status?: string;

  tipoTitulo?: string;

  complemento?: string;

  [key: string]: any;
}

/* ============================================================
   PARCELA M8
============================================================ */

export interface M8Parcela {
  id: number;

  tituloId: number;

  numeroItem?: number;

  vencimento?: string;

  valor?: number;

  saldo?: number;

  pessoaNome?: string;

  favorecidoNome?: string;

  meioPagamentoId?: number;

  meioPagamentoNome?: string;

  complemento?: string;

  [key: string]: any;
}
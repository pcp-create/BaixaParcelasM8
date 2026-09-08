export type IntegrationStatus =
  | "aguardando"
  | "conciliando"
  | "pronto"
  | "baixando"
  | "baixada"
  | "nao_encontrado"
  | "conflito"
  | "erro";

export type CanonicalField =
  | "cliente"
  | "dataVencimento"
  | "dataPagamento"
  | "documento"
  | "valor";

export interface BankMapping {
  cliente: string;
  dataVencimento: string;
  dataPagamento: string;
  documento: string;
  valor: string;
}

export interface BankM8Config {
  contaContabilId: number;
  historicoId: number;
  meioPagamentoId: number;
  observacaoInterna: string;
  complemento: string;
}

export interface BankConfig {
  id: string;
  nome: string;

  mapping: BankMapping;

  m8: BankM8Config;
}

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
   * Payload completo retornado pelo M8.
   * Será usado no modal de detalhes.
   */
  tituloM8?: Record<string, any>;

  parcelaM8?: Record<string, any>;

  /*
   * Resposta completa do endpoint de baixa.
   */
  baixaM8?: Record<string, any>;
}

/* ============================================================
   CONTAS A PAGAR M8
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
   PARCELAS M8
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
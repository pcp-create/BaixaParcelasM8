export type CanonicalField =
  | "cliente"
  | "dataVencimento"
  | "dataPagamento"
  | "documento"
  | "valor";

export type BankMapping = Record<CanonicalField, string>;

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

export type IntegrationStatus =
  | "aguardando"
  | "conciliando"
  | "pronto"
  | "nao_encontrado"
  | "conflito"
  | "baixando"
  | "baixada"
  | "erro";

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
}

export interface M8ContaPagar {
  id: number;
  empresaId?: number;
  fornecedorId?: number;
  fornecedorNome?: string;
  pessoaCompraNome?: string;
  saldo?: number;
  status?: string;
  documento?: string;
  valor?: number;
  [key: string]: unknown;
}

export interface M8Parcela {
  id: number;
  tituloId: number;
  numeroItem?: number;
  vencimento?: string;
  previsaoPagamento?: string;
  valor?: number;
  saldo?: number;
  pessoaNome?: string;
  favorecidoNome?: string;
  [key: string]: unknown;
}

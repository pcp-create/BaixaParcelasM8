export type IntegrationStatus =
  | "aguardando"
  | "conciliando"
  | "pronto"
  | "baixando"
  | "baixada"
  | "ja_baixada"
  | "parcialmente_baixada"
  | "credito"
  | "nao_encontrado"
  | "sugestao"
  | "revisar"
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

/** Colunas numéricas começam em 1; strings identificam cabeçalhos. */
export interface BankMapping {
  cliente: string | number;
  dataVencimento: string | number;
  dataPagamento: string | number;
  documento: string | number;
  valor: string | number;
  tipo?: string | number;
}

/* ============================================================
   CONFIGURAÇÃO M8 POR BANCO
============================================================ */

export interface BankM8Config {
  contaContabilId: number;
  contaContabilNome?: string;
  contaContabilCodigo?: string;
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

  /** Primeira linha de dados no arquivo, contando a partir de 1. */
  linhaInicio: number;
  formato?: string;
  detectarInicioPorData?: boolean;
  tipoPeloSinal?: boolean;
  toleranciaDiasConciliacao?: number;

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
  valorJuros?: number | null;
  jurosConfirmados?: number;
  valorDesconto?: number;
  descontoConfirmado?: number;
  sugestoesValor?: ValueSuggestion[];

  /*
   * Tipo do movimento bancário:
   *
   * D = Débito
   * C = Crédito
   *
   * A coluna é definida no layout do banco; layouts antigos
   * podem usar a detecção pelo cabeçalho "Tipo".
   */
  tipo: string;

  status: IntegrationStatus;

  statusMensagem: string;
  correspondenciaData?: {
    tipo: "exata" | "dia_util" | "proximidade" | "antecipada";
    vencimento: string;
    pagamento: string;
    dias: number;
    motivo: string;
  };
  revisaoData?: { aprovadaEm: string; company: number; bankId: string; tituloId: number; parcelaId: number; vencimento: string; pagamento: string; valor: number };

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

  tituloId?: number;

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

export interface ValueSuggestion {
  titulo: M8ContaPagar;
  parcela: M8Parcela;
  data: NonNullable<NormalizedCsvRow["correspondenciaData"]>;
  principal: number;
  juros: number;
  desconto: number;
}

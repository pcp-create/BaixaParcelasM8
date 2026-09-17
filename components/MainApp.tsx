"use client";

import {
  ChangeEvent,
  Fragment,
  useEffect,
  useMemo,
  useState,
} from "react";

import { BANK_M8_STORAGE_KEY, loadBanks, serializeM8 } from "@/lib/banks";

import {
  BankConfig,
  NormalizedCsvRow,
} from "@/lib/types";

import {
  normalizeRows,
  parseCsv,
} from "@/lib/csv";

import ValueSuggestions from "./ValueSuggestions";
import { selectSuggestionInRows, clearValueSelection } from "@/lib/value-suggestions";

import { amountForMatching } from "@/lib/amount-adjustment";

import StatusBadge from "./StatusBadge";
import BankConfigModal from "./BankConfigModal";


/*
 * Quantidade máxima de retomadas automáticas após a
 * tentativa inicial de conciliação.
 */
const MAX_RETOMADAS_CONCILIACAO =
  3;

const DELAY_RETOMADA_MS =
  1500;

/* ============================================================
   TIPOS
============================================================ */

type ModoConciliacao =
  | "pendentes"
  | "todos";

type SortKey =
  | "numeroLinha"
  | "cliente"
  | "documento"
  | "tipo"
  | "dataPagamento"
  | "valor"
  | "valorJuros"
  | "tituloId"
  | "parcelaId"
  | "status"
  | "statusMensagem";

type SortDirection =
  | "asc"
  | "desc"
  | null;

interface ColumnFilters {
  cliente: string;
  documento: string;
  tipo: string;
  pagamento: string;
  valor: string;
  titulo: string;
  parcela: string;
  status: string;
}

interface ProgressState {
  active: boolean;

  type:
    | "conciliacao"
    | "baixa"
    | "";

  current: number;

  total: number;

  label: string;
}

interface DetailModalState {
  title: string;

  subtitle: string;

  data:
    | Record<string, any>
    | null;
}

/* ============================================================
   CONSTANTES
============================================================ */

const EMPTY_FILTERS: ColumnFilters = {
  cliente: "",
  documento: "",
  tipo: "",
  pagamento: "",
  valor: "",
  titulo: "",
  parcela: "",
  status: "",
};

const INITIAL_PROGRESS: ProgressState = {
  active: false,
  type: "",
  current: 0,
  total: 0,
  label: "",
};

/* ============================================================
   FORMATAÇÃO
============================================================ */

function money(
  v:
    | number
    | null
    | undefined
) {
  if (v == null) {
    return "—";
  }

  return new Intl.NumberFormat(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL",
    }
  ).format(v);
}

function dateBr(v: string) {
  if (!v) {
    return "—";
  }

  const m =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      v
    );

  return m
    ? `${m[3]}/${m[2]}/${m[1]}`
    : v;
}

/* ============================================================
   TIPO DO MOVIMENTO

   C = Crédito
   D = Débito
============================================================ */

function ehCredito(
  tipo: unknown
): boolean {
  return (
    String(tipo ?? "")
      .trim()
      .toUpperCase() === "C"
  );
}

/* ============================================================
   COMPONENTE
============================================================ */

export default function MainApp() {
  /* ==========================================================
     ESTADOS
  ========================================================== */

  const [banks, setBanks] =
    useState<BankConfig[]>(
      () => loadBanks()
    );

  const [dateReviewRow, setDateReviewRow] = useState<NormalizedCsvRow | null>(null);

  const [expandedValueRows, setExpandedValueRows] = useState<Set<string>>(new Set());

  const [bankId, setBankId] =
    useState("viacredi");

  const [company, setCompany] =
    useState(1);

  const [
    modoConciliacao,
    setModoConciliacao,
  ] =
    useState<ModoConciliacao>(
      "pendentes"
    );

  const [rawRows, setRawRows] =
    useState<
      Array<{
        numeroLinha: number;
        columns?: string[];

        values:
          Record<string, string>;
      }>
    >([]);

  const [rows, setRows] =
    useState<
      NormalizedCsvRow[]
    >([]);

  const [
    fileName,
    setFileName,
  ] =
    useState("");

  const [busy, setBusy] =
    useState(false);

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    showConfig,
    setShowConfig,
  ] =
    useState(false);

  const [query, setQuery] =
    useState("");

  const [sortKey, setSortKey] =
    useState<SortKey | null>(
      null
    );

  const [
    sortDirection,
    setSortDirection,
  ] =
    useState<SortDirection>(
      null
    );

  const [
    columnFilters,
    setColumnFilters,
  ] =
    useState<ColumnFilters>(
      EMPTY_FILTERS
    );

  const [
    progress,
    setProgress,
  ] =
    useState<ProgressState>(
      INITIAL_PROGRESS
    );

  const [
    detailModal,
    setDetailModal,
  ] =
    useState<
      DetailModalState | null
    >(null);

  const [
    showFullPayload,
    setShowFullPayload,
  ] =
    useState(false);

  /* ==========================================================
     CARREGAR CONFIGURAÇÕES
  ========================================================== */

  useEffect(() => {
    try {
      setBanks(loadBanks(localStorage.getItem(BANK_M8_STORAGE_KEY)));
    } catch {
      // O layout e os padrões continuam disponíveis sem armazenamento local.
    }
  }, []);

  /* ==========================================================
     BANCO ATUAL
  ========================================================== */

  const bank =
    banks.find(
      (b) =>
        b.id === bankId
    ) ||
    banks[0];

  /* ==========================================================
     TROCA DE BANCO
  ========================================================== */

  useEffect(() => {
    // Cada arquivo pertence ao layout do banco selecionado na importação.
    setRawRows([]);
    setRows([]);
    setFileName("");
    setMessage("");
    setProgress(INITIAL_PROGRESS);
    clearFilters();
    setDateReviewRow(null);
    setExpandedValueRows(new Set());
  }, [bankId, company]);

  /* ==========================================================
     CONTADORES
  ========================================================== */

  const counts =
    useMemo(() => {
      const pronto =
        rows.filter(
          (r) =>
            r.status ===
            "pronto"
        );

      const baixadaAgora =
        rows.filter(
          (r) =>
            r.status ===
            "baixada"
        ).length;

      const jaBaixada =
        rows.filter(
          (r) =>
            r.status ===
            "ja_baixada"
        ).length;

      const pendencias =
        rows.filter(
          (r) =>
            [
              "erro",
              "nao_encontrado",
              "conflito",
              "parcialmente_baixada",
            ].includes(
              r.status
            )
        ).length;

      return {
        total:
          rows.length,

        pronto:
          pronto.length,

        baixada:
          baixadaAgora +
          jaBaixada,

        erro:
          pendencias,

        valorPronto:
          pronto.reduce(
            (total, r) =>
              total +
              (r.valor || 0),
            0
          ),
      };
    }, [rows]);

  /* ==========================================================
     PROGRESSO
  ========================================================== */

  const progressPercent =
    progress.total > 0
      ? Math.round(
          (progress.current /
            progress.total) *
            100
        )
      : 0;

  /* ==========================================================
     FILTROS
  ========================================================== */

  function setColumnFilter(
    key:
      keyof ColumnFilters,
    value: string
  ) {
    setColumnFilters(
      (old) => ({
        ...old,
        [key]: value,
      })
    );
  }

  function clearFilters() {
    setQuery("");

    setColumnFilters({
      ...EMPTY_FILTERS,
    });
  }

  const hasActiveFilters =
    useMemo(
      () =>
        query.trim() !== "" ||
        Object.values(
          columnFilters
        ).some(
          (value) =>
            value.trim() !== ""
        ),
      [
        query,
        columnFilters,
      ]
    );

  /* ==========================================================
     FILTRAGEM
  ========================================================== */

  const filteredRows =
    useMemo(() => {
      const globalQuery =
        query
          .trim()
          .toLowerCase();

      return rows.filter(
        (r) => {
          if (globalQuery) {
            const searchable =
              [
                r.numeroLinha,
                r.cliente,
                r.documento,
                r.tipo,
                r.tipo === "C" ? "Crédito" : r.tipo === "D" ? "Débito" : "",
                r.dataPagamento,
                dateBr(
                  r.dataPagamento
                ),
                r.valor,
                money(r.valor),
                r.tituloId,
                r.parcelaId,
                r.status,
                r.statusMensagem,
                JSON.stringify(
                  r.original
                ),
              ]
                .join(" ")
                .toLowerCase();

            if (
              !searchable.includes(
                globalQuery
              )
            ) {
              return false;
            }
          }

          if (
            columnFilters.cliente &&
            !String(
              r.cliente || ""
            )
              .toLowerCase()
              .includes(
                columnFilters
                  .cliente
                  .toLowerCase()
              )
          ) {
            return false;
          }

          if (
            columnFilters.documento &&
            !String(
              r.documento || ""
            )
              .toLowerCase()
              .includes(
                columnFilters
                  .documento
                  .toLowerCase()
              )
          ) {
            return false;
          }

          if (
            columnFilters.tipo &&
            String(
              r.tipo || ""
            )
              .trim()
              .toUpperCase() !==
              columnFilters.tipo
                .trim()
                .toUpperCase()
          ) {
            return false;
          }

          if (
            columnFilters.pagamento
          ) {
            const value =
              `${r.dataPagamento} ${dateBr(
                r.dataPagamento
              )}`.toLowerCase();

            if (
              !value.includes(
                columnFilters
                  .pagamento
                  .toLowerCase()
              )
            ) {
              return false;
            }
          }

          if (
            columnFilters.valor
          ) {
            const value =
              `${r.valor ?? ""} ${money(
                r.valor
              )}`.toLowerCase();

            if (
              !value.includes(
                columnFilters
                  .valor
                  .toLowerCase()
              )
            ) {
              return false;
            }
          }

          if (
            columnFilters.titulo &&
            !String(
              r.tituloId ?? ""
            ).includes(
              columnFilters.titulo
            )
          ) {
            return false;
          }

          if (
            columnFilters.parcela &&
            !String(
              r.parcelaId ?? ""
            ).includes(
              columnFilters.parcela
            )
          ) {
            return false;
          }

          if (
            columnFilters.status &&
            r.status !==
              columnFilters.status
          ) {
            return false;
          }

          return true;
        }
      );
    }, [
      rows,
      query,
      columnFilters,
    ]);

  /* ==========================================================
     CLASSIFICAÇÃO
  ========================================================== */

  function handleSort(
    key: SortKey
  ) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDirection(
        "asc"
      );
      return;
    }

    if (
      sortDirection ===
      "asc"
    ) {
      setSortDirection(
        "desc"
      );
      return;
    }

    if (
      sortDirection ===
      "desc"
    ) {
      setSortKey(null);
      setSortDirection(null);
      return;
    }

    setSortKey(key);
    setSortDirection(
      "asc"
    );
  }

  function sortIcon(
    key: SortKey
  ) {
    if (
      sortKey !== key ||
      !sortDirection
    ) {
      return "↕";
    }

    return sortDirection ===
      "asc"
      ? "↑"
      : "↓";
  }

  /* ==========================================================
     LINHAS EXIBIDAS
  ========================================================== */

  const displayedRows =
    useMemo(() => {
      if (
        !sortKey ||
        !sortDirection
      ) {
        return filteredRows;
      }

      return [
        ...filteredRows,
      ].sort(
        (a, b) => {
          let valueA:
            any =
            a[sortKey];

          let valueB:
            any =
            b[sortKey];

          if (sortKey === "valorJuros") {
            valueA = (a.valorJuros ?? 0) + (a.valorDesconto ?? 0);
            valueB = (b.valorJuros ?? 0) + (b.valorDesconto ?? 0);
          }

          if (
            [
              "numeroLinha",
              "valor",
              "valorJuros",
              "tituloId",
              "parcelaId",
            ].includes(
              sortKey
            )
          ) {
            valueA =
              Number(
                valueA ?? 0
              );

            valueB =
              Number(
                valueB ?? 0
              );
          }

          if (
            typeof valueA ===
              "number" &&
            typeof valueB ===
              "number"
          ) {
            const result =
              valueA -
              valueB;

            return sortDirection ===
              "asc"
              ? result
              : -result;
          }

          const result =
            String(
              valueA ?? ""
            ).localeCompare(
              String(
                valueB ?? ""
              ),
              "pt-BR",
              {
                sensitivity:
                  "base",
                numeric:
                  true,
              }
            );

          return sortDirection ===
            "asc"
            ? result
            : -result;
        }
      );
    }, [
      filteredRows,
      sortKey,
      sortDirection,
    ]);

  /* ==========================================================
     IMPORTAR CSV
  ========================================================== */

  async function chooseFile(
    e:
      ChangeEvent<HTMLInputElement>
  ) {
    const file =
      e.target.files?.[0];

    if (!file) {
      return;
    }

    e.currentTarget.value = "";
    const spreadsheet = bank.formato === "xls";
    const validExtension = spreadsheet ? /\.xlsx?$/i.test(file.name) : /\.csv$/i.test(file.name);
    if (!validExtension) {
      setMessage(spreadsheet ? "Selecione um arquivo .XLS ou .XLSX do Sicredi." : "Selecione um arquivo .CSV do Viacredi.");
      return;
    }

    setBusy(true);
    try {
      let parsedRows: typeof rawRows;
      let detail: string;
      if (spreadsheet) {
        const { parseSicrediSpreadsheet } = await import("@/lib/spreadsheet");
        const parsed = parseSicrediSpreadsheet(await file.arrayBuffer());
        parsedRows = parsed.rows;
        detail = `Primeira linha de dados detectada: ${parsed.firstDataRow}.`;
        if (parsed.skippedRows) detail += ` ${parsed.skippedRows} linha(s) sem data válida ignorada(s) após o início dos dados.`;
      } else {
        const parsed = parseCsv(await file.text());
        parsedRows = parsed.rows;
        detail = `Delimitador detectado: ${parsed.delimiter === "\t" ? "TAB" : parsed.delimiter}.`;
      }
      const normalized = normalizeRows(parsedRows, bank);
      setRawRows(parsedRows);
      setFileName(file.name);
      setRows(normalized);
      clearFilters();
      setSortKey(null);
      setSortDirection(null);
      setProgress(INITIAL_PROGRESS);
      setMessage(`Arquivo carregado: ${normalized.length} registro(s). ${detail}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Falha ao ler o extrato.");
    } finally {
      setBusy(false);
    }
  }

  /* ==========================================================
     SALVAR BANCO
  ========================================================== */

  function saveBank(updated: BankConfig) {
    const next = banks.map((b) =>
      b.id === updated.id ? { ...b, m8: { ...updated.m8 } } : b
    );
    setBanks(next);
    setShowConfig(false);
    try {
      localStorage.setItem(BANK_M8_STORAGE_KEY, serializeM8(next));
      setMessage("Configuração M8 salva neste navegador.");
    } catch {
      setMessage("Configuração M8 aplicada nesta sessão. Não foi possível salvar no navegador.");
    }
  }

  /* ==========================================================
     PROCESSAR STREAM
  ========================================================== */

  async function processStream(
    response: Response,

    operation:
      | "conciliacao"
      | "baixa"
  ): Promise<{
    results:
      Array<
        Partial<
          NormalizedCsvRow
        > & {
          rowId:
            string;
        }
      >;

    doneReceived:
      boolean;

    error:
      string | null;

    serverPending:
      number | null;
  }> {
    if (!response.body) {
      return {
        results: [],
        doneReceived:
          false,
        error:
          "O navegador não recebeu o fluxo de processamento.",
        serverPending:
          null,
      };
    }

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();

    let buffer = "";

    const results =
      new Map<
        string,
        Partial<
          NormalizedCsvRow
        > & {
          rowId:
            string;
        }
      >();

    let doneReceived =
      false;

    let streamError:
      string | null =
      null;

    let serverPending:
      number | null =
      null;

    function processEvent(
      event: any
    ) {
      if (
        event.type ===
          "start" ||
        event.type ===
          "status"
      ) {
        setProgress({
          active: true,
          type: operation,
          current:
            Number(
              event.current ?? 0
            ),
          total:
            Number(
              event.total ?? 0
            ),
          label:
            event.label || "",
        });

        return;
      }

      if (
        event.type ===
        "progress"
      ) {
        setProgress({
          active: true,
          type: operation,
          current:
            Number(
              event.current ?? 0
            ),
          total:
            Number(
              event.total ?? 0
            ),
          label:
            event.label || "",
        });

        if (
          event.result?.rowId
        ) {
          const result = {
            ...event.result,
            rowId:
              String(
                event.result
                  .rowId
              ),
          };

          results.set(
            result.rowId,
            result
          );

          setRows(
            (old) =>
              old.map(
                (r) =>
                  r.rowId ===
                  result.rowId
                    ? {
                        ...r,
                        ...result,
                      }
                    : r
              )
          );
        }

        return;
      }

      if (
        event.type ===
        "error"
      ) {
        streamError =
          event.error ||
          "Erro durante o processamento.";

        if (
          event.pendentes !=
          null
        ) {
          serverPending =
            Number(
              event.pendentes
            );
        }

        return;
      }

      if (
        event.type ===
        "done"
      ) {
        doneReceived =
          true;

        if (
          event.pendentes !=
          null
        ) {
          serverPending =
            Number(
              event.pendentes
            );
        }

        setProgress({
          active: true,
          type: operation,
          current:
            Number(
              event.current ??
              event.total ??
              0
            ),
          total:
            Number(
              event.total ?? 0
            ),
          label:
            event.label ||
            "Concluído.",
        });
      }
    }

    try {
      while (true) {
        const {
          value,
          done,
        } =
          await reader.read();

        if (done) {
          break;
        }

        buffer +=
          decoder.decode(
            value,
            {
              stream: true,
            }
          );

        const linhas =
          buffer.split(
            "\n"
          );

        buffer =
          linhas.pop() ||
          "";

        for (
          const linha
          of linhas
        ) {
          const texto =
            linha.trim();

          if (!texto) {
            continue;
          }

          try {
            processEvent(
              JSON.parse(
                texto
              )
            );
          } catch (
            error
          ) {
            streamError =
              error instanceof
              Error
                ? error.message
                : "Erro ao interpretar retorno do servidor.";
          }
        }
      }

      const restante =
        buffer.trim();

      if (
        restante
      ) {
        try {
          processEvent(
            JSON.parse(
              restante
            )
          );
        } catch (
          error
        ) {
          streamError =
            error instanceof
            Error
              ? error.message
              : "Erro ao interpretar o último retorno do servidor.";
        }
      }
    } catch (
      error
    ) {
      streamError =
        error instanceof
        Error
          ? error.message
          : "A conexão com o processamento foi interrompida.";
    }

    return {
      results:
        Array.from(
          results.values()
        ),

      doneReceived,

      error:
        streamError,

      serverPending,
    };
  }

  /* ==========================================================
     CONCILIAR
  ========================================================== */

  async function conciliar() {
    if (!rows.length) {
      return setMessage(
        "Importe um extrato antes de conciliar."
      );
    }

    if (
      !bank.mapping.valor
    ) {
      return setMessage(
        "Configure a coluna Valor do banco."
      );
    }

    if (rows.some((row) => !ehCredito(row.tipo) && amountForMatching(row) === null)) {
      setMessage("Confira os juros: informe um valor não negativo com até 2 casas decimais e menor que o valor do extrato.");
      return;
    }

    /*
     * Montamos uma cópia local do lote.
     *
     * Isso evita depender da atualização assíncrona do
     * setRows() para descobrir quais registros ainda estão
     * pendentes durante as retomadas automáticas.
     */
    let workingRows =
      rows.map(
        (
          r
        ): NormalizedCsvRow => {
          if (
            ehCredito(
              r.tipo
            )
          ) {
            return {
              ...r,

              status:
                "credito",

              statusMensagem:
                "Crédito identificado no extrato. Não necessita conciliação ou baixa no Contas a Pagar.",

              tituloId:
                undefined,

              parcelaId:
                undefined,

              tituloM8:
                undefined,

              parcelaM8:
                undefined,

              baixaM8:
                undefined,

              fornecedorNome:
                undefined,

              parcelaValor:
                undefined,

              parcelaSaldo:
                undefined,

              apiError:
                undefined,
            };
          }

          return {
            ...r,

            sugestoesValor: undefined,
            correspondenciaData: undefined,
            revisaoData: undefined,
            status:
              "conciliando",

            statusMensagem:
              "Aguardando processamento...",

            tituloId:
              undefined,

            parcelaId:
              undefined,

            tituloM8:
              undefined,

            parcelaM8:
              undefined,

            baixaM8:
              undefined,

            fornecedorNome:
              undefined,

            parcelaValor:
              undefined,

            parcelaSaldo:
              undefined,

            apiError:
              undefined,
          };
        }
      );

    setRows(
      workingRows
    );

    setBusy(
      true
    );

    setProgress({
      active: true,
      type:
        "conciliacao",
      current: 0,
      total:
        workingRows.length,
      label:
        "Preparando conciliação...",
    });

    setMessage(
      modoConciliacao ===
        "pendentes"
        ? "Iniciando conciliação somente dos títulos pendentes..."
        : "Iniciando verificação completa de todos os títulos..."
    );

    let ultimaFalha =
      "";

    let retomadas =
      0;

    try {
      while (
        true
      ) {
        const pendentes =
          workingRows.filter(
            (r) =>
              r.status ===
              "conciliando"
          );

        /*
         * Nenhuma linha pode continuar como "Conciliando"
         * quando declaramos sucesso.
         */
        if (
          !pendentes.length
        ) {
          const totalErros =
            workingRows.filter(
              (r) =>
                r.status ===
                "erro"
            ).length;

          setMessage(
            totalErros > 0
              ? `Conciliação finalizada com ${totalErros} registro(s) em erro. Nenhum registro permaneceu como “Conciliando”. Revise os erros e execute a conciliação novamente se desejar tentar esses itens.`
              : modoConciliacao ===
                  "pendentes"
                ? "Conciliação dos títulos pendentes concluída. Todos os registros foram processados."
                : "Verificação completa concluída. Todos os registros foram processados. Revise os registros antes de efetuar a baixa."
          );

          break;
        }

        if (
          retomadas >
          MAX_RETOMADAS_CONCILIACAO
        ) {
          const idsPendentes =
            new Set(
              pendentes.map(
                (r) =>
                  r.rowId
              )
            );

          workingRows =
            workingRows.map(
              (r) =>
                idsPendentes.has(
                  r.rowId
                )
                  ? {
                      ...r,

                      status:
                        "erro",

                      statusMensagem:
                        `Conciliação interrompida após ${MAX_RETOMADAS_CONCILIACAO} retomada(s) automática(s). Execute a conciliação novamente para tentar estes registros.`,

                      apiError:
                        ultimaFalha ||
                        "Não foi possível concluir o processamento após as tentativas automáticas.",
                    }
                  : r
            );

          setRows(
            workingRows
          );

          setMessage(
            `A conciliação não foi concluída integralmente. ${pendentes.length} registro(s) permaneceram pendentes após ${MAX_RETOMADAS_CONCILIACAO} retomada(s) automática(s). Eles foram marcados como Erro para não permanecerem indefinidamente como “Conciliando”.`
          );

          break;
        }

        const numeroTentativa =
          retomadas + 1;

        if (
          retomadas >
          0
        ) {
          setMessage(
            `A comunicação foi interrompida antes da conclusão. Retomando automaticamente ${pendentes.length} registro(s) pendente(s) — retomada ${retomadas}/${MAX_RETOMADAS_CONCILIACAO}...`
          );

          setProgress({
            active: true,
            type:
              "conciliacao",
            current: 0,
            total:
              pendentes.length,
            label:
              `Retomando ${pendentes.length} registro(s) pendente(s)...`,
          });

          await new Promise(
            (resolve) =>
              setTimeout(
                resolve,
                DELAY_RETOMADA_MS
              )
          );
        }

        let response:
          Response;

        try {
          response =
            await fetch(
              "/api/m8/conciliar",
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json",
                },

                body:
                  JSON.stringify({
                    company,
                    bankId,

                    /*
                     * Enviamos somente os registros que ainda
                     * estão pendentes nesta tentativa.
                     */
                    rows:
                      pendentes,

                    modoConciliacao,
                  }),
              }
            );
        } catch (
          error
        ) {
          ultimaFalha =
            error instanceof
            Error
              ? error.message
              : "Falha de conexão ao iniciar a conciliação.";

          retomadas++;

          continue;
        }

        if (
          !response.ok
        ) {
          let errorText =
            "";

          try {
            errorText =
              await response.text();
          } catch {}

          ultimaFalha =
            errorText ||
            `Erro HTTP ${response.status}`;

          retomadas++;

          continue;
        }

        const streamResult =
          await processStream(
            response,
            "conciliacao"
          );

        /*
         * Replica localmente os mesmos resultados que já foram
         * aplicados visualmente pelo processStream().
         */
        if (
          streamResult.results
            .length
        ) {
          const resultados =
            new Map(
              streamResult.results.map(
                (result) => [
                  result.rowId,
                  result,
                ]
              )
            );

          workingRows =
            workingRows.map(
              (r) => {
                const result =
                  resultados.get(
                    r.rowId
                  );

                return result
                  ? {
                      ...r,
                      ...result,
                    }
                  : r;
              }
            );

          setRows(
            workingRows
          );
        }

        const aindaPendentes =
          workingRows.filter(
            (r) =>
              r.status ===
              "conciliando"
          );

        /*
         * SUCESSO REAL:
         * - o stream precisa ter terminado;
         * - nenhuma linha pode permanecer "Conciliando".
         */
        if (
          streamResult.doneReceived &&
          !streamResult.error &&
          !aindaPendentes.length
        ) {
          const totalErros =
            workingRows.filter(
              (r) =>
                r.status ===
                "erro"
            ).length;

          setMessage(
            totalErros > 0
              ? `Conciliação finalizada com ${totalErros} registro(s) em erro. Nenhum registro permaneceu como “Conciliando”. Revise os erros e execute a conciliação novamente se desejar tentar esses itens.`
              : modoConciliacao ===
                  "pendentes"
                ? "Conciliação dos títulos pendentes concluída. Todos os registros foram processados."
                : "Verificação completa concluída. Todos os registros foram processados. Revise os registros antes de efetuar a baixa."
          );

          break;
        }

        ultimaFalha =
          streamResult.error ||
          (
            !streamResult.doneReceived
              ? "O fluxo de conciliação foi encerrado antes de receber a confirmação final."
              : `${aindaPendentes.length} registro(s) não receberam resultado final.`
          );

        /*
         * Somente as linhas que ainda estão como "Conciliando"
         * serão reenviadas na próxima iteração.
         */
        retomadas++;
      }
    } finally {
      setBusy(
        false
      );

      setTimeout(
        () => {
          setProgress(
            (old) => ({
              ...old,
              active: false,
            })
          );
        },
        700
      );
    }
  }

  /* ==========================================================
     BAIXAR
  ========================================================== */

  async function baixar() {
    const aptas =
      rows.filter(
        (r) =>
          r.status ===
            "pronto" &&
          !ehCredito(
            r.tipo
          )
      );

    if (!aptas.length) {
      return setMessage(
        "Não existem parcelas prontas para baixa."
      );
    }

    if (
      Number(
        bank.m8
          .contaContabilId
      ) <= 0
    ) {
      return setMessage(
        "Configure a Conta Contábil do banco antes de efetuar a baixa."
      );
    }

    if (
      Number(
        bank.m8
          .historicoId
      ) <= 0
    ) {
      return setMessage(
        "Configure o Histórico do banco antes de efetuar a baixa."
      );
    }

    if (
      Number(
        bank.m8
          .meioPagamentoId
      ) <= 0
    ) {
      return setMessage(
        "Configure o Meio de Pagamento do banco antes de efetuar a baixa."
      );
    }

    const total =
      aptas.reduce(
        (valor, r) =>
          valor +
          (r.valor || 0),
        0
      );

    if (
      !confirm(
        `Confirma a baixa de ${aptas.length} parcela(s), totalizando ${money(
          total
        )}?`
      )
    ) {
      return;
    }

    setBusy(true);

    setMessage(
      "Iniciando baixa das parcelas..."
    );

    const idsAptas =
      new Set(
        aptas.map(
          (r) =>
            r.rowId
        )
      );

    setRows(
      (old) =>
        old.map(
          (r) =>
            idsAptas.has(
              r.rowId
            )
              ? {
                  ...r,
                  status:
                    "baixando",
                  statusMensagem:
                    "Aguardando baixa...",
                  apiError:
                    undefined,
                }
              : r
        )
    );

    setProgress({
      active: true,
      type: "baixa",
      current: 0,
      total:
        aptas.length,
      label:
        "Preparando baixas...",
    });

    try {
      const response =
        await fetch(
          "/api/m8/baixar",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                company,
                bankId,
                rows:
                  aptas,
                config:
                  bank.m8,
              }),
          }
        );

      if (!response.ok) {
        let errorText = "";

        try {
          errorText =
            await response.text();
        } catch {}

        throw new Error(
          errorText ||
            `Erro HTTP ${response.status}`
        );
      }

      await processStream(
        response,
        "baixa"
      );

      setMessage(
        "Processamento de baixa concluído."
      );
    } catch (err) {
      setMessage(
        err instanceof Error
          ? err.message
          : "Erro na baixa."
      );

      setRows(
        (old) =>
          old.map(
            (r) =>
              r.status ===
              "baixando"
                ? {
                    ...r,
                    status:
                      "erro",
                    statusMensagem:
                      "Baixa interrompida.",
                  }
                : r
          )
      );
    } finally {
      setBusy(false);

      setTimeout(
        () => {
          setProgress(
            (old) => ({
              ...old,
              active: false,
            })
          );
        },
        700
      );
    }
  }

  /* ==========================================================
     DETALHES
  ========================================================== */

  function abrirTitulo(
    row:
      NormalizedCsvRow
  ) {
    if (!row.tituloM8) {
      setMessage(
        "O payload deste título não está disponível."
      );

      return;
    }

    setShowFullPayload(false);

    setDetailModal({
      title:
        `Título M8 ${row.tituloId}`,

      subtitle:
        "Informações retornadas pelo M8 para este título.",

      data:
        row.tituloM8,
    });
  }

  function abrirParcela(
    row:
      NormalizedCsvRow
  ) {
    if (!row.parcelaM8) {
      setMessage(
        "O payload desta parcela não está disponível."
      );

      return;
    }

    setShowFullPayload(false);

    setDetailModal({
      title:
        `Parcela M8 ${row.parcelaId}`,

      subtitle:
        `Informações da parcela vinculada ao título ${row.tituloId}.`,

      data:
        row.parcelaM8,
    });
  }

  function fecharDetalhes() {
    setDetailModal(null);
    setShowFullPayload(false);
  }

  async function copiarPayload() {
    if (!detailModal?.data) {
      return;
    }

    try {
      await navigator
        .clipboard
        .writeText(
          JSON.stringify(
            detailModal.data,
            null,
            2
          )
        );

      setMessage(
        "Payload copiado para a área de transferência."
      );
    } catch {
      setMessage(
        "Não foi possível copiar o payload."
      );
    }
  }

  /* ==========================================================
     CABEÇALHO CLASSIFICÁVEL
  ========================================================== */

  function SortHeader({
    column,
    label,
    className = "",
  }: {
    column: SortKey;
    label: string;
    className?: string;
  }) {
    const active =
      sortKey === column &&
      sortDirection;

    return (
      <th className={className}>
        <button
          type="button"
          className={`sort-header ${
            active
              ? "active"
              : ""
          }`}
          onClick={() =>
            handleSort(column)
          }
          title={`Classificar por ${label}`}
        >
          <span>
            {label}
          </span>

          <span
            className="sort-icon"
            aria-hidden="true"
          >
            {sortIcon(column)}
          </span>
        </button>
      </th>
    );
  }

  /* ==========================================================
     RENDER
  ========================================================== */

  return (
    <main className="container">

      {/* ======================================================
          CABEÇALHO
      ====================================================== */}

      <header className="page-header">
        <div>
          <div className="eyebrow">
            FINANCEIRO · ERP M8
          </div>

          <h1>
            Conciliação e Baixa de Parcelas
          </h1>

          <p>
            Importe o extrato bancário, concilie com as contas a pagar e execute as baixas de forma controlada.
          </p>
        </div>

        <div className="brand">
          RJ{" "}
          <span>
            Compressores
          </span>
        </div>
      </header>

      {/* ======================================================
    CONTROLES / CONFIGURAÇÃO INICIAL
====================================================== */}

<section className="panel controls">
  <div className="setup-field">
    <label htmlFor="bank-select">1. Banco</label>
    <div className="bank-selection">
      <select
        id="bank-select"
        className="setup-select"
        value={bankId}
        disabled={busy}
        onChange={(e) => setBankId(e.target.value)}
      >
        {banks.map((b) => (
          <option key={b.id} value={b.id}>{b.nome}</option>
        ))}
      </select>
      <button
        type="button"
        className="bank-settings-button"
        disabled={busy}
        onClick={() => setShowConfig(true)}
        title={`Configurar M8 do banco ${bank.nome}`}
        aria-label={`Configurar M8 do banco ${bank.nome}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9.5 3-.5 2a8 8 0 0 0-1.5.9l-2-.6-2.5 4.4 1.5 1.4a8 8 0 0 0 0 1.8L3 14.3l2.5 4.4 2-.6A8 8 0 0 0 9 19l.5 2h5l.5-2a8 8 0 0 0 1.5-.9l2 .6 2.5-4.4-1.5-1.4a8 8 0 0 0 0-1.8L21 9.7l-2.5-4.4-2 .6A8 8 0 0 0 15 5l-.5-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </div>
  </div>

  <div className="setup-field">
    <label htmlFor="csv-file">2. Arquivo {bank.formato === "xls" ? "XLS" : "CSV"}</label>
    <div className="csv-file-picker">
      <input
        id="csv-file"
        type="file"
        accept={bank.formato === "xls" ? ".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : ".csv,text/csv"}
        disabled={busy}
        onChange={chooseFile}
        aria-describedby="csv-file-name"
      />
      <span id="csv-file-name" title={fileName || `Selecionar arquivo ${bank.formato === "xls" ? "XLS" : "CSV"}`}>
        {fileName || `Selecionar arquivo ${bank.formato === "xls" ? "XLS" : "CSV"}`}
      </span>
    </div>
  </div>

  <div className="setup-field">
    <label htmlFor="company-select">3. Empresa M8</label>
    <select
      id="company-select"
      className="setup-select"
      value={company}
      disabled={busy}
      onChange={(e) => setCompany(Number(e.target.value))}
    >
      <option value={1}>1 - RJ Industria</option>
      <option value={2}>2 - Serrana</option>
      <option value={27404}>27404 - Criciúma</option>
    </select>
  </div>
</section>

      {/* ======================================================
          AVISO
      ====================================================== */}

      {message && (
        <div className="notice">
          {message}
        </div>
      )}

      {/* ======================================================
          PROGRESSO
      ====================================================== */}

      {progress.active && (
        <section className="progress-panel">

          <div className="progress-info">

            <div>
              <strong>
                {progress.type ===
                "conciliacao"
                  ? "Conciliação em andamento"
                  : "Baixa em andamento"}
              </strong>

              <span>
                {progress.label}
              </span>
            </div>

            <strong className="progress-percent">
              {progressPercent}%
            </strong>

          </div>

          <div className="progress-track">
            <div
              className="progress-bar"
              style={{
                width:
                  `${progressPercent}%`,
              }}
            />
          </div>

          <div className="progress-counter">
            {progress.current} de{" "}
            {progress.total} processado(s)
          </div>

        </section>
      )}

      {/* ======================================================
          CARDS
      ====================================================== */}

      <section className="stats">

        <div className="stat">
          <span>
            Registros
          </span>

          <strong>
            {counts.total}
          </strong>
        </div>

        <div className="stat">
          <span>
            Prontos para baixa
          </span>

          <strong>
            {counts.pronto}
          </strong>
        </div>

        <div className="stat">
          <span>
            Baixados
          </span>

          <strong>
            {counts.baixada}
          </strong>
        </div>

        <div className="stat">
          <span>
            Pendências / erros
          </span>

          <strong>
            {counts.erro}
          </strong>
        </div>

        <div className="stat accent">
          <span>
            Valor pronto
          </span>

          <strong>
            {money(
              counts.valorPronto
            )}
          </strong>
        </div>

      </section>

      {/* ======================================================
          TABELA
      ====================================================== */}

      <section className="panel">

        <div className="toolbar">

          <div>
            <h2>
              Registros importados
            </h2>

            <p>
              Clique no número do Título ou da Parcela para visualizar os detalhes retornados pelo M8.
            </p>
          </div>

          <div className="toolbar-actions">

            <input
              className="search"
              placeholder="Pesquisar em toda a tabela..."
              value={query}
              onChange={(e) =>
                setQuery(
                  e.target.value
                )
              }
            />

            {hasActiveFilters && (
              <button
                type="button"
                className="button secondary"
                onClick={
                  clearFilters
                }
              >
                Limpar filtros
              </button>
            )}

          </div>

        </div>

        {/* ====================================================
            AÇÕES DE CONCILIAÇÃO

            NOVO SELETOR:
            - pendentes
            - todos
        ==================================================== */}

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent:
              "space-between",
            gap: "14px",
            flexWrap: "wrap",
            padding:
              "14px 18px",
            borderBottom:
              "1px solid #e3e9f1",
            background:
              "#fbfcfe",
          }}
        >

          <label
            style={{
              display: "flex",
              flexDirection:
                "column",
              gap: "6px",
              fontSize: "12px",
              fontWeight: 700,
              color: "#47566a",
              minWidth: "270px",
            }}
          >
            Modo de conciliação

            <select
              value={
                modoConciliacao
              }
              disabled={busy}
              onChange={(e) =>
                setModoConciliacao(
                  e.target
                    .value as ModoConciliacao
                )
              }
              style={{
                height: "40px",
                padding:
                  "0 11px",
                background:
                  "white",
                color:
                  "#17263d",
                border:
                  "1px solid #cfd9e6",
                borderRadius:
                  "8px",
              }}
            >
              <option value="pendentes">
                Somente títulos pendentes
              </option>

              <option value="todos">
                Verificar todos os títulos
              </option>
            </select>

            <span
              style={{
                fontSize:
                  "11px",
                fontWeight:
                  400,
                color:
                  "#7b899a",
              }}
            >
              {modoConciliacao ===
              "pendentes"
                ? "Mais rápido. Títulos já totalmente baixados não serão considerados."
                : "Mais completo. Também permite identificar parcelas já baixadas."}
            </span>

          </label>

          <div
            style={{
              display: "flex",
              gap: "9px",
              alignItems:
                "center",
              flexWrap:
                "wrap",
            }}
          >

            <button
              className="button secondary"
              disabled={
                busy ||
                !rows.length
              }
              onClick={
                conciliar
              }
            >
              1. Conciliar no M8
            </button>

            <button
              className="button primary"
              disabled={
                busy ||
                counts.pronto ===
                  0
              }
              onClick={
                baixar
              }
            >
              2. Efetuar baixas ({counts.pronto})
            </button>

          </div>

        </div>

        {/* ====================================================
            RESUMO
        ==================================================== */}

        {rows.length > 0 && (
          <div className="table-summary">
            Exibindo{" "}

            <strong>
              {displayedRows.length}
            </strong>

            {" "}de{" "}

            <strong>
              {rows.length}
            </strong>

            {" "}registro(s)
          </div>
        )}

        {/* ====================================================
            TABELA
        ==================================================== */}

        <div className="table-wrap">

          <table>

            <thead>

              <tr>

                <SortHeader
                  column="numeroLinha"
                  label="Linha"
                />

                <SortHeader
                  column="cliente"
                  label="Cliente"
                />

                <SortHeader
                  column="documento"
                  label="Documento"
                />

                <SortHeader
                  column="tipo"
                  label="Tipo"
                />

                <SortHeader
                  column="dataPagamento"
                  label="Pagamento"
                />

                <SortHeader
                  column="valor"
                  label="Valor do extrato"
                  className="right"
                />

                <SortHeader column="valorJuros" label="Juros / Desconto (R$)" className="right" />

                <SortHeader
                  column="tituloId"
                  label="Título M8"
                />

                <SortHeader
                  column="parcelaId"
                  label="Parcela M8"
                />

                <SortHeader
                  column="status"
                  label="Status Integração"
                />

                <SortHeader
                  column="statusMensagem"
                  label="Retorno"
                />

              </tr>

              {/* ===============================================
                  FILTROS
              =============================================== */}

              <tr className="filter-row">

                <th>
                  <span className="filter-placeholder">
                    —
                  </span>
                </th>

                <th>
                  <input
                    className="column-filter"
                    placeholder="Cliente"
                    value={
                      columnFilters.cliente
                    }
                    onChange={(e) =>
                      setColumnFilter(
                        "cliente",
                        e.target.value
                      )
                    }
                  />
                </th>

                <th>
                  <input
                    className="column-filter"
                    placeholder="Documento"
                    value={
                      columnFilters.documento
                    }
                    onChange={(e) =>
                      setColumnFilter(
                        "documento",
                        e.target.value
                      )
                    }
                  />
                </th>

                <th>
                  <select
                    className="column-filter"
                    value={
                      columnFilters.tipo
                    }
                    onChange={(e) =>
                      setColumnFilter(
                        "tipo",
                        e.target.value
                      )
                    }
                  >
                    <option value="">
                      Todos
                    </option>

                    <option value="D">
                      D - Débito
                    </option>

                    <option value="C">
                      C - Crédito
                    </option>
                  </select>
                </th>

                <th>
                  <input
                    className="column-filter"
                    placeholder="dd/mm/aaaa"
                    value={
                      columnFilters.pagamento
                    }
                    onChange={(e) =>
                      setColumnFilter(
                        "pagamento",
                        e.target.value
                      )
                    }
                  />
                </th>

                <th>
                  <input
                    className="column-filter"
                    placeholder="Valor"
                    value={
                      columnFilters.valor
                    }
                    onChange={(e) =>
                      setColumnFilter(
                        "valor",
                        e.target.value
                      )
                    }
                  />
                </th>

                <th><span className="filter-placeholder">Automático</span></th>
                <th>
                  <input
                    className="column-filter"
                    placeholder="Título"
                    value={
                      columnFilters.titulo
                    }
                    onChange={(e) =>
                      setColumnFilter(
                        "titulo",
                        e.target.value
                      )
                    }
                  />
                </th>

                <th>
                  <input
                    className="column-filter"
                    placeholder="Parcela"
                    value={
                      columnFilters.parcela
                    }
                    onChange={(e) =>
                      setColumnFilter(
                        "parcela",
                        e.target.value
                      )
                    }
                  />
                </th>

                <th>
                  <select
                    className="column-filter"
                    value={
                      columnFilters.status
                    }
                    onChange={(e) =>
                      setColumnFilter(
                        "status",
                        e.target.value
                      )
                    }
                  >
                    <option value="">
                      Todos
                    </option>

                    <option value="aguardando">
                      Aguardando
                    </option>

                    <option value="conciliando">
                      Conciliando
                    </option>

                    <option value="pronto">
                      Pronto para baixa
                    </option>

                    <option value="baixando">
                      Baixando
                    </option>

                    <option value="baixada">
                      Parcela baixada
                    </option>

                    <option value="ja_baixada">
                      Já baixada no M8
                    </option>

                    <option value="credito">
                      Crédito
                    </option>

                    <option value="parcialmente_baixada">
                      Baixa parcial
                    </option>

                    <option value="nao_encontrado">
                      Não encontrado
                    </option>

                    <option value="sugestao">Selecionar parcela</option>
                    <option value="revisar">Possível correspondência — revisar</option>
                    <option value="conflito">
                      Conflito
                    </option>

                    <option value="erro">
                      Erro
                    </option>
                  </select>
                </th>

                <th>
                  <span className="filter-placeholder">
                    —
                  </span>
                </th>

              </tr>

            </thead>

            <tbody>

              {displayedRows.length ===
              0 ? (

                <tr>
                  <td
                    colSpan={11}
                    className="empty"
                  >
                    {rows.length ===
                    0
                      ? "Importe um extrato para visualizar os registros."
                      : "Nenhum registro encontrado com os filtros informados."}
                  </td>
                </tr>

              ) : (

                displayedRows.map(
                  (r) => (

                    <Fragment key={r.rowId}>
                    <tr
                      className={r.sugestoesValor?.length ? "has-value-suggestions" : undefined}
                      onClick={(event) => {
                        if (!r.sugestoesValor?.length || (event.target as HTMLElement).closest("button,input,select,a")) return;
                        setExpandedValueRows((current) => { const next = new Set(current); if (next.has(r.rowId)) next.delete(r.rowId); else next.add(r.rowId); return next; });
                      }}
                    >

                      <td>
                        {r.numeroLinha}
                      </td>

                      <td>
                        {r.cliente ||
                          "—"}
                      </td>

                      <td>
                        {r.documento ||
                          "—"}
                      </td>

                      <td>
                        {String(
                          r.tipo || ""
                        )
                          .trim()
                          .toUpperCase() ===
                        "C"
                          ? "C - Crédito"
                          : String(
                              r.tipo || ""
                            )
                              .trim()
                              .toUpperCase() ===
                            "D"
                          ? "D - Débito"
                          : r.tipo ||
                            "—"}
                      </td>

                      <td>
                        {dateBr(
                          r.dataPagamento
                        )}
                      </td>

                      <td className="right">
                        {money(
                          r.valor
                        )}
                      </td>

                      <td className="right">
                        <span>{money((r.valorDesconto ?? 0) > 0 ? r.valorDesconto : (r.valorJuros ?? 0))}</span>
                        <small className="account-id-note">{(r.valorDesconto ?? 0) > 0 ? "Desconto" : (r.valorJuros ?? 0) > 0 ? "Juros" : "Sem ajuste"}</small>
                        <small className="account-id-note">Principal: {amountForMatching(r) === null ? "Valor inválido" : money(amountForMatching(r))}</small>
                      </td>
                      <td>

                        {r.tituloId &&
                        r.tituloM8 ? (

                          <button
                            type="button"
                            className="m8-link"
                            onClick={() =>
                              abrirTitulo(r)
                            }
                            title="Visualizar detalhes do título"
                          >
                            {r.tituloId}
                          </button>

                        ) : (

                          r.tituloId ??
                          "—"

                        )}

                      </td>

                      <td>

                        {r.parcelaId &&
                        r.parcelaM8 ? (

                          <button
                            type="button"
                            className="m8-link"
                            onClick={() =>
                              abrirParcela(r)
                            }
                            title="Visualizar detalhes da parcela"
                          >
                            {r.parcelaId}
                          </button>

                        ) : (

                          r.parcelaId ??
                          "—"

                        )}

                      </td>

                      <td>
                        <StatusBadge
                          status={
                            r.status
                          }
                        />
                      </td>

                      <td
                        className="message-cell"
                        title={
                          r.apiError
                        }
                      >

                        {r.statusMensagem}
                        {r.parcelaId && ["pronto", "revisar"].includes(r.status) && <div><button type="button" className="link-button" disabled={busy} onClick={() => setRows((current) => current.map((row) => row.rowId === r.rowId ? clearValueSelection(row) : row))}>Remover seleção</button></div>}
                        {!!r.sugestoesValor?.length && <div><button type="button" className="link-button" aria-expanded={expandedValueRows.has(r.rowId)} onClick={() => setExpandedValueRows((current) => { const next = new Set(current); if (next.has(r.rowId)) next.delete(r.rowId); else next.add(r.rowId); return next; })}>{expandedValueRows.has(r.rowId) ? "Ocultar" : "Ver"} {r.sugestoesValor.length} possíveis parcelas</button></div>}
                        {r.status === "revisar" && (
                          <div><button type="button" className="link-button" disabled={busy} onClick={() => setDateReviewRow(r)}>Revisar correspondência</button></div>
                        )}

                        {r.apiError && (
                          <div className="api-error-detail">
                            {r.apiError}
                          </div>
                        )}

                      </td>

                    </tr>
                    {expandedValueRows.has(r.rowId) && !!r.sugestoesValor?.length && <tr><td colSpan={11} className="suggestions-cell">
                      <ValueSuggestions row={r} rows={rows} disabled={busy} onSelect={(suggestion) => setRows((current) => selectSuggestionInRows(current, r.rowId, suggestion, company, bankId))} />
                    </td></tr>}
                    </Fragment>

                  )
                )

              )}

            </tbody>

          </table>

        </div>

      </section>

      {/* ======================================================
          CONFIGURAÇÃO DO BANCO
      ====================================================== */}

      <BankConfigModal
        open={showConfig}
        bank={bank}
        detectedStartLine={rawRows[0]?.numeroLinha}
        company={company}
        onClose={() =>
          setShowConfig(false)
        }
        onSave={saveBank}
      />

      {/* ======================================================
          DETALHES M8
      ====================================================== */}

      {dateReviewRow && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="date-review-title">
            <div className="modal-title">
              <div><h2 id="date-review-title">Revisar correspondência por data</h2><p>Confira o título e a parcela antes de liberar para baixa.</p></div>
              <button type="button" className="icon-button" aria-label="Fechar revisão" onClick={() => setDateReviewRow(null)}>×</button>
            </div>
            <dl className="form-grid">
              <div><dt>Cliente / Fornecedor no extrato</dt><dd>{dateReviewRow.cliente}</dd></div>
              <div><dt>Fornecedor no M8</dt><dd>{dateReviewRow.fornecedorNome || "—"}</dd></div>
              <div><dt>Título / Parcela M8</dt><dd>{dateReviewRow.tituloId} / {dateReviewRow.parcelaId}</dd></div>
              <div><dt>Documento no extrato / M8</dt><dd>{dateReviewRow.documento || "—"} / {String(dateReviewRow.tituloM8?.documento || "—")}</dd></div>
              <div><dt>Extrato − Juros + Desconto / Parcela</dt><dd>{money(dateReviewRow.valor)} − {money(dateReviewRow.valorJuros ?? 0)} + {money(dateReviewRow.valorDesconto ?? 0)} = {money(amountForMatching(dateReviewRow))} / {money(dateReviewRow.parcelaValor)}</dd></div>
              <div><dt>Vencimento M8 / Pagamento</dt><dd>{dateBr(dateReviewRow.correspondenciaData?.vencimento || "")} / {dateBr(dateReviewRow.dataPagamento)}</dd></div>
            </dl>
            <p>{dateReviewRow.correspondenciaData?.motivo}</p>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setDateReviewRow(null)}>Manter para revisão</button>
              <button type="button" className="button" disabled={busy} onClick={() => {
                const reviewed = dateReviewRow;
                if (!reviewed.tituloId || !reviewed.parcelaId || !reviewed.correspondenciaData || reviewed.valor == null) return;
                const approval = { aprovadaEm: new Date().toISOString(), company, bankId, tituloId: reviewed.tituloId, parcelaId: reviewed.parcelaId, vencimento: reviewed.correspondenciaData.vencimento, pagamento: reviewed.correspondenciaData.pagamento, valor: reviewed.valor };
                setRows((current) => current.map((r) => r.rowId === reviewed.rowId && r.status === "revisar" ? { ...r, status: "pronto", revisaoData: approval, statusMensagem: `${r.correspondenciaData?.motivo} Correspondência aprovada manualmente; pronta para baixa.` } : r));
                setDateReviewRow(null);
              }}>Confirmar correspondência</button>
            </div>
          </div>
        </div>
      )}

      {detailModal && (

        <div
          className="modal-backdrop"
          onMouseDown={
            fecharDetalhes
          }
        >

          <div
            className="modal m8-detail-modal"
            onMouseDown={(e) =>
              e.stopPropagation()
            }
          >

            <div className="modal-title">

              <div>

                <div className="eyebrow">
                  DETALHES ERP M8
                </div>

                <h2>
                  {detailModal.title}
                </h2>

                <p>
                  {detailModal.subtitle}
                </p>

              </div>

              <button
                type="button"
                className="icon-button"
                onClick={
                  fecharDetalhes
                }
                title="Fechar"
              >
                ×
              </button>

            </div>

            {/* =================================================
                DETALHES EM LISTA
            ================================================= */}

            <div className="payload-list">

              {Object.entries(
                detailModal.data || {}
              ).map(
                ([key, value]) => (

                  <div
                    className="payload-list-row"
                    key={key}
                  >

                    <div className="payload-list-label">
                      {key}
                    </div>

                    <div className="payload-list-value">

                      {value === null ||
                      value === undefined ||
                      value === ""

                        ? "—"

                        : typeof value ===
                            "object"

                          ? JSON.stringify(
                              value
                            )

                          : String(value)}

                    </div>

                  </div>

                )
              )}

            </div>

            {/* =================================================
                PAYLOAD COMPLETO
            ================================================= */}

            <div className="payload-expand-section">

              <button
                type="button"
                className="payload-expand-button"
                onClick={() =>
                  setShowFullPayload(
                    (old) =>
                      !old
                  )
                }
              >

                <span>
                  {showFullPayload
                    ? "Ocultar payload completo"
                    : "Visualizar payload completo"}
                </span>

                <span
                  className={`payload-expand-icon ${
                    showFullPayload
                      ? "open"
                      : ""
                  }`}
                >
                  ▼
                </span>

              </button>

              {showFullPayload && (

                <div className="payload-expanded-content">

                  <div className="payload-json-actions">

                    <span>
                      JSON completo retornado pelo M8
                    </span>

                    <button
                      type="button"
                      className="button secondary payload-copy-button"
                      onClick={
                        copiarPayload
                      }
                    >
                      Copiar JSON
                    </button>

                  </div>

                  <pre className="payload-json">
                    {JSON.stringify(
                      detailModal.data,
                      null,
                      2
                    )}
                  </pre>

                </div>

              )}

            </div>

            <div className="modal-actions">

              <button
                type="button"
                className="button secondary"
                onClick={
                  fecharDetalhes
                }
              >
                Fechar
              </button>

            </div>

          </div>

        </div>

      )}

    </main>
  );
}
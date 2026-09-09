"use client";

import {
  ChangeEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import defaultBanks from "@/data/bancos.json";

import {
  BankConfig,
  NormalizedCsvRow,
} from "@/lib/types";

import {
  normalizeRows,
  parseCsv,
} from "@/lib/csv";

import StatusBadge from "./StatusBadge";
import BankConfigModal from "./BankConfigModal";

const STORAGE_KEY =
  "conciliacao-m8-bancos-v1";

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
  | "dataVencimento"
  | "dataPagamento"
  | "valor"
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
  vencimento: string;
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
  vencimento: "",
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
      defaultBanks as BankConfig[]
    );

  const [bankId, setBankId] =
    useState("banco-teste");

  const [company, setCompany] =
    useState(1);

  const [
    modoConciliacao,
    setModoConciliacao,
  ] =
    useState<ModoConciliacao>(
      "pendentes"
    );

  const [headers, setHeaders] =
    useState<string[]>([]);

  const [rawRows, setRawRows] =
    useState<
      Array<{
        numeroLinha: number;

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
    const saved =
      localStorage.getItem(
        STORAGE_KEY
      );

    if (saved) {
      try {
        setBanks(
          JSON.parse(saved)
        );
      } catch {}
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
    if (
      rawRows.length &&
      bank
    ) {
      setRows(
        normalizeRows(
          rawRows,
          bank
        )
      );
    }
  }, [bankId]);

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
                r.dataVencimento,
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
            columnFilters.vencimento &&
            String(
              r.dataVencimento || ""
            )
              .trim()
              .toUpperCase() !==
              columnFilters.vencimento
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

          if (
            [
              "numeroLinha",
              "valor",
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

    if (
      !file.name
        .toLowerCase()
        .endsWith(".csv")
    ) {
      setMessage(
        "Selecione um arquivo .CSV."
      );
      return;
    }

    try {
      const text =
        await file.text();

      const parsed =
        parseCsv(text);

      setHeaders(
        parsed.headers
      );

      setRawRows(
        parsed.rows
      );

      setFileName(
        file.name
      );

      setRows(
        normalizeRows(
          parsed.rows,
          bank
        )
      );

      clearFilters();

      setSortKey(null);
      setSortDirection(null);

      setProgress(
        INITIAL_PROGRESS
      );

      setMessage(
        `Arquivo carregado: ${parsed.rows.length} registro(s). Delimitador detectado: ${
          parsed.delimiter ===
          "\t"
            ? "TAB"
            : parsed.delimiter
        }`
      );
    } catch (err) {
      setMessage(
        err instanceof Error
          ? err.message
          : "Falha ao ler CSV."
      );
    }
  }

  /* ==========================================================
     SALVAR BANCO
  ========================================================== */

  function saveBank(
    updated: BankConfig
  ) {
    const next =
      banks.map(
        (b) =>
          b.id ===
          updated.id
            ? updated
            : b
      );

    setBanks(next);

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(next)
    );

    setShowConfig(false);

    if (rawRows.length) {
      setRows(
        normalizeRows(
          rawRows,
          updated
        )
      );
    }

    setMessage(
      "Configuração do banco salva neste navegador."
    );
  }

  /* ==========================================================
     NOVO BANCO
  ========================================================== */

  function newBank() {
    const id =
      `banco-${Date.now()}`;

    const empty:
      BankConfig = {
      id,

      nome:
        "Novo Banco",

      mapping: {
        cliente: "",
        dataVencimento:
          "",
        dataPagamento:
          "",
        documento:
          "",
        valor: "",
      },

      m8: {
        contaContabilId:
          0,

        historicoId:
          0,

        meioPagamentoId:
          0,

        observacaoInterna:
          "Baixa automática via conciliação bancária",

        complemento:
          "",
      },
    };

    const next = [
      ...banks,
      empty,
    ];

    setBanks(next);
    setBankId(id);

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(next)
    );

    setShowConfig(true);
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
        "Importe um CSV antes de conciliar."
      );
    }

    if (
      !bank.mapping.valor
    ) {
      return setMessage(
        "Configure a coluna Valor do banco."
      );
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

<section
  className="panel controls"
  style={{
    display: "grid",

    /*
     * Arquivo recebe mais espaço.
     * Configuração e Banco ficam intermediários.
     * Empresa M8 fica compacta.
     */
    gridTemplateColumns:
      "minmax(280px, 1.45fr) minmax(220px, 1fr) minmax(210px, 0.95fr) minmax(120px, 0.55fr)",

    gap: "16px",

    alignItems: "start",

    padding: "18px",
  }}
>

  {/* ====================================================
      1. ARQUIVO CSV
  ==================================================== */}

  <label
    className="file-control"
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "7px",
      minWidth: 0,
    }}
  >
    <span
      style={{
        height: "auto",
        padding: 0,
        background: "transparent",
        border: 0,
        borderRadius: 0,
        color: "#294969",
        fontSize: "12px",
        fontWeight: 750,
        cursor: "default",
        overflow: "visible",
      }}
    >
      1. Arquivo CSV
    </span>

    <input
      type="file"
      accept=".csv,text/csv"
      disabled={busy}
      onChange={chooseFile}
    />

    <span
      title={fileName || "Selecionar arquivo CSV"}
      style={{
        display: "flex",
        alignItems: "center",

        width: "100%",
        height: "40px",

        padding: "0 12px",

        background: "#f8fbff",

        border: "1px dashed #7f9bbc",
        borderRadius: "8px",

        color: "#294969",

        fontSize: "12px",
        fontWeight: 650,

        cursor: busy
          ? "not-allowed"
          : "pointer",

        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {fileName || "Selecionar arquivo CSV"}
    </span>
  </label>

  {/* ====================================================
      2. CONFIGURAÇÃO DO BANCO
  ==================================================== */}

  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "7px",
      minWidth: 0,
    }}
  >
    <div
      style={{
        color: "#294969",
        fontSize: "12px",
        fontWeight: 750,
        lineHeight: 1.4,
      }}
    >
      2. Configuração do banco
    </div>

    <button
      type="button"
      className="button secondary"
      disabled={
        busy ||
        !rawRows.length
      }
      onClick={() =>
        setShowConfig(true)
      }
      title={
        !rawRows.length
          ? "Importe primeiro o arquivo CSV para configurar as colunas."
          : "Configurar o mapeamento das colunas do banco."
      }
      style={{
        width: "100%",
        height: "40px",
      }}
    >
      Configurar banco
    </button>

    <span
      style={{
        paddingLeft: "2px",

        color: !rawRows.length
          ? "#9aa6b5"
          : "#718094",

        fontSize: "11px",
        fontWeight: 400,

        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {!rawRows.length
        ? "Importe o arquivo CSV primeiro"
        : "Mapear colunas do arquivo"}
    </span>
  </div>

  {/* ====================================================
      3. BANCO
  ==================================================== */}

  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "7px",
      minWidth: 0,
    }}
  >
    <div
      style={{
        color: "#294969",
        fontSize: "12px",
        fontWeight: 750,
        lineHeight: 1.4,
      }}
    >
      3. Banco
    </div>

    <select
      value={bankId}
      disabled={busy}
      onChange={(e) =>
        setBankId(
          e.target.value
        )
      }
      style={{
        width: "100%",
        height: "40px",

        padding: "0 11px",

        background: "white",
        color: "#17263d",

        border: "1px solid #cfd9e6",
        borderRadius: "8px",

        outline: "none",
      }}
    >
      {banks.map(
        (b) => (
          <option
            key={b.id}
            value={b.id}
          >
            {b.nome}
          </option>
        )
      )}
    </select>

    <button
      type="button"
      className="link-button"
      disabled={
        busy ||
        !rawRows.length
      }
      onClick={newBank}
      style={{
        paddingLeft: "2px",
        height: "17px",
        lineHeight: "17px",
      }}
    >
      + Adicionar banco
    </button>
  </div>

  {/* ====================================================
      4. EMPRESA M8
  ==================================================== */}

  <label
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "7px",
      minWidth: 0,
    }}
  >
    <span
      style={{
        color: "#294969",
        fontSize: "12px",
        fontWeight: 750,
        lineHeight: 1.4,
      }}
    >
      4. Empresa M8
    </span>

    <input
      type="number"
      min="1"
      value={company}
      disabled={busy}
      onChange={(e) =>
        setCompany(
          Number(
            e.target.value
          ) || 1
        )
      }
      style={{
        width: "100%",
        height: "40px",
      }}
    />

    {/*
     * Espaço invisível para manter
     * a mesma altura dos blocos que
     * possuem uma segunda informação.
     */}
    <span
      aria-hidden="true"
      style={{
        height: "17px",
        fontSize: "11px",
        visibility: "hidden",
      }}
    >
      espaço
    </span>
  </label>

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
                  column="dataVencimento"
                  label="Tipo"
                />

                <SortHeader
                  column="dataPagamento"
                  label="Pagamento"
                />

                <SortHeader
                  column="valor"
                  label="Valor CSV"
                  className="right"
                />

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
                      columnFilters.vencimento
                    }
                    onChange={(e) =>
                      setColumnFilter(
                        "vencimento",
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
                    colSpan={10}
                    className="empty"
                  >
                    {rows.length ===
                    0
                      ? "Importe um arquivo CSV para visualizar os registros."
                      : "Nenhum registro encontrado com os filtros informados."}
                  </td>
                </tr>

              ) : (

                displayedRows.map(
                  (r) => (

                    <tr
                      key={r.rowId}
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
                          r.dataVencimento || ""
                        )
                          .trim()
                          .toUpperCase() ===
                        "C"
                          ? "C - Crédito"
                          : String(
                              r.dataVencimento || ""
                            )
                              .trim()
                              .toUpperCase() ===
                            "D"
                          ? "D - Débito"
                          : r.dataVencimento ||
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

                        {r.apiError && (
                          <div className="api-error-detail">
                            {r.apiError}
                          </div>
                        )}

                      </td>

                    </tr>

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
        headers={headers}
        company={company}
        onClose={() =>
          setShowConfig(false)
        }
        onSave={saveBank}
      />

      {/* ======================================================
          DETALHES M8
      ====================================================== */}

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
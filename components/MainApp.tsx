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

/* ============================================================
   FORMATAÇÃO
============================================================ */

function money(
  v: number | null | undefined
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

function dateBr(
  v: string
) {
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
   SORT
============================================================ */

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

/* ============================================================
   FILTROS
============================================================ */

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

const EMPTY_FILTERS: ColumnFilters =
  {
    cliente: "",
    documento: "",
    vencimento: "",
    pagamento: "",
    valor: "",
    titulo: "",
    parcela: "",
    status: "",
  };

/* ============================================================
   PROGRESSO
============================================================ */

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

const INITIAL_PROGRESS: ProgressState =
  {
    active: false,
    type: "",
    current: 0,
    total: 0,
    label: "",
  };

/* ============================================================
   MODAL M8
============================================================ */

interface DetailModalState {
  title: string;

  subtitle: string;

  data:
    | Record<string, any>
    | null;
}

/* ============================================================
   COMPONENTE
============================================================ */

export default function MainApp() {
  const [banks, setBanks] =
    useState<BankConfig[]>(
      defaultBanks as BankConfig[]
    );

  const [bankId, setBankId] =
    useState(
      "banco-teste"
    );

  const [company, setCompany] =
    useState(1);

  const [headers, setHeaders] =
    useState<string[]>([]);

  const [rawRows, setRawRows] =
    useState<
      Array<{
        numeroLinha: number;

        values:
          Record<
            string,
            string
          >;
      }>
    >([]);

  const [rows, setRows] =
    useState<
      NormalizedCsvRow[]
    >([]);

  const [fileName, setFileName] =
    useState("");

  const [busy, setBusy] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [
    showConfig,
    setShowConfig,
  ] =
    useState(false);

  const [query, setQuery] =
    useState("");

  const [sortKey, setSortKey] =
    useState<
      SortKey | null
    >(null);

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
    useState<DetailModalState | null>(
      null
    );

  /* ==========================================================
     BANCOS
  ========================================================== */

  useEffect(() => {
    const saved =
      localStorage.getItem(
        STORAGE_KEY
      );

    if (saved) {
      try {
        setBanks(
          JSON.parse(
            saved
          )
        );
      } catch {}
    }
  }, []);

  const bank =
    banks.find(
      (b) =>
        b.id === bankId
    ) || banks[0];

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
    useMemo(
      () => ({
        total:
          rows.length,

        pronto:
          rows.filter(
            (r) =>
              r.status ===
              "pronto"
          ).length,

        baixada:
          rows.filter(
            (r) =>
              r.status ===
              "baixada"
          ).length,

        erro:
          rows.filter(
            (r) =>
              [
                "erro",
                "nao_encontrado",
                "conflito",
              ].includes(
                r.status
              )
          ).length,

        valorPronto:
          rows
            .filter(
              (r) =>
                r.status ===
                "pronto"
            )
            .reduce(
              (a, r) =>
                a +
                (r.valor ||
                  0),
              0
            ),
      }),

      [rows]
    );

  /* ==========================================================
     PROGRESSO %
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
        query.trim() !==
          "" ||
        Object.values(
          columnFilters
        ).some(
          (value) =>
            value.trim() !==
            ""
        ),

      [
        query,
        columnFilters,
      ]
    );

  const filteredRows =
    useMemo(() => {
      const globalQuery =
        query
          .trim()
          .toLowerCase();

      return rows.filter(
        (r) => {
          if (
            globalQuery
          ) {
            const searchable =
              [
                r.numeroLinha,
                r.cliente,
                r.documento,
                dateBr(
                  r.dataVencimento
                ),
                dateBr(
                  r.dataPagamento
                ),
                r.valor,
                money(
                  r.valor
                ),
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
              r.cliente ||
                ""
            )
              .toLowerCase()
              .includes(
                columnFilters.cliente.toLowerCase()
              )
          ) {
            return false;
          }

          if (
            columnFilters.documento &&
            !String(
              r.documento ||
                ""
            )
              .toLowerCase()
              .includes(
                columnFilters.documento.toLowerCase()
              )
          ) {
            return false;
          }

          if (
            columnFilters.vencimento
          ) {
            const value =
              `${r.dataVencimento} ${dateBr(
                r.dataVencimento
              )}`.toLowerCase();

            if (
              !value.includes(
                columnFilters.vencimento.toLowerCase()
              )
            ) {
              return false;
            }
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
                columnFilters.pagamento.toLowerCase()
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
                columnFilters.valor.toLowerCase()
              )
            ) {
              return false;
            }
          }

          if (
            columnFilters.titulo &&
            !String(
              r.tituloId ??
                ""
            ).includes(
              columnFilters.titulo
            )
          ) {
            return false;
          }

          if (
            columnFilters.parcela &&
            !String(
              r.parcelaId ??
                ""
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
    if (
      sortKey !== key
    ) {
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

    setSortKey(null);

    setSortDirection(
      null
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
              valueA ??
                ""
            ).localeCompare(
              String(
                valueB ??
                  ""
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
     CSV
  ========================================================== */

  async function chooseFile(
    e: ChangeEvent<HTMLInputElement>
  ) {
    const file =
      e.target
        .files?.[0];

    if (!file) {
      return;
    }

    if (
      !file.name
        .toLowerCase()
        .endsWith(
          ".csv"
        )
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

      setSortDirection(
        null
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
     CONFIGURAÇÃO BANCO
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
      JSON.stringify(
        next
      )
    );

    setShowConfig(
      false
    );

    if (
      rawRows.length
    ) {
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
        documento: "",
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

        complemento: "",
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
      JSON.stringify(
        next
      )
    );

    setShowConfig(
      true
    );
  }

  /* ==========================================================
     LEITOR DE STREAM NDJSON
  ========================================================== */

  async function processStream(
    response: Response,
    operation:
      | "conciliacao"
      | "baixa"
  ) {
    if (
      !response.body
    ) {
      throw new Error(
        "O navegador não recebeu o fluxo de processamento."
      );
    }

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();

    let buffer = "";

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
            stream:
              true,
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
        if (
          !linha.trim()
        ) {
          continue;
        }

        const event =
          JSON.parse(
            linha
          );

        if (
          event.type ===
            "start" ||
          event.type ===
            "status"
        ) {
          setProgress({
            active: true,
            type:
              operation,

            current:
              event.current ??
              0,

            total:
              event.total ??
              0,

            label:
              event.label ||
              "",
          });
        }

        if (
          event.type ===
          "progress"
        ) {
          setProgress({
            active: true,
            type:
              operation,

            current:
              event.current ??
              0,

            total:
              event.total ??
              0,

            label:
              event.label ||
              "",
          });

          if (
            event.result
          ) {
            setRows(
              (old) =>
                old.map(
                  (r) =>
                    r.rowId ===
                    event.result
                      .rowId
                      ? {
                          ...r,
                          ...event.result,
                        }
                      : r
                )
            );
          }
        }

        if (
          event.type ===
          "error"
        ) {
          throw new Error(
            event.error ||
              "Erro durante o processamento."
          );
        }

        if (
          event.type ===
          "done"
        ) {
          setProgress({
            active: false,
            type:
              operation,

            current:
              event.total ||
              0,

            total:
              event.total ||
              0,

            label:
              event.label ||
              "",
          });
        }
      }
    }
  }

  /* ==========================================================
     CONCILIAR
  ========================================================== */

  async function conciliar() {
    if (
      !rows.length
    ) {
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

    setBusy(true);

    setMessage(
      "Iniciando conciliação..."
    );

    setRows(
      (old) =>
        old.map(
          (r) => ({
            ...r,

            status:
              "conciliando",

            statusMensagem:
              "Aguardando processamento...",
          })
        )
    );

    setProgress({
      active: true,
      type:
        "conciliacao",
      current: 0,
      total:
        rows.length,
      label:
        "Preparando conciliação...",
    });

    try {
      const response =
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
                rows,
              }),
          }
        );

      if (
        !response.ok
      ) {
        throw new Error(
          `Erro HTTP ${response.status}`
        );
      }

      await processStream(
        response,
        "conciliacao"
      );

      setMessage(
        "Conciliação concluída. Revise os registros antes de efetuar a baixa."
      );
    } catch (err) {
      setMessage(
        err instanceof Error
          ? err.message
          : "Erro na conciliação."
      );

      setRows(
        (old) =>
          old.map(
            (r) =>
              r.status ===
              "conciliando"
                ? {
                    ...r,

                    status:
                      "erro",

                    statusMensagem:
                      "Conciliação interrompida.",
                  }
                : r
          )
      );
    } finally {
      setBusy(false);

      setProgress(
        (old) => ({
          ...old,
          active: false,
        })
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
          "pronto"
      );

    if (
      !aptas.length
    ) {
      return setMessage(
        "Não existem parcelas prontas para baixa."
      );
    }

    const total =
      aptas.reduce(
        (a, r) =>
          a +
          (r.valor ||
            0),
        0
      );

    if (
      !confirm(
        `Confirma a baixa de ${aptas.length} parcela(s), totalizando ${money(total)}?`
      )
    ) {
      return;
    }

    setBusy(true);

    setMessage(
      "Iniciando baixa das parcelas..."
    );

    setRows(
      (old) =>
        old.map(
          (r) =>
            r.status ===
            "pronto"
              ? {
                  ...r,

                  status:
                    "baixando",

                  statusMensagem:
                    "Aguardando baixa...",
                }
              : r
        )
    );

    /*
     * Depois da alteração acima,
     * aptas continua contendo os objetos
     * anteriores com status pronto,
     * que é exatamente o que enviaremos.
     */

    setProgress({
      active: true,
      type:
        "baixa",
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
            method:
              "POST",

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

      if (
        !response.ok
      ) {
        throw new Error(
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

      setProgress(
        (old) => ({
          ...old,
          active: false,
        })
      );
    }
  }

  /* ==========================================================
     MODAL PAYLOAD
  ========================================================== */

  function abrirTitulo(
    row: NormalizedCsvRow
  ) {
    if (
      !row.tituloM8
    ) {
      return;
    }

    setDetailModal({
      title:
        `Título M8 ${row.tituloId}`,

      subtitle:
        "Payload completo retornado pelo endpoint de Contas a Pagar.",

      data:
        row.tituloM8,
    });
  }

  function abrirParcela(
    row: NormalizedCsvRow
  ) {
    if (
      !row.parcelaM8
    ) {
      return;
    }

    setDetailModal({
      title:
        `Parcela M8 ${row.parcelaId}`,

      subtitle:
        `Payload completo da parcela vinculada ao título ${row.tituloId}.`,

      data:
        row.parcelaM8,
    });
  }

  async function copiarPayload() {
    if (
      !detailModal?.data
    ) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
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
     SORT HEADER
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
      sortKey ===
        column &&
      sortDirection;

    return (
      <th
        className={
          className
        }
      >
        <button
          type="button"
          className={`sort-header ${
            active
              ? "active"
              : ""
          }`}
          onClick={() =>
            handleSort(
              column
            )
          }
        >
          <span>
            {label}
          </span>

          <span className="sort-icon">
            {sortIcon(
              column
            )}
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

      <section className="panel controls">
        <label>
          Empresa M8

          <input
            type="number"
            min="1"
            value={company}
            onChange={(e) =>
              setCompany(
                Number(
                  e.target.value
                ) || 1
              )
            }
          />
        </label>

        <label>
          Banco

          <select
            value={bankId}
            onChange={(e) =>
              setBankId(
                e.target.value
              )
            }
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
        </label>

        <div className="button-stack">
          <button
            className="button secondary"
            onClick={() =>
              setShowConfig(
                true
              )
            }
          >
            Configurar banco
          </button>

          <button
            className="link-button"
            onClick={
              newBank
            }
          >
            + Adicionar banco
          </button>
        </div>

        <label className="file-control">
          Arquivo CSV

          <input
            type="file"
            accept=".csv,text/csv"
            onChange={
              chooseFile
            }
          />

          <span>
            {fileName ||
              "Selecionar arquivo CSV"}
          </span>
        </label>
      </section>

      {message && (
        <div className="notice">
          {message}
        </div>
      )}

      {/* ====================================================
          PROGRESSO
      ==================================================== */}

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

      <section className="panel">
        <div className="toolbar">
          <div>
            <h2>
              Registros importados
            </h2>

            <p>
              Clique no número do Título ou da Parcela para visualizar o payload completo retornado pelo M8.
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
                className="button secondary"
                onClick={
                  clearFilters
                }
              >
                Limpar filtros
              </button>
            )}

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

        {rows.length > 0 && (
          <div className="table-summary">
            Exibindo{" "}
            <strong>
              {displayedRows.length}
            </strong>{" "}
            de{" "}
            <strong>
              {rows.length}
            </strong>{" "}
            registro(s)
          </div>
        )}

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
                  label="Vencimento"
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

              <tr className="filter-row">
                <th>—</th>

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
                  <input
                    className="column-filter"
                    placeholder="dd/mm/aaaa"
                    value={
                      columnFilters.vencimento
                    }
                    onChange={(e) =>
                      setColumnFilter(
                        "vencimento",
                        e.target.value
                      )
                    }
                  />
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
                      Pronto
                    </option>

                    <option value="baixando">
                      Baixando
                    </option>

                    <option value="baixada">
                      Baixada
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

                <th>—</th>
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
                      key={
                        r.rowId
                      }
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
                        {dateBr(
                          r.dataVencimento
                        )}
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

                      {/* TÍTULO M8 */}

                      <td>
                        {r.tituloId &&
                        r.tituloM8 ? (
                          <button
                            type="button"
                            className="m8-link"
                            onClick={() =>
                              abrirTitulo(
                                r
                              )
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

                      {/* PARCELA M8 */}

                      <td>
                        {r.parcelaId &&
                        r.parcelaM8 ? (
                          <button
                            type="button"
                            className="m8-link"
                            onClick={() =>
                              abrirParcela(
                                r
                              )
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

      <section className="flow">
        <div>
          <b>ETAPA 1</b>
          <span>
            Autenticação Token
          </span>
        </div>

        <i>→</i>

        <div>
          <b>ETAPA 2</b>
          <span>
            Contas a Pagar
          </span>
        </div>

        <i>→</i>

        <div>
          <b>ETAPA 3</b>
          <span>
            Parcelas em Aberto
          </span>
        </div>

        <i>→</i>

        <div>
          <b>REVISÃO</b>
          <span>
            Conciliação
          </span>
        </div>

        <i>→</i>

        <div>
          <b>ETAPA 4</b>
          <span>
            Baixar Parcelas
          </span>
        </div>
      </section>

      <BankConfigModal
        open={
          showConfig
        }
        bank={bank}
        headers={
          headers
        }
        onClose={() =>
          setShowConfig(
            false
          )
        }
        onSave={
          saveBank
        }
      />

      {/* ====================================================
          MODAL DETALHES M8
      ==================================================== */}

      {detailModal && (
        <div
          className="modal-backdrop"
          onMouseDown={() =>
            setDetailModal(
              null
            )
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
                className="icon-button"
                onClick={() =>
                  setDetailModal(
                    null
                  )
                }
                title="Fechar"
              >
                ×
              </button>
            </div>

            {/* CAMPOS */}

            <div className="payload-grid">
              {Object.entries(
                detailModal.data ||
                  {}
              ).map(
                ([
                  key,
                  value,
                ]) => (
                  <div
                    className="payload-field"
                    key={key}
                  >
                    <span>
                      {key}
                    </span>

                    <strong>
                      {value ===
                        null ||
                      value ===
                        undefined
                        ? "—"
                        : typeof value ===
                            "object"
                          ? JSON.stringify(
                              value
                            )
                          : String(
                              value
                            )}
                    </strong>
                  </div>
                )
              )}
            </div>

            {/* JSON COMPLETO */}

            <div className="payload-json-header">
              <h3>
                Payload completo
              </h3>

              <button
                className="button secondary"
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

            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() =>
                  setDetailModal(
                    null
                  )
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
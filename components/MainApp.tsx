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
  if (v == null) return "—";

  return new Intl.NumberFormat(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL",
    }
  ).format(v);
}

function dateBr(v: string) {
  if (!v) return "—";

  const m =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);

  return m
    ? `${m[3]}/${m[2]}/${m[1]}`
    : v;
}

/* ============================================================
   CLASSIFICAÇÃO
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

/* ============================================================
   COMPONENTE
============================================================ */

export default function MainApp() {
  const [banks, setBanks] =
    useState<BankConfig[]>(
      defaultBanks as BankConfig[]
    );

  const [bankId, setBankId] =
    useState("banco-teste");

  const [company, setCompany] =
    useState(1);

  const [headers, setHeaders] =
    useState<string[]>([]);

  const [rawRows, setRawRows] =
    useState<
      Array<{
        numeroLinha: number;
        values: Record<string, string>;
      }>
    >([]);

  const [rows, setRows] =
    useState<NormalizedCsvRow[]>([]);

  const [fileName, setFileName] =
    useState("");

  const [busy, setBusy] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [showConfig, setShowConfig] =
    useState(false);

  /* ==========================================================
     PESQUISA GERAL
  ========================================================== */

  const [query, setQuery] =
    useState("");

  /* ==========================================================
     CLASSIFICAÇÃO
  ========================================================== */

  const [sortKey, setSortKey] =
    useState<SortKey | null>(null);

  const [
    sortDirection,
    setSortDirection,
  ] =
    useState<SortDirection>(null);

  /* ==========================================================
     FILTROS DAS COLUNAS
  ========================================================== */

  const [
    columnFilters,
    setColumnFilters,
  ] =
    useState<ColumnFilters>(
      EMPTY_FILTERS
    );

  /* ==========================================================
     CARREGAR CONFIGURAÇÕES DOS BANCOS
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

  const bank =
    banks.find(
      (b) =>
        b.id === bankId
    ) || banks[0];

  /* ==========================================================
     RENORMALIZAR CSV AO TROCAR BANCO
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
                (r.valor || 0),
              0
            ),
      }),
      [rows]
    );

  /* ==========================================================
     ALTERAR FILTRO
  ========================================================== */

  function setColumnFilter(
    key: keyof ColumnFilters,
    value: string
  ) {
    setColumnFilters(
      (old) => ({
        ...old,
        [key]: value,
      })
    );
  }

  /* ==========================================================
     LIMPAR FILTROS
  ========================================================== */

  function clearFilters() {
    setQuery("");

    setColumnFilters(
      EMPTY_FILTERS
    );
  }

  /* ==========================================================
     SABER SE EXISTE FILTRO ATIVO
  ========================================================== */

  const hasActiveFilters =
    useMemo(() => {
      return (
        query.trim() !== "" ||
        Object.values(
          columnFilters
        ).some(
          (value) =>
            value.trim() !== ""
        )
      );
    }, [
      query,
      columnFilters,
    ]);

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
          /* -----------------------------------------------
             PESQUISA GERAL
          ------------------------------------------------ */

          if (
            globalQuery
          ) {
            const searchable =
              [
                r.numeroLinha,
                r.cliente,
                r.documento,
                r.dataVencimento,
                dateBr(
                  r.dataVencimento
                ),
                r.dataPagamento,
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

          /* -----------------------------------------------
             CLIENTE
          ------------------------------------------------ */

          if (
            columnFilters.cliente &&
            !String(
              r.cliente || ""
            )
              .toLowerCase()
              .includes(
                columnFilters.cliente
                  .toLowerCase()
              )
          ) {
            return false;
          }

          /* -----------------------------------------------
             DOCUMENTO
          ------------------------------------------------ */

          if (
            columnFilters.documento &&
            !String(
              r.documento || ""
            )
              .toLowerCase()
              .includes(
                columnFilters.documento
                  .toLowerCase()
              )
          ) {
            return false;
          }

          /* -----------------------------------------------
             VENCIMENTO
          ------------------------------------------------ */

          if (
            columnFilters.vencimento
          ) {
            const value =
              `${r.dataVencimento} ${dateBr(
                r.dataVencimento
              )}`.toLowerCase();

            if (
              !value.includes(
                columnFilters.vencimento
                  .toLowerCase()
              )
            ) {
              return false;
            }
          }

          /* -----------------------------------------------
             PAGAMENTO
          ------------------------------------------------ */

          if (
            columnFilters.pagamento
          ) {
            const value =
              `${r.dataPagamento} ${dateBr(
                r.dataPagamento
              )}`.toLowerCase();

            if (
              !value.includes(
                columnFilters.pagamento
                  .toLowerCase()
              )
            ) {
              return false;
            }
          }

          /* -----------------------------------------------
             VALOR
          ------------------------------------------------ */

          if (
            columnFilters.valor
          ) {
            const value =
              `${r.valor ?? ""} ${money(
                r.valor
              )}`.toLowerCase();

            if (
              !value.includes(
                columnFilters.valor
                  .toLowerCase()
              )
            ) {
              return false;
            }
          }

          /* -----------------------------------------------
             TÍTULO
          ------------------------------------------------ */

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

          /* -----------------------------------------------
             PARCELA
          ------------------------------------------------ */

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

          /* -----------------------------------------------
             STATUS
          ------------------------------------------------ */

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
     ALTERAR CLASSIFICAÇÃO

     1º clique = crescente
     2º clique = decrescente
     3º clique = remove classificação
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

    if (
      sortDirection ===
      "desc"
    ) {
      setSortKey(null);
      setSortDirection(
        null
      );

      return;
    }

    setSortKey(key);
    setSortDirection(
      "asc"
    );
  }

  /* ==========================================================
     ÍCONE DA CLASSIFICAÇÃO
  ========================================================== */

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
     LINHAS ORDENADAS

     IMPORTANTE:
     [...filteredRows] cria uma cópia.
     O array original "rows" NÃO é alterado.
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
          let valueA: any =
            a[sortKey];

          let valueB: any =
            b[sortKey];

          /* -----------------------------------------------
             VALOR
          ------------------------------------------------ */

          if (
            sortKey ===
            "valor"
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

          /* -----------------------------------------------
             LINHA / TÍTULO / PARCELA
          ------------------------------------------------ */

          if (
            sortKey ===
              "numeroLinha" ||
            sortKey ===
              "tituloId" ||
            sortKey ===
              "parcelaId"
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

          /* -----------------------------------------------
             DATAS

             YYYY-MM-DD permite comparação direta.
          ------------------------------------------------ */

          if (
            sortKey ===
              "dataVencimento" ||
            sortKey ===
              "dataPagamento"
          ) {
            valueA =
              valueA || "";

            valueB =
              valueB || "";
          }

          /* -----------------------------------------------
             NÚMEROS
          ------------------------------------------------ */

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

          /* -----------------------------------------------
             TEXTO
          ------------------------------------------------ */

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
     ESCOLHER ARQUIVO
  ========================================================== */

  async function chooseFile(
    e: ChangeEvent<HTMLInputElement>
  ) {
    const file =
      e.target.files?.[0];

    if (!file) return;

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

      setMessage(
        `Arquivo carregado: ${parsed.rows.length} registro(s). Delimitador detectado: ${
          parsed.delimiter ===
          "\t"
            ? "TAB"
            : parsed.delimiter
        }`
      );

      setRows(
        normalizeRows(
          parsed.rows,
          bank
        )
      );

      /* Nova importação começa sem filtros */
      clearFilters();

      setSortKey(null);
      setSortDirection(
        null
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

  /* ==========================================================
     NOVO BANCO
  ========================================================== */

  function newBank() {
    const id =
      `banco-${Date.now()}`;

    const empty: BankConfig =
      {
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
     CONCILIAR
  ========================================================== */

  async function conciliar() {
    if (!rows.length) {
      return setMessage(
        "Importe um CSV antes de conciliar."
      );
    }

    if (
      !bank.mapping
        .documento ||
      !bank.mapping.valor
    ) {
      return setMessage(
        "Configure as colunas obrigatórias do banco."
      );
    }

    setBusy(true);

    setMessage(
      "Executando ETAPA 1, ETAPA 2 e ETAPA 3..."
    );

    setRows(
      (old) =>
        old.map(
          (r) => ({
            ...r,

            status:
              "conciliando",

            statusMensagem:
              "Consultando M8...",
          })
        )
    );

    try {
      /*
       * IMPORTANTE:
       * A conciliação utiliza "rows",
       * e NÃO displayedRows.
       *
       * Portanto filtros e classificação
       * não alteram o processamento.
       */

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

      const data =
        await response.json();

      if (
        !response.ok
      ) {
        throw new Error(
          data.error ||
            "Falha na conciliação."
        );
      }

      setRows(
        (old) =>
          old.map(
            (r) => ({
              ...r,

              ...(
                data.results.find(
                  (x: any) =>
                    x.rowId ===
                    r.rowId
                ) || {}
              ),
            })
          )
      );

      setMessage(
        "Conciliação concluída. Revise os registros antes de efetuar a baixa."
      );
    } catch (err) {
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

      setMessage(
        err instanceof Error
          ? err.message
          : "Erro na conciliação."
      );
    } finally {
      setBusy(false);
    }
  }

  /* ==========================================================
     BAIXAR
  ========================================================== */

  async function baixar() {
    /*
     * Também utiliza "rows".
     * Classificação e filtros não interferem.
     */

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

    if (
      !confirm(
        `Confirma a baixa de ${aptas.length} parcela(s), totalizando ${money(
          aptas.reduce(
            (a, r) =>
              a +
              (r.valor || 0),
            0
          )
        )}?`
      )
    ) {
      return;
    }

    setBusy(true);

    setMessage(
      "Executando ETAPA 4 — Baixa de parcelas..."
    );

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

      const data =
        await response.json();

      if (
        !response.ok
      ) {
        throw new Error(
          data.error ||
            "Falha ao efetuar baixas."
        );
      }

      setRows(
        (old) =>
          old.map(
            (r) => ({
              ...r,

              ...(
                data.results.find(
                  (x: any) =>
                    x.rowId ===
                    r.rowId
                ) || {}
              ),
            })
          )
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
    } finally {
      setBusy(false);
    }
  }

  /* ==========================================================
     BOTÃO DE CABEÇALHO
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
          title={`Classificar por ${label}`}
        >
          <span>
            {label}
          </span>

          <span
            className="sort-icon"
            aria-hidden="true"
          >
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
      {/* ======================================================
          CABEÇALHO
      ====================================================== */}

      <header className="page-header">
        <div>
          <div className="eyebrow">
            FINANCEIRO · ERP
            M8
          </div>

          <h1>
            Conciliação e
            Baixa de Parcelas
          </h1>

          <p>
            Importe o extrato
            bancário, concilie
            com as contas a
            pagar e execute as
            baixas de forma
            controlada.
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
          CONTROLES
      ====================================================== */}

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

      {/* ======================================================
          MENSAGEM
      ====================================================== */}

      {message && (
        <div className="notice">
          {message}
        </div>
      )}

      {/* ======================================================
          INDICADORES
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
            Prontos para
            baixa
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
            Pendências /
            erros
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
              Registros
              importados
            </h2>

            <p>
              O sistema exige
              correspondência
              segura antes de
              permitir a baixa.
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
              1. Conciliar no
              M8
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
              2. Efetuar baixas
              ({counts.pronto})
            </button>
          </div>
        </div>

        {/* ====================================================
            RESUMO DOS FILTROS
        ==================================================== */}

        {rows.length >
          0 && (
          <div className="table-summary">
            Exibindo{" "}
            <strong>
              {
                displayedRows.length
              }
            </strong>{" "}
            de{" "}
            <strong>
              {rows.length}
            </strong>{" "}
            registro(s)

            {sortKey &&
              sortDirection && (
                <>
                  {" "}
                  · Classificação
                  ativa
                </>
              )}
          </div>
        )}

        <div className="table-wrap">
          <table>
            {/* =================================================
                CABEÇALHO PRINCIPAL
            ================================================= */}

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

              {/* ===============================================
                  LINHA DE FILTROS
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
                    placeholder="Filtrar cliente"
                    value={
                      columnFilters.cliente
                    }
                    onChange={(
                      e
                    ) =>
                      setColumnFilter(
                        "cliente",
                        e.target
                          .value
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
                    onChange={(
                      e
                    ) =>
                      setColumnFilter(
                        "documento",
                        e.target
                          .value
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
                    onChange={(
                      e
                    ) =>
                      setColumnFilter(
                        "vencimento",
                        e.target
                          .value
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
                    onChange={(
                      e
                    ) =>
                      setColumnFilter(
                        "pagamento",
                        e.target
                          .value
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
                    onChange={(
                      e
                    ) =>
                      setColumnFilter(
                        "valor",
                        e.target
                          .value
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
                    onChange={(
                      e
                    ) =>
                      setColumnFilter(
                        "titulo",
                        e.target
                          .value
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
                    onChange={(
                      e
                    ) =>
                      setColumnFilter(
                        "parcela",
                        e.target
                          .value
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
                    onChange={(
                      e
                    ) =>
                      setColumnFilter(
                        "status",
                        e.target
                          .value
                      )
                    }
                  >
                    <option value="">
                      Todos
                    </option>

                    <option value="pendente">
                      Pendente
                    </option>

                    <option value="conciliando">
                      Conciliando
                    </option>

                    <option value="pronto">
                      Pronto
                    </option>

                    <option value="baixada">
                      Baixada
                    </option>

                    <option value="nao_encontrado">
                      Não
                      encontrado
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

            {/* =================================================
                CORPO
            ================================================= */}

            <tbody>
              {displayedRows.length ===
              0 ? (
                <tr>
                  <td
                    colSpan={
                      10
                    }
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
                        {
                          r.numeroLinha
                        }
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

                      <td>
                        {r.tituloId ??
                          "—"}
                      </td>

                      <td>
                        {r.parcelaId ??
                          "—"}
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
                        {
                          r.statusMensagem
                        }
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
          FLUXO
      ====================================================== */}

      <section className="flow">
        <div>
          <b>
            ETAPA 1
          </b>

          <span>
            Autenticação
            Token
          </span>
        </div>

        <i>→</i>

        <div>
          <b>
            ETAPA 2
          </b>

          <span>
            Contas a Pagar
          </span>
        </div>

        <i>→</i>

        <div>
          <b>
            ETAPA 3
          </b>

          <span>
            Parcelas em
            Aberto
          </span>
        </div>

        <i>→</i>

        <div>
          <b>
            REVISÃO
          </b>

          <span>
            Conciliação
          </span>
        </div>

        <i>→</i>

        <div>
          <b>
            ETAPA 4
          </b>

          <span>
            Baixar Parcelas
          </span>
        </div>
      </section>

      {/* ======================================================
          CONFIGURAÇÃO DO BANCO
      ====================================================== */}

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
    </main>
  );
}
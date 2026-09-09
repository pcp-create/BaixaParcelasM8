"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  BankConfig,
  CanonicalField,
} from "@/lib/types";

/* ============================================================
   CAMPOS DO MAPEAMENTO CSV

   Mantemos a chave interna "dataVencimento" porque ela já está
   integrada ao restante do sistema, mas na interface o usuário
   enxerga "Tipo".
============================================================ */

const fields: Array<{
  key: CanonicalField;
  label: string;
}> = [
  {
    key: "cliente",
    label:
      "Cliente / Fornecedor",
  },

  {
    key:
      "dataVencimento",
    label:
      "Tipo",
  },

  {
    key:
      "dataPagamento",
    label:
      "Data do pagamento",
  },

  {
    key:
      "documento",
    label:
      "Documento",
  },

  {
    key:
      "valor",
    label:
      "Valor pago",
  },
];

/* ============================================================
   TIPOS
============================================================ */

interface ContaContabil {
  id: number;
  codigo: string;
  nome: string;
}

interface Props {
  open: boolean;

  bank:
    | BankConfig
    | null;

  headers:
    string[];

  company:
    number;

  onClose:
    () => void;

  onSave:
    (
      bank:
        BankConfig
    ) => void;
}

/* ============================================================
   CACHE LOCAL

   A lista é salva por empresa.
   O botão "Atualizar lista" ignora esse cache e busca novamente.
============================================================ */

function cacheKey(
  company:
    number
): string {
  return `conciliacao-m8-plano-contas-v1-company-${company}`;
}

/* ============================================================
   TEXTO DA CONTA
============================================================ */

function contaLabel(
  conta:
    ContaContabil
): string {
  const codigo =
    String(
      conta.codigo ??
      ""
    ).trim();

  const nome =
    String(
      conta.nome ??
      ""
    ).trim();

  if (
    codigo &&
    nome
  ) {
    return `${codigo} - ${nome}`;
  }

  return (
    nome ||
    codigo ||
    `ID ${conta.id}`
  );
}

/* ============================================================
   NORMALIZAR PESQUISA
============================================================ */

function normalizarTexto(
  value:
    unknown
): string {
  return String(
    value ??
    ""
  )
    .normalize(
      "NFD"
    )
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toUpperCase()
    .trim();
}

/* ============================================================
   COMPONENTE
============================================================ */

export default function BankConfigModal({
  open,
  bank,
  headers,
  company,
  onClose,
  onSave,
}: Props) {
  const [
    draft,
    setDraft,
  ] =
    useState<
      BankConfig |
      null
    >(bank);

  const [
    contas,
    setContas,
  ] =
    useState<
      ContaContabil[]
    >([]);

  const [
    pesquisaConta,
    setPesquisaConta,
  ] =
    useState("");

  const [
    loadingContas,
    setLoadingContas,
  ] =
    useState(false);

  const [
    erroContas,
    setErroContas,
  ] =
    useState("");

  const [
    listaAberta,
    setListaAberta,
  ] =
    useState(false);

  const [
    listaCarregada,
    setListaCarregada,
  ] =
    useState(false);

  /* ==========================================================
     ATUALIZAR DRAFT
  ========================================================== */

  useEffect(
    () => {
      setDraft(
        bank
      );

      setPesquisaConta(
        ""
      );

      setListaAberta(
        false
      );
    },
    [
      bank,
    ]
  );

  /* ==========================================================
     CARREGAR CACHE AO ABRIR
  ========================================================== */

  useEffect(
    () => {
      if (
        !open ||
        !company
      ) {
        return;
      }

      setErroContas(
        ""
      );

      setListaCarregada(
        false
      );

      try {
        const saved =
          localStorage.getItem(
            cacheKey(
              company
            )
          );

        if (
          saved
        ) {
          const parsed =
            JSON.parse(
              saved
            );

          if (
            Array.isArray(
              parsed
            )
          ) {
            setContas(
              parsed
            );

            setListaCarregada(
              true
            );

            return;
          }
        }
      } catch {
        /*
         * Se o cache estiver inválido, apenas busca novamente.
         */
      }

      void carregarContas(
        false
      );
    },
    [
      open,
      company,
    ]
  );

  /* ==========================================================
     BUSCAR PLANO DE CONTAS
  ========================================================== */

  async function carregarContas(
    forcarAtualizacao:
      boolean
  ) {
    if (
      !Number.isFinite(
        Number(
          company
        )
      ) ||
      Number(
        company
      ) <= 0
    ) {
      setErroContas(
        "Empresa M8 inválida."
      );

      return;
    }

    if (
      !forcarAtualizacao &&
      listaCarregada &&
      contas.length
    ) {
      return;
    }

    setLoadingContas(
      true
    );

    setErroContas(
      ""
    );

    try {
      const response =
        await fetch(
          `/api/m8/planocontas?company=${encodeURIComponent(
            String(
              company
            )
          )}`,
          {
            method:
              "GET",

            cache:
              "no-store",
          }
        );

      const body =
        await response.json();

      if (
        !response.ok
      ) {
        throw new Error(
          body?.error ||
          `Erro HTTP ${response.status}`
        );
      }

      const lista:
        ContaContabil[] =
        Array.isArray(
          body?.contas
        )
          ? body.contas
          : [];

      setContas(
        lista
      );

      setListaCarregada(
        true
      );

      localStorage.setItem(
        cacheKey(
          company
        ),
        JSON.stringify(
          lista
        )
      );
    } catch (
      error
    ) {
      setErroContas(
        error instanceof
        Error
          ? error.message
          : "Não foi possível carregar o plano de contas."
      );
    } finally {
      setLoadingContas(
        false
      );
    }
  }

  /* ==========================================================
     CONTA ATUALMENTE SELECIONADA
  ========================================================== */

  const contaSelecionada =
    useMemo(
      () => {
        const id =
          Number(
            draft?.m8
              .contaContabilId ??
            0
          );

        if (
          !id
        ) {
          return null;
        }

        return (
          contas.find(
            (conta) =>
              Number(
                conta.id
              ) ===
              id
          ) ||
          null
        );
      },
      [
        contas,
        draft?.m8
          .contaContabilId,
      ]
    );

  /* ==========================================================
     FILTRAR CONTAS

     Pesquisa por:
     - código
     - nome
     - ID
  ========================================================== */

  const contasFiltradas =
    useMemo(
      () => {
        const busca =
          normalizarTexto(
            pesquisaConta
          );

        const base =
          busca
            ? contas.filter(
                (
                  conta
                ) => {
                  const texto =
                    normalizarTexto(
                      `${conta.codigo} ${conta.nome} ${conta.id}`
                    );

                  return texto.includes(
                    busca
                  );
                }
              )
            : contas;

        /*
         * Limite visual para não renderizar milhares
         * de opções ao mesmo tempo.
         *
         * A pesquisa continua considerando a lista inteira.
         */
        return base.slice(
          0,
          100
        );
      },
      [
        contas,
        pesquisaConta,
      ]
    );

  if (
    !open ||
    !draft
  ) {
    return null;
  }

  /* ==========================================================
     ATUALIZAR MAPEAMENTO
  ========================================================== */

  const updateMapping = (
    key:
      CanonicalField,

    value:
      string
  ) =>
    setDraft(
      (
        atual
      ) => {
        if (
          !atual
        ) {
          return atual;
        }

        return {
          ...atual,

          mapping: {
            ...atual.mapping,

            [key]:
              value,
          },
        };
      }
    );

  /* ==========================================================
     ATUALIZAR CONFIGURAÇÃO M8
  ========================================================== */

  const updateM8 = (
    key:
      keyof BankConfig[
        "m8"
      ],

    value:
      string
  ) =>
    setDraft(
      (
        atual
      ) => {
        if (
          !atual
        ) {
          return atual;
        }

        return {
          ...atual,

          m8: {
            ...atual.m8,

            [key]:
              [
                "contaContabilId",
                "historicoId",
                "meioPagamentoId",
              ].includes(
                key
              )
                ? Number(
                    value
                  )
                : value,
          },
        };
      }
    );

  /* ==========================================================
     SELECIONAR CONTA
  ========================================================== */

  function selecionarConta(
    conta:
      ContaContabil
  ) {
    setDraft(
      (
        atual
      ) => {
        if (
          !atual
        ) {
          return atual;
        }

        return {
          ...atual,

          m8: {
            ...atual.m8,

            contaContabilId:
              Number(
                conta.id
              ),
          },
        };
      }
    );

    setPesquisaConta(
      ""
    );

    setListaAberta(
      false
    );
  }

  /* ==========================================================
     LIMPAR CONTA
  ========================================================== */

  function limparConta() {
    setDraft(
      (
        atual
      ) => {
        if (
          !atual
        ) {
          return atual;
        }

        return {
          ...atual,

          m8: {
            ...atual.m8,

            contaContabilId:
              0,
          },
        };
      }
    );

    setPesquisaConta(
      ""
    );

    setListaAberta(
      true
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">

        {/* ====================================================
            CABEÇALHO
        ==================================================== */}

        <div className="modal-title">
          <div>
            <h2>
              Configuração do banco
            </h2>

            <p>
              Mapeie o layout do CSV e os IDs usados na baixa do M8.
            </p>
          </div>

          <button
            type="button"
            className="icon-button"
            onClick={
              onClose
            }
          >
            ×
          </button>
        </div>

        {/* ====================================================
            NOME DO BANCO
        ==================================================== */}

        <label>
          Nome do banco

          <input
            value={
              draft.nome
            }
            onChange={(
              e
            ) =>
              setDraft({
                ...draft,

                nome:
                  e.target
                    .value,
              })
            }
          />
        </label>

        {/* ====================================================
            MAPEAMENTO CSV
        ==================================================== */}

        <h3>
          Mapeamento do CSV
        </h3>

        <div className="form-grid">
          {fields.map(
            (
              f
            ) => (
              <label
                key={
                  f.key
                }
              >
                {f.label}

                <select
                  value={
                    draft
                      .mapping[
                      f.key
                    ]
                  }
                  onChange={(
                    e
                  ) =>
                    updateMapping(
                      f.key,
                      e.target
                        .value
                    )
                  }
                >
                  <option value="">
                    Selecione...
                  </option>

                  {headers.map(
                    (
                      h,
                      i
                    ) => (
                      <option
                        key={
                          h
                        }
                        value={
                          h
                        }
                      >
                        {i +
                          1}{" "}
                        -{" "}
                        {h}
                      </option>
                    )
                  )}
                </select>
              </label>
            )
          )}
        </div>

        {/* ====================================================
            CONFIGURAÇÃO M8
        ==================================================== */}

        <h3>
          Configuração M8 para baixa
        </h3>

        <div
          className="form-grid three"
          style={{
            alignItems:
              "start",
          }}
        >

          {/* ==================================================
              CONTA CONTÁBIL
          ================================================== */}

          <div
            style={{
              position:
                "relative",
            }}
          >
            <label>
              Conta Contábil

              {/* ==============================================
                  CONTA SELECIONADA
              ============================================== */}

              {draft.m8
                .contaContabilId >
              0 ? (
                <div
                  style={{
                    display:
                      "flex",

                    alignItems:
                      "center",

                    gap:
                      "8px",
                  }}
                >
                  <div
                    title={
                      contaSelecionada
                        ? contaLabel(
                            contaSelecionada
                          )
                        : `ID ${draft.m8.contaContabilId}`
                    }
                    style={{
                      display:
                        "flex",

                      alignItems:
                        "center",

                      minHeight:
                        "40px",

                      flex:
                        1,

                      padding:
                        "8px 10px",

                      background:
                        "#f8fbff",

                      border:
                        "1px solid #cfd9e6",

                      borderRadius:
                        "8px",

                      color:
                        "#17263d",

                      fontSize:
                        "13px",

                      lineHeight:
                        1.25,
                    }}
                  >
                    {contaSelecionada
                      ? contaLabel(
                          contaSelecionada
                        )
                      : `Conta Contábil ID ${draft.m8.contaContabilId}`}
                  </div>

                  <button
                    type="button"
                    className="button secondary"
                    onClick={
                      limparConta
                    }
                    title="Alterar conta contábil"
                    style={{
                      minWidth:
                        "72px",

                      height:
                        "40px",

                      padding:
                        "0 10px",
                    }}
                  >
                    Alterar
                  </button>
                </div>
              ) : (
                <input
                  value={
                    pesquisaConta
                  }
                  placeholder={
                    loadingContas
                      ? "Carregando contas..."
                      : "Pesquisar código ou nome..."
                  }
                  disabled={
                    loadingContas
                  }
                  onFocus={() =>
                    setListaAberta(
                      true
                    )
                  }
                  onChange={(
                    e
                  ) => {
                    setPesquisaConta(
                      e.target
                        .value
                    );

                    setListaAberta(
                      true
                    );
                  }}
                  autoComplete="off"
                />
              )}
            </label>

            {/* ================================================
                RESULTADOS DA PESQUISA
            ================================================ */}

            {draft.m8
                .contaContabilId <=
              0 &&
              listaAberta &&
              !loadingContas && (
                <div
                  style={{
                    position:
                      "absolute",

                    zIndex:
                      30,

                    top:
                      "66px",

                    left:
                      0,

                    right:
                      0,

                    maxHeight:
                      "260px",

                    overflowY:
                      "auto",

                    background:
                      "white",

                    border:
                      "1px solid #cfd9e6",

                    borderRadius:
                      "8px",

                    boxShadow:
                      "0 10px 28px rgba(25, 45, 70, 0.16)",
                  }}
                >
                  {contasFiltradas
                    .length >
                  0 ? (
                    contasFiltradas.map(
                      (
                        conta
                      ) => (
                        <button
                          key={
                            conta.id
                          }
                          type="button"
                          onClick={() =>
                            selecionarConta(
                              conta
                            )
                          }
                          style={{
                            display:
                              "block",

                            width:
                              "100%",

                            padding:
                              "9px 11px",

                            textAlign:
                              "left",

                            background:
                              "white",

                            border:
                              0,

                            borderBottom:
                              "1px solid #edf1f5",

                            color:
                              "#17263d",

                            cursor:
                              "pointer",

                            fontSize:
                              "12px",

                            lineHeight:
                              1.35,
                          }}
                          title={
                            contaLabel(
                              conta
                            )
                          }
                        >
                          <strong>
                            {conta.codigo ||
                              `ID ${conta.id}`}
                          </strong>

                          {conta.nome && (
                            <>
                              {" "}
                              -{" "}
                              {conta.nome}
                            </>
                          )}
                        </button>
                      )
                    )
                  ) : (
                    <div
                      style={{
                        padding:
                          "12px",

                        color:
                          "#718094",

                        fontSize:
                          "12px",
                      }}
                    >
                      Nenhuma conta encontrada.
                    </div>
                  )}

                  {contasFiltradas
                      .length >=
                    100 && (
                    <div
                      style={{
                        padding:
                          "8px 11px",

                        background:
                          "#f8fafc",

                        color:
                          "#718094",

                        fontSize:
                          "11px",
                      }}
                    >
                      Mostrando os primeiros 100 resultados. Digite mais caracteres para refinar a pesquisa.
                    </div>
                  )}
                </div>
              )}

            {/* ================================================
                CONTROLES DA LISTA
            ================================================ */}

            <div
              style={{
                display:
                  "flex",

                alignItems:
                  "center",

                justifyContent:
                  "space-between",

                gap:
                  "8px",

                marginTop:
                  "6px",
              }}
            >
              <span
                style={{
                  color:
                    erroContas
                      ? "#b42318"
                      : "#718094",

                  fontSize:
                    "11px",

                  lineHeight:
                    1.3,
                }}
              >
                {erroContas
                  ? erroContas
                  : loadingContas
                    ? "Consultando plano de contas no M8..."
                    : `${contas.length} conta(s) disponível(is)`}
              </span>

              <button
                type="button"
                className="link-button"
                disabled={
                  loadingContas
                }
                onClick={() =>
                  void carregarContas(
                    true
                  )
                }
                style={{
                  whiteSpace:
                    "nowrap",
                }}
              >
                {loadingContas
                  ? "Atualizando..."
                  : "↻ Atualizar lista"}
              </button>
            </div>
          </div>

          {/* ==================================================
              HISTÓRICO
          ================================================== */}

          <label>
            Histórico ID

            <input
              type="number"
              min="0"
              value={
                draft.m8
                  .historicoId
              }
              onChange={(
                e
              ) =>
                updateM8(
                  "historicoId",
                  e.target
                    .value
                )
              }
            />
          </label>

          {/* ==================================================
              MEIO DE PAGAMENTO
          ================================================== */}

          <label>
            Meio Pagamento ID

            <input
              type="number"
              min="0"
              value={
                draft.m8
                  .meioPagamentoId
              }
              onChange={(
                e
              ) =>
                updateM8(
                  "meioPagamentoId",
                  e.target
                    .value
                )
              }
            />
          </label>
        </div>

        {/* ====================================================
            OBSERVAÇÃO
        ==================================================== */}

        <label>
          Observação interna

          <input
            value={
              draft.m8
                .observacaoInterna
            }
            onChange={(
              e
            ) =>
              updateM8(
                "observacaoInterna",
                e.target
                  .value
              )
            }
          />
        </label>

        {/* ====================================================
            COMPLEMENTO
        ==================================================== */}

        <label>
          Complemento

          <input
            value={
              draft.m8
                .complemento
            }
            onChange={(
              e
            ) =>
              updateM8(
                "complemento",
                e.target
                  .value
              )
            }
          />
        </label>

        {/* ====================================================
            BOTÕES
        ==================================================== */}

        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            onClick={
              onClose
            }
          >
            Cancelar
          </button>

          <button
            type="button"
            className="button primary"
            onClick={() =>
              onSave(
                draft
              )
            }
          >
            Salvar configuração
          </button>
        </div>

      </div>
    </div>
  );
}

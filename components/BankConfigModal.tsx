"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  BankConfig,
  CanonicalField,
} from "@/lib/types";

/* ============================================================
   CAMPOS DE MAPEAMENTO DO CSV

   IMPORTANTE:
   O campo interno "dataVencimento" está sendo reaproveitado
   para mapear a coluna Tipo do CSV.

   Exemplo:
   C = Crédito
   D = Débito

   Mantemos a chave interna para não alterar a estrutura que
   já está funcionando no restante do sistema.
============================================================ */

const fields: Array<{
  key: CanonicalField;
  label: string;
}> = [
  {
    key: "cliente",
    label: "Cliente / Fornecedor",
  },
  {
    key: "dataVencimento",
    label: "Tipo",
  },
  {
    key: "dataPagamento",
    label: "Data do pagamento",
  },
  {
    key: "documento",
    label: "Documento",
  },
  {
    key: "valor",
    label: "Valor pago",
  },
];

interface Props {
  open: boolean;

  bank:
    | BankConfig
    | null;

  headers: string[];

  onClose: () => void;

  onSave: (
    bank: BankConfig
  ) => void;
}

export default function BankConfigModal({
  open,
  bank,
  headers,
  onClose,
  onSave,
}: Props) {
  const [
    draft,
    setDraft,
  ] =
    useState<
      BankConfig | null
    >(bank);

  useEffect(
    () =>
      setDraft(bank),
    [bank]
  );

  if (
    !open ||
    !draft
  ) {
    return null;
  }

  /* ==========================================================
     ATUALIZAR MAPEAMENTO CSV
  ========================================================== */

  const updateMapping = (
    key: CanonicalField,
    value: string
  ) =>
    setDraft({
      ...draft,

      mapping: {
        ...draft.mapping,

        [key]:
          value,
      },
    });

  /* ==========================================================
     ATUALIZAR CONFIGURAÇÃO M8
  ========================================================== */

  const updateM8 = (
    key:
      keyof BankConfig["m8"],
    value: string
  ) =>
    setDraft({
      ...draft,

      m8: {
        ...draft.m8,

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
    });

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
            (f) => (
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

        <div className="form-grid three">
          <label>
            Conta Contábil ID

            <input
              type="number"
              min="0"
              value={
                draft.m8
                  .contaContabilId
              }
              onChange={(
                e
              ) =>
                updateM8(
                  "contaContabilId",
                  e.target
                    .value
                )
              }
            />
          </label>

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
            className="button secondary"
            onClick={
              onClose
            }
          >
            Cancelar
          </button>

          <button
            className="button primary"
            onClick={
              () =>
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
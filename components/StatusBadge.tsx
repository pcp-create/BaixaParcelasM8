import {
  IntegrationStatus,
} from "@/lib/types";

interface Props {
  status: IntegrationStatus;
}

/* ============================================================
   TEXTOS
============================================================ */

const labels:
  Record<
    IntegrationStatus,
    string
  > = {
  aguardando:
    "Aguardando",

  conciliando:
    "Conciliando",

  pronto:
    "Pronto para baixa",

  baixando:
    "Baixando",

  baixada:
    "Parcela baixada",

  ja_baixada:
    "Já baixada no M8",

  parcialmente_baixada:
    "Baixa parcial",

  credito:
    "Crédito",

  nao_encontrado:
    "Não encontrado",

  conflito:
    "Conflito",

  erro:
    "Erro",
};

/* ============================================================
   COMPONENTE
============================================================ */

export default function StatusBadge({
  status,
}: Props) {
  const label =
    labels[status] ||
    status;

  /*
   * Mantemos a classe padrão do projeto.
   *
   * Para "credito", adicionamos também uma aparência
   * própria inline, evitando a necessidade de alterar
   * o globals.css agora.
   */
  const creditStyle =
    status ===
    "credito"
      ? {
          background:
            "#e8f4ff",

          border:
            "1px solid #9bc8ef",

          color:
            "#1769aa",
        }
      : undefined;

  return (
    <span
      className={`status status-${status}`}
      style={
        creditStyle
      }
    >
      {label}
    </span>
  );
}

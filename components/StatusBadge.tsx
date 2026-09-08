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

  return (
    <span
      className={`status status-${status}`}
    >
      {label}
    </span>
  );
}
import { IntegrationStatus } from "@/lib/types";

const labels: Record<IntegrationStatus, string> = {
  aguardando: "Aguardando",
  conciliando: "Conciliando",
  pronto: "Pronto para baixa",
  nao_encontrado: "Não encontrado",
  conflito: "Conflito",
  baixando: "Baixando",
  baixada: "Parcela Baixada",
  erro: "Erro"
};

export default function StatusBadge({ status }: { status: IntegrationStatus }) {
  return <span className={`status status-${status}`}>{labels[status]}</span>;
}

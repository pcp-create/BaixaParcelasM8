"use client";

import { useState } from "react";
import { parseAdjustment } from "@/lib/amount-adjustment";

export default function AdjustmentInput({ value, disabled, rowNumber, onChange }: {
  value: number | null | undefined;
  disabled: boolean;
  rowNumber: number;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(String(value ?? 0).replace(".", ","));
  return <input
    className="column-filter adjustment-input"
    type="text"
    inputMode="decimal"
    aria-label={`Valor juros da linha ${rowNumber}`}
    aria-invalid={value === null}
    title="Juros incluídos no extrato. O principal é o valor do extrato menos os juros. Travado após conciliar."
    disabled={disabled}
    value={text}
    onChange={(event) => {
      setText(event.target.value);
      onChange(parseAdjustment(event.target.value));
    }}
    onBlur={() => { if (value !== null) setText((value ?? 0).toFixed(2).replace(".", ",")); }}
  />;
}

"use client";

import { GlassCard, GlassInput } from "./glass-card";
import type { ProcessDates } from "@/lib/data";

interface DateFieldsProps {
  dates: ProcessDates;
  onDatesChange?: (dates: ProcessDates) => void;
  compact?: boolean;
}

export function DateFields({ dates, onDatesChange, compact = false }: DateFieldsProps) {
  return (
    <GlassCard className={compact ? "p-4" : "p-6"}>
      <h3 className={compact ? "mb-3 text-[11px] font-medium uppercase tracking-wider text-primary" : "mb-4 text-xs font-medium uppercase tracking-wider text-primary"}>
        Datas do Processo
      </h3>
      <div className={compact ? "grid gap-4 sm:grid-cols-2" : "grid gap-6 sm:grid-cols-2"}>
        <GlassInput
          label="Data de Apuração"
          type="text"
          value={dates.apuracao}
          onChange={(e) =>
            onDatesChange?.({ ...dates, apuracao: e.target.value })
          }
          placeholder="DD/MM/AAAA"
        />
        <GlassInput
          label="Data de Vencimento"
          type="text"
          value={dates.vencimento}
          onChange={(e) =>
            onDatesChange?.({ ...dates, vencimento: e.target.value })
          }
          placeholder="DD/MM/AAAA"
        />
      </div>
    </GlassCard>
  );
}

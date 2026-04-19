"use client";

import { GlassCard, GlassInput } from "./glass-card";
import type { ProcessDates } from "@/lib/data";

interface DateFieldsProps {
  dates: ProcessDates;
  onDatesChange?: (dates: ProcessDates) => void;
}

export function DateFields({ dates, onDatesChange }: DateFieldsProps) {
  return (
    <GlassCard className="p-6">
      <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-primary">
        Datas do Processo
      </h3>
      <div className="grid gap-6 sm:grid-cols-2">
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

"use client";

import { Table2, ListTodo, Settings, Circle } from "lucide-react";
import { GlassButton } from "./glass-card";

interface HeaderProps {
  chromeStatus?: "pronto" | "carregando" | "erro";
  onOpenTabelas?: () => void;
  onOpenFilaTrabalho?: () => void;
  onOpenConfiguracoes?: () => void;
  onOpenChrome?: () => void;
  chromeActionDisabled?: boolean;
}

export function Header({
  chromeStatus = "pronto",
  onOpenTabelas,
  onOpenFilaTrabalho,
  onOpenConfiguracoes,
  onOpenChrome,
  chromeActionDisabled = false,
}: HeaderProps) {
  const statusColor = {
    pronto: "text-success",
    carregando: "text-warning",
    erro: "text-destructive",
  };

  const statusText = {
    pronto: "Chrome disponível",
    carregando: "Verificando Chrome...",
    erro: "Chrome indisponível",
  };

  return (
    <header className="sticky top-0 z-50 border-b border-glass-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <h1 className="text-lg font-semibold text-foreground tracking-tight">
          AutoLiquid
          <span className="ml-2 text-xs font-normal text-muted-foreground tracking-normal">
            · DCF / Liquidação
          </span>
        </h1>

        <nav className="flex items-center gap-2">
          <GlassButton
            variant="ghost"
            size="sm"
            onClick={onOpenTabelas}
            disabled={!onOpenTabelas}
            title={onOpenTabelas ? undefined : "Ação ainda não disponível nesta tela"}
          >
            <Table2 className="h-4 w-4" />
            Tabelas
          </GlassButton>

          <GlassButton
            variant="ghost"
            size="sm"
            onClick={onOpenFilaTrabalho}
            disabled={!onOpenFilaTrabalho}
            title={onOpenFilaTrabalho ? undefined : "Ação ainda não disponível nesta tela"}
          >
            <ListTodo className="h-4 w-4" />
            Fila de Trabalho
          </GlassButton>

          <GlassButton
            variant="ghost"
            size="sm"
            onClick={onOpenChrome}
            disabled={!onOpenChrome || chromeActionDisabled}
            title={
              onOpenChrome
                ? "Abrir ou reconectar o Chrome na página inicial da automação"
                : "Ação indisponível nesta tela"
            }
          >
            <Circle className={`h-3 w-3 fill-current ${statusColor[chromeStatus]}`} />
            <span className={statusColor[chromeStatus]}>{statusText[chromeStatus]}</span>
          </GlassButton>

          <GlassButton
            variant="ghost"
            size="sm"
            onClick={onOpenConfiguracoes}
            disabled={!onOpenConfiguracoes}
            title={onOpenConfiguracoes ? undefined : "Configurações web ainda não implementadas"}
          >
            <Settings className="h-4 w-4" />
            Configurações
          </GlassButton>
        </nav>
      </div>
    </header>
  );
}

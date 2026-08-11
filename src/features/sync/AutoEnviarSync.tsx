import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { syncEnviar } from "../../lib/api";

/**
 * Envio automático com debounce (Q3, docs/plans/2026-08-11-sync-google-drive.md
 * Fase 5): depois de qualquer mutação de dado bem-sucedida em QUALQUER tela
 * (fichas, mapa, batalha, notas — a mesma superfície que os triggers de
 * `sync_revisao` cobrem, migration 0012), espera `DEBOUNCE_MS` de quietude e
 * então tenta `sync_enviar(forcar=false)`.
 *
 * Sem UI (`return null`) e fora do `Outlet`, montado uma vez no `AppShell` —
 * igual `SyncBootDriver`/`DiscordConexaoDriver` — porque a mutação pode vir de
 * qualquer rota, não só da tela Sync.
 *
 * Escolha de implementação (Q3 pedia frontend OU timer no backend): frontend
 * com o `MutationCache` do React Query, porque toda mutação do app já passa
 * por `useMutation` — não precisa de um novo mecanismo de "o que mudou" nem
 * de tocar nos ~20 arquivos que chamam `invoke`. O envio em si chama
 * `syncEnviar` DIRETO (fora de um `useMutation`), então ele não aparece de
 * volta no `MutationCache` e não reagenda a si mesmo.
 *
 * Não força: `sync_enviar(false)` já recusa sozinho quando a nuvem está mais
 * nova (guarda leve em `sincronizacao_nuvem::enviar`) — aqui só chama e
 * ignora silenciosamente o resultado quando não deu pra mandar (sem
 * transporte configurado, conflito, ou erro de rede). É automático em
 * segundo plano; a tela Sync e o diálogo de conflito do boot já avisam o
 * usuário quando importa.
 */
const DEBOUNCE_MS = 8_000;

export default function AutoEnviarSync() {
  const qc = useQueryClient();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function agendarEnvio() {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        syncEnviar(false)
          .then((resultado) => {
            if (resultado.sucesso) qc.invalidateQueries({ queryKey: ["sync"] });
          })
          .catch(() => {
            // Falha de transporte (sem internet, cofre trancado, token
            // expirado) não deve interromper o usuário no meio de outra
            // tarefa — a próxima mutação reagenda outra tentativa.
          });
      }, DEBOUNCE_MS);
    }

    const unsubscribe = qc.getMutationCache().subscribe((evento) => {
      if (evento.type === "updated" && evento.mutation.state.status === "success") {
        agendarEnvio();
      }
    });

    return () => {
      unsubscribe();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [qc]);

  return null;
}

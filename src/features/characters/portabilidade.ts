import { open, save } from "@tauri-apps/plugin-dialog";
import { exportarFichas, importarFichas } from "../../lib/api";
import type { ResultadoImport } from "../../lib/types";

const FILTRO = [{ name: "Ficha do RPG", extensions: ["json"] }];

/** Nome de arquivo seguro: troca o que o Windows não aceita por `-`. */
function sanitizar(nome: string) {
  return nome.replace(/[<>:"/\\|?*]/g, "-").trim() || "ficha";
}

/** `fichas-2026-08-09.json` — data local, não UTC. */
export function nomeArquivoLote() {
  const hoje = new Date();
  const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(
    hoje.getDate(),
  ).padStart(2, "0")}`;
  return `fichas-${iso}.json`;
}

/**
 * Abre o "Salvar como" e grava as fichas. Devolve quantas foram, ou `null` se
 * o usuário cancelou (cancelar não é erro — não deve virar toast vermelho).
 */
export async function exportarComDialogo(
  ids: number[],
  nomeSugerido: string,
): Promise<number | null> {
  const caminho = await save({
    title: ids.length === 1 ? "Exportar ficha" : "Exportar fichas",
    defaultPath: sanitizar(nomeSugerido),
    filters: FILTRO,
  });
  if (!caminho) return null;
  return exportarFichas(ids, caminho);
}

/** Abre o "Abrir arquivo" e importa. `null` = cancelado. */
export async function importarComDialogo(): Promise<ResultadoImport | null> {
  const caminho = await open({
    title: "Importar fichas",
    multiple: false,
    directory: false,
    filters: FILTRO,
  });
  if (typeof caminho !== "string") return null;
  return importarFichas(caminho);
}

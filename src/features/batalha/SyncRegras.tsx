import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  atualizarCatalogoPericia,
  atualizarCatalogoTraco,
  atualizarNota,
  configGet,
  configSet,
  criarCatalogoPericia,
  criarCatalogoTraco,
  criarNota,
  discordLerCanal,
  listarCatalogos,
  listarNotas,
} from "../../lib/api";
import type {
  CanalTexto,
  CatalogoPericiaInput,
  CatalogoTracoInput,
} from "../../lib/types";
import { concatenarMensagens, diffPorNome, type DiffResultado } from "../../lib/diffCatalogo";
import { extrairPericias, extrairTracos } from "../balanceamento/extracao";
import { CONFIG_REGRAS_NOTAS } from "../balanceamento/prompts";
import { useToast } from "../../components/Toast";

const CONFIG_MAPA = "sync_regras_mapa";
const LIMITE_MENSAGENS = 200;

// "nota" = regra (entra no contexto da IA); "nota_livre" = fica só na tela de
// Notas — caso de #ficha (ficha de exemplo) e #dicas-do-mestre (cita outro RPG).
type Destino = "" | "nota" | "nota_livre" | "pericias" | "vantagens" | "desvantagens";

/** Slugs CSV não têm ordem garantida — "percepcao,intuicao" == "intuicao,percepcao". */
function atributoIguais(a: string, b: string): boolean {
  const normalizar = (s: string) =>
    s.split(",").map((v) => v.trim()).filter(Boolean).sort().join(",");
  return normalizar(a) === normalizar(b);
}

type Preview =
  | { destino: "pericias"; canalNome: string; diff: DiffResultado<CatalogoPericiaInput> }
  | {
      destino: "vantagens" | "desvantagens";
      canalNome: string;
      diff: DiffResultado<CatalogoTracoInput>;
    };

/** Upsert de nota por título: atualiza se existir, cria se não. */
async function upsertNotaPorTitulo(titulo: string, corpo: string): Promise<void> {
  const resumos = await listarNotas();
  const existente = resumos.find((r) => r.titulo === titulo);
  if (existente) await atualizarNota(existente.id, { titulo, corpo });
  else await criarNota({ titulo, corpo });
}

export default function SyncRegras({
  canais,
  conectado,
}: {
  canais: CanalTexto[];
  conectado: boolean;
}) {
  const [mapa, setMapa] = useState<Record<string, Destino>>({});
  const [previews, setPreviews] = useState<Preview[]>([]);
  const toast = useToast();
  const qc = useQueryClient();

  const { data: mapaSalvo } = useQuery({
    queryKey: ["config", CONFIG_MAPA],
    queryFn: () => configGet(CONFIG_MAPA),
  });
  useEffect(() => {
    if (mapaSalvo) {
      try {
        setMapa(JSON.parse(mapaSalvo) as Record<string, Destino>);
      } catch {
        // config corrompida: começa vazio, próximo salvar conserta
      }
    }
  }, [mapaSalvo]);

  function definirDestino(canalId: string, destino: Destino) {
    const novo = { ...mapa, [canalId]: destino };
    if (!destino) delete novo[canalId];
    setMapa(novo);
    void configSet(CONFIG_MAPA, JSON.stringify(novo));
  }

  const sincronizarMut = useMutation({
    // Duas fases: 1) só leitura/extração em memória, 2) grava. Se um canal
    // qualquer falhar (extração inválida, erro de leitura), a fase 1 aborta
    // antes de qualquer nota ser gravada — senão um erro no meio do lote
    // deixaria metade das notas salvas e a outra metade perdida.
    mutationFn: async () => {
      const escolhidos = canais.filter((c) => mapa[c.id]);
      if (escolhidos.length === 0) throw new Error("Nenhum canal com destino definido.");
      const catalogos = await listarCatalogos();

      // Fase 1: ler + extrair, sem gravar nada.
      const notasPendentes: { titulo: string; corpo: string; ehRegra: boolean }[] = [];
      const novosPreviews: Preview[] = [];

      for (const canal of escolhidos) {
        const texto = concatenarMensagens(await discordLerCanal(canal.id, LIMITE_MENSAGENS));
        if (!texto) continue; // canal vazio (ou intent do portal desligado)
        const destino = mapa[canal.id];

        if (destino === "nota" || destino === "nota_livre") {
          notasPendentes.push({
            titulo: `#${canal.nome}`,
            corpo: texto,
            ehRegra: destino === "nota",
          });
        } else if (destino === "pericias") {
          const extraidas = await extrairPericias(texto);
          novosPreviews.push({
            destino,
            canalNome: canal.nome,
            diff: diffPorNome(catalogos.pericias, extraidas, (a, n) =>
              a.descricao === n.descricao && atributoIguais(a.atributo, n.atributo),
            ),
          });
        } else if (destino === "vantagens" || destino === "desvantagens") {
          const extraidas = await extrairTracos(
            texto,
            destino === "vantagens" ? "vantagem" : "desvantagem",
          );
          const atuais = destino === "vantagens" ? catalogos.vantagens : catalogos.desvantagens;
          novosPreviews.push({
            destino,
            canalNome: canal.nome,
            diff: diffPorNome(atuais, extraidas, (a, n) =>
              a.descricao === n.descricao && a.efeito === n.efeito,
            ),
          });
        }
      }

      // Canais homônimos (dois canais "ficha") upsertam a mesma nota em sequência —
      // o segundo sobrescreve o primeiro silenciosamente. Não impede (upsert
      // continua valendo), só avisa pro dono ignorar um dos dois canais.
      const titulosRepetidos = [
        ...new Set(
          notasPendentes
            .map((n) => n.titulo)
            .filter((titulo, i, todos) => todos.indexOf(titulo) !== i),
        ),
      ];

      // Fase 2: só chega aqui se a fase 1 inteira passou — grava as notas.
      const titulosRegras = new Set<string>();
      for (const n of notasPendentes) {
        await upsertNotaPorTitulo(n.titulo, n.corpo);
        if (n.ehRegra) titulosRegras.add(n.titulo);
      }
      const titulosNotas = [...titulosRegras];
      await configSet(CONFIG_REGRAS_NOTAS, JSON.stringify(titulosNotas));
      return { titulosNotas, novosPreviews, titulosRepetidos };
    },
    onSuccess: ({ titulosNotas, novosPreviews, titulosRepetidos }) => {
      qc.invalidateQueries({ queryKey: ["notas"] });
      qc.invalidateQueries({ queryKey: ["config"] });
      setPreviews(novosPreviews);
      if (titulosRepetidos.length > 0) {
        toast.erro(
          `Canais homônimos: ${titulosRepetidos.join(", ")} — só o último escolhido foi salvo. Ignore um dos canais duplicados.`,
        );
      }
      toast.sucesso(
        `${titulosNotas.length} nota(s) de regra sincronizada(s)` +
          (novosPreviews.length > 0 ? " — revise o catálogo abaixo." : "."),
      );
    },
    onError: (e) => toast.erro(String(e)),
  });

  const aplicarMut = useMutation({
    mutationFn: async () => {
      for (const p of previews) {
        if (p.destino === "pericias") {
          for (const nova of p.diff.criar) await criarCatalogoPericia(nova);
          for (const a of p.diff.atualizar) await atualizarCatalogoPericia(a.id, a.nova);
        } else {
          const tipo = p.destino === "vantagens" ? "vantagem" : "desvantagem";
          for (const nova of p.diff.criar) await criarCatalogoTraco(tipo, nova);
          for (const a of p.diff.atualizar) await atualizarCatalogoTraco(tipo, a.id, a.nova);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogos"] });
      setPreviews([]);
      toast.sucesso("Compêndio atualizado.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  if (!conectado) return null;

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Regras do jogo
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Escolha o destino de cada canal: Nota (regra, entra no contexto da IA),
          Nota (não é regra, fica só na tela de Notas — ex.: ficha de exemplo, etiqueta
          de mesa) ou Compêndio (extração via IA, com revisão antes de gravar).
        </p>
      </div>

      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
        {canais.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm text-slate-300">#{c.nome}</span>
            <select
              value={mapa[c.id] ?? ""}
              onChange={(e) => definirDestino(c.id, e.target.value as Destino)}
              className="h-8 rounded-lg border border-slate-800 bg-slate-950/60 px-2 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">— ignorar</option>
              <option value="nota">Nota (regra)</option>
              <option value="nota_livre">Nota (não é regra)</option>
              <option value="pericias">Compêndio: perícias</option>
              <option value="vantagens">Compêndio: vantagens</option>
              <option value="desvantagens">Compêndio: desvantagens</option>
            </select>
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled={sincronizarMut.isPending}
        onClick={() => sincronizarMut.mutate()}
        className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-50"
      >
        {sincronizarMut.isPending ? "Sincronizando…" : "Sincronizar regras"}
      </button>

      {previews.length > 0 && (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-300">
            Revisão do Compêndio — nada foi gravado ainda:
          </p>
          {previews.map((p, i) => (
            <div key={i} className="text-sm text-slate-300">
              <p className="font-medium text-slate-200">
                #{p.canalNome} → {p.destino}
              </p>
              <ul className="mt-1 space-y-0.5 pl-4 text-xs">
                {p.diff.criar.map((n) => (
                  <li key={`c-${n.nome}`} className="text-emerald-300">
                    + criar: {n.nome}
                  </li>
                ))}
                {p.diff.atualizar.map((a) => (
                  <li key={`a-${a.id}`} className="text-amber-300">
                    ~ atualizar: {a.nomeAtual}
                  </li>
                ))}
                <li className="text-slate-500">= manter: {p.diff.manter.length}</li>
              </ul>
            </div>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={aplicarMut.isPending}
              onClick={() => aplicarMut.mutate()}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {aplicarMut.isPending ? "Aplicando…" : "Aplicar no Compêndio"}
            </button>
            <button
              type="button"
              onClick={() => setPreviews([])}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800"
            >
              Descartar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

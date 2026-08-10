import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  batalhaPresetCarregar,
  batalhaPresetExcluir,
  batalhaPresetListar,
  batalhaPresetRenomear,
  batalhaPresetSalvar,
  batalhaPresetSobrescrever,
} from "../../lib/api";
import type { BatalhaPreset, EstadoBatalha } from "../../lib/types";
import { useToast } from "../../components/Toast";

const INPUT =
  "h-9 w-full rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-500/50 disabled:opacity-40";
const BTN_MINI =
  "rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40";
const BTN_MINI_NEUTRO = `${BTN_MINI} text-slate-400 hover:bg-slate-800 hover:text-slate-100`;
const BTN_MINI_PERIGO = `${BTN_MINI} text-rose-400 hover:bg-rose-500/10 hover:text-rose-300`;

/** Qual ação destrutiva está pedindo confirmação (segundo clique) num preset. */
type Confirmando = { id: number; acao: "carregar" | "excluir" } | null;

/** Edição inline de nome/descrição de um preset. */
type Edicao = { id: number; nome: string; descricao: string };

/**
 * Biblioteca de batalhas pré-prontas: salva a arena atual sob um nome e recarrega
 * depois. Carregar substitui a batalha em andamento, por isso passa por `roda` —
 * o mesmo canal que o resto do cockpit usa pra aplicar o `EstadoBatalha` novo no
 * cache — e por uma confirmação de segundo clique (nunca `window.confirm`, que
 * trava o webview do Tauri).
 */
export default function BatalhasSalvas({
  roda,
  combatentesAtuais,
}: {
  roda: (acao: () => Promise<EstadoBatalha>) => void;
  combatentesAtuais: number;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [nomeNovo, setNomeNovo] = useState("");
  const [descricaoNova, setDescricaoNova] = useState("");
  const [confirmando, setConfirmando] = useState<Confirmando>(null);
  const [editando, setEditando] = useState<Edicao | null>(null);

  const { data: presets } = useQuery({
    queryKey: ["batalhaPresets"],
    queryFn: batalhaPresetListar,
  });

  // O "Confirmar?" desarma sozinho. Deixado armado indefinidamente ele vira uma
  // armadilha: o mestre clica em Excluir, se distrai na mesa, volta minutos
  // depois e o mesmo botão — que agora significa outra coisa — está debaixo do
  // cursor. Confirmação destrutiva só vale enquanto a intenção é recente.
  useEffect(() => {
    if (!confirmando) return;
    const id = setTimeout(() => setConfirmando(null), 5000);
    return () => clearTimeout(id);
  }, [confirmando]);

  const invalidar = () => qc.invalidateQueries({ queryKey: ["batalhaPresets"] });

  const salvar = useMutation({
    mutationFn: () => batalhaPresetSalvar(nomeNovo.trim(), descricaoNova.trim()),
    onSuccess: (preset) => {
      invalidar();
      setNomeNovo("");
      setDescricaoNova("");
      toast.sucesso(`"${preset.nome}" salva.`);
    },
    onError: (e) => toast.erro(String(e)),
  });

  const sobrescrever = useMutation({
    mutationFn: (id: number) => batalhaPresetSobrescrever(id),
    onSuccess: (preset) => {
      invalidar();
      toast.sucesso(`"${preset.nome}" atualizada com a batalha atual.`);
    },
    onError: (e) => toast.erro(String(e)),
  });

  const renomear = useMutation({
    mutationFn: (p: { id: number; nome: string; descricao: string }) =>
      batalhaPresetRenomear(p.id, p.nome, p.descricao),
    onSuccess: () => {
      invalidar();
      setEditando(null);
      toast.sucesso("Preset renomeado.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  const excluir = useMutation({
    mutationFn: (id: number) => batalhaPresetExcluir(id),
    onSuccess: () => {
      invalidar();
      setConfirmando(null);
      toast.sucesso("Preset excluído.");
    },
    onError: (e) => {
      setConfirmando(null);
      toast.erro(String(e));
    },
  });

  function carregarPreset(preset: BatalhaPreset) {
    roda(() =>
      batalhaPresetCarregar(preset.id).then((novo) => {
        toast.sucesso(`"${preset.nome}" carregada.`);
        return novo;
      }),
    );
    setConfirmando(null);
  }

  function aoClicarAcaoDestrutiva(id: number, acao: "carregar" | "excluir", preset: BatalhaPreset) {
    const pendente = confirmando?.id === id && confirmando.acao === acao;
    if (!pendente) {
      setConfirmando({ id, acao });
      return;
    }
    if (acao === "carregar") carregarPreset(preset);
    else excluir.mutate(id);
  }

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Batalhas salvas
      </h2>

      <div className="space-y-2">
        <input
          type="text"
          value={nomeNovo}
          onChange={(e) => setNomeNovo(e.target.value)}
          placeholder="Nome da batalha"
          disabled={salvar.isPending}
          className={INPUT}
        />
        <input
          type="text"
          value={descricaoNova}
          onChange={(e) => setDescricaoNova(e.target.value)}
          placeholder="Descrição (opcional)"
          disabled={salvar.isPending}
          className={INPUT}
        />
        <button
          type="button"
          disabled={combatentesAtuais === 0 || !nomeNovo.trim() || salvar.isPending}
          onClick={() => salvar.mutate()}
          title={combatentesAtuais === 0 ? "A arena está vazia" : undefined}
          className="w-full rounded-lg bg-indigo-500/10 px-3 py-2 text-sm font-medium text-indigo-300 hover:bg-indigo-500/20 disabled:pointer-events-none disabled:opacity-40"
        >
          {salvar.isPending ? "Salvando…" : "Salvar batalha atual"}
        </button>
      </div>

      {/* Sem teto de altura: o painel vive dentro do `PresetsDialog`, cujo corpo
          já rola — um teto aqui criaria uma 2ª scrollbar aninhada. */}
      <ul className="space-y-1.5">
        {(presets ?? []).map((p) => {
          const editandoEste = editando?.id === p.id;
          return (
            <li
              key={p.id}
              className="rounded-lg border border-slate-800/80 bg-slate-950/40 p-2"
            >
              {editandoEste ? (
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={editando.nome}
                    onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
                    placeholder="Nome"
                    className={INPUT}
                  />
                  <input
                    type="text"
                    value={editando.descricao}
                    onChange={(e) => setEditando({ ...editando, descricao: e.target.value })}
                    placeholder="Descrição (opcional)"
                    className={INPUT}
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditando(null)}
                      className={BTN_MINI_NEUTRO}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={!editando.nome.trim() || renomear.isPending}
                      onClick={() =>
                        renomear.mutate({
                          id: editando.id,
                          nome: editando.nome.trim(),
                          descricao: editando.descricao.trim(),
                        })
                      }
                      className={`${BTN_MINI_NEUTRO} bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 hover:text-indigo-200`}
                    >
                      {renomear.isPending ? "Salvando…" : "Salvar"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-200">{p.nome}</p>
                    {p.descricao && (
                      <p className="truncate text-xs text-slate-500">{p.descricao}</p>
                    )}
                    <p className="text-[11px] text-slate-600">
                      {p.combatentes} {p.combatentes === 1 ? "combatente" : "combatentes"}
                    </p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => aoClicarAcaoDestrutiva(p.id, "carregar", p)}
                      className={
                        confirmando?.id === p.id && confirmando.acao === "carregar"
                          ? `${BTN_MINI} bg-indigo-500 text-white hover:bg-indigo-400`
                          : BTN_MINI_NEUTRO
                      }
                    >
                      {confirmando?.id === p.id && confirmando.acao === "carregar"
                        ? "Confirmar carregar?"
                        : "Carregar"}
                    </button>
                    <button
                      type="button"
                      disabled={sobrescrever.isPending}
                      onClick={() => sobrescrever.mutate(p.id)}
                      className={BTN_MINI_NEUTRO}
                    >
                      {sobrescrever.isPending ? "Sobrescrevendo…" : "Sobrescrever"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditando({ id: p.id, nome: p.nome, descricao: p.descricao })}
                      className={BTN_MINI_NEUTRO}
                    >
                      Renomear
                    </button>
                    <button
                      type="button"
                      disabled={excluir.isPending}
                      onClick={() => aoClicarAcaoDestrutiva(p.id, "excluir", p)}
                      className={
                        confirmando?.id === p.id && confirmando.acao === "excluir"
                          ? `${BTN_MINI} bg-rose-500 text-white hover:bg-rose-400`
                          : BTN_MINI_PERIGO
                      }
                    >
                      {confirmando?.id === p.id && confirmando.acao === "excluir"
                        ? "Confirmar excluir?"
                        : "Excluir"}
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
        {presets && presets.length === 0 && (
          <li className="px-2 py-4 text-center text-xs text-slate-500">
            Nenhuma batalha salva ainda — monte a arena e clique em "Salvar batalha atual".
          </li>
        )}
      </ul>
    </section>
  );
}

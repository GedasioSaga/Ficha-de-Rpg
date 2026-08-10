import type { MapaInput } from "../../lib/types";

/**
 * Estado do editor de mapa e suas transições — lógica pura, sem React, sem
 * chamada de backend. Mora fora do `useMapaEditor` porque é aqui que estão as
 * regras que decidem se uma edição sobrevive: quando o dado do servidor pode
 * substituir o que está na tela e quando uma gravação pode marcar o editor
 * como limpo. Regra errada aqui apaga desenho do usuário — por isso é testável
 * isolada (`estadoMapa.test.ts`).
 */
export type HistEstado = {
  presente: MapaInput;
  passado: MapaInput[];
  futuro: MapaInput[];
  sujo: boolean;
  /** Id do mapa dono de `presente` — fonte da verdade do auto-save (nunca `selecionado`, que já pode ter mudado). */
  mapaId: number | null;
};

export type HistAcao =
  | { tipo: "set"; input: MapaInput; id: number | null }
  | { tipo: "salvo"; enviado: MapaInput }
  | { tipo: "editar"; input: MapaInput }
  | { tipo: "campo"; input: MapaInput }
  | { tipo: "undo" }
  | { tipo: "redo" };

/** Compara dois inputs por conteúdo (a grade é array de string, `===` não serve). */
function mesmoInput(a: MapaInput, b: MapaInput): boolean {
  return (
    a.titulo === b.titulo &&
    a.colunas === b.colunas &&
    a.linhas === b.linhas &&
    a.legenda === b.legenda &&
    a.efeito === b.efeito &&
    a.grade.length === b.grade.length &&
    a.grade.every((linha, i) => linha === b.grade[i])
  );
}

export function reduzir(e: HistEstado, a: HistAcao): HistEstado {
  switch (a.tipo) {
    case "set":
      // Dado vindo de fora (cache do react-query, refetch) NUNCA pode apagar
      // edição não salva do mesmo mapa. O cache pode estar atrás do banco, e
      // sobrescrever aqui não perde só o que está na tela: o auto-save seguinte
      // gravaria esse valor velho por cima do bom.
      if (e.sujo && e.mapaId === a.id) return e;
      // Eco do próprio save: mesmo mapa, mesmo conteúdo. Só confirma limpo —
      // zerar passado/futuro aqui mataria o Ctrl+Z 500ms depois de cada traço,
      // já que o auto-save dispara sozinho e o mapa gravado volta por aqui.
      if (e.mapaId === a.id && mesmoInput(e.presente, a.input)) return { ...e, sujo: false };
      return { presente: a.input, passado: [], futuro: [], sujo: false, mapaId: a.id };
    case "salvo":
      // Só fica limpo se nada mudou desde o envio — quem continuou desenhando
      // durante a gravação segue sujo, e o auto-save regrava.
      return mesmoInput(e.presente, a.enviado) ? { ...e, sujo: false } : e;
    case "editar":
      return { ...e, presente: a.input, passado: [...e.passado, e.presente].slice(-100), futuro: [], sujo: true };
    case "campo":
      // edição de texto (título/ordem/legenda/efeito) não entra no histórico — só a grade tem undo/redo
      return { ...e, presente: a.input, sujo: true };
    case "undo": {
      if (e.passado.length === 0) return e;
      const anterior = e.passado[e.passado.length - 1];
      return { ...e, presente: anterior, passado: e.passado.slice(0, -1), futuro: [e.presente, ...e.futuro], sujo: true };
    }
    case "redo": {
      if (e.futuro.length === 0) return e;
      const proximo = e.futuro[0];
      return { ...e, presente: proximo, passado: [...e.passado, e.presente], futuro: e.futuro.slice(1), sujo: true };
    }
  }
}

import { describe, expect, test } from "vitest";
import { reduzir, type HistEstado } from "./estadoMapa";
import type { MapaInput } from "../../lib/types";

function inp(grade: string[], titulo = "Mapa"): MapaInput {
  return { titulo, colunas: grade[0]?.length ?? 0, linhas: grade.length, grade, legenda: "", efeito: "" };
}

function estado(parcial: Partial<HistEstado> = {}): HistEstado {
  return {
    presente: inp(["---", "---"]),
    passado: [],
    futuro: [],
    sujo: false,
    mapaId: 1,
    ...parcial,
  };
}

describe("set (dado que chegou do servidor)", () => {
  test("aplica quando não há edição pendente", () => {
    const doServidor = inp(["XXX", "---"]);

    const novo = reduzir(estado(), { tipo: "set", input: doServidor, id: 1 });

    expect(novo.presente).toEqual(doServidor);
    expect(novo.sujo).toBe(false);
    expect(novo.mapaId).toBe(1);
  });

  test("NÃO sobrescreve edição não salva do mesmo mapa", () => {
    // O cache do react-query pode entregar uma versão anterior do mapa (o save
    // não invalida `["mapa", id]`). Se isso apagar o que está na tela, o próximo
    // auto-save grava o valor velho por cima do bom — perda definitiva.
    const desenhando = inp(["XX-", "---"]);
    const versaoVelhaDoCache = inp(["---", "---"]);

    const novo = reduzir(estado({ presente: desenhando, sujo: true, mapaId: 1 }), {
      tipo: "set",
      input: versaoVelhaDoCache,
      id: 1,
    });

    expect(novo.presente).toEqual(desenhando);
    expect(novo.sujo).toBe(true);
  });

  test("eco do próprio save não apaga o histórico de undo", () => {
    // Depois de gravar, o mapa volta do backend e reentra por `set`. Se isso
    // resetar passado/futuro, o Ctrl+Z para de funcionar 500ms depois de cada
    // traço (o auto-save roda sozinho).
    const naTela = inp(["XX-", "---"]);
    const anterior = inp(["---", "---"]);

    const novo = reduzir(estado({ presente: naTela, passado: [anterior], mapaId: 1 }), {
      tipo: "set",
      input: inp(["XX-", "---"]),
      id: 1,
    });

    expect(novo.passado).toEqual([anterior]);
    expect(novo.sujo).toBe(false);
  });

  test("conteúdo diferente zera o histórico (mapa outro / recarregado de fora)", () => {
    const novo = reduzir(estado({ presente: inp(["XX-", "---"]), passado: [inp(["---", "---"])], mapaId: 1 }), {
      tipo: "set",
      input: inp(["~~~", "~~~"]),
      id: 1,
    });

    expect(novo.passado).toEqual([]);
  });

  test("aplica mesmo sujo quando é OUTRO mapa (troca de seleção)", () => {
    const outroMapa = inp(["~~~", "~~~"], "Outro");

    const novo = reduzir(estado({ presente: inp(["XX-", "---"]), sujo: true, mapaId: 1 }), {
      tipo: "set",
      input: outroMapa,
      id: 2,
    });

    expect(novo.presente).toEqual(outroMapa);
    expect(novo.mapaId).toBe(2);
    expect(novo.sujo).toBe(false);
  });
});

describe("salvo (gravação confirmada pelo backend)", () => {
  test("marca limpo quando nada mudou desde o envio", () => {
    const enviado = inp(["XX-", "---"]);
    // objeto diferente, mesmo conteúdo — é o caso real: `presente` foi recriado
    // por re-render entre o envio e a resposta.
    const presente = inp(["XX-", "---"]);

    const novo = reduzir(estado({ presente, sujo: true }), { tipo: "salvo", enviado });

    expect(novo.sujo).toBe(false);
    expect(novo.presente).toEqual(presente);
  });

  test("continua sujo quando o usuário editou durante a gravação", () => {
    const enviado = inp(["XX-", "---"]);
    const editadoDepois = inp(["XXX", "---"]);

    const novo = reduzir(estado({ presente: editadoDepois, sujo: true }), { tipo: "salvo", enviado });

    expect(novo.sujo).toBe(true);
    expect(novo.presente).toEqual(editadoDepois);
  });

  test("detecta mudança em campo de texto, não só na grade", () => {
    const enviado = inp(["XX-", "---"], "Floresta");
    const renomeadoDepois = inp(["XX-", "---"], "Floresta de Noite");

    const novo = reduzir(estado({ presente: renomeadoDepois, sujo: true }), { tipo: "salvo", enviado });

    expect(novo.sujo).toBe(true);
  });
});

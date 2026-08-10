// Fonte única dos 8 atributos (ordem fixa da ficha) + rótulos/abreviações.
// Reusado por StatBlock, CharacterSheet e o formulário — evita divergência.

export const ATRIBUTOS = [
  "forca",
  "agilidade",
  "percepcao",
  "resistencia",
  "intuicao",
  "espirito",
  "carisma",
  "determinacao",
] as const;

export type Atributo = (typeof ATRIBUTOS)[number];

export const ROTULO_ATRIBUTO: Record<string, string> = {
  forca: "Força",
  agilidade: "Agilidade",
  percepcao: "Percepção",
  resistencia: "Resistência",
  intuicao: "Intuição",
  espirito: "Espírito",
  carisma: "Carisma",
  determinacao: "Determinação",
};

export const ABREV_ATRIBUTO: Record<string, string> = {
  forca: "FOR",
  agilidade: "AGI",
  percepcao: "PER",
  resistencia: "RES",
  intuicao: "INT",
  espirito: "ESP",
  carisma: "CAR",
  determinacao: "DET",
};

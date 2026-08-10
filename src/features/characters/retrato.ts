// Helpers do placeholder de retrato (iniciais + gradiente estável por nome).
// Compartilhados entre CharacterCard, StatBlock e os cards de transformação.

// Gradientes coesos para o placeholder (via style, à prova de versão do Tailwind).
const GRADIENTES = [
  ["#4f46e5", "#3730a3"], // indigo
  ["#7c3aed", "#5b21b6"], // violet
  ["#0284c7", "#075985"], // sky
  ["#0d9488", "#115e59"], // teal
  ["#d97706", "#92400e"], // amber
  ["#e11d48", "#9f1239"], // rose
] as const;

/** Até 2 iniciais em maiúsculas a partir do nome. */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  return partes
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();
}

/** Gradiente estável a partir do nome — mesmo nome sempre no mesmo tom. */
export function gradienteDoNome(nome: string): string {
  let h = 0;
  for (let i = 0; i < nome.length; i++) {
    h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  }
  const [de, ate] = GRADIENTES[h % GRADIENTES.length];
  return `linear-gradient(135deg, ${de} 0%, ${ate} 100%)`;
}

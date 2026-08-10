import type { PersonagemInput } from "../../../lib/types";
import { ATRIBUTOS, type Atributo, ROTULO_ATRIBUTO } from "../atributos";
import { CampoNumero, CampoTexto, CARTAO_FORM, Select, Textarea } from "./Campos";

const POOLS = [
  { chave: "hp", label: "HP" },
  { chave: "sp", label: "SP" },
  { chave: "escudo", label: "Escudo" },
] as const;

const OPCOES_TIPO = [
  { valor: "jogador", label: "Jogador" },
  { valor: "npc", label: "NPC" },
];

export default function SecaoBase({
  valor,
  onChange,
}: {
  valor: PersonagemInput;
  onChange: (parcial: Partial<PersonagemInput>) => void;
}) {
  // Atributos e pools são todos campos `number` em PersonagemInput; a chave
  // computada é sempre um desses nomes, então o cast pro Partial é seguro.
  const setNumero = (chave: Atributo | "hp" | "sp" | "escudo", v: number) =>
    onChange({ [chave]: v } as Partial<PersonagemInput>);

  return (
    <div className={`${CARTAO_FORM} space-y-4`}>
      <CampoTexto
        label="Nome"
        valor={valor.nome}
        onChange={(nome) => onChange({ nome })}
        placeholder="Nome do personagem"
      />
      <Select
        label="Tipo"
        valor={valor.tipo}
        onChange={(tipo) => onChange({ tipo: tipo === "npc" ? "npc" : "jogador" })}
        opcoes={OPCOES_TIPO}
      />
      <Textarea
        label="Descrição"
        valor={valor.descricao}
        onChange={(descricao) => onChange({ descricao })}
        placeholder="Breve descrição"
      />

      <div>
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Pools
        </span>
        <div className="grid grid-cols-3 gap-2">
          {POOLS.map((p) => (
            <CampoNumero
              key={p.chave}
              label={p.label}
              valor={valor[p.chave]}
              onChange={(v) => setNumero(p.chave, v)}
            />
          ))}
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Atributos
        </span>
        <div className="grid grid-cols-2 gap-2">
          {ATRIBUTOS.map((a) => (
            <CampoNumero
              key={a}
              label={ROTULO_ATRIBUTO[a]}
              valor={valor[a]}
              onChange={(v) => setNumero(a, v)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

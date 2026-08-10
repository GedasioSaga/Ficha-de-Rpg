// src/features/configuracoes/ConfiguracoesScreen.tsx
import ChavesIA from "./ChavesIA";
import SeletorModelo from "./SeletorModelo";

export default function ConfiguracoesScreen() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Configurações</h1>
        <p className="mt-1 text-sm text-slate-500">
          Chave e modelo que a IA usa na conversa, na análise de equilíbrio, na
          simulação de combate e na leitura do retrato.
        </p>
      </div>
      <div className="mt-4 space-y-4">
        <ChavesIA />
        <SeletorModelo />
      </div>
    </div>
  );
}

# Fichas: etiquetas + import/export

Data: 2026-08-09

## Problema

Duas dores, uma tela.

1. **Não dá pra tirar ficha do app.** Nenhum caminho de backup, de mandar um NPC
   pronto pra outra pessoa, nem de levar ficha entre máquinas. O único import que
   existia era o do v1 (`importar_v1`), de mão única e amarrado ao formato antigo.
2. **A lista de NPCs é plana.** Em Batalha, o painel "Disponíveis" cospe todos os
   NPCs numa lista só, ordenada por nome. Com dezenas de NPCs o mestre se perde
   no meio da sessão.

## Decisões

| Decisão | Escolha | Por quê |
|---|---|---|
| Escopo da organização | Só NPCs | Jogadores são poucos, fixos e sempre relevantes na luta; agrupar só atrapalharia. Continuam numa lista plana no topo. |
| Modelo | **Etiquetas** (N por NPC), não pastas | Um NPC é "Marinha" *e* "Arco Alabasta" *e* "Chefe" ao mesmo tempo. Pasta obrigaria escolher um eixo só. |
| Na Batalha | **Chips de filtro + grupos dobráveis** | Chips estreitam, grupos deixam achar sem clicar. NPC com N etiquetas aparece nos N grupos — duplicata aceita de propósito: achar importa mais que aparecer uma vez só. |
| Semântica de múltiplas chips | **E** (interseção) | Marcar `Marinha` + `Chefe` serve pra estreitar. `OU` já é o comportamento de não marcar nada. |
| Formato do arquivo | JSON único, retrato em base64 embutido | Ficha vira um arquivo só, mandável por Discord. Custo: ~33% de inchaço da imagem. |
| Arquivo é sempre array | Sim, mesmo com 1 ficha | O import não precisa saber se veio de "exportar uma" ou "exportar todas". |
| Colisão de nome no import | **Sempre cria nova** (`Smoker (2)`) | Nunca destrói dado existente. Duplicata é fácil de apagar; edição perdida não volta. |
| Seletor de arquivo | `tauri-plugin-dialog` (dep nova) | Diálogo nativo de abrir/salvar. A leitura/escrita fica no Rust, então **não** precisou de `plugin-fs`. |

## Modelo

`0009_etiqueta.sql`:

- `etiqueta(id, nome UNIQUE COLLATE NOCASE, cor, timestamps)` — `cor` é token da
  paleta fechada (`slate`, `rose`, …), validado no Rust; o frontend mapeia token
  → classes Tailwind (classe dinâmica não sobrevive ao varredor do Tailwind).
- `personagem_etiqueta(personagem_id, etiqueta_id)` — PK composta, cascade dos
  dois lados, índice pelo lado da etiqueta.

`NOCASE` é o que faz o upsert por nome não criar "Marinha" e "marinha" separadas.

## Regra dura

**Jogador não recebe etiqueta.** A guarda está no backend
(`repositorios::escrever_etiquetas`), não só na UI — assim import de arquivo
editado à mão, ou uma tela futura, não conseguem furar.

## Arquivos

Backend:
- `migrations/0009_etiqueta.sql`, registrada em `db/connection.rs`
- `domain/modelos.rs` — `Etiqueta`, `EtiquetaInput`, `FichaExportada`,
  `ResultadoImport`; `etiquetas` em `PersonagemResumo`/`Completo`/`Input`
- `db/repositorios.rs` — CRUD de etiqueta, `escrever_etiquetas`,
  `etiquetas_por_personagem` (uma query, não N+1)
- `db/portabilidade.rs` — export/import; reusa `criar_personagem` e
  `RetratoInput::Novo`, então o retrato entra pelo mesmo caminho (com dedup
  sha256) de qualquer save
- `lib.rs` — 7 comandos novos

Frontend:
- `features/characters/etiquetas.ts` — paleta, filtro **E**, agrupamento
- `features/characters/ChipsEtiquetas.tsx` — chips, usadas na galeria e na Batalha
- `features/characters/portabilidade.ts` — diálogos nativos
- `features/characters/form/EtiquetasEditor.tsx` — editor no form (só NPC)
- `FichasGallery.tsx`, `CharacterCard.tsx`, `CharacterSheet.tsx`, `RosterPanel.tsx`

## Verificação

`cargo test` (124, sendo 4 novos de portabilidade) · `cargo build` ·
`npm run build` · `npm test`.

Manual: criar etiqueta num NPC pelo form → filtrar na galeria → exportar uma e
exportar o filtro inteiro → importar de volta (vira `Nome (2)`, com retrato) →
conferir chips e grupos no painel Disponíveis da Batalha.

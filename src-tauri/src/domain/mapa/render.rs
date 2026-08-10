use super::modelos::{Mapa, LIMITE_DISCORD};

/// Uma peça posicionada no mapa, pronta pra render: além da célula e do glifo
/// (que é o que entra na grade), carrega o nome do combatente e se é a vez
/// dele — usados só na legenda automática, nunca na grade em si.
#[derive(Debug, Clone, PartialEq)]
pub struct PecaRender {
    pub linha: u16,
    pub coluna: u16,
    pub glifo: char,
    pub nome: String,
    pub eh_turno: bool,
}

/// Teto de caracteres do nome na legenda automática. Nomes de combatente podem
/// ser longos ("Ryoko D. Violeta Marinheiro"); sem truncar, um punhado de peças
/// já estoura a legenda numa parede de texto. 14 chars cabe a maioria dos
/// primeiros nomes + inicial, mantendo a legenda numa linha legível.
const NOME_LEGENDA_MAX_CHARS: usize = 14;

/// Rótulo de coluna: 0→'A', 1→'B', ... (até 25→'Z').
fn rotulo_coluna(indice: usize) -> char {
    (b'A' + indice as u8) as char
}

/// Nome de cada terreno pintável, na ordem em que aparece na legenda.
///
/// Fonte da verdade do que vai pro Discord. O editor tem a própria lista pros
/// botões (`PALETA` em `src/features/mapa/logica.ts`) — mexeu numa, mexa na
/// outra, senão o botão diz "árvore" e a legenda no Discord diz outra coisa.
///
/// Só ASCII: a grade é monoespaçada e caractere fora do ASCII costuma cair num
/// fallback de largura diferente, entortando a coluna toda.
const TERRENOS: &[(char, &str)] = &[
    ('.', "chão"),
    ('#', "pedra"),
    ('X', "árvore"),
    ('~', "água"),
    ('^', "elevação"),
    ('=', "ponte/convés"),
    ('+', "porta"),
    ('*', "fogo/perigo"),
    ('%', "escombros"),
];

/// Bloco "Legenda" (automático): `X = árvore · ~ = água`, só com os terrenos que
/// o mapa realmente usa. Poupa o mestre de digitar a legenda à mão e de mantê-la
/// atualizada quando o desenho muda.
///
/// A célula vazia (`-`) fica de fora por não significar nada, e o mesmo vale
/// para "pontos de interesse" (letras/dígitos soltos): esses variam por mapa e
/// quem explica é o texto livre do mestre.
fn legenda_simbolos(m: &Mapa) -> Option<String> {
    let usados: Vec<String> = TERRENOS
        .iter()
        .filter(|(ch, _)| m.grade.iter().any(|linha| linha.contains(*ch)))
        .map(|(ch, nome)| format!("{ch} = {nome}"))
        .collect();
    if usados.is_empty() {
        return None;
    }
    Some(usados.join(" · "))
}

/// Trunca `nome` em até `max` caracteres (não bytes — nome com acento/emoji
/// não pode partir no meio de um char multibyte), acrescentando `…` quando corta.
fn truncar_nome(nome: &str, max: usize) -> String {
    if nome.chars().count() <= max {
        return nome.to_string();
    }
    let mut truncado: String = nome.chars().take(max).collect();
    truncado.push('…');
    truncado
}

/// Bloco "Ordem" (automático): `1 Barril · 2 Ryoko D. Vio… · 3 Bariarte`.
/// Só entra quem tem peça no mapa (`pecas`), ordenado pelo glifo. `None` quando
/// não há nenhuma peça posicionada — não emite bloco/linha vazia à toa.
fn ordem_automatica(pecas: &[PecaRender]) -> Option<String> {
    if pecas.is_empty() {
        return None;
    }
    let mut ordenadas: Vec<&PecaRender> = pecas.iter().collect();
    // Ordena pela ordem VISUAL dos glifos ('1'..'9', 'A'..'Z'), não pelo valor
    // ASCII cru: o fallback '#' (0x23) vem antes dos dígitos na tabela, então
    // ordenar direto jogaria as peças além da 35ª pro topo da legenda, fora de
    // sincronia com a grade. `is_ascii_digit`/`is_ascii_uppercase` primeiro,
    // '#' por último.
    ordenadas.sort_by_key(|p| {
        let classe = match p.glifo {
            c if c.is_ascii_digit() => 0,
            c if c.is_ascii_uppercase() => 1,
            _ => 2,
        };
        (classe, p.glifo)
    });
    let itens: Vec<String> = ordenadas
        .iter()
        .map(|p| format!("{} {}", p.glifo, truncar_nome(&p.nome, NOME_LEGENDA_MAX_CHARS)))
        .collect();
    Some(itens.join(" · "))
}

/// Bloco "Turno Atual" (automático): `Bariarte (3)` — nome + glifo de quem tem
/// `eh_turno`. `None` quando ninguém no mapa está com o turno (sem peças, ou
/// o dono do turno não está posicionado).
fn turno_atual(pecas: &[PecaRender]) -> Option<String> {
    let p = pecas.iter().find(|p| p.eh_turno)?;
    Some(format!("{} ({})", p.nome, p.glifo))
}

/// Renderiza o mapa no formato EXATO que vai pro Discord:
/// título `**negrito**`, grade num bloco ``` monoespaçado, depois até 4 blocos
/// rotulados nessa ordem — Legenda, Ordem, Turno Atual, Efeito do Campo — só
/// os não-vazios. Legenda e Efeito do Campo são texto livre; Ordem e Turno
/// Atual são derivados de `pecas`.
///
/// `pecas` = peças 0-indexadas; cada uma sobrepõe o char de terreno da célula
/// que ocupa. Lista vazia = só terreno (comportamento antigo). O glifo não
/// muda o tamanho da grade, então o guard [`excede_discord`] segue valendo.
pub fn render_discord(m: &Mapa, pecas: &[PecaRender]) -> String {
    let mut out = String::new();

    if !m.titulo.trim().is_empty() {
        out.push_str("**");
        out.push_str(m.titulo.trim());
        out.push_str("**\n\n");
    }

    let largura_rotulo = m.linhas.to_string().len();

    out.push_str("```\n");
    // cabeçalho de colunas: (largura_rotulo + 1) espaços, depois A B C ...
    for _ in 0..largura_rotulo + 1 {
        out.push(' ');
    }
    for c in 0..m.colunas as usize {
        out.push(rotulo_coluna(c));
        if c + 1 < m.colunas as usize {
            out.push(' ');
        }
    }
    out.push('\n');
    // linhas
    for (i, linha) in m.grade.iter().enumerate() {
        out.push_str(&format!("{:>width$}", i + 1, width = largura_rotulo));
        out.push(' ');
        let mut chars = linha.chars();
        for c in 0..m.colunas as usize {
            // consome sempre o char de terreno (mantém o alinhamento), mas a
            // peça na célula, se houver, sobrepõe o glifo.
            let terreno = chars.next().unwrap_or('-');
            let glifo = pecas
                .iter()
                .find(|p| p.linha as usize == i && p.coluna as usize == c)
                .map(|p| p.glifo);
            out.push(glifo.unwrap_or(terreno));
            if c + 1 < m.colunas as usize {
                out.push(' ');
            }
        }
        out.push('\n');
    }
    out.push_str("```");

    // Blocos rotulados nessa ordem exata; só os não-vazios entram (sem linha
    // órfã). Legenda/Efeito do Campo são texto livre; Ordem/Turno Atual são
    // derivados de `pecas`.
    let mut blocos: Vec<(&str, String)> = Vec::with_capacity(4);
    // Legenda = símbolos detectados no desenho + o que o mestre escreveu. O
    // automático vem primeiro (é o que decodifica a grade); o texto livre
    // complementa com o que a tabela de terrenos não sabe (o significado de um
    // ponto de interesse, uma regra da cena).
    let legenda_livre = m.legenda.trim();
    let legenda = match (legenda_simbolos(m), legenda_livre.is_empty()) {
        (Some(auto), true) => Some(auto),
        (Some(auto), false) => Some(format!("{auto} · {legenda_livre}")),
        (None, true) => None,
        (None, false) => Some(legenda_livre.to_string()),
    };
    if let Some(legenda) = legenda {
        blocos.push(("Legenda", legenda));
    }
    if let Some(ordem) = ordem_automatica(pecas) {
        blocos.push(("Ordem", ordem));
    }
    if let Some(turno) = turno_atual(pecas) {
        blocos.push(("Turno Atual", turno));
    }
    let efeito = m.efeito.trim();
    if !efeito.is_empty() {
        blocos.push(("Efeito do Campo", efeito.to_string()));
    }

    for (i, (rotulo, valor)) in blocos.iter().enumerate() {
        out.push_str(if i == 0 { "\n\n" } else { "\n" });
        out.push_str(&format!("**{rotulo}:** {valor}"));
    }

    out
}

/// True se o texto renderizado passa do limite de caracteres do Discord.
/// Usada no guard de `discord_postar_mapa`/`discord_atualizar_mapa` (Fase 4);
/// a UI também replica a regra em TS pro aviso "passa de 2000" (spec §8).
pub fn excede_discord(s: &str) -> bool {
    s.chars().count() > LIMITE_DISCORD
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mapa(titulo: &str, colunas: u8, linhas: u8, grade: &[&str], legenda: &str, efeito: &str) -> Mapa {
        Mapa {
            id: 0,
            titulo: titulo.into(),
            colunas,
            linhas,
            grade: grade.iter().map(|s| s.to_string()).collect(),
            legenda: legenda.into(),
            efeito: efeito.into(),
            criado_em: String::new(),
            atualizado_em: String::new(),
        }
    }

    #[test]
    fn formato_exato_com_titulo_e_extras() {
        // A grade usa 'X', então a legenda automática explica o símbolo e o
        // texto livre do mestre entra logo depois, complementando.
        let m = mapa("Teste", 3, 2, &["-XX", "X--"], "vale do norte", "");
        let esperado = "**Teste**\n\n```\n  A B C\n1 - X X\n2 X - -\n```\n\n**Legenda:** X = árvore · vale do norte";
        assert_eq!(render_discord(&m, &[]), esperado);
    }

    fn peca(linha: u16, coluna: u16, glifo: char, nome: &str, eh_turno: bool) -> PecaRender {
        PecaRender { linha, coluna, glifo, nome: nome.into(), eh_turno }
    }

    #[test]
    fn pecas_sobrepoem_glifo_na_celula_e_geram_bloco_ordem() {
        let m = mapa("", 3, 2, &["---", "---"], "", "");
        // peça '1' em (linha 0, coluna 2) e '2' em (linha 1, coluna 0).
        let out = render_discord(&m, &[peca(0, 2, '1', "Barril", false), peca(1, 0, '2', "Ryoko", false)]);
        let esperado = "```\n  A B C\n1 - - 1\n2 2 - -\n```\n\n**Ordem:** 1 Barril · 2 Ryoko";
        assert_eq!(out, esperado);
    }

    #[test]
    fn sem_titulo_comeca_no_bloco_e_padda_linha_curta() {
        let m = mapa("", 3, 2, &["X", ""], "", "");
        // "X" vira "X - -" (pad), linha vazia vira "- - -"; a legenda automática
        // entra porque o desenho usa 'X'.
        let esperado = "```\n  A B C\n1 X - -\n2 - - -\n```\n\n**Legenda:** X = árvore";
        assert_eq!(render_discord(&m, &[]), esperado);
    }

    #[test]
    fn largura_rotulo_dois_digitos() {
        let mut grade = Vec::new();
        for _ in 0..10 {
            grade.push("------".to_string());
        }
        let refs: Vec<&str> = grade.iter().map(String::as_str).collect();
        let m = mapa("", 6, 10, &refs, "", "");
        let out = render_discord(&m, &[]);
        // largura_rotulo = 2 → cabeçalho começa com 3 espaços; linha 1 com " 1"
        assert!(out.starts_with("```\n   A B C D E F\n 1 "));
        assert!(out.contains("\n10 "));
    }

    #[test]
    fn excede_discord_no_limite() {
        assert!(!excede_discord("abc"));
        assert!(excede_discord(&"a".repeat(2001)));
        // mapa cheio 26x50 estoura
        let linha = "X".repeat(26);
        let grade: Vec<String> = std::iter::repeat(linha).take(50).collect();
        let refs: Vec<&str> = grade.iter().map(String::as_str).collect();
        let m = mapa("Grande", 26, 50, &refs, "", "");
        assert!(excede_discord(&render_discord(&m, &[])));
    }

    #[test]
    fn sem_pecas_legenda_efeito_nao_emite_bloco_orfao() {
        // Grade só com célula vazia: nada a legendar, nenhuma peça, nenhum texto
        // livre → só a grade, sem rótulo órfão nenhum.
        let m = mapa("Teste", 3, 2, &["---", "---"], "", "");
        let esperado = "**Teste**\n\n```\n  A B C\n1 - - -\n2 - - -\n```";
        assert_eq!(render_discord(&m, &[]), esperado);
    }

    #[test]
    fn ordena_blocos_legenda_e_efeito_do_campo_pulando_ordem_e_turno_vazios() {
        // sem peças no mapa (Ordem/Turno Atual ficam de fora), só Legenda e
        // Efeito do Campo — na ordem certa e com o rótulo novo.
        let m = mapa("Teste", 3, 2, &["-XX", "X--"], "", "noite");
        let esperado =
            "**Teste**\n\n```\n  A B C\n1 - X X\n2 X - -\n```\n\n**Legenda:** X = árvore\n**Efeito do Campo:** noite";
        assert_eq!(render_discord(&m, &[]), esperado);
    }

    #[test]
    fn legenda_automatica_lista_so_os_terrenos_desenhados_na_ordem_da_tabela() {
        // Usa água, pedra e fogo — e NÃO árvore. A ordem segue a tabela
        // `TERRENOS`, não a ordem em que aparecem no desenho.
        let m = mapa("", 3, 2, &["*#~", "---"], "", "");
        let out = render_discord(&m, &[]);
        assert!(out.contains("**Legenda:** # = pedra · ~ = água · * = fogo/perigo"), "saiu: {out}");
        assert!(!out.contains("árvore"));
    }

    #[test]
    fn legenda_automatica_ignora_celula_vazia_e_ponto_de_interesse() {
        // '-' não significa nada e 'K' é ponto de interesse (o mestre explica no
        // texto livre) — nenhum dos dois entra na legenda automática.
        let m = mapa("", 3, 2, &["--K", "---"], "K = tesouro", "");
        let out = render_discord(&m, &[]);
        assert_eq!(out, "```\n  A B C\n1 - - K\n2 - - -\n```\n\n**Legenda:** K = tesouro");
    }

    #[test]
    fn legenda_lista_so_quem_esta_no_mapa_na_ordem_dos_glifos() {
        let m = mapa("", 3, 1, &["---"], "", "");
        // passadas fora de ordem — o bloco Ordem deve reordenar por glifo (1, 2, 3).
        let pecas = [
            peca(0, 2, '3', "Bariarte", false),
            peca(0, 0, '1', "Barril", false),
            peca(0, 1, '2', "Ryoko", false),
        ];
        let out = render_discord(&m, &pecas);
        assert!(out.ends_with("**Ordem:** 1 Barril · 2 Ryoko · 3 Bariarte"));
    }

    #[test]
    fn turno_atual_traz_nome_e_glifo_do_combatente_da_vez() {
        let m = mapa("", 3, 1, &["---"], "", "");
        let pecas = [
            peca(0, 0, '1', "Barril", false),
            peca(0, 1, '2', "Ryoko", false),
            peca(0, 2, '3', "Bariarte", true),
        ];
        let out = render_discord(&m, &pecas);
        assert!(out.ends_with("**Ordem:** 1 Barril · 2 Ryoko · 3 Bariarte\n**Turno Atual:** Bariarte (3)"));
    }

    #[test]
    fn truncamento_respeita_teto_e_nao_corta_multibyte() {
        let m = mapa("", 1, 1, &["-"], "", "");
        // nome com acentos propositalmente maior que o teto de 14 chars —
        // truncar por byte entraria em pânico ou cortaria o "é" ao meio.
        let pecas = [peca(0, 0, '1', "Ryoko D. Violeta Marinheiro", false)];
        let out = render_discord(&m, &pecas);
        assert!(out.ends_with("**Ordem:** 1 Ryoko D. Viole…"));
        assert_eq!("Ryoko D. Viole".chars().count(), NOME_LEGENDA_MAX_CHARS);
    }
}

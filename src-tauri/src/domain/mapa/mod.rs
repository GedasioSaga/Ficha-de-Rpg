pub mod modelos;
pub mod render;

pub use modelos::{
    normalizar, normalizar_grade, Mapa, MapaInput, MapaResumo, COLUNAS_MAX, COLUNAS_MIN,
    LIMITE_DISCORD, LINHAS_MAX, LINHAS_MIN,
};
pub use render::{excede_discord, render_discord, PecaRender};

// CELULA_VAZIA: sem consumidor fora de `modelos`/`render` neste slice — mantida
// re-exportada (é conceito público do domínio) e testada.
#[allow(unused_imports)]
pub use modelos::CELULA_VAZIA;

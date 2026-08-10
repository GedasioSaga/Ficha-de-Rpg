//! RNG injetável do motor. Produção usa xorshift semeado; testes usam uma sequência
//! roteirizada (deterministas). Zero dependências novas.

/// Fonte de aleatoriedade do motor. `d20` devolve `1..=20`.
///
/// `Send + Sync` para permitir manter a `Batalha` em estado gerenciado do Tauri.
pub trait Dado: Send + Sync {
    fn d20(&mut self) -> u8;
}

/// PRNG xorshift64* semeável.
#[derive(Debug, Clone)]
pub struct DadoXorshift {
    estado: u64,
}

impl DadoXorshift {
    pub fn new(seed: u64) -> Self {
        // xorshift trava em 0 — troca por uma constante não-nula.
        DadoXorshift {
            estado: if seed == 0 { 0x9E37_79B9_7F4A_7C15 } else { seed },
        }
    }

    /// Semeia pelo relógio (uso de produção).
    pub fn semeado_pelo_relogio() -> Self {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x1234_5678_9ABC_DEF0);
        DadoXorshift::new(nanos)
    }

    fn proximo_u64(&mut self) -> u64 {
        let mut x = self.estado;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.estado = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
}

impl Dado for DadoXorshift {
    fn d20(&mut self) -> u8 {
        (self.proximo_u64() % 20) as u8 + 1
    }
}

/// Dado roteirizado: devolve valores fixos em ordem (cicla ao chegar ao fim).
/// Torna os testes deterministas. Valores fora de `1..=20` são grampeados.
#[derive(Debug, Clone)]
pub struct DadoRoteirizado {
    sequencia: Vec<u8>,
    i: usize,
}

impl DadoRoteirizado {
    pub fn new(sequencia: Vec<u8>) -> Self {
        DadoRoteirizado { sequencia, i: 0 }
    }
}

impl Dado for DadoRoteirizado {
    fn d20(&mut self) -> u8 {
        if self.sequencia.is_empty() {
            return 1;
        }
        let v = self.sequencia[self.i % self.sequencia.len()];
        self.i += 1;
        v.clamp(1, 20)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roteirizado_devolve_a_sequencia_em_ordem() {
        let mut d = DadoRoteirizado::new(vec![7, 13, 20]);
        assert_eq!(d.d20(), 7);
        assert_eq!(d.d20(), 13);
        assert_eq!(d.d20(), 20);
        // cicla
        assert_eq!(d.d20(), 7);
    }

    #[test]
    fn roteirizado_vazio_devolve_1() {
        let mut d = DadoRoteirizado::new(vec![]);
        assert_eq!(d.d20(), 1);
    }

    #[test]
    fn xorshift_sempre_no_intervalo_1_a_20() {
        let mut d = DadoXorshift::new(42);
        for _ in 0..10_000 {
            let v = d.d20();
            assert!((1..=20).contains(&v), "valor fora do intervalo: {}", v);
        }
    }

    #[test]
    fn xorshift_e_deterministico_por_seed() {
        let mut a = DadoXorshift::new(123);
        let mut b = DadoXorshift::new(123);
        for _ in 0..100 {
            assert_eq!(a.d20(), b.d20());
        }
    }
}

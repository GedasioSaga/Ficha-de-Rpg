import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

/** Base comum: traço fino, cantos arredondados, herda a cor do texto. */
function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Alterna a sidebar (painel à esquerda). */
export function IconPanel(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </Icon>
  );
}

/** Fichas — personagem. */
export function IconFichas(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Icon>
  );
}

/** Batalha — escudo. */
export function IconBatalha(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </Icon>
  );
}

/** Mapa. */
export function IconMapa(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3z" />
      <path d="M9 3v15" />
      <path d="M15 6v15" />
    </Icon>
  );
}

/** Discord — mensagem. */
export function IconDiscord(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Icon>
  );
}

/** Notas — documento. */
export function IconNotas(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </Icon>
  );
}

/** Compêndio — livro. */
export function IconCompendio(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </Icon>
  );
}

/** Busca — lupa. */
export function IconBusca(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7.5" />
      <path d="M21 21l-4.35-4.35" />
    </Icon>
  );
}

/** Voltar — seta para a esquerda. */
export function IconVoltar(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </Icon>
  );
}

/** Adicionar — mais. */
export function IconMais(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

/** Excluir — lixeira. */
export function IconLixeira(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </Icon>
  );
}

/** Fechar — X. */
export function IconFechar(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </Icon>
  );
}

/** Upload — seta para dentro de uma bandeja. */
export function IconUpload(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </Icon>
  );
}

/** Editar — lápis. */
export function IconEditar(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Icon>
  );
}

/** Confirmação — check. */
export function IconCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  );
}

/** Download — seta para dentro de uma bandeja (exportar ficha). */
export function IconDownload(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </Icon>
  );
}

/** Etiqueta — tag com furo. */
export function IconEtiqueta(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </Icon>
  );
}

/** Configurações — engrenagem. */
export function IconConfiguracoes(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      {/* 8 dentes no mesmo raio (8.5) e vales no mesmo raio (6.5): quadro 3.5→20.5
          nos dois eixos, igual aos ícones vizinhos. */}
      <path d="M20.5 12 18 14.5 18 18 14.5 18 12 20.5 9.5 18 6 18 6 14.5 3.5 12 6 9.5 6 6 9.5 6 12 3.5 14.5 6 18 6 18 9.5Z" />
    </Icon>
  );
}

/** Sync — duas setas circulares. */
export function IconSync(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </Icon>
  );
}

/** Balanceamento — balança. */
export function IconBalanceamento(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v16" />
      <path d="M6 7h12" />
      <path d="M6 7l-2.5 5.5a2.9 2.9 0 0 0 5 0L6 7Z" />
      <path d="M18 7l-2.5 5.5a2.9 2.9 0 0 0 5 0L18 7Z" />
      <path d="M8.5 20h7" />
    </Icon>
  );
}

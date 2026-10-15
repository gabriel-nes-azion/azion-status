# DESIGN.md — Azion Console Design System

Guia visual independente de framework para reproduzir o look & feel do Azion Console em outras UIs.

---

## 1. Princípios

- **Flat, não skeumórfico.** Bordas sutis substituem sombras.
- **Header sempre escuro**, conteúdo claro ou escuro conforme tema.
- **Laranja `#F3652B`** é cor de marca — uso pontual em CTAs, hovers, indicadores ativos. Nunca para body text ou áreas extensas.
- **Hierarquia por tamanho e cor**, não por peso pesado. Não use `font-weight ≥ 700`.
- **Dados densos em monoespaçada** (IDs, métricas, código). UI em sans-serif.
- **Espaçamento em múltiplos de 4px.**

---

## 2. Cores

### Marca

| Nome | Hex | Uso |
|---|---|---|
| Orange | `#F3652B` | CTA primário, foco, hover, indicador ativo |
| Success | `#22C55E` | Check verde |

### Header (sempre dark, em ambos os temas)

| Token | Hex |
|---|---|
| Background | `#111111` |
| Border | `#3e3e3e` |
| Text | `#b5b5b5` |
| Button hover | `#f5f5f516` |
| Avatar bg | `#363636` |

### Semânticas (use tokens, não hex)

Defina como CSS variables e troque por tema. Nomes a usar:

```
--surface-ground       background da página
--surface-section      background de cards/seções
--surface-border       borda padrão (1px)
--surface-hover        hover de linha/item
--surface-50..600      escala neutra

--text-primary         texto principal
--text-secondary       descrições, metadata
--text-muted           desabilitado, placeholder
--text-link / --text-link-hover

--status-success / --status-danger / --status-warning / --status-info
```

**Light:** surfaces brancas/cinza claríssimo, texto quase preto.
**Dark:** surface-ground ≈ `#0A0A0A`, texto `#e5e5e5`.

Toggle de tema via classe no `<html>` (`theme-light` / `theme-dark`), persistido em storage e respeitando `prefers-color-scheme`.

---

## 3. Tipografia

| Família | Uso |
|---|---|
| **Sora** | Toda a UI — body, títulos, botões, labels |
| **Proto Mono** | IDs, valores numéricos, código, métricas densas |

### Escala

| Tamanho | Onde |
|---|---|
| 12px | labels, metadata, captions |
| 14px | body de UI, descrições |
| 16px | body padrão |
| 18px | breadcrumb, labels destacados |
| 20px | títulos de seção |
| 24px | título de página (H1) |
| 28px | métricas grandes |

Pesos: **400 / 500 / 600**. Hierarquia:

```
Page title       24px / 500
Section          20px / 500
Subsection       18px / 600
Label            14px / 500
Description      14px / text-secondary
Metadata         12px / mono / text-secondary
```

---

## 4. Espaçamento, raios e bordas

**Escala base 4px:** `0, 4, 8, 12, 16, 20, 24, 32`.

**Padding de página:** `16px` mobile / `32px` desktop horizontal. `12–16px` topo / `16–32px` base.

**Border radius:**
- **6px** = padrão (botões, inputs, cards pequenos)
- **8–12px** = modais, cards grandes, áreas de destaque
- **full** = avatars, pills, badges

**Bordas:** `1px solid var(--surface-border)`. Sombras só em popovers/dropdowns (sutis). **Sem `shadow-xl/2xl`.**

---

## 5. Layout da aplicação

```
┌─────────────────────────────────────────────────┐
│ Header (fixed, 56px, #111111)                   │
├─────────────────────────────────────┬───────────┤
│                                     │           │
│ Main                                │ Sidebar   │
│  ├─ Heading (breadcrumb + title +   │ direito   │
│  │           descrição + ações)     │ (drawer,  │
│  └─ Content                         │  ~512px)  │
│                                     │           │
│ Footer (sticky, links + status)     │           │
└─────────────────────────────────────┴───────────┘
```

- Header **fixo no topo**, 56px, dark, com logo, menu, busca/copilot, perfil.
- Sidebar é **drawer lateral direito** (mobile = overlay, desktop = panel), largura ~512px. Não é navegação principal — guarda Copilot, Help, etc.
- Footer sticky com copyright, links e status do sistema.
- Conteúdo principal vive em um wrapper com padding responsivo (`16px → 32px`).

---

## 6. Padrões de página

### List view

```
[Breadcrumb]
[Title]                                      [Create ▾]
[Description]

[Tabela com filtros, paginação server-side, frozen first column]
```

- Tabela cresce verticalmente (sem scroll interno) — a página é que rola.
- Coluna mais à direita = menu de ações (Edit, Delete).
- Empty state = mensagem + CTA de criação.

### Create / Edit

```
[Breadcrumb]
[Title]
[Description]

[Form fields agrupados por seção, com divider entre seções]

──────────────────────────────────
[Cancel]                    [Save]   ← Action bar sticky no fundo
```

- Edit pode ter abas no topo (Tabs) e uma "Danger zone" no final.

### Drawer create

Para criação rápida sem mudar de rota: drawer da direita com o mesmo form, ações no rodapé do drawer.

---

## 7. Componentes essenciais

### Botões

**Severidades (cor):** primary · secondary · info · success · warn · danger
**Estilos:** filled (default) · outlined · link · text
**Tamanhos:** small (32px) · medium (40px) · large
**Estados:** default · hover · disabled · loading (spinner substitui ícone)

Convenções:
- Listas/toolbars usam `small`. Forms usam medium.
- Ícone à esquerda do label por padrão.
- Submits assíncronos sempre mostram loading.
- Ação destrutiva = `danger` filled ou outlined; nunca link.

### Campos de formulário

Estrutura visual de cada campo:

```
Label *                                ← 14px / 500
[ input/select/textarea          ]     ← 6px radius, border surface-border
Helper text aqui                       ← 14px / text-secondary
Error message (quando dirty)           ← status-danger
```

Tipos: text, dropdown/select, textarea, password, number, multiselect, switch, radio cards.

### Tabela

- Cabeçalho com sort clicável.
- Filtros por coluna (popover).
- Paginação **server-side** com indicador de loading.
- Frozen primeira coluna no scroll horizontal.
- Tags coloridas para status (`success-green`, `danger-red`, `warning-orange`, `info-blue`).
- Texto longo = truncar + tooltip de cópia.
- Export CSV opcional no header da tabela.

### Dialog (modal)

- Largura: `max-width: 36rem` (confirmações) ou `max-width: 48rem` (forms curtos).
- Backdrop escuro semi-transparente (~50%).
- Padding interno `24px`.
- Header com título + close (×).
- Footer com botões: cancel à esquerda (outlined/text), confirm à direita (primary ou danger).

### Tags / badges

- Pill (`border-radius: full`), padding `2px 8px`, 12px texto.
- Cor de fundo derivada da cor semântica com baixa opacidade; texto na cor cheia.

### Toast / notificações

Canto superior direito ou inferior. Auto-dismiss em ~5s. Cor da borda esquerda = severity.

### Danger zone

Bloco no fim de páginas de edit:

```
border 1px var(--status-danger) com 50% alpha
background var(--status-danger) com ~10% alpha
radius 8px, padding 24px
texto em tom avermelhado claro
botão danger
```

---

## 8. Ícones

Use **um único set principal** (estilo PrimeIcons / Phosphor regular / Lucide funcionam bem). Convenções:

- Tamanho herda do `font-size` do contexto.
- 16px em texto pequeno, 20px em botão médio, 24px+ em destaque.
- **Ícones de marca** (logos, features proprietárias) ficam em set separado para distinguir de ações genéricas.

Mapeamento mental:
- `+` criar · `lápis` editar · `lixeira` deletar · `download` exportar
- `chevron-down` dropdown · `external-link` link externo
- `info-circle` info · `exclamation-triangle` warning · `check-circle` success · `times-circle` error

---

## 9. Movimento

**Duração padrão: 220ms / ease-in-out** para fade, slide, expand.
Hovers podem ser mais curtos (~150ms). Loading spinner contínuo. **Sem bouncy/elastic.** Sem parallax.

```
fade-in / fade-out:  220ms ease-in-out
slide-down (expand): 220ms ease-in-out
hover:               150ms ease-out
spinner:             rotação contínua
```

---

## 10. Acessibilidade

- Contraste mínimo AA em todos os textos.
- Foco visível em todos os interativos (outline laranja `#F3652B` ou ring com a cor).
- Labels reais em todos os campos (sem placeholder-as-label).
- Targets clicáveis ≥ 32×32px.
- Estados não comunicados só por cor — usar ícone + texto também.

---

## 11. Cheatsheet (copiar e colar)

```css
:root {
  --brand-orange: #F3652B;
  --status-success: #22C55E;

  --header-bg: #111111;
  --header-border: #3e3e3e;
  --header-text: #b5b5b5;
}

/* tipografia */
font-family: 'Sora', system-ui, sans-serif;
font-mono:   'Proto Mono', ui-monospace, monospace;

/* radius */
--radius-sm: 4px;
--radius-md: 6px;   /* padrão */
--radius-lg: 12px;
--radius-full: 9999px;

/* espaçamento (multiplos de 4) */
4 8 12 16 20 24 32

/* transição */
transition: all 220ms ease-in-out;
```

---

## 12. Resumo em uma página

> Sora em tudo. Header preto, body com tema. Laranja `#F3652B` apenas em marca/CTA/hover. Bordas em vez de sombras. Raio 6px padrão, 12px em containers grandes, full em pills. Espaçamento múltiplo de 4. Sem peso ≥ 700. Status via tokens semânticos, nunca hex. Animações 220ms ease-in-out. Forms validam no blur, com helper e erro inline. Tabelas crescem (não scrollam) e usam paginação server-side. Modais simples, action bar sticky em forms. Acessibilidade AA, foco visível, label real.

import type { Config } from "tailwindcss";

// Themeable palette — values come from CSS custom properties defined in
// src/index.css. The channel-triple form keeps Tailwind's `/opacity`
// modifiers working (e.g. bg-mauve/5 → rgb(var(--c-mauve) / 0.05)).
const c = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // :root is the fizx.uk scheme; .theme-upleb swaps to the upleb.uk
        // orange scheme (toggled via the ndisc title button).
        bg: c("--c-bg"),
        panel: c("--c-panel"),
        surface: c("--c-surface"),
        surfaceHover: c("--c-surface-hover"),
        fg: c("--c-fg"),
        muted: c("--c-muted"),
        accent: c("--c-accent"),
        digital: c("--c-digital"),
        ok: c("--c-ok"),
        warn: c("--c-warn"),
        alert: c("--c-alert"),
        mauve: c("--c-mauve"),
        auburn: c("--c-auburn"),
        // Genre palette — shared with glmps. Use as bg-g-electronic,
        // text-g-jazz, etc. Sub-genres slot under their parent hue.
        g: {
          classical: c("--c-g-classical"),
          downtempo: c("--c-g-downtempo"),
          electronic: c("--c-g-electronic"),
          experimental: c("--c-g-experimental"),
          funk: c("--c-g-funk"),
          jazz: c("--c-g-jazz"),
          pop: c("--c-g-pop"),
          reggae: c("--c-g-reggae"),
          rock: c("--c-g-rock"),
          soundtrack: c("--c-g-soundtrack"),
          acid: c("--c-g-acid"),
          breaks: c("--c-g-breaks"),
          "dnb-jungle": c("--c-g-dnb-jungle"),
          "drone-noise": c("--c-g-drone-noise"),
          dub: c("--c-g-dub"),
          electro: c("--c-g-electro"),
          "footwork-trap": c("--c-g-footwork-trap"),
          techno: c("--c-g-techno"),
        },
      },
      fontFamily: {
        sans: ["Helvetica", "Arial", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;

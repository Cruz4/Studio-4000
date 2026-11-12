// Supplied palette colours are preserved. Text accents are derived for contrast.
export interface Palette { id: string; name: string; primary: string; secondary: string; accent: string; effectsHeading?: string }
export const PALETTES: Palette[] = [
  {
    "id": "plotting",
    "name": "Plotting",
    "primary": "#9AFF29",
    "secondary": "#28B4FF",
    "accent": "#28B4FF"
  },
  {
    "id": "breeze-candy",
    "name": "Breeze Candy",
    "primary": "#4A5FC1",
    "secondary": "#E5B9A8",
    "accent": "#394F8A"
  },
  {
    "id": "prism-dash",
    "name": "Prism Dash",
    "primary": "#2CCCC3",
    "secondary": "#5626C4",
    "accent": "#FACD3D"
  },
  {
    "id": "zest-pulse",
    "name": "Zest Pulse",
    "primary": "#F15B42",
    "secondary": "#7CAADC",
    "accent": "#FFD372"
  },
  {
    "id": "navy-flame",
    "name": "Navy Flame",
    "primary": "#FF6A3D",
    "secondary": "#9DAAF2",
    "accent": "#F4DB7D"
  },
  {
    "id": "scarlet-brew",
    "name": "Scarlet Brew",
    "primary": "#AD1D45",
    "secondary": "#50A8A8",
    "accent": "#F4B26A"
  },
  {
    "id": "eco-blast",
    "name": "Eco Blast",
    "primary": "#4F7942",
    "secondary": "#2E8B57",
    "accent": "#F0E68C"
  },
  {
    "id": "swell-metrics",
    "name": "Swell Metrics",
    "primary": "#61C0BF",
    "secondary": "#AAD9D9",
    "accent": "#FCDD76"
  },
  {
    "id": "studio-sessions",
    "name": "Studio Sessions",
    "primary": "#2C3E50",
    "secondary": "#BDC3C7",
    "accent": "#E74C3C",
    "effectsHeading": "#FF00FF"
  },
  {
    "id": "sage-flame",
    "name": "Sage Flame",
    "primary": "#A3B899",
    "secondary": "#D4E2D4",
    "accent": "#F0A58F"
  },
  {
    "id": "blue-storm",
    "name": "Blue Storm",
    "primary": "#1857A4",
    "secondary": "#59C4EB",
    "accent": "#FFCB0C"
  },
  {
    "id": "magic-time",
    "name": "Magic Time",
    "primary": "#16F4D0",
    "secondary": "#AE9EFF",
    "accent": "#50E3C2"
  },
  {
    "id": "showtime",
    "name": "Showtime",
    "primary": "#FF7B00",
    "secondary": "#000C81",
    "accent": "#FACD3D"
  },
  {
    "id": "busy-transactions",
    "name": "Busy Transactions",
    "primary": "#9FDF16",
    "secondary": "#234417",
    "accent": "#32C89B"
  },
  {
    "id": "technological-shine",
    "name": "Technological Shine",
    "primary": "#00BFFF",
    "secondary": "#1C2833",
    "accent": "#FF00FF"
  },
  {
    "id": "gold-mine",
    "name": "Gold Mine",
    "primary": "#2FF962",
    "secondary": "#9F7709",
    "accent": "#FACD3D"
  },
  {
    "id": "icy-orchid",
    "name": "Icy Orchid",
    "primary": "#6061A8",
    "secondary": "#D3C5E5",
    "accent": "#8EC9BC"
  },
  {
    "id": "alpine-leaf",
    "name": "Alpine Leaf",
    "primary": "#2963A2",
    "secondary": "#4CAABC",
    "accent": "#72C2C9"
  },
  {
    "id": "fog-lavender",
    "name": "Fog & Lavender",
    "primary": "#9882AC",
    "secondary": "#E1E5EB",
    "accent": "#604D6E"
  },
  {
    "id": "lemon-blush",
    "name": "Lemon Blush",
    "primary": "#C7395F",
    "secondary": "#DED4E8",
    "accent": "#E8BA40"
  },
  {
    "id": "candy-mirage",
    "name": "Candy Mirage",
    "primary": "#78FFC4",
    "secondary": "#DCAAE4",
    "accent": "#FDC2E4"
  },
  {
    "id": "golden-orchid",
    "name": "Golden Orchid",
    "primary": "#FAEF7C",
    "secondary": "#E3CCB2",
    "accent": "#E26274"
  },
  {
    "id": "sunburn-drift",
    "name": "Sunburn Drift",
    "primary": "#B6818B",
    "secondary": "#57BBBC",
    "accent": "#B8912E"
  },
  {
    "id": "muted-dessert",
    "name": "Muted Dessert",
    "primary": "#D2385A",
    "secondary": "#DE9DC2",
    "accent": "#9EE8E1"
  },
  {
    "id": "blushwave",
    "name": "Blushwave",
    "primary": "#6FC7E1",
    "secondary": "#EABDCF",
    "accent": "#EFD557"
  },
  {
    "id": "pop-petal",
    "name": "Pop Petal",
    "primary": "#EFC6D4",
    "secondary": "#D950AE",
    "accent": "#AAE847"
  },
  {
    "id": "lilac-smoke",
    "name": "Lilac Smoke",
    "primary": "#D3CAE2",
    "secondary": "#E6C17A",
    "accent": "#F6EDE3"
  },
  {
    "id": "earth-blush",
    "name": "Earth Blush",
    "primary": "#D4B8B1",
    "secondary": "#866C69",
    "accent": "#CD8C8C"
  },
  {
    "id": "pastel-riot",
    "name": "Pastel Riot",
    "primary": "#F4B0F7",
    "secondary": "#9CFAD4",
    "accent": "#EDF9A2"
  },
  {
    "id": "rust-grove",
    "name": "Rust Grove",
    "primary": "#507B6A",
    "secondary": "#6A513C",
    "accent": "#A4998E"
  },
  {
    "id": "solar-tide",
    "name": "Solar Tide",
    "primary": "#E88659",
    "secondary": "#D8BF58",
    "accent": "#D1BAA2"
  },
  {
    "id": "impact-aid",
    "name": "Impact Aid",
    "primary": "#F76035",
    "secondary": "#FBD99D",
    "accent": "#90D6BB"
  },
  {
    "id": "jester-gesture",
    "name": "Jester Gesture",
    "primary": "#35E941",
    "secondary": "#9373F2",
    "accent": "#E01F1F"
  },
  {
    "id": "neon-midnight",
    "name": "Neon Midnight",
    "primary": "#53FD94",
    "secondary": "#601A39",
    "accent": "#F958B6"
  },
  {
    "id": "neon-treats",
    "name": "Neon Treats",
    "primary": "#8BC322",
    "secondary": "#363636",
    "accent": "#C73C00"
  }
];
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export function mix(a: string, b: string, amount: number) {
  return "#" + rgb(a).map((v, i) => Math.round(v * (1 - amount) + rgb(b)[i] * amount).toString(16).padStart(2, "0")).join("");
}
export function contrast(a: string, b: string) {
  const lum = (hex: string) => rgb(hex).map((v) => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
export const inkFor = (fill: string) => contrast("#000000", fill) >= contrast("#ffffff", fill) ? "#000000" : "#ffffff";
export function paletteTokens(p: Palette): Record<string, string> {
  const bg4 = mix("#171d26", p.secondary, .16);
  const readable = (color: string) => {
    let c = color;
    for (let i = 0; i <= 100 && contrast(c, bg4) < 4.5; i++) c = mix(color, "#ffffff", i / 100);
    return c;
  };
  return {
    "--bg": mix("#05070b", p.secondary, .04), "--bg1": mix("#090c10", p.secondary, .12),
    "--bg2": mix("#0e131b", p.secondary, .12), "--bg3": mix("#121923", p.secondary, .14), "--bg4": bg4,
    "--effects-heading": p.effectsHeading ?? readable(p.accent),
    "--primary-rgb": rgb(p.primary).join(", "), "--secondary-rgb": rgb(p.secondary).join(", "),
    "--text": "#f2f4f8", "--dim": "#c1c9d5", "--faint": "#a3aebe",
    "--violet": readable(p.primary), "--violet2": readable(p.accent), "--cyan": readable(p.secondary),
    "--primary-fill": p.primary, "--primary-ink": inkFor(p.primary),
    "--secondary-fill": p.secondary, "--secondary-ink": inkFor(p.secondary),
    "--accent-fill": p.accent, "--accent-ink": inkFor(p.accent),
    "--track-sep": "#05070b", "--glow": "0 0 0 1px " + readable(p.primary),
  };
}

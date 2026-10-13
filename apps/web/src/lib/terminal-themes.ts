import type { ITheme } from "xterm";

export interface TerminalTheme {
  id: string;
  name: string;
  theme: ITheme;
}

export const terminalThemes: TerminalTheme[] = [
  {
    id: "xt-dark",
    name: "XTerminal Dark",
    theme: {
      background: "#07090d",
      foreground: "#c9d1d9",
      cursor: "#22d3ee",
      cursorAccent: "#07090d",
      selectionBackground: "rgba(34, 211, 238, 0.25)",
      black: "#0d1117",
      red: "#ff6b6b",
      green: "#4ade80",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#e6edf3",
      brightBlack: "#8b949e",
      brightRed: "#ff8787",
      brightGreen: "#86efac",
      brightYellow: "#fde047",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#f0f6fc",
    },
  },
  {
    id: "midnight-violet",
    name: "Midnight Violet",
    theme: {
      background: "#0a0a14",
      foreground: "#d6d3e8",
      cursor: "#c084fc",
      cursorAccent: "#0a0a14",
      selectionBackground: "rgba(192, 132, 252, 0.25)",
      black: "#12121f",
      red: "#f472b6",
      green: "#a3e635",
      yellow: "#facc15",
      blue: "#818cf8",
      magenta: "#e879f9",
      cyan: "#22d3ee",
      white: "#ede9fe",
      brightBlack: "#6b6b8a",
      brightRed: "#f9a8d4",
      brightGreen: "#bef264",
      brightYellow: "#fde68a",
      brightBlue: "#a5b4fc",
      brightMagenta: "#f5d0fe",
      brightCyan: "#67e8f9",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "paper-light",
    name: "Paper Light",
    theme: {
      background: "#faf8f5",
      foreground: "#24292f",
      cursor: "#0969da",
      cursorAccent: "#faf8f5",
      selectionBackground: "rgba(9, 105, 218, 0.2)",
      black: "#24292f",
      red: "#cf222e",
      green: "#116329",
      yellow: "#4d2d00",
      blue: "#0969da",
      magenta: "#8250df",
      cyan: "#1b7c83",
      white: "#6e7781",
      brightBlack: "#57606a",
      brightRed: "#a40e26",
      brightGreen: "#1a7f37",
      brightYellow: "#633c01",
      brightBlue: "#218bff",
      brightMagenta: "#a475f9",
      brightCyan: "#3192aa",
      brightWhite: "#8c959f",
    },
  },
];

export function themeById(id: string): TerminalTheme {
  return terminalThemes.find((t) => t.id === id) ?? terminalThemes[0];
}

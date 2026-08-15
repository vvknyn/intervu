export interface ThemeColors {
  brand: string;
  "brand-foreground": string;
  "brand-muted": string;
}

export interface Theme {
  name: string;
  label: string;
  colors: {
    light: ThemeColors;
    dark: ThemeColors;
  };
}

export const themes: Record<string, Theme> = {
  carbon: {
    name: "carbon",
    label: "Carbon",
    colors: {
      light: {
        // editorial pass ink accent — matches --foreground/--background (paper)
        brand: "22 21 19",
        "brand-foreground": "254 254 252",
        "brand-muted": "118 114 104",
      },
      dark: {
        // editorial pass ink accent — matches --foreground/--background (carbon)
        brand: "236 234 228",
        "brand-foreground": "19 18 17",
        "brand-muted": "138 134 123",
      },
    },
  },
  green: {
    name: "green",
    label: "Green",
    colors: {
      light: {
        // Contrast pass 2 2026-08-15: #286a3d — deep enough to carry text on
        // white AND on green-tint-bg (chip active state). Value-paired with
        // globals.css :root --brand; change both together.
        brand: "40 106 61",
        "brand-foreground": "255 255 255",
        "brand-muted": "110 160 126",
      },
      dark: {
        brand: "94 180 150",
        "brand-foreground": "15 18 22",
        "brand-muted": "58 140 110",
      },
    },
  },
  neutral: {
    name: "neutral",
    label: "Neutral",
    colors: {
      light: {
        brand: "10 10 10",
        "brand-foreground": "255 255 255",
        "brand-muted": "115 115 115",
      },
      dark: {
        brand: "250 250 250",
        "brand-foreground": "10 10 10",
        "brand-muted": "161 161 161",
      },
    },
  },
  indigo: {
    name: "indigo",
    label: "Indigo",
    colors: {
      light: {
        // design accent #4F46E5
        brand: "79 70 229",
        "brand-foreground": "255 255 255",
        "brand-muted": "165 180 252",
      },
      dark: {
        // design accent #7C82F2
        brand: "124 130 242",
        "brand-foreground": "255 255 255",
        "brand-muted": "99 102 241",
      },
    },
  },
  blue: {
    name: "blue",
    label: "Blue",
    colors: {
      light: {
        brand: "59 130 246",
        "brand-foreground": "255 255 255",
        "brand-muted": "147 197 253",
      },
      dark: {
        brand: "96 165 250",
        "brand-foreground": "10 15 30",
        "brand-muted": "59 130 246",
      },
    },
  },
  emerald: {
    name: "emerald",
    label: "Emerald",
    colors: {
      light: {
        brand: "16 185 129",
        "brand-foreground": "255 255 255",
        "brand-muted": "110 231 183",
      },
      dark: {
        brand: "52 211 153",
        "brand-foreground": "10 20 15",
        "brand-muted": "16 185 129",
      },
    },
  },
  rose: {
    name: "rose",
    label: "Rose",
    colors: {
      light: {
        brand: "244 63 94",
        "brand-foreground": "255 255 255",
        "brand-muted": "253 164 175",
      },
      dark: {
        brand: "251 113 133",
        "brand-foreground": "25 10 15",
        "brand-muted": "244 63 94",
      },
    },
  },
  amber: {
    name: "amber",
    label: "Amber",
    colors: {
      light: {
        brand: "245 158 11",
        "brand-foreground": "255 255 255",
        "brand-muted": "252 211 77",
      },
      dark: {
        brand: "251 191 36",
        "brand-foreground": "25 20 5",
        "brand-muted": "245 158 11",
      },
    },
  },
};

export const themeNames = Object.keys(themes) as (keyof typeof themes)[];

export const DEFAULT_THEME = "green";

export function getTheme(name: string): Theme {
  return themes[name] || themes[DEFAULT_THEME];
}

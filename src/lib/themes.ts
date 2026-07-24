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
  green: {
    name: "green",
    label: "Green",
    colors: {
      light: {
        // portal redesign brand #0E6B4C
        brand: "14 107 76",
        "brand-foreground": "251 250 246",
        "brand-muted": "125 189 163",
      },
      dark: {
        // portal redesign brand #3ECF8E
        brand: "62 207 142",
        "brand-foreground": "20 19 15",
        "brand-muted": "58 179 130",
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

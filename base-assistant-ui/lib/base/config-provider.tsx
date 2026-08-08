"use client";

import {
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  defaultBaseConfig,
  type ResolvedBaseConfig,
} from "@/lib/base/defaults";

const BaseConfigContext = createContext<ResolvedBaseConfig>(defaultBaseConfig);

export function BaseConfigProvider({
  value,
  children,
}: {
  value: ResolvedBaseConfig;
  children: ReactNode;
}) {
  const theme = value.brandTheme;
  const style = {
    "--background": theme.background,
    "--foreground": theme.text,
    "--muted": theme.surface,
    "--muted-foreground": colorMix(theme.text, theme.background, 0.7),
    "--accent": colorMix(theme.accent, theme.background, 0.18),
    "--accent-foreground": theme.text,
    "--border": colorMix(theme.surface, theme.text, 0.82),
    "--input": colorMix(theme.surface, theme.text, 0.82),
    "--ring": theme.accent,
    "--primary": theme.accent,
    "--primary-foreground": bestContrast(theme.accent),
    "--popover": theme.background,
    "--popover-foreground": theme.text,
    "--card": theme.background,
    "--card-foreground": theme.text,
    "--sidebar": theme.surface,
    "--sidebar-foreground": theme.text,
    "--sidebar-primary": theme.accent,
    "--sidebar-primary-foreground": bestContrast(theme.accent),
    "--sidebar-accent": colorMix(theme.accent, theme.surface, 0.2),
    "--sidebar-accent-foreground": theme.text,
    "--sidebar-border": colorMix(theme.surface, theme.accent, 0.78),
    "--sidebar-ring": theme.accent,
  } as CSSProperties;

  return (
    <BaseConfigContext.Provider value={value}>
      <div className="dark h-full" style={style}>
        {children}
      </div>
    </BaseConfigContext.Provider>
  );
}

export function useBaseConfig() {
  return useContext(BaseConfigContext);
}

function colorMix(first: string, second: string, firstWeight: number) {
  const a = parseHex(first);
  const b = parseHex(second);
  if (!a || !b) return first;

  const mix = a.map((value, index) =>
    Math.round(value * firstWeight + b[index] * (1 - firstWeight)),
  );
  return `#${mix.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function bestContrast(hex: string) {
  const rgb = parseHex(hex);
  if (!rgb) return "#000000";
  const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  return luminance > 0.6 ? "#09090b" : "#ffffff";
}

function parseHex(hex: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const value = match[1];
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

/**
 * Fenced code, coloured and copyable.
 *
 * These are the two slots `MarkdownTextPrimitive` leaves open, and the library
 * composes them as *siblings* — a header, then the content, inside one fragment
 * with no wrapper to style. That is why the two halves join themselves: the
 * header wears the top radius and drops its bottom border, and the `pre` below
 * squares off its top. Adjacent siblings, one apparent box.
 *
 * `SyntaxHighlighter` is only reached when the fence declared a language at all
 * — an undecorated ``` block goes to the library's own plain renderer and never
 * arrives here. So the fallback below is for the other case: a language that was
 * named but that Prism has no grammar for.
 */

import { useState, type FC } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Highlight, Prism, type PrismTheme } from "prism-react-renderer";
import { themes } from "prism-react-renderer";
import type {
  CodeHeaderProps,
  SyntaxHighlighterProps,
} from "@assistant-ui/react-markdown";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useResolvedTheme } from "@/lib/theme";

/** How long the tick stays after a copy. Matches the message action bar's own
 *  feedback, so the two do not read as different kinds of button. */
const COPIED_MS = 2000;

/** Prism's own names for the grammars it ships, plus the spellings people
 *  actually write in a fence. Anything not here renders unhighlighted, which is
 *  a plain monospace block in the right colours rather than a broken one. */
const ALIASES: Record<string, string> = {
  yml: "yaml",
  shell: "bash",
  sh: "bash",
  "c++": "cpp",
  "c#": "csharp",
  golang: "go",
  rs: "rust",
  ts: "typescript",
  js: "javascript",
  py: "python",
  md: "markdown",
};

/** The grammar to highlight with, or null when Prism has none. */
function grammarFor(language: string): string | null {
  const name = ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  return name in Prism.languages ? name : null;
}

/**
 * Light and dark.
 *
 * Picked from the resolved theme rather than from a `dark:` class, because
 * these are inline styles — Prism themes are JavaScript objects, which is most
 * of why this highlighter was chosen over one that ships stylesheets.
 */
function themeFor(resolved: "light" | "dark"): PrismTheme {
  return resolved === "dark" ? themes.vsDark : themes.github;
}

export const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  // A fence that declared nothing arrives here as `"unknown"`. The header still
  // earns its place — the copy button is the reason most people look at it —
  // but naming the language "unknown" is a label pretending to be information.
  const named = language && language !== "unknown" ? language : null;

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    });
  };

  return (
    <div
      data-slot="code-header"
      className="bg-muted/70 text-muted-foreground -mb-px flex h-9 items-center justify-between rounded-t-(--radius-md) border px-3 font-mono text-xs"
    >
      <span className="truncate">{named}</span>
      <TooltipIconButton
        tooltip={copied ? "Copied" : "Copy code"}
        side="left"
        className="-me-1.5 size-7"
        onClick={copy}
      >
        {copied ? (
          <CheckIcon className="size-3.5" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </TooltipIconButton>
    </div>
  );
};

export const SyntaxHighlighter: FC<SyntaxHighlighterProps> = ({
  components: { Pre, Code },
  language,
  code,
}) => {
  const resolved = useResolvedTheme();
  const grammar = grammarFor(language);

  // Named a language Prism does not know. The block still gets its header, its
  // frame and its copy button — only the colours are missing, which is the
  // honest picture of "no grammar for this" rather than a failure.
  if (!grammar) {
    return (
      <Pre className="rounded-t-none">
        <Code>{code}</Code>
      </Pre>
    );
  }

  return (
    <Highlight theme={themeFor(resolved)} code={code} language={grammar}>
      {({ style, tokens, getLineProps, getTokenProps }) => (
        // The theme's own background, over the stylesheet's. Everything else
        // about the box — border, radius, padding, scroll — stays with
        // `.aui-md pre` in `index.css`, so a highlighted block and a plain one
        // are the same shape.
        <Pre style={style} className="rounded-t-none">
          <Code>
            {tokens.map((line, index) => (
              // `key` on the index deliberately: these are lines of one
              // immutable string, and they have no identity beyond position.
              <span key={index} {...getLineProps({ line })} className="block">
                {line.map((token, at) => (
                  <span key={at} {...getTokenProps({ token })} />
                ))}
              </span>
            ))}
          </Code>
        </Pre>
      )}
    </Highlight>
  );
};

/**
 * Reading an interrupt, and shaping the answer it expects.
 *
 * Pure functions on purpose — no React here — because these are the rules that
 * are easy to get subtly, silently wrong, and a plain function is the thing you
 * can reason about and test without a browser.
 *
 * The governing rule is **render from the generic protocol fields first, then
 * enrich from `metadata.second_brain`.** That ordering keeps the app honest
 * about the protocol: everything below works against any AG-UI server, and the
 * Second Brain metadata only ever adds labels and extra buttons. A missing
 * metadata field degrades; it never crashes.
 */

import type { AgUiInterrupt, AgUiResumeEntry } from "@assistant-ui/react-ag-ui";

/** One selectable answer. `value` goes to the server, `label` to the person. */
export type Choice = { value: string; label: string };

export type InterruptView = {
  /** The question, shown in full and never truncated. */
  message: string;
  /** True for a permission request — the safety surface. */
  isApproval: boolean;
  /** Non-empty means render buttons; empty means render an input. */
  choices: Choice[];
  /** HTML input type, when there are no choices. */
  inputType: "text" | "number";
  /** Prefill for the input, if the schema offered one. */
  defaultValue: string;
  /** Extra guidance the kernel supplied. */
  assist: string;
  allowBack: boolean;
  allowSkip: boolean;
};

type SchemaValue = {
  type?: string;
  enum?: unknown[];
  enumLabels?: unknown[];
  default?: unknown;
};

function schemaValue(interrupt: AgUiInterrupt): SchemaValue {
  const schema = (interrupt.responseSchema ?? {}) as {
    properties?: { value?: SchemaValue };
  };
  return schema.properties?.value ?? {};
}

function secondBrain(interrupt: AgUiInterrupt): Record<string, unknown> {
  const metadata = (interrupt.metadata ?? {}) as {
    second_brain?: Record<string, unknown>;
  };
  return metadata.second_brain ?? {};
}

/**
 * Pair `enum` with `enumLabels` **by index**.
 *
 * Answer with the value, display the label. Getting this backwards puts
 * internal spellings like `always:api.search.brave.com` on a person's buttons —
 * the handoff notes this has bitten the system before, which is why it is one
 * named function rather than an inline `.map` at each call site.
 */
function choicesFromSchema(value: SchemaValue): Choice[] {
  if (!Array.isArray(value.enum)) return [];
  const labels = Array.isArray(value.enumLabels) ? value.enumLabels : [];
  return value.enum.map((choice, index) => ({
    value: String(choice),
    label: String(labels[index] ?? choice),
  }));
}

/** Everything the dialog needs to draw itself, from one interrupt. */
export function describe(interrupt: AgUiInterrupt): InterruptView {
  const value = schemaValue(interrupt);
  const meta = secondBrain(interrupt);
  const isApproval = interrupt.reason === "confirmation";

  // Generic first.
  let choices = choicesFromSchema(value);

  // An approval with no enum is the plain yes/no case. Both options are
  // spelled out here rather than left implicit so that neither can be styled
  // as the obvious one later by accident.
  if (choices.length === 0 && isApproval) {
    choices = [
      { value: "allow", label: "Allow" },
      { value: "deny", label: "Deny" },
    ];
  }

  // Then enrich. `display.choices` carries the kernel's own labelling, which is
  // better than the schema's when both exist.
  const form = (meta.form ?? {}) as {
    field?: { type?: string; default?: unknown };
    display?: {
      prompt?: string;
      assist?: string;
      choices?: { value?: unknown; label?: unknown }[];
      allow_back?: boolean;
      allow_skip?: boolean;
    };
  };
  const display = form.display ?? {};
  if (Array.isArray(display.choices) && display.choices.length > 0) {
    choices = display.choices.map((choice) => ({
      value: String(choice.value ?? ""),
      label: String(choice.label ?? choice.value ?? ""),
    }));
  }

  const numeric = value.type === "integer" || value.type === "number";

  return {
    message: interrupt.message ?? "Input required",
    isApproval,
    choices,
    inputType: numeric ? "number" : "text",
    defaultValue: value.default === undefined ? "" : String(value.default),
    assist: String(display.assist ?? ""),
    allowBack: display.allow_back === true,
    allowSkip: display.allow_skip === true,
  };
}

/**
 * The payload shape this interrupt's answer must take.
 *
 * Three shapes, and picking the wrong one fails *silently* — the server's
 * `_coerce` validates an approval answer against its enum and simply refuses a
 * mismatch, leaving the dialog answered on our side and the agent still
 * waiting on its.
 *
 *   - approval **with** an enum → `{value}`, verbatim, never coerced
 *   - approval **without** one  → `{accepted: boolean}`
 *   - a form field or choice    → `{value}`
 */
export function resolveWith(
  interrupt: AgUiInterrupt,
  value: string,
): AgUiResumeEntry {
  const hasEnum = Array.isArray(schemaValue(interrupt).enum);
  const isApproval = interrupt.reason === "confirmation";

  if (isApproval && !hasEnum) {
    return {
      interruptId: interrupt.id,
      status: "resolved",
      payload: { accepted: value === "allow" },
    };
  }
  return {
    interruptId: interrupt.id,
    status: "resolved",
    payload: { value },
  };
}

/**
 * Closing the dialog is an answer, not an absence of one.
 *
 * `cancelled` denies an approval and cancels a form. Sending nothing would
 * leave the agent parked in `approving_request` waiting for something that is
 * never coming — which looks exactly like the app having hung.
 */
export function cancel(interrupt: AgUiInterrupt): AgUiResumeEntry {
  return { interruptId: interrupt.id, status: "cancelled" };
}

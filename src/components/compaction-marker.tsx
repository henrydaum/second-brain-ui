/**
 * Where the agent's memory of this conversation starts.
 *
 * Compaction folds everything said so far into a summary and writes a marker
 * row. Nothing is deleted — every message above the line is still stored, and
 * this app still shows all of it — but from the agent's side that transcript is
 * gone, replaced by a paragraph of summary. Scrollback that did not say so
 * would be a transcript quietly disagreeing with what the agent can answer
 * about, and the person would find out by being told "I don't recall that"
 * about a message plainly on their screen.
 *
 * **So the line is drawn where the loss happened, not where the reading
 * stops.** A wiggly rule rather than a banner: this is a seam in the
 * conversation, not an event in it, and anything with a headline and a body
 * would read as something the agent said. The sentence lives in the tooltip,
 * where it answers the question the line raises without repeating itself down
 * the length of a long conversation.
 *
 * assistant-ui has no compaction primitive. What it does have is the **system
 * role** — a first-class message that is in the transcript without being of the
 * conversation, whose default renderer draws nothing — and that is exactly this
 * shape, so the marker travels as one rather than through a channel of its own.
 * See `runtime/convert.ts`.
 */

import { useId, type FC } from "react";
import { MessagePrimitive, useAuiState } from "@assistant-ui/react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fullTimestamp } from "@/lib/time";
import { COMPACTED, SENT_AT } from "@/runtime/convert";

/**
 * What the line means, in one sentence.
 *
 * Worded for what is durably true. The session that did the compacting keeps
 * the last couple of messages beside the summary for a while, but that does not
 * survive a reload and is not a promise this can make on the conversation's
 * behalf — and of the two ways to be wrong here, "the agent knows less than you
 * think" is the one that costs nothing.
 */
const EXPLANATION =
  "The agent can only see a summary of everything above this line — not the messages themselves.";

/** One period of the rule, in the pattern's own units. The path below is drawn
 *  well past both edges of the tile so the curve continues across the join
 *  rather than meeting itself at a clipped stroke end. */
const WAVE = { width: 20, height: 10 };

/**
 * The rule itself, given the moment it marks.
 *
 * Split from the message wiring above it so it can be drawn — and tested —
 * without a thread around it.
 */
export const CompactionRule: FC<{ at?: number }> = ({ at }) => {
  // Patterns are referenced by id, and a conversation can hold more than one
  // marker. Sharing one id across instances happens to render the same, but it
  // is duplicate ids in the document, which is nobody's intent.
  const wave = useId();
  const when = at === undefined ? null : fullTimestamp(new Date(at));

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          data-slot="compaction-marker"
          // `cursor-default` and `select-none` for the reason the message time
          // has them: an I-beam over a decorative rule reads as an invitation
          // to select something that is not text.
          className="group flex w-full cursor-default items-center py-1 select-none"
        >
          {/* The tooltip is a hover, and a hover is not available to everyone.
              This is the same sentence, said where a screen reader will reach
              it as it passes the line. */}
          <span className="sr-only">Conversation compacted. {EXPLANATION}</span>
          {/* Faded rather than a border colour: `--border` is white at 10% in
              the dark theme, which for a full-width hairline is close to
              invisible — and a marker nobody notices is the failure this whole
              component exists to prevent. One token at two strengths also
              means the hover is the same line getting clearer, not a different
              colour arriving. */}
          <svg
            aria-hidden
            className="text-muted-foreground/40 group-hover:text-muted-foreground h-2.5 w-full transition-colors duration-200"
          >
            <defs>
              <pattern
                id={wave}
                width={WAVE.width}
                height={WAVE.height}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M -20 5 q 5 -4 10 0 t 10 0 t 10 0 t 10 0 t 10 0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                  strokeLinecap="round"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${wave})`} />
          </svg>
        </div>
      </TooltipTrigger>
      {/* `subtle`, like the message time: this elaborates on something already
          on screen rather than announcing what a control will do. */}
      <TooltipContent side="top" variant="subtle" className="max-w-72">
        <p className="text-foreground font-medium">
          Conversation compacted
          {when && <span className="text-muted-foreground"> · {when}</span>}
        </p>
        <p>{EXPLANATION}</p>
      </TooltipContent>
    </Tooltip>
  );
};

export const CompactionMarker: FC = () => {
  // Keyed on the flag rather than on the role. A system message this app did
  // not put there is one it cannot explain, and drawing nothing for it is both
  // assistant-ui's own default and the only honest option.
  const compacted = useAuiState(
    (s) => s.message.metadata?.custom?.[COMPACTED] === true,
  );
  const at = useAuiState((s) => {
    const value = s.message.metadata?.custom?.[SENT_AT];
    return typeof value === "number" ? value : undefined;
  });

  if (!compacted) return null;

  return (
    <MessagePrimitive.Root
      data-role="system"
      className="fade-in animate-in mx-auto w-full max-w-(--thread-max-width) px-2 duration-150"
    >
      <CompactionRule at={at} />
    </MessagePrimitive.Root>
  );
};

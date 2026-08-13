/**
 * The Settings row that turns device notifications on and off.
 *
 * Deliberately shaped like the rows it sits between rather than like a feature:
 * a ghost button, left-aligned icon and label, the same muted-until-hover
 * treatment as `ThemePicker` and the system actions. It is one line in a list
 * of settings, which is what it is.
 *
 * **Absent, not disabled, where push cannot work.** On a desktop browser
 * without `PushManager`, and on an iPhone before the app has been added to the
 * home screen, `pushSupported()` is false and this renders nothing. A disabled
 * control there would be an invitation to go hunting for the reason it is
 * disabled, and the real reason — "install the app first" — belongs in the
 * deployment doc, not in a tooltip nobody on a phone can hover.
 *
 * **Nothing important is said in a `title` alone.** This is a control whose
 * whole audience is a phone, and a phone has no hover: an explanation parked in
 * a tooltip is an explanation nobody will ever read. So the two states that
 * need explaining say it in visible text underneath, and the row stays a plain
 * `Button` only while there is nothing to explain.
 *
 * Clicking is the user gesture `Notification.requestPermission()` requires, so
 * the permission prompt has to hang off this handler and cannot be moved into
 * an effect.
 */

import { useCallback, useEffect, useState, type FC } from "react";
import {
  BellIcon,
  BellOffIcon,
  BellRingIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  disablePush,
  enablePush,
  pushState,
  pushSupported,
  type PushState,
} from "@/lib/push";

type Drawn = Exclude<PushState, "unsupported">;

/**
 * What each state says.
 *
 * `detail` is only set where the label alone would leave somebody stuck, and
 * where it is set it is *rendered*, not hovered. `blocked` is the one true dead
 * end — a page cannot re-prompt after a denial — while `unconfigured` is a
 * server-side gap the person reading this can go and close, so it names the
 * settings rather than merely reporting failure.
 */
const PRESENTATION: Record<
  Drawn,
  { label: string; icon: typeof BellIcon; detail?: string }
> = {
  off: {
    label: "Notify this device",
    icon: BellIcon,
  },
  on: {
    label: "Stop notifying this device",
    icon: BellRingIcon,
  },
  blocked: {
    label: "Notifications blocked",
    icon: BellOffIcon,
    detail:
      "This device refused permission. Re-allow notifications for Second Brain in iOS Settings, then reopen this page.",
  },
  unconfigured: {
    label: "Notifications not set up",
    icon: BellOffIcon,
    detail:
      "Second Brain has no VAPID key yet, so no device can be subscribed. This is a server setting, not a permission on this phone.",
  },
};

export const PushToggle: FC = () => {
  // `null` until the first read resolves. Rendering nothing in the meantime
  // keeps the row from flickering between "off" and "on" on every open of
  // Settings, which reads as a control changing itself.
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  // On mount this can only ever answer from the browser, so it never says
  // `unconfigured` — that verdict comes from *trying*, because the server's key
  // is not something the browser can see. Reopening Settings therefore offers
  // "Notify this device" again, which is right: trying again costs one Request
  // and is exactly what somebody who has just set the key wants to do.
  useEffect(() => {
    let cancelled = false;
    void pushState().then((current) => {
      if (!cancelled) setState(current);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(async () => {
    setBusy(true);
    try {
      setState(state === "on" ? await disablePush() : await enablePush());
    } catch {
      // Something genuinely unexpected. Re-read rather than guess: the
      // browser's own answer is the one the row is supposed to show, and a
      // failed subscribe leaves permission granted but nothing subscribed.
      setState(await pushState());
    } finally {
      setBusy(false);
    }
  }, [state]);

  /** Ask again after fixing the thing the row complained about, without
   *  hunting for a way to reload an installed web app. */
  const recheck = useCallback(async () => {
    setBusy(true);
    try {
      setState(await enablePush());
    } catch {
      setState(await pushState());
    } finally {
      setBusy(false);
    }
  }, []);

  if (!pushSupported() || state === null || state === "unsupported") return null;

  const { label, icon: Icon, detail } = PRESENTATION[state];
  const StateIcon = busy ? LoaderCircleIcon : Icon;

  // The explaining states are not buttons: there is nothing to press, and a
  // disabled button with a tooltip is exactly the shape that told this user
  // nothing on a phone. `unconfigured` keeps one affordance — a re-check — so
  // that setting the key on the Mac does not also mean reinstalling the app.
  if (detail) {
    return (
      <div className="px-3 py-2">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <StateIcon className={busy ? "size-3.5 animate-spin" : "size-3.5"} />
          <span>{label}</span>
        </div>
        <p className="text-muted-foreground/80 mt-1 text-xs leading-relaxed">
          {detail}
        </p>
        {state === "unconfigured" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void recheck()}
            className="text-muted-foreground hover:text-foreground mt-1 h-7 w-full justify-start gap-2 px-0 font-normal"
          >
            <RefreshCwIcon className="size-3.5" />
            Check again
          </Button>
        )}
      </div>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={busy}
      aria-pressed={state === "on"}
      onClick={() => void toggle()}
      className="text-muted-foreground hover:text-foreground w-full justify-start gap-2 font-normal"
    >
      <StateIcon className={busy ? "size-3.5 animate-spin" : "size-3.5"} />
      {label}
    </Button>
  );
};

/**
 * The Settings row that turns device notifications on.
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
 * Clicking is the user gesture `Notification.requestPermission()` requires, so
 * the permission prompt has to hang off this handler and cannot be moved into
 * an effect.
 */

import { useCallback, useEffect, useState, type FC } from "react";
import { BellIcon, BellOffIcon, BellRingIcon, LoaderCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  disablePush,
  enablePush,
  pushState,
  pushSupported,
  type PushState,
} from "@/lib/push";

/** What each state says and does. `blocked` is a dead end by design — a page
 *  cannot re-prompt after a denial, so the row states the fact and stops
 *  offering. */
const PRESENTATION: Record<
  Exclude<PushState, "unsupported">,
  { label: string; icon: typeof BellIcon; title: string }
> = {
  off: {
    label: "Notify this device",
    icon: BellIcon,
    title: "Send scheduled agent results to this device as notifications.",
  },
  on: {
    label: "Notifying this device",
    icon: BellRingIcon,
    title: "Scheduled agent results are sent to this device. Click to stop.",
  },
  blocked: {
    label: "Notifications blocked",
    icon: BellOffIcon,
    title:
      "This browser refused notification permission. Re-allow it in the browser or system settings for this app.",
  },
  unconfigured: {
    label: "Notifications not set up",
    icon: BellOffIcon,
    title:
      "Second Brain has no VAPID key, so this device cannot be subscribed. Generate a key pair and set push_vapid_public_key and secret_push_vapid_private_key on the push service.",
  },
};

export const PushToggle: FC = () => {
  // `null` until the first read resolves. Rendering nothing in the meantime
  // keeps the row from flickering between "off" and "on" on every open of
  // Settings, which reads as a control changing itself.
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

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
      // The service is probably not loaded. Re-read rather than guess: the
      // browser's own answer is the one the row is supposed to show, and a
      // failed subscribe leaves permission granted but nothing subscribed.
      setState(await pushState());
    } finally {
      setBusy(false);
    }
  }, [state]);

  if (!pushSupported() || state === null || state === "unsupported") return null;

  const { label, icon: Icon, title } = PRESENTATION[state];
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      title={title}
      disabled={busy || state === "blocked" || state === "unconfigured"}
      aria-pressed={state === "on"}
      onClick={() => void toggle()}
      className="text-muted-foreground hover:text-foreground w-full justify-start gap-2 font-normal"
    >
      {busy ? (
        <LoaderCircleIcon className="size-3.5 animate-spin" />
      ) : (
        <Icon className="size-3.5" />
      )}
      {label}
    </Button>
  );
};

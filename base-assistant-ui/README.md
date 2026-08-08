# Xulux Base Assistant UI

A complete chat application built from assistant-ui primitives: thread management, attachments, mentions, slash commands, model picker, and voice input.

This Phase 1 template intentionally preserves the assistant-ui Base demo as-is.
Customization is planned for the next phase after the Base demo surface is
inventoried and a contract is defined.

## Run

```bash
npm install
npm run dev
```

Add `OPENAI_API_KEY` to `.env.local` for live AI responses. Without a key, `app/api/chat/route.ts` returns a deterministic fallback response so the demo still runs locally.

Source demo: `apps/docs/components/examples/base.tsx`

Hosted template config: `blaxel.toml`

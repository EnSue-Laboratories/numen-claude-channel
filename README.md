# numen-claude-channel

Talk to Claude from inside Minecraft.

A [Claude Code channel](https://code.claude.com/docs/en/channels) that bridges a running [Numen](https://github.com/Dwinovo/minecraft-numen) Minecraft game into a live Claude Code session. Type `@Claude dig me a mine` in the in-game chat and the message is **pushed** into your session — Claude reads it, takes over a companion through [numen-mcp](https://github.com/Dwinovo/numen-mcp), and does it. No API key in the mod needed: Claude *is* the brain.

```
Minecraft (Numen mod)                      Claude Code session
┌───────────────────────┐   file tail   ┌─────────────────────────┐
│ vanilla chat @mentions ├──────────────▶ <channel> events pushed  │
│ G-panel messages       │              │ Claude reacts, drives    │
│ task_finished events   │              │ companions via numen-mcp │
└───────────────────────┘   HTTP MCP   ◀┤ (http://127.0.0.1:8765)  │
                                        └─────────────────────────┘
```

## What it watches

| Source | Event type | Where it exists |
|---|---|---|
| `logs/latest.log` — vanilla chat lines containing an `@mention` | `chat` | client **and** dedicated server |
| `config/numen/conversations/*.inbox.jsonl` — G-panel messages | `prompt` | client only |
| same files — `task_finished` / `body_log` game feedback | `event` | client only |

The channel is currently **one-way**: numen-mcp has no `say` tool yet, so Claude answers with actions in the world (and text in your terminal), not in-game chat.

## Requirements

- [Numen](https://github.com/Dwinovo/minecraft-numen) 0.0.4+ and [numen-mcp](https://github.com/Dwinovo/numen-mcp) installed in the game (Minecraft 1.21.1, Fabric/NeoForge)
- Node.js 18+
- Claude Code with channels (research preview) — requires claude.ai or Console auth

## Setup

```bash
git clone https://github.com/EnSue-Laboratories/numen-claude-channel
cd numen-claude-channel
npm install
```

Register both servers in your project's `.mcp.json` (adjust paths):

```json
{
  "mcpServers": {
    "numen": { "type": "http", "url": "http://127.0.0.1:8765/mcp" },
    "numen-chat": {
      "command": "node",
      "args": ["/path/to/numen-claude-channel/numen-chat.js"],
      "env": { "NUMEN_MINECRAFT_DIR": "/path/to/your/.minecraft" }
    }
  }
}
```

`NUMEN_MINECRAFT_DIR` points at the game dir (the folder containing `config/` and `logs/`):

- **Singleplayer / client**: the instance's `.minecraft` dir → all three event sources work.
- **Dedicated Linux server**: the server root → `@mention` chat works (server log); panel inbox files live on the owner's client, so that source stays silent. Run the channel on whichever machine also runs Claude Code.

Individual overrides: `NUMEN_CONV_DIR`, `NUMEN_GAME_LOG`, `NUMEN_POLL_MS`.

Start the session with the channel enabled (research preview requires the development flag for custom channels):

```bash
claude --dangerously-load-development-channels server:numen-chat
```

The flag is the on/off toggle — omit it and the channel never loads. Other MCP clients (Codex, Gemini, …) are unaffected either way: `numen-mcp` stays a standard MCP server, and the channel is a separate, purely additive entry.

In-game, with a companion summoned (`/numen player summon Claude`):

```
@Claude go chop some wood
```

## Extras

`numen.py` — a one-file CLI for poking numen-mcp directly, useful for debugging:

```bash
python3 numen.py list_companions
python3 numen.py get_self_status '{"companion":"Claude"}'
NUMEN_MCP_URL=http://192.168.1.10:8765/mcp python3 numen.py list_companions
```

## Notes

- Only *new* lines are forwarded (the watcher starts at end-of-file), so restarting the session doesn't replay history.
- Repeated `body_log` reflex events (e.g. "fled from a Zombie") are deduplicated for 30s to avoid spam.
- Chat forwarding is mention-gated: lines without `@word` are never sent to Claude.

## License

MIT © EnSue Laboratories

## Remote game (cross-machine)

When the game runs on a different machine than Claude Code (e.g. a Windows gaming PC), set
`NUMEN_SSH_HOST` instead of `NUMEN_MINECRAFT_DIR`:

```json
"numen-chat": {
  "command": "node",
  "args": ["/path/to/numen-chat.js"],
  "env": { "NUMEN_SSH_HOST": "user@gamingpc" }
}
```

Copy `numen-tail.ps1` to the remote user's home first (`scp numen-tail.ps1 user@gamingpc:`).
The channel then streams chat/inbox events over SSH (key auth required); it auto-reconnects
if the link drops. Pair it with an `.mcp.json` `numen` entry pointing at the remote
numen-mcp (`http://gamingpc:8765/mcp` + bearer token) for full cross-machine play.

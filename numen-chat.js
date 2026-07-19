#!/usr/bin/env node
// Claude Code channel: tails Numen companion inbox files and pushes
// owner chat + task events into the running session.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';

// Point NUMEN_MINECRAFT_DIR at the game dir (the folder holding config/ and logs/):
//   - singleplayer client: the instance's .minecraft dir  -> panel chat + events + vanilla chat
//   - dedicated server:    the server root                -> vanilla chat mentions (server log);
//                          inbox files only exist client-side, so that source stays silent
// NUMEN_CONV_DIR / NUMEN_GAME_LOG override the derived paths individually.
const BASE = process.env.NUMEN_MINECRAFT_DIR || '';
const CONV_DIR = process.env.NUMEN_CONV_DIR || (BASE && join(BASE, 'config', 'numen', 'conversations'));
const GAME_LOG = process.env.NUMEN_GAME_LOG || (BASE && join(BASE, 'logs', 'latest.log'));
if (!CONV_DIR && !GAME_LOG) {
  console.error('[numen-chat] set NUMEN_MINECRAFT_DIR (or NUMEN_CONV_DIR / NUMEN_GAME_LOG) — nothing to watch');
  process.exit(1);
}
const POLL_MS = Number(process.env.NUMEN_POLL_MS || 500);
// Matches both client logs ("[CHAT] <name> msg") and dedicated-server logs ("<name> msg");
// only lines containing an @mention are forwarded.
const CHAT_RE = /(?:\[CHAT\] )?<([^>]+)> (.*@\w+.*)/;

const mcp = new Server(
  { name: 'numen-chat', version: '0.1.0' },
  {
    capabilities: { experimental: { 'claude/channel': {} } },
    instructions: [
      'Events from the numen-chat channel arrive as <channel source="numen-chat" type="...">.',
      'type="chat" is the player talking in VANILLA in-game chat with an @mention (meta: player, mention) — if the mention names a live Numen companion (or "Claude"), treat the message as an instruction/question and act on it by driving that companion through the "numen" MCP server tools (acquire_companion first if needed).',
      'type="prompt" is the owner talking to a companion via the G-panel (meta: companion uuid — map to a name via list_companions). Same handling.',
      'type="event" is game feedback (task_finished results, body_log reflexes) — use it to continue or adjust ongoing work instead of polling task_status.',
      'This channel is one-way: numen-mcp has no speak tool, so you cannot chat back in-game. Acknowledge by acting, and report in the terminal.',
    ].join(' '),
  },
);
await mcp.connect(new StdioServerTransport());

// start at EOF for every existing file: only NEW lines get forwarded
const offsets = new Map();
function fileSize(p) { try { return statSync(p).size; } catch { return -1; } }
for (const f of safeList()) offsets.set(f, fileSize(join(CONV_DIR, f)));

function safeList() {
  if (!CONV_DIR) return [];
  try { return readdirSync(CONV_DIR).filter(f => f.endsWith('.inbox.jsonl')); }
  catch { return []; }
}

const recentBodyLogs = new Map(); // dedupe text -> last-sent ms
let logOffset = fileSize(GAME_LOG);

async function pumpGameLog() {
  if (!GAME_LOG) return;
  const size = fileSize(GAME_LOG);
  if (size < 0) return;
  if (size < logOffset) logOffset = 0;   // new day / log rotation
  if (size === logOffset) return;
  const fd = openSync(GAME_LOG, 'r');
  const buf = Buffer.alloc(size - logOffset);
  readSync(fd, buf, 0, buf.length, logOffset);
  closeSync(fd);
  logOffset = size;
  for (const line of buf.toString('utf8').split('\n')) {
    const m = CHAT_RE.exec(line);
    if (!m) continue;
    const [, player, text] = m;
    const mention = (/@(\w+)/.exec(text) || [])[1] || '';
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: text.trim(),
        meta: { player, mention, type: 'chat' },
      },
    });
  }
}

async function pump() {
  await pumpGameLog();
  for (const f of safeList()) {
    const path = join(CONV_DIR, f);
    const size = fileSize(path);
    if (size < 0) continue;
    let off = offsets.get(f) ?? 0;
    if (size < off) off = 0;              // file rotated/truncated
    if (size === off) { offsets.set(f, off); continue; }

    const fd = openSync(path, 'r');
    const buf = Buffer.alloc(size - off);
    readSync(fd, buf, 0, buf.length, off);
    closeSync(fd);
    offsets.set(f, size);

    const companion = f.replace('.inbox.jsonl', '');
    for (const line of buf.toString('utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let msg;
      try { msg = JSON.parse(t); } catch { continue; }
      const text = (msg.text || '')
        .replace(/<\/?query>/g, '')
        .trim();
      if (!text) continue;

      if (msg.type === 'event') {
        if (text.includes('kind="body_log"')) {
          const last = recentBodyLogs.get(text) || 0;
          if (Date.now() - last < 30_000) continue;  // squelch reflex spam
          recentBodyLogs.set(text, Date.now());
        }
      }

      await mcp.notification({
        method: 'notifications/claude/channel',
        params: {
          content: text,
          meta: { companion, type: msg.type || 'unknown', ts: String(msg.ts || '') },
        },
      });
    }
  }
  setTimeout(pump, POLL_MS);
}
setTimeout(pump, POLL_MS);

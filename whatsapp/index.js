import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import express from "express";
import P from "pino";
import QRCode from "qrcode";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";

const PORT = process.env.PORT || 3000;
const AUTH_DIR = process.env.AUTH_DIR || "/app/auth";
// Where the backend's inbound-capture endpoint lives — the gateway is a dumb
// pipe, it forwards every message here and the backend decides what to do
// with it (matching chat, idempotency, OCR, the write-enabled agent, etc).
const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";
// Proves to the backend that a call to /api/wa/inbound/ actually came from
// this gateway — that endpoint has no browser session to authenticate with.
const WA_INBOUND_SECRET = process.env.WA_INBOUND_SECRET || "";

// Baileys logs some errors under non-standard keys (e.g. `ackErr`) that pino's
// default serializer only special-cases for `err`/`error` — without this,
// those log as `{}` since Error.message/stack aren't own-enumerable.
const logger = P({
  level: process.env.LOG_LEVEL || "warn",
  serializers: { ackErr: P.stdSerializers.err, err: P.stdSerializers.err },
});

// Mutable connection state read by the HTTP handlers below.
let sock = null;
let connectionState = "connecting"; // "connecting" | "qr" | "open" | "close"
let latestQR = null;

// Best-effort chat directory: WhatsApp doesn't hand over a full chat list for
// free, so this fills in progressively from history sync + incoming traffic.
// id (JID) -> display name.
const chats = new Map();

// Message IDs the gateway itself just sent (via /send), so forwardInbound can
// tell "the bot's own auto-reply echoing back" apart from "the owner typing a real
// message from their own linked phone" — both arrive as fromMe:true, since their
// phone IS the linked device. Consumed (deleted) the moment they're seen, so
// this stays small; the size cap is just a cheap safety net.
const recentlySentIds = new Set();

function upsertChats(items) {
  for (const item of items || []) {
    if (!item?.id) continue;
    const name = item.name || item.notify || chats.get(item.id);
    if (name && name !== item.id) {
      chats.set(item.id, name);
    } else if (!chats.has(item.id)) {
      chats.set(item.id, item.id);
      // Group subjects aren't always in chats/contacts upsert events (unlike
      // the initial history sync, which does include them) — fetch it directly.
      if (item.id.endsWith("@g.us") && sock) {
        sock
          .groupMetadata(item.id)
          .then((meta) => meta?.subject && chats.set(item.id, meta.subject))
          .catch(() => {});
      }
    }
  }
}

// Forwards one inbound message to the backend's dumb-pipe endpoint: JSON for
// plain text, multipart with the downloaded image for a photo. Never throws —
// a failed forward (backend down, bad media, etc.) is logged and skipped so
// it can't break the rest of the messages.upsert batch.
async function forwardInbound(msg) {
  const chatId = msg.key?.remoteJid;
  const messageId = msg.key?.id;
  if (!chatId || !messageId) return;
  if (chatId === "status@broadcast" || chatId.endsWith("@newsletter")) return;

  const isSelf = msg.key?.fromMe;
  // Our own reply landing back in the timeline — not a real inbound message.
  if (isSelf && recentlySentIds.delete(messageId)) return;

  const content = msg.message;
  if (!content) return;
  const imageMsg = content.imageMessage;
  const text = content.conversation || content.extendedTextMessage?.text || imageMsg?.caption || "";
  // "self" = the owner, from their own linked phone; otherwise whoever's name/JID
  // Baileys attaches to the message (pushName for a person, participant is
  // the group-message sender field when pushName isn't set).
  const sender = isSelf ? "self" : msg.pushName || msg.key?.participant || "";

  try {
    if (imageMsg) {
      const buffer = await downloadMediaMessage(msg, "buffer", {}, {
        logger,
        reuploadRequest: sock.updateMediaMessage,
      });
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("message_id", messageId);
      form.append("caption", text);
      form.append("sender", sender);
      form.append("image", new Blob([buffer], { type: imageMsg.mimetype || "image/jpeg" }), "receipt.jpg");
      await fetch(`${BACKEND_URL}/api/wa/inbound/`, {
        method: "POST",
        headers: { "X-Wa-Gateway-Secret": WA_INBOUND_SECRET },
        body: form,
      });
    } else if (text) {
      await fetch(`${BACKEND_URL}/api/wa/inbound/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Wa-Gateway-Secret": WA_INBOUND_SECRET,
        },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, sender }),
      });
    }
  } catch (err) {
    logger.warn({ err }, "Failed to forward inbound message to backend.");
  }
}

// AUTH_DIR is the mountpoint of the whatsapp_auth Docker volume, so it can't be
// rmdir'd itself (EBUSY) — only emptied.
async function clearAuthDir() {
  const entries = await readdir(AUTH_DIR).catch(() => []);
  await Promise.all(
    entries.map((name) =>
      rm(join(AUTH_DIR, name), { recursive: true, force: true }).catch((err) =>
        logger.warn({ err, name }, "Failed to clear auth file.")
      )
    )
  );
}

async function startSock() {
  connectionState = "connecting";
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  // The version bundled with @whiskeysockets/baileys (and fetchLatestBaileysVersion(),
  // which just reads that same bundled default from GitHub) has lagged behind actual
  // WhatsApp Web releases before, which silently breaks new-device pairing — the QR
  // scans, the phone shows nothing, and it eventually times out with "QR refs attempts
  // ended". fetchLatestWaWebVersion() reads the real current version from web.whatsapp.com
  // directly. See https://github.com/WhiskeySockets/Baileys/issues/2679.
  let version;
  try {
    ({ version } = await fetchLatestWaWebVersion({}));
  } catch (err) {
    logger.warn({ err }, "Could not fetch latest WhatsApp Web version, using bundled default.");
  }

  sock = makeWASocket({ auth: state, logger, ...(version && { version }) });

  sock.ev.process(async (events) => {
    if (events["connection.update"]) {
      const { connection, lastDisconnect, qr } = events["connection.update"];

      if (qr) {
        latestQR = qr;
        connectionState = "qr";
      }
      if (connection === "open") {
        connectionState = "open";
        latestQR = null;
        logger.warn("WhatsApp connection open.");
      }
      if (connection === "close") {
        connectionState = "close";
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        logger.warn(
          { statusCode, message: lastDisconnect?.error?.message },
          "WhatsApp connection closed."
        );
        if (statusCode === DisconnectReason.loggedOut) {
          // The linked session was invalidated (e.g. unlinked from the phone) —
          // resuming with the same creds would just fail the same way forever,
          // leaving the badge stuck on "close" with no way to reconnect short of
          // shelling in to clear the volume. Wipe the stale creds so the retry
          // below goes through a fresh QR pairing instead.
          logger.warn("Logged out — clearing auth state to generate a new pairing QR.");
          await clearAuthDir();
        }
        scheduleReconnect();
      }
    }

    if (events["creds.update"]) {
      await saveCreds();
    }

    if (events["messaging-history.set"]) {
      const { chats: historyChats, contacts } = events["messaging-history.set"];
      upsertChats(historyChats);
      upsertChats((contacts || []).map((c) => ({ id: c.id, name: c.name || c.notify })));
    }

    if (events["chats.upsert"]) upsertChats(events["chats.upsert"]);
    if (events["contacts.upsert"]) {
      upsertChats(events["contacts.upsert"].map((c) => ({ id: c.id, name: c.name || c.notify })));
    }

    if (events["messages.upsert"]) {
      // "notify" = a message that just arrived live; "append" = backlog replayed
      // on reconnect (offline queue, history resync). Only "notify" should ever
      // reach the write-enabled agent — reprocessing old real messages as fresh
      // commands would silently re-register expenses/pay bills from the past.
      const { messages, type } = events["messages.upsert"];
      for (const msg of messages || []) {
        const id = msg.key?.remoteJid;
        if (!id || id === "status@broadcast") continue;
        // pushName is the individual SENDER's display name — for a DM, remoteJid
        // is that same person, so it's a valid name. For a group, remoteJid is the
        // group's JID, and using the sender's pushName here would mislabel the
        // whole group as whichever member happened to message last.
        const name = !id.endsWith("@g.us") ? msg.pushName : null;
        if (name) chats.set(id, name);
        else if (!chats.has(id)) chats.set(id, id);

        if (type !== "notify") continue;
        try {
          await forwardInbound(msg);
        } catch (err) {
          logger.warn({ err }, "Error forwarding inbound message.");
        }
      }
    }
  });
}

// Retries startSock() itself failing (e.g. a transient error thrown before any
// socket exists), not just WhatsApp-side disconnects — otherwise a single glitch
// on boot or reconnect would silently end the loop and leave the badge stuck.
function scheduleReconnect(delay = 3000) {
  setTimeout(() => {
    startSock().catch((err) => {
      logger.error(err, "Failed to restart WhatsApp socket.");
      scheduleReconnect();
    });
  }, delay);
}

startSock().catch((err) => {
  logger.error(err, "Failed to start WhatsApp socket.");
  scheduleReconnect();
});

function toJid(to) {
  if (to.includes("@")) return to;
  const digits = to.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

const app = express();
app.use(express.json());

app.get("/status", (_req, res) => {
  res.json({ state: connectionState, connected: connectionState === "open" });
});

app.get("/qr", async (_req, res) => {
  if (connectionState !== "qr" || !latestQR) {
    return res.status(404).json({ error: "No QR pending." });
  }
  const png = await QRCode.toBuffer(latestQR, { width: 320 });
  res.set("Content-Type", "image/png");
  res.send(png);
});

app.get("/chats", (_req, res) => {
  res.json(Array.from(chats.entries()).map(([id, name]) => ({ id, name })));
});

app.post("/send", async (req, res) => {
  const { to, message } = req.body || {};
  if (!to || !message) {
    return res.status(400).json({ error: "Both 'to' and 'message' are required." });
  }
  if (connectionState !== "open" || !sock) {
    return res.status(503).json({ error: "Not connected to WhatsApp." });
  }
  try {
    const sent = await sock.sendMessage(toJid(to), { text: message });
    if (sent?.key?.id) {
      if (recentlySentIds.size > 200) recentlySentIds.clear();
      recentlySentIds.add(sent.key.id);
    }
    res.json({ sent: true });
  } catch (err) {
    logger.error(err, "Failed to send message");
    res.status(500).json({ error: "Send failed." });
  }
});

app.listen(PORT, () => {
  logger.info(`WhatsApp gateway listening on :${PORT}`);
});

// SPDX-License-Identifier: MIT
// The page side of the Redline bridge.
//
// The page never holds the instance secret. It talks to the host through this
// relay, which offers a fixed set of messages and nothing else:
//
//   annotations.submit  -> the pins the user marked on the page
//   drawings.save       -> the free-form strokes
//   state.get           -> the narrow state the overlay draws (language,
//                          delivery, pending ids, settings)
//   diag                -> a diagnostic line for the host log
//
// Two transports, one API:
//
//   direct  the page was served by the host, so it is same-origin and the
//           browser proves it with the Origin header. The request carries no
//           credential at all.
//   client  the page is an arbitrary guest of the harness browser. The host
//           plugin drains the queue with executeJavaScript and answers with
//           executeJavaScript, so the privileged call happens in the host
//           context, where the instance secret lives.
(() => {
  "use strict";
  if (window.__LR_BRIDGE__) return;

  const MODE = window.__LR_BRIDGE_MODE__ === "client" ? "client" : "direct";
  const ORIGIN = (() => {
    try {
      const base = window.__LR__ && typeof window.__LR__.apiBase === "string" ? window.__LR__.apiBase : "";
      return base.replace(/\/+$/, "");
    } catch {
      return "";
    }
  })();
  const ANSWER_TIMEOUT_MS = 20000;
  const QUEUE_LIMIT = 64;
  const MESSAGES = new Set(["annotations.submit", "drawings.save", "state.get", "diag"]);

  let sequence = 0;
  const waiting = new Map();
  const queue = [];

  function settle(id, ok, data, error) {
    const entry = waiting.get(id);
    if (entry === undefined) return;
    waiting.delete(id);
    clearTimeout(entry.timer);
    if (ok) entry.resolve(data);
    else entry.reject(new Error(typeof error === "string" && error !== "" ? error : "the bridge call failed"));
  }

  function forget(id) {
    const at = queue.findIndex((message) => message.id === id);
    if (at !== -1) queue.splice(at, 1);
  }

  async function sendDirect(type, payload) {
    const target = ORIGIN === "" ? "/.lr/bridge" : `${ORIGIN}/.lr/bridge`;
    const response = await fetch(target, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, payload })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) throw new Error(data.error ?? `HTTP ${response.status}`);
    return data;
  }

  function sendClient(type, payload) {
    return new Promise((resolve, reject) => {
      sequence += 1;
      const id = `lr-${Date.now()}-${sequence}`;
      const timer = setTimeout(() => {
        // The message is dropped with the promise: a page that gave up must
        // not have the host run it later.
        forget(id);
        settle(id, false, null, "the host did not answer the bridge call");
      }, ANSWER_TIMEOUT_MS);
      waiting.set(id, { resolve, reject, timer });
      if (queue.length >= QUEUE_LIMIT) queue.shift();
      queue.push({ id, type, payload });
    });
  }

  window.__LR_BRIDGE__ = {
    mode: MODE,
    send(type, payload) {
      const name = typeof type === "string" ? type : "";
      if (name === "") return Promise.reject(new Error("bridge message without a type"));
      if (!MESSAGES.has(name)) return Promise.reject(new Error(`the bridge does not carry "${name}"`));
      const body = payload !== null && typeof payload === "object" ? payload : {};
      return MODE === "client" ? sendClient(name, body) : sendDirect(name, body);
    }
  };

  if (MODE === "client") {
    window.__LR_BRIDGE_DRAIN__ = (limit) => JSON.stringify(queue.splice(0, typeof limit === "number" ? Math.max(0, Math.min(Math.trunc(limit), queue.length)) : queue.length));
    window.__LR_BRIDGE_DELIVER__ = (raw) => {
      let parsed;
      try {
        parsed = JSON.parse(typeof raw === "string" ? raw : "[]");
      } catch {
        return;
      }
      if (!Array.isArray(parsed)) parsed = [parsed];
      for (const answer of parsed) {
        if (answer === null || typeof answer !== "object") continue;
        settle(answer.id, answer.ok === true, answer.data ?? null, answer.error ?? "");
      }
    };
  }
})();

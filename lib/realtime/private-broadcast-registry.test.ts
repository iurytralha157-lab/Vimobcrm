import assert from "node:assert/strict";
import test from "node:test";

import {
  PrivateBroadcastRegistry,
  type PrivateBroadcastStatus,
  type PrivateBroadcastTransport,
} from "./private-broadcast-registry";

type OpenedChannel = {
  topic: string;
  event: string;
  closeCalls: number;
  onPayload: (payload: unknown) => void;
  onStatus: (status: PrivateBroadcastStatus, error?: Error) => void;
  close: () => Promise<void>;
};

class FakeTransport implements PrivateBroadcastTransport {
  authCalls = 0;
  channels: OpenedChannel[] = [];
  nextClose: (() => Promise<void>) | null = null;
  authError: Error | null = null;

  async setAuth() {
    this.authCalls += 1;
    if (this.authError) throw this.authError;
  }

  open(input: Parameters<PrivateBroadcastTransport["open"]>[0]) {
    const channel: OpenedChannel = {
      topic: input.topic,
      event: input.event,
      closeCalls: 0,
      onPayload: input.onPayload,
      onStatus: input.onStatus,
      close: async () => {
        channel.closeCalls += 1;
        if (this.nextClose) await this.nextClose();
      },
    };
    this.channels.push(channel);
    return channel;
  }
}

const wait = (milliseconds = 0) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

test("fans out one physical topic and only closes after the final lease", async () => {
  const transport = new FakeTransport();
  const registry = new PrivateBroadcastRegistry(transport, { closeGraceMs: 5 });
  const received: string[] = [];
  const first = registry.acquire({
    topic: "whatsapp:org:inbox",
    event: "whatsapp.inbox.changed",
    onPayload: () => received.push("first"),
  });
  const second = registry.acquire({
    topic: "whatsapp:org:inbox",
    event: "whatsapp.inbox.changed",
    onPayload: () => received.push("second"),
  });

  await wait();
  assert.equal(transport.authCalls, 1);
  assert.equal(transport.channels.length, 1);
  transport.channels[0].onPayload({ scope: "conversations" });
  assert.deepEqual(received, ["first", "second"]);

  first.release();
  await wait(10);
  assert.equal(transport.channels[0].closeCalls, 0);

  second.release();
  await wait(10);
  assert.equal(transport.channels[0].closeCalls, 1);
});

test("reacquiring during the close grace period reuses the live channel", async () => {
  const transport = new FakeTransport();
  const registry = new PrivateBroadcastRegistry(transport, { closeGraceMs: 20 });
  const first = registry.acquire({
    topic: "whatsapp:org:lead:a",
    event: "whatsapp.message.changed",
    onPayload: () => undefined,
  });

  await wait();
  first.release();
  await wait(5);
  const replacement = registry.acquire({
    topic: "whatsapp:org:lead:a",
    event: "whatsapp.message.changed",
    onPayload: () => undefined,
  });
  await wait(25);

  assert.equal(transport.channels.length, 1);
  assert.equal(transport.channels[0].closeCalls, 0);

  replacement.release();
  await wait(25);
});

test("waits for an in-flight close before opening the same topic again", async () => {
  const transport = new FakeTransport();
  let finishClose: (() => void) | undefined;
  transport.nextClose = () => new Promise<void>((resolve) => {
    finishClose = resolve;
  });
  const registry = new PrivateBroadcastRegistry(transport, { closeGraceMs: 0 });
  const first = registry.acquire({
    topic: "whatsapp:org:lead:a",
    event: "whatsapp.message.changed",
    onPayload: () => undefined,
  });

  await wait();
  first.release();
  await wait(5);
  assert.equal(transport.channels[0].closeCalls, 1);

  const replacement = registry.acquire({
    topic: "whatsapp:org:lead:a",
    event: "whatsapp.message.changed",
    onPayload: () => undefined,
  });
  await wait();
  assert.equal(transport.channels.length, 1);

  finishClose?.();
  await wait();
  assert.equal(transport.channels.length, 2);
  assert.equal(transport.authCalls, 1);

  transport.nextClose = null;
  replacement.release();
  await wait(5);
});

test("changing lead topics never tears down the independent inbox topic", async () => {
  const transport = new FakeTransport();
  const registry = new PrivateBroadcastRegistry(transport, { closeGraceMs: 5 });
  const inbox = registry.acquire({
    topic: "whatsapp:org:inbox",
    event: "whatsapp.inbox.changed",
    onPayload: () => undefined,
  });
  const leadA = registry.acquire({
    topic: "whatsapp:org:lead:a",
    event: "whatsapp.message.changed",
    onPayload: () => undefined,
  });
  await wait();

  leadA.release();
  const leadB = registry.acquire({
    topic: "whatsapp:org:lead:b",
    event: "whatsapp.message.changed",
    onPayload: () => undefined,
  });
  await wait(10);

  const inboxChannels = transport.channels.filter((channel) => channel.topic.endsWith(":inbox"));
  const leadAChannels = transport.channels.filter((channel) => channel.topic.endsWith(":lead:a"));
  const leadBChannels = transport.channels.filter((channel) => channel.topic.endsWith(":lead:b"));
  assert.equal(inboxChannels.length, 1);
  assert.equal(inboxChannels[0].closeCalls, 0);
  assert.equal(leadAChannels[0].closeCalls, 1);
  assert.equal(leadBChannels.length, 1);

  inbox.release();
  leadB.release();
  await wait(10);
});

test("an organization switch closes the old topic and opens an isolated topic", async () => {
  const transport = new FakeTransport();
  const registry = new PrivateBroadcastRegistry(transport, { closeGraceMs: 5 });
  const orgA = registry.acquire({
    topic: "whatsapp:org-a:inbox",
    event: "whatsapp.inbox.changed",
    onPayload: () => undefined,
  });
  await wait();

  orgA.release();
  const orgB = registry.acquire({
    topic: "whatsapp:org-b:inbox",
    event: "whatsapp.inbox.changed",
    onPayload: () => undefined,
  });
  await wait(10);

  assert.equal(transport.channels.filter((channel) => channel.topic.includes("org-a")).length, 1);
  assert.equal(transport.channels.find((channel) => channel.topic.includes("org-a"))?.closeCalls, 1);
  assert.equal(transport.channels.filter((channel) => channel.topic.includes("org-b")).length, 1);

  orgB.release();
  await wait(10);
});

test("reports an auth failure and retries without opening an unauthenticated channel", async () => {
  const transport = new FakeTransport();
  transport.authError = new Error("token unavailable");
  const diagnostics: string[] = [];
  const registry = new PrivateBroadcastRegistry(transport, {
    closeGraceMs: 5,
    retryDelayMs: 10,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.kind),
  });
  const lease = registry.acquire({
    topic: "whatsapp:org:inbox",
    event: "whatsapp.inbox.changed",
    onPayload: () => undefined,
  });

  await wait(5);
  assert.equal(transport.channels.length, 0);
  assert.ok(diagnostics.includes("auth_error"));

  transport.authError = null;
  await wait(15);
  assert.equal(transport.authCalls, 2);
  assert.equal(transport.channels.length, 1);

  lease.release();
  await wait(10);
});

test("isolates listener failures and reports reconnecting channel states", async () => {
  const transport = new FakeTransport();
  const diagnostics: string[] = [];
  const statuses: PrivateBroadcastStatus[] = [];
  let healthyPayloads = 0;
  const registry = new PrivateBroadcastRegistry(transport, {
    closeGraceMs: 5,
    retryDelayMs: 5,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.kind),
  });
  const broken = registry.acquire({
    topic: "whatsapp:org:inbox",
    event: "whatsapp.inbox.changed",
    onPayload: () => {
      throw new Error("broken logical listener");
    },
  });
  const healthy = registry.acquire({
    topic: "whatsapp:org:inbox",
    event: "whatsapp.inbox.changed",
    onPayload: () => {
      healthyPayloads += 1;
    },
    onStatus: (status) => statuses.push(status),
  });

  await wait();
  transport.channels[0].onPayload({});
  transport.channels[0].onStatus("CHANNEL_ERROR", new Error("socket"));
  transport.channels[0].onStatus("TIMED_OUT");
  transport.channels[0].onStatus("SUBSCRIBED");

  assert.equal(healthyPayloads, 1);
  assert.deepEqual(statuses, ["CHANNEL_ERROR", "TIMED_OUT", "SUBSCRIBED"]);
  assert.ok(diagnostics.includes("listener_error"));
  assert.ok(diagnostics.includes("channel_error"));
  assert.ok(diagnostics.includes("timed_out"));
  assert.equal(transport.channels.length, 1, "realtime-js owns transient rejoin");
  assert.equal(transport.channels[0].closeCalls, 0);

  broken.release();
  healthy.release();
  await wait(10);
});

test("opens a fresh physical channel after an unexpected terminal close", async () => {
  const transport = new FakeTransport();
  const diagnostics: string[] = [];
  const registry = new PrivateBroadcastRegistry(transport, {
    closeGraceMs: 5,
    retryDelayMs: 5,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.kind),
  });
  const lease = registry.acquire({
    topic: "whatsapp:org:lead:a",
    event: "whatsapp.message.changed",
    onPayload: () => undefined,
  });

  await wait();
  transport.channels[0].onStatus("CLOSED");
  await wait(10);

  assert.ok(diagnostics.includes("unexpected_closed"));
  assert.equal(transport.channels.length, 2);

  lease.release();
  await wait(10);
});

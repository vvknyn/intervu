import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTransport, type Transporter } from "nodemailer";

import { usernameEmail } from "@/lib/auth/minted-email";
import { SmtpMarketingTransport, smtpConfigFromEnv, smtpTransportOptions, type SmtpConfig } from "@/lib/marketing/transport";

const CONFIG: SmtpConfig = {
  host: "127.0.0.1",
  port: 1025,
  secure: false,
  user: "vivek@example.com",
  pass: "bridge-password",
  from: "Vivek from Velai <vivek@example.com>",
};

const MESSAGE = {
  to: "Reader@Example.com",
  subject: "Velai now tells you why a job fits",
  html: "<p>Hi</p>",
  text: "Hi",
  unsubscribeUrl: "https://velai.app/unsubscribe?token=abc",
};

type SentOptions = Record<string, unknown> & { to: string; headers: Record<string, string> };

/** A transporter that renders the real MIME message with nodemailer's stream
 *  transport and reports the recipient as accepted, the way an SMTP server does. */
function recordingTransporter(acceptedOverride?: string[]) {
  const stream = createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const sent: { options: SentOptions; raw: string }[] = [];
  const transporter = {
    verify: async () => true,
    sendMail: async (options: SentOptions) => {
      const info = await stream.sendMail(options);
      sent.push({ options, raw: (info.message as Buffer).toString("utf8") });
      return { ...info, accepted: acceptedOverride ?? [options.to], response: "250 OK" };
    },
  } as unknown as Transporter;
  return { transporter, sent };
}

describe("smtpConfigFromEnv", () => {
  it("defaults to Proton Mail Bridge on this machine, over STARTTLS", () => {
    const config = smtpConfigFromEnv({ SMTP_USER: "vivek@example.com", SMTP_PASS: "pw", MARKETING_FROM: CONFIG.from });
    assert.deepEqual(config, { ...CONFIG, pass: "pw" });
  });

  it("uses TLS from the start on port 465", () => {
    const config = smtpConfigFromEnv({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "465", SMTP_USER: "a@example.com", SMTP_PASS: "pw", MARKETING_FROM: "a@example.com" });
    assert.equal(config.secure, true);
  });

  it("names every missing setting at once", () => {
    assert.throws(() => smtpConfigFromEnv({}), /needs SMTP_USER, SMTP_PASS, MARKETING_FROM/);
  });

  it("refuses a port that isn't a number", () => {
    assert.throws(() => smtpConfigFromEnv({ SMTP_PORT: "bridge", SMTP_USER: "a", SMTP_PASS: "b", MARKETING_FROM: "c" }), /SMTP_PORT/);
  });
});

describe("smtpTransportOptions", () => {
  it("accepts Bridge's own certificate only when the server is on this machine", () => {
    assert.deepEqual(smtpTransportOptions(CONFIG).tls, { rejectUnauthorized: false });
    assert.equal(smtpTransportOptions({ ...CONFIG, host: "smtp.protonmail.ch", port: 587 }).tls, undefined);
  });

  it("never sends the password before TLS", () => {
    assert.equal(smtpTransportOptions(CONFIG).requireTLS, true);
    assert.equal(smtpTransportOptions({ ...CONFIG, port: 465, secure: true }).secure, true);
  });
});

describe("SmtpMarketingTransport.send", () => {
  it("sends from the configured address with the unsubscribe headers every marketing email carries", async () => {
    const { transporter, sent } = recordingTransporter();
    const transport = new SmtpMarketingTransport(CONFIG, transporter, async () => false);
    const { id } = await transport.send(MESSAGE);

    assert.ok(id.length > 0);
    assert.equal(sent.length, 1);
    const { options, raw } = sent[0];
    assert.equal(options.to, "reader@example.com");
    assert.equal(options.replyTo, undefined);
    assert.match(raw, /^From: Vivek from Velai <vivek@example\.com>$/m);
    assert.match(raw, /^To: reader@example\.com$/m);
    assert.match(raw, /^Subject: Velai now tells you why a job fits$/m);
    assert.match(raw, /^List-Unsubscribe: <https:\/\/velai\.app\/unsubscribe\?token=abc>$/m);
    assert.match(raw, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
    assert.match(raw, /multipart\/alternative/);
  });

  it("passes a Reply-To through when one is set", async () => {
    const { transporter, sent } = recordingTransporter();
    await new SmtpMarketingTransport(CONFIG, transporter, async () => false).send({ ...MESSAGE, replyTo: "inbox@example.com" });
    assert.match(sent[0].raw, /^Reply-To: inbox@example\.com$/m);
  });

  it("does not send to someone who unsubscribed after the list was read", async () => {
    const { transporter, sent } = recordingTransporter();
    const transport = new SmtpMarketingTransport(CONFIG, transporter, async () => true);
    await assert.rejects(transport.send(MESSAGE), /suppressed/);
    assert.equal(sent.length, 0);
  });

  it("does not send to a username login address, which has no mailbox", async () => {
    const { transporter, sent } = recordingTransporter();
    const transport = new SmtpMarketingTransport(CONFIG, transporter, async () => false);
    await assert.rejects(transport.send({ ...MESSAGE, to: usernameEmail("someone") }), /no-mailbox/);
    assert.equal(sent.length, 0);
  });

  it("fails loudly when the server does not accept the recipient", async () => {
    const { transporter } = recordingTransporter([]);
    const transport = new SmtpMarketingTransport(CONFIG, transporter, async () => false);
    await assert.rejects(transport.send(MESSAGE), /not accepted/);
  });
});

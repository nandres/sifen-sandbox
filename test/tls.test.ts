import { request } from "node:https";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSandbox } from "../src/server.js";
import { NOW_ISO, PATHS, XSD_DIR, buildDocument, createIdentity, field, recibeRequest, type Identity } from "./helpers.js";

let server: Server;
let port: number;
let client: Identity;
let serverIdentity: Identity;
let peerCertificatePresented: boolean | undefined;

function post(path: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        key: client.keyPem,
        cert: client.certPem,
        rejectUnauthorized: false,
        minVersion: "TLSv1.2",
        headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

beforeAll(async () => {
  client = createIdentity("CLIENTE");
  serverIdentity = createIdentity("localhost");
  const sandbox = createSandbox({ xsdDirectory: XSD_DIR, lotDelayMs: 0 });
  sandbox.store.setClock(NOW_ISO);
  server = createServer(
    { key: serverIdentity.keyPem, cert: serverIdentity.certPem, requestCert: true, rejectUnauthorized: false, minVersion: "TLSv1.2" },
    (req, res) => {
      peerCertificatePresented = Boolean((req.socket as import("node:tls").TLSSocket).getPeerCertificate().subject);
      sandbox.listener(req, res);
    },
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

describe("HTTPS con certificado de cliente", () => {
  it("atiende el servicio y recibe el certificado, como SIFEN", async () => {
    const { xml } = buildDocument(client);
    const response = await post(PATHS.recibe, recibeRequest(xml));
    expect(response.status).toBe(200);
    expect(field(response.body, "dCodRes")).toBe("0260");
    expect(peerCertificatePresented).toBe(true);
  });
});

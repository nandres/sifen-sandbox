#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { resolve } from "node:path";

import { createSandbox } from "./server.js";

const env = process.env;

function parseCscs(value: string | undefined): Record<string, string> | undefined {
  // "0001:ABCD...,0002:EFGH..."
  if (!value) return undefined;
  return Object.fromEntries(value.split(",").map((pair) => pair.split(":", 2) as [string, string]));
}

const cscs = parseCscs(env["SANDBOX_CSCS"]);
const sandbox = createSandbox({
  xsdDirectory: resolve(env["SANDBOX_XSD_DIR"] ?? "xsd"),
  lotDelayMs: Number(env["SANDBOX_LOT_DELAY_MS"] ?? 2000),
  checkCertificateRuc: env["SANDBOX_CHECK_CERT_RUC"] === "true",
  ...(cscs ? { cscs } : {}),
});

const host = env["SANDBOX_HOST"] ?? "127.0.0.1";
const port = Number(env["SANDBOX_PORT"] ?? 3900);
const certificate = env["SANDBOX_TLS_CERT"];
const key = env["SANDBOX_TLS_KEY"];

const server =
  certificate && key
    ? createHttpsServer(
        {
          cert: readFileSync(certificate),
          key: readFileSync(key),
          minVersion: "TLSv1.2",
          // Pide certificado de cliente, como SIFEN, pero acepta cualquiera: es un simulador.
          requestCert: env["SANDBOX_TLS_CLIENT_CERT"] === "request",
          rejectUnauthorized: false,
        },
        sandbox.listener,
      )
    : createHttpServer(sandbox.listener);

server.listen(port, host, () => {
  const scheme = certificate && key ? "https" : "http";
  console.log(`sifen-sandbox escuchando en ${scheme}://${host}:${port}`);
  console.log(`Estado: ${scheme}://${host}:${port}/__sandbox/health`);
  console.log("Es un simulador: lo que aprueba no tiene ningún valor fiscal.");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";

import { RULES, hit } from "./rules.js";
import { SAMPLE_NOTICE, SCENARIOS, SampleGenerator } from "./sample.js";
import {
  SERVICES,
  UnsupportedEventError,
  rejectionBody,
  runService,
  type SandboxContext,
  type ServiceDefinition,
} from "./services.js";
import { SOAP12, contentTypeFor, parseEnvelope, soapFault, soapResponse } from "./soap.js";
import { Store, type Fault, type FaultKind, type RucState } from "./store.js";
import { MalformedXmlError } from "./xml.js";
import { SchemaSet } from "./xsd.js";

export interface SandboxOptions {
  xsdDirectory: string;
  /** IdCSC → CSC. Los predeterminados son los genéricos de la Guía de Pruebas de la DNIT. */
  cscs?: Record<string, string>;
  lotDelayMs?: number;
  checkCertificateRuc?: boolean;
}

export interface Sandbox {
  store: Store;
  listener: RequestListener;
}

const MAX_BODY = 12 * 1000 * 1000;
const CONTROL = "/__sandbox";
const FAULT_KINDS: readonly FaultKind[] = ["http", "delay", "drop", "soapFault", "code"];

class BodyTooLarge extends Error {}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function send(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "X-Sifen-Sandbox": "simulated",
  });
  response.end(body);
}

const sendJson = (response: ServerResponse, status: number, data: unknown): void =>
  send(response, status, "application/json; charset=utf-8", `${JSON.stringify(data, null, 2)}\n`);

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createSandbox(options: SandboxOptions): Sandbox {
  const store = new Store();
  const ctx: SandboxContext = {
    store,
    schemas: new SchemaSet(options.xsdDirectory),
    // Los CSC genéricos de la Guía de Pruebas de la DNIT (§2).
    cscs: new Map(Object.entries(options.cscs ?? { "0001": "ABCD0000000000000000000000000000", "0002": "EFGH0000000000000000000000000000" })),
    checkCertificateRuc: options.checkCertificateRuc ?? false,
    lotDelayMs: options.lotDelayMs ?? 2000,
  };

  const samples = new SampleGenerator();

  async function handleService(definition: ServiceDefinition, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const service = definition.name;
    const raw = await readBody(request);

    const answer = (soapNamespace: string, body: string, status = 200): void =>
      send(response, status, contentTypeFor(soapNamespace), soapResponse(soapNamespace, body));
    const refuse = (code: string, detail?: string): void => {
      const rejection = hit(code, detail);
      store.record({ at: new Date(store.now()).toISOString(), service, status: "Rechazado", results: [rejection] });
      answer(SOAP12, rejectionBody(service, rejection, store.now()));
    };

    let fault: Fault | undefined = store.takeFault(service);
    if (fault?.kind === "delay") {
      await wait(fault.ms ?? 1000);
      fault = undefined;
    }
    if (fault) {
      store.record({ at: new Date(store.now()).toISOString(), service, results: [], fault: fault.kind });
      if (fault.kind === "drop") {
        request.socket.destroy();
        return;
      }
      if (fault.kind === "http") {
        send(response, fault.status ?? 503, "text/plain; charset=utf-8", "Falla simulada por sifen-sandbox\n");
        return;
      }
      if (fault.kind === "soapFault") {
        send(response, 500, contentTypeFor(SOAP12), soapFault(SOAP12, "Falla simulada por sifen-sandbox"));
        return;
      }
      answer(SOAP12, rejectionBody(service, hit(fault.code ?? "0161"), store.now()));
      return;
    }

    if (raw.length > definition.maxBytes) {
      refuse(definition.oversizeCode);
      return;
    }
    const xml = raw.toString("utf8");
    const declared = /^\s*<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(xml)?.[1];
    if (declared && declared.toLowerCase() !== "utf-8") {
      refuse("0107", `Se declaró ${declared}`);
      return;
    }

    let envelope;
    try {
      envelope = parseEnvelope(xml);
    } catch (error) {
      if (!(error instanceof MalformedXmlError)) throw error;
      refuse("0160", error.message.slice(0, 200));
      return;
    }
    if (!envelope || envelope.payload.localName !== definition.root) {
      refuse("0101", `Se esperaba ${definition.root} dentro del Body del sobre SOAP`);
      return;
    }

    try {
      const result = await runService(definition, xml, envelope.payload, ctx);
      store.record({ at: new Date(store.now()).toISOString(), service, ...result.log });
      answer(envelope.soapNamespace, result.body);
    } catch (error) {
      if (!(error instanceof UnsupportedEventError)) throw error;
      send(response, 501, contentTypeFor(envelope.soapNamespace), soapFault(envelope.soapNamespace, error.message));
    }
  }

  async function handleControl(path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const route = `${request.method} ${path}`;
    const parse = async (): Promise<Record<string, unknown>> => {
      const raw = (await readBody(request)).toString("utf8");
      return raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
    };

    switch (route) {
      case "GET /health":
        sendJson(response, 200, {
          status: "ok",
          simulated: true,
          now: new Date(store.now()).toISOString(),
          clockFixed: store.isClockFixed(),
        });
        return;
      case "GET /rules":
        sendJson(response, 200, Object.values(RULES));
        return;
      case "GET /requests":
        sendJson(response, 200, store.log);
        return;
      case "GET /documents":
        sendJson(
          response,
          200,
          [...store.documents.values()].map(({ xml: _xml, ...document }) => document),
        );
        return;
      case "GET /blocks":
        sendJson(response, 200, [...store.blocks.values()].filter((block) => block.until > store.now()));
        return;
      case "GET /samples":
        sendJson(response, 200, SCENARIOS.map((scenario) => samples.describe(scenario)));
        return;
      case "GET /faults":
        sendJson(response, 200, store.faults);
        return;
      case "POST /reset":
        store.reset();
        sendJson(response, 200, { status: "ok" });
        return;
      case "POST /clock": {
        const { now } = await parse();
        if (now !== null && typeof now !== "string") throw new RangeError('Mandá {"now": "2026-11-05T10:00:00-03:00"} o {"now": null}');
        store.setClock(now);
        sendJson(response, 200, { now: new Date(store.now()).toISOString(), clockFixed: store.isClockFixed() });
        return;
      }
      case "POST /faults": {
        const data = await parse();
        const kind = data["kind"] as FaultKind;
        if (!FAULT_KINDS.includes(kind)) throw new RangeError(`kind debe ser uno de: ${FAULT_KINDS.join(", ")}`);
        const service = String(data["service"] ?? "*");
        const known = Object.values(SERVICES).map((s) => s.name as string);
        if (service !== "*" && !known.includes(service)) throw new RangeError(`service debe ser "*" o uno de: ${known.join(", ")}`);
        const code = data["code"] === undefined ? undefined : String(data["code"]);
        if (code !== undefined && !RULES[code]) throw new RangeError(`Código desconocido: ${code}`);
        const fault = store.addFault({
          service,
          kind,
          times: Number(data["times"] ?? 1),
          ...(data["status"] !== undefined ? { status: Number(data["status"]) } : {}),
          ...(data["ms"] !== undefined ? { ms: Number(data["ms"]) } : {}),
          ...(code !== undefined ? { code } : {}),
        });
        sendJson(response, 201, fault);
        return;
      }
      case "POST /ruc": {
        const data = await parse();
        const ruc = String(data["ruc"] ?? "");
        if (!/^\d{1,8}$/.test(ruc)) throw new RangeError("ruc debe ser el número sin dígito verificador");
        store.rucs.set(ruc, { ...store.ruc(ruc), ...data, ruc } as ReturnType<Store["ruc"]> & { estado: RucState });
        sendJson(response, 201, store.ruc(ruc));
        return;
      }
      case "POST /timbrado": {
        const data = await parse();
        const entry = { ruc: String(data["ruc"] ?? ""), numero: String(data["numero"] ?? ""), activo: data["activo"] !== false };
        if (!entry.ruc || !entry.numero) throw new RangeError("Faltan ruc y numero");
        store.timbrados.set(`${entry.ruc}:${entry.numero}`, entry);
        sendJson(response, 201, entry);
        return;
      }
    }

    const sample = /^GET \/samples\/([\w-]+)$/.exec(route);
    if (sample) {
      const scenario = SCENARIOS.find((candidate) => candidate.name === sample[1]);
      if (!scenario) {
        sendJson(response, 404, { error: "Ejemplo desconocido", samples: SCENARIOS.map((candidate) => candidate.name) });
        return;
      }
      response.setHeader("X-Sifen-Sandbox-Notice", SAMPLE_NOTICE);
      send(response, 200, "application/soap+xml; charset=utf-8", samples.request(scenario, store.now()));
      return;
    }

    const finish = /^POST \/lots\/([^/]+)\/finish$/.exec(route);
    if (finish) {
      const lot = store.lots.get(finish[1] ?? "");
      if (!lot) {
        sendJson(response, 404, { error: "Lote inexistente" });
        return;
      }
      lot.readyAt = 0;
      sendJson(response, 200, { id: lot.id, ready: true });
      return;
    }
    sendJson(response, 404, { error: `No existe ${route} en la API de control` });
  }

  const listener: RequestListener = (request, response) => {
    const path = new URL(request.url ?? "/", "http://sandbox").pathname.replace(/\.wsd$/, ".wsdl");

    const work = async (): Promise<void> => {
      if (path === CONTROL || path.startsWith(`${CONTROL}/`)) {
        await handleControl(path.slice(CONTROL.length) || "/health", request, response);
        return;
      }
      const definition = SERVICES[path];
      if (!definition) {
        sendJson(response, 404, {
          error: "Ruta desconocida",
          services: Object.keys(SERVICES),
          control: `${CONTROL}/health`,
        });
        return;
      }
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Este simulador recibe sobres SOAP por POST y todavía no publica el WSDL" });
        return;
      }
      await handleService(definition, request, response);
    };

    work().catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof BodyTooLarge) {
        sendJson(response, 413, { error: "El mensaje supera los 12 MB" });
      } else if (error instanceof RangeError || error instanceof SyntaxError) {
        sendJson(response, 400, { error: error.message });
      } else {
        console.error(error);
        sendJson(response, 500, { error: "Error interno de sifen-sandbox" });
      }
    });
  };

  return { store, listener };
}

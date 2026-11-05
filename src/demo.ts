#!/usr/bin/env node
// Prueba de punta a punta contra un simulador que ya está corriendo: pide cada ejemplo,
// lo envía a su servicio y compara el código recibido con el esperado.
//
//   npm run demo
//   npm run demo -- http://127.0.0.1:3900

const base = (process.argv[2] ?? process.env["SANDBOX_URL"] ?? "http://127.0.0.1:3900").replace(/\/$/, "");

interface Sample {
  name: string;
  description: string;
  path: string;
  expected: string;
}

async function main(): Promise<number> {
  let samples: Sample[];
  try {
    samples = (await (await fetch(`${base}/__sandbox/samples`)).json()) as Sample[];
  } catch {
    console.error(`No se pudo conectar con ${base}. ¿Está corriendo el simulador? Probá: npm start`);
    return 2;
  }

  let failures = 0;
  for (const sample of samples) {
    const request = await (await fetch(`${base}/__sandbox/samples/${sample.name}`)).text();
    const response = await fetch(base + sample.path, {
      method: "POST",
      headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
      body: request,
    });
    const body = await response.text();
    const code = /<(?:ns2:)?dCodRes>(\d+)</.exec(body)?.[1] ?? `HTTP ${response.status}`;
    const passed = code === sample.expected;
    if (!passed) failures += 1;
    console.log(`${passed ? "ok   " : "FALLA"} ${code.padEnd(5)} ${sample.description}`);
  }
  console.log(failures === 0 ? `\nLos ${samples.length} ejemplos dieron el código esperado.` : `\n${failures} de ${samples.length} no dieron el código esperado.`);
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main();

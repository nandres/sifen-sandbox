// Cálculos de ítems, IVA y totales: MT §12.4 (E8, E8.1, E8.1.1, E8.2 y F), con las fórmulas que
// cambiaron la NT 1 (F011, F014) y la NT 13 (E735, E737, F002, F004, F005).
// Se usa punto fijo con BigInt: con coma flotante, 0,1 + 0,2 ya no da 0,3.

import type { Element } from "@xmldom/xmldom";

import { hit, type RuleHit } from "./rules.js";
import { descendant, descendants, text } from "./xml.js";

const SCALE = 100_000_000n;
const ZERO = 0n;
/** MT §F: «las reglas de validación aceptarán redondeos de 50 céntimos, por encima o por debajo». */
const TOLERANCE = SCALE / 2n;
/** MT §12.4 EA003a y EA004: «puede haber una variación de 0.8». */
const PERCENT_TOLERANCE = (SCALE * 8n) / 10n;

function fixed(value: string | undefined): bigint {
  if (!value) return ZERO;
  const match = /^(-?)(\d+)(?:\.(\d{1,8}))?$/.exec(value.trim());
  if (!match) return ZERO;
  const units = BigInt(match[2] ?? "0") * SCALE + BigInt((match[3] ?? "").padEnd(8, "0"));
  return match[1] ? -units : units;
}

const whole = (value: number): bigint => BigInt(value) * SCALE;
const multiply = (a: bigint, b: bigint): bigint => (a * b + SCALE / 2n) / SCALE;
const divide = (a: bigint, b: bigint): bigint => (b === ZERO ? ZERO : (a * SCALE) / b);
const abs = (value: bigint): bigint => (value < ZERO ? -value : value);
const within = (a: bigint, b: bigint, tolerance = TOLERANCE): boolean => abs(a - b) <= tolerance;

function show(value: bigint): string {
  const sign = value < ZERO ? "-" : "";
  const units = abs(value);
  const decimals = String(units % SCALE).padStart(8, "0").replace(/0+$/, "");
  return `${sign}${units / SCALE}${decimals ? `.${decimals}` : ""}`;
}

const mismatch = (code: string, field: string, received: bigint, expected: bigint): RuleHit =>
  hit(code, `${field} es ${show(received)}; el cálculo da ${show(expected)}`);

// Valores del XSD (tdDesAfecIVA).
const AFFECTATION: Readonly<Record<string, string>> = {
  "1": "Gravado IVA",
  "2": "Exonerado (Art. 100 - Ley 6380/2019)",
  "3": "Exento",
  // Con ese espacio: es como figura en el XSD oficial, aunque el manual lo escribe sin él.
  "4": "Gravado parcial (Grav- Exento)",
};

interface ItemValues {
  quantity: bigint;
  total: bigint;
  totalGs?: bigint;
  discount: bigint;
  globalDiscount: bigint;
  advance: bigint;
  globalAdvance: bigint;
  affectation?: string;
  rate: bigint;
  base: bigint;
  vat: bigint;
  exempt: bigint;
  hasVat: boolean;
}

function checkItem(item: Element, tipo: string, tipoImpuesto: string, foreign: boolean, out: ItemValues[]): RuleHit | undefined {
  const quantity = fixed(text(item, "dCantProSer"));
  const group = descendant(item, "gValorItem");
  if (!group) return tipo === "7" ? undefined : hit("1850");
  if (tipo === "7") return hit("1851");

  const price = fixed(text(group, "dPUniProSer"));
  const gross = fixed(text(group, "dTotBruOpeItem"));
  const expectedGross = multiply(price, quantity);
  if (!within(gross, expectedGross)) return mismatch("1859", "dTotBruOpeItem", gross, expectedGross);

  const discount = fixed(text(group, "dDescItem"));
  const percent = text(group, "dPorcDesIt");
  if (discount > ZERO && percent === undefined) return hit("1852");
  if (discount > ZERO && price > ZERO) {
    const expectedPercent = divide(discount * 100n, price);
    if (!within(fixed(percent), expectedPercent, PERCENT_TOLERANCE)) {
      return mismatch("1861", "dPorcDesIt", fixed(percent), expectedPercent);
    }
  }
  const globalDiscount = fixed(text(group, "dDescGloItem"));
  const advance = fixed(text(group, "dAntPreUniIt"));
  const globalAdvance = fixed(text(group, "dAntGloPreUniIt"));
  const total = fixed(text(group, "dTotOpeItem"));

  // La fórmula del valor total para ISC (D013=2) no se simula.
  if (tipoImpuesto !== "2") {
    const net = tipo === "4" ? price : price - discount - globalDiscount - advance - globalAdvance;
    const expectedTotal = multiply(net, quantity);
    if (!within(total, expectedTotal)) return mismatch("1853", "dTotOpeItem", total, expectedTotal);
  }

  const values: ItemValues = {
    quantity,
    total,
    discount,
    globalDiscount,
    advance,
    globalAdvance,
    rate: ZERO,
    base: ZERO,
    vat: ZERO,
    exempt: ZERO,
    hasVat: false,
  };

  const exchange = text(group, "dTiCamIt");
  const totalGsText = text(group, "dTotOpeGs");
  if (foreign && exchange) {
    if (!totalGsText) return hit("1857");
    const expectedGs = multiply(total, fixed(exchange));
    if (!within(fixed(totalGsText), expectedGs)) return mismatch("1858", "dTotOpeGs", fixed(totalGsText), expectedGs);
    values.totalGs = fixed(totalGsText);
  }

  const vatGroup = descendant(item, "gCamIVA");
  const vatRequired = ["1", "3", "4", "5"].includes(tipoImpuesto) && !["3", "4", "7"].includes(tipo);
  if (!vatGroup) {
    out.push(values);
    return vatRequired ? hit("1900") : undefined;
  }
  if (["3", "4", "7"].includes(tipo)) return hit("1901");
  if (tipoImpuesto === "2") return hit("1902");

  const affectation = text(vatGroup, "iAfecIVA") ?? "";
  if (text(vatGroup, "dDesAfecIVA") !== AFFECTATION[affectation]) {
    return hit("1903", `Para ${affectation} es "${AFFECTATION[affectation] ?? ""}"`);
  }
  const proportion = fixed(text(vatGroup, "dPropIVA"));
  const rate = fixed(text(vatGroup, "dTasaIVA"));
  const base = fixed(text(vatGroup, "dBasGravIVA"));
  const vat = fixed(text(vatGroup, "dLiqIVAItem"));
  const exempt = fixed(text(vatGroup, "dBasExe"));
  const taxed = affectation === "1" || affectation === "4";

  if (affectation === "1" && proportion !== whole(100)) return hit("1904", "Gravado IVA exige dPropIVA = 100");
  if ((affectation === "2" || affectation === "3") && proportion !== ZERO) return hit("1905");
  if (affectation === "4" && (proportion <= ZERO || proportion >= whole(100))) return hit("1906");
  if (!taxed && rate !== ZERO) return hit("1907");
  if (taxed && rate !== whole(5) && rate !== whole(10)) return hit("1908");

  if (!taxed) {
    if (base !== ZERO) return hit("1909");
    if (vat !== ZERO) return hit("1912");
  } else {
    // NT 13: [100 * EA008 * E733] / [10000 + (E734 * E733)]
    const denominator = whole(10_000) + multiply(rate, proportion);
    const expectedBase = divide(multiply(whole(100), multiply(total, proportion)), denominator);
    if (!within(base, expectedBase)) return mismatch(rate === whole(5) ? "1910" : "1911", "dBasGravIVA", base, expectedBase);
    const expectedVat = divide(multiply(base, rate), whole(100));
    if (!within(vat, expectedVat)) return mismatch("1913", "dLiqIVAItem", vat, expectedVat);
  }
  if (affectation === "4") {
    // NT 13: [100 * EA008 * (100 – E733)] / [10000 + (E734 * E733)]
    const denominator = whole(10_000) + multiply(rate, proportion);
    const expectedExempt = divide(multiply(whole(100), multiply(total, whole(100) - proportion)), denominator);
    if (!within(exempt, expectedExempt)) return mismatch("1921", "dBasExe", exempt, expectedExempt);
  } else if (text(vatGroup, "dBasExe") !== undefined && exempt !== ZERO) {
    return mismatch("1921", "dBasExe", exempt, ZERO);
  }

  out.push({ ...values, affectation, rate, base, vat, exempt, hasVat: true });
  return undefined;
}

const sum = <T>(list: T[], pick: (value: T) => bigint): bigint => list.reduce((total, value) => total + pick(value), ZERO);

/** Compara un campo opcional: da `missing` si hacía falta y no vino, y `wrong` si no coincide. */
function checkField(totals: Element, field: string, expected: bigint, required: boolean, missing: string, wrong: string): RuleHit | undefined {
  const raw = text(totals, field);
  if (raw === undefined) return required ? hit(missing, `Falta ${field}`) : undefined;
  return within(fixed(raw), expected) ? undefined : mismatch(wrong, field, fixed(raw), expected);
}

export function checkAmounts(de: Element): RuleHit | undefined {
  const tipo = text(de, "iTiDE") ?? "";
  const tipoImpuesto = text(de, "iTImp") ?? "";
  const foreign = (text(de, "cMoneOpe") ?? "PYG") !== "PYG";

  const items: ItemValues[] = [];
  for (const item of descendants(de, "gCamItem")) {
    const problem = checkItem(item, tipo, tipoImpuesto, foreign, items);
    if (problem) return problem;
  }

  const totals = descendant(de, "gTotSub");
  if (tipo === "7") return totals ? hit("2351") : undefined;
  if (!totals) return hit("2350");

  const withAffectation = (...codes: string[]): ItemValues[] => items.filter((item) => item.affectation !== undefined && codes.includes(item.affectation));
  const atRate = (rate: number): ItemValues[] => items.filter((item) => item.hasVat && item.rate === whole(rate));
  const fivePct = atRate(5);
  const tenPct = atRate(10);

  if (tipoImpuesto !== "2") {
    const exentas = withAffectation("3");
    const parciales = withAffectation("4");
    const expectedExempt = sum(exentas, (i) => i.total) + sum(parciales, (i) => i.exempt);
    const subtotal = (rateItems: ItemValues[]): bigint =>
      sum(rateItems.filter((i) => i.affectation === "1"), (i) => i.total) + sum(rateItems.filter((i) => i.affectation === "4"), (i) => i.base + i.vat);

    const problem =
      checkField(totals, "dSubExe", expectedExempt, exentas.length + parciales.length > 0, "2352", "2353") ??
      checkField(totals, "dSubExo", sum(withAffectation("2"), (i) => i.total), withAffectation("2").length > 0, "2354", "2355") ??
      checkField(totals, "dSub5", subtotal(fivePct), fivePct.length > 0, "2356", "2357") ??
      checkField(totals, "dSub10", subtotal(tenPct), tenPct.length > 0, "2358", "2359");
    if (problem) return problem;

    const totalOperation = fixed(text(totals, "dTotOpe"));
    const expectedOperation =
      tipo === "4"
        ? sum(items, (i) => i.total)
        : fixed(text(totals, "dSubExe")) + fixed(text(totals, "dSubExo")) + fixed(text(totals, "dSub5")) + fixed(text(totals, "dSub10"));
    if (!within(totalOperation, expectedOperation)) return mismatch("2362", "dTotOpe", totalOperation, expectedOperation);
  }

  const perUnit = (pick: (i: ItemValues) => bigint): bigint => sum(items, (i) => multiply(pick(i), i.quantity));
  const expectedDiscount = perUnit((i) => i.discount);
  const expectedGlobalDiscount = perUnit((i) => i.globalDiscount);
  const expectedAdvance = perUnit((i) => i.advance);
  const expectedGlobalAdvance = perUnit((i) => i.globalAdvance);

  const figures =
    checkField(totals, "dTotDesc", expectedDiscount, false, "2363", "2363") ??
    checkField(totals, "dTotDescGlotem", expectedGlobalDiscount, false, "2383", "2383") ??
    checkField(totals, "dTotAntItem", expectedAdvance, false, "2384", "2384") ??
    checkField(totals, "dTotAnt", expectedGlobalAdvance, false, "2387", "2387") ??
    checkField(totals, "dDescTotal", fixed(text(totals, "dTotDesc")) + fixed(text(totals, "dTotDescGlotem")), false, "2364", "2364") ??
    checkField(totals, "dAnticipo", fixed(text(totals, "dTotAntItem")) + fixed(text(totals, "dTotAnt")), false, "2388", "2388");
  if (figures) return figures;

  if (tipo === "1" || tipo === "5" || tipo === "6") {
    const general = fixed(text(totals, "dTotGralOpe"));
    // NT 1: F008 - F013 + F025
    const expectedGeneral = fixed(text(totals, "dTotOpe")) - fixed(text(totals, "dRedon")) + fixed(text(totals, "dComi"));
    if (!within(general, expectedGeneral)) return mismatch("2365", "dTotGralOpe", general, expectedGeneral);
  }

  const hasVat = items.some((item) => item.hasVat);
  if (hasVat) {
    const vat =
      checkField(totals, "dIVA5", sum(fivePct, (i) => i.vat), fivePct.length > 0, "2366", "2367") ??
      checkField(totals, "dIVA10", sum(tenPct, (i) => i.vat), tenPct.length > 0, "2368", "2369");
    if (vat) return vat;

    const vat5 = text(totals, "dIVA5");
    const vat10 = text(totals, "dIVA10");
    const expectedVat =
      fixed(vat5) + fixed(vat10) - fixed(text(totals, "dLiqTotIVA5")) - fixed(text(totals, "dLiqTotIVA10")) + fixed(text(totals, "dIVAComi"));
    const bases =
      checkField(totals, "dTotIVA", expectedVat, vat5 !== undefined || vat10 !== undefined, "2370", "2371") ??
      checkField(totals, "dBaseGrav5", sum(fivePct, (i) => i.base), fivePct.length > 0, "2372", "2373") ??
      checkField(totals, "dBaseGrav10", sum(tenPct, (i) => i.base), tenPct.length > 0, "2374", "2375");
    if (bases) return bases;

    const base5 = text(totals, "dBaseGrav5");
    const base10 = text(totals, "dBaseGrav10");
    const totalBase = checkField(totals, "dTBasGraIVA", fixed(base5) + fixed(base10), base5 !== undefined || base10 !== undefined, "2376", "2377");
    if (totalBase) return totalBase;
  }

  if (foreign) {
    const totalGs = text(totals, "dTotalGs");
    if (totalGs === undefined) return hit("2382", "Falta dTotalGs");
    const condition = text(de, "dCondTiCam");
    if (condition === "1") {
      const expected = multiply(fixed(text(totals, "dTotGralOpe")), fixed(text(de, "dTiCam")));
      if (!within(fixed(totalGs), expected)) return mismatch("2385", "dTotalGs", fixed(totalGs), expected);
    } else if (condition === "2") {
      const expected = sum(items, (i) => i.totalGs ?? ZERO);
      if (!within(fixed(totalGs), expected)) return mismatch("2386", "dTotalGs", fixed(totalGs), expected);
    }
  }
  return undefined;
}

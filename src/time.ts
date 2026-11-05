// SIFEN maneja fechas locales de Paraguay, sin zona horaria (MT §7.2.3). Paraguay está en
// UTC-3 todo el año desde octubre de 2024, y eso es lo que se usa acá.

const OFFSET = "-03:00";
const OFFSET_MS = 3 * 60 * 60 * 1000;

export const HOUR = 60 * 60 * 1000;

export function parseLocal(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = /T\d{2}:\d{2}:\d{2}$/.test(value) ? `${value}${OFFSET}` : value;
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized}T00:00:00${OFFSET}` : normalized);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Fecha de proceso en el formato de `fecUTC`: AAAA-MM-DDThh:mm:ss-03:00. */
export function formatProcessDate(epoch: number): string {
  return `${new Date(epoch - OFFSET_MS).toISOString().slice(0, 19)}${OFFSET}`;
}

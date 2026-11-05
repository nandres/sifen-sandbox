import { DOMParser, type Document, type Element } from "@xmldom/xmldom";

export const SIFEN_NS = "http://ekuatia.set.gov.py/sifen/xsd";
export const DSIG_NS = "http://www.w3.org/2000/09/xmldsig#";
export const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";

export class MalformedXmlError extends Error {}

export function parseXml(xml: string): Document {
  const parser = new DOMParser({
    onError(level, message) {
      if (level !== "warning") throw new MalformedXmlError(String(message).trim());
    },
  });
  try {
    return parser.parseFromString(xml, "text/xml");
  } catch (error) {
    if (error instanceof MalformedXmlError) throw error;
    throw new MalformedXmlError(error instanceof Error ? error.message : String(error));
  }
}

/** Primer descendiente con ese nombre local, sin importar el namespace. */
export function descendant(root: Document | Element, localName: string): Element | undefined {
  return root.getElementsByTagNameNS("*", localName)[0] ?? undefined;
}

export function descendants(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS("*", localName));
}

export function text(root: Document | Element | undefined, localName: string): string | undefined {
  if (!root) return undefined;
  const value = descendant(root, localName)?.textContent?.trim();
  return value === "" ? undefined : value;
}

export function firstChildElement(element: Element): Element | undefined {
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1) return node as Element;
  }
  return undefined;
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Saca un elemento tal como llegó, sin volver a serializarlo: la firma se calcula sobre
 * esos bytes. Si el elemento se repite, sirve `all`.
 */
export function rawElements(xml: string, localName: string): string[] {
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${localName}(?:\\s[^>]*)?>[\\s\\S]*?</(?:[\\w.-]+:)?${localName}\\s*>`, "g");
  return xml.match(pattern) ?? [];
}

export function rawElement(xml: string, localName: string): string | undefined {
  return rawElements(xml, localName)[0];
}

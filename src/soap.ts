import type { Element } from "@xmldom/xmldom";

import { SIFEN_NS, descendant, firstChildElement, parseXml } from "./xml.js";

export const SOAP12 = "http://www.w3.org/2003/05/soap-envelope";
export const SOAP11 = "http://schemas.xmlsoap.org/soap/envelope/";

export interface SoapRequest {
  soapNamespace: string;
  payload: Element;
}

/** Lanza MalformedXmlError si no es XML; devuelve undefined si no es un sobre SOAP. */
export function parseEnvelope(xml: string): SoapRequest | undefined {
  const document = parseXml(xml);
  const root = document.documentElement;
  if (!root || root.localName !== "Envelope") return undefined;
  const namespace = root.namespaceURI === SOAP11 ? SOAP11 : SOAP12;
  // El ejemplo del manual escribe soap:body en minúscula; se aceptan las dos.
  const body = descendant(document, "Body") ?? descendant(document, "body");
  const payload = body ? firstChildElement(body) : undefined;
  return payload ? { soapNamespace: namespace, payload } : undefined;
}

export function soapResponse(soapNamespace: string, body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<env:Envelope xmlns:env="${soapNamespace}"><env:Header/><env:Body>${body}</env:Body></env:Envelope>`
  );
}

export function soapFault(soapNamespace: string, reason: string): string {
  const safe = reason.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const fault =
    soapNamespace === SOAP11
      ? `<env:Fault><faultcode>env:Server</faultcode><faultstring>${safe}</faultstring></env:Fault>`
      : `<env:Fault><env:Code><env:Value>env:Receiver</env:Value></env:Code><env:Reason><env:Text xml:lang="es">${safe}</env:Text></env:Reason></env:Fault>`;
  return soapResponse(soapNamespace, fault);
}

/** Como en las respuestas reales de la Guía de la DNIT: todo con el prefijo ns2. */
export const element = (name: string, inner: string): string =>
  `<ns2:${name} xmlns:ns2="${SIFEN_NS}">${inner.replace(/<(\/?)([A-Za-z])/g, "<$1ns2:$2")}</ns2:${name}>`;

export function contentTypeFor(soapNamespace: string): string {
  return soapNamespace === SOAP11 ? "text/xml; charset=utf-8" : "application/soap+xml; charset=utf-8";
}

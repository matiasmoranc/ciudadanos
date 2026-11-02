/**
 * Actualiza el DOM sin reemplazar nodos que no cambiaron. La interfaz se
 * redibuja varias veces por segundo: si se recrearan los botones, un toque que
 * cae entre el pointerdown y el pointerup se perdería.
 */
export function patch(target: Element, html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;
  morphChildren(target, template.content);
}

function morphChildren(current: Node, next: Node) {
  const a = Array.from(current.childNodes);
  const b = Array.from(next.childNodes);
  b.forEach((wanted, i) => {
    const existing = a[i];
    if (!existing) current.appendChild(wanted);
    else if (!sameKind(existing, wanted)) current.replaceChild(wanted, existing);
    else morphNode(existing, wanted);
  });
  for (let i = b.length; i < a.length; i++) current.removeChild(a[i]);
}

function sameKind(a: Node, b: Node) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
  return !(a instanceof Element) || a.id === (b as Element).id;
}

function morphNode(a: Node, b: Node) {
  if (a.nodeType === Node.TEXT_NODE) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  if (!(a instanceof Element) || !(b instanceof Element)) return;
  for (const name of a.getAttributeNames()) {
    if (!b.hasAttribute(name)) a.removeAttribute(name);
  }
  for (const name of b.getAttributeNames()) {
    const value = b.getAttribute(name)!;
    if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  }
  morphChildren(a, b);
}

// A small DOM for running the page readers against saved HTML fixtures in plain Node.
// It supports the parts the readers use: parsing well-formed HTML, attributes, text,
// contains(), getClientRects() and a subset of CSS selectors (tag, #id, .class,
// [attr], [attr=v], [attr^=v], [attr*=v], [attr$=v] with an optional i flag,
// :first-child, descendant and child combinators, and comma lists).
import { readFile } from 'node:fs/promises';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'div', 'dl', 'dt', 'dd', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'li', 'main', 'nav', 'ol', 'p', 'section', 'table', 'tr', 'ul']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’' };
const decode = value => value.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (all, code) => code[0] === '#' ? String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : +code.slice(1)) : ENTITIES[code] ?? all);

class Node {
  constructor(parent) { this.parentNode = parent; }
  get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map(child => child.textContent).join(''); }
}
class Text extends Node { constructor(data, parent) { super(parent); this.nodeType = 3; this.data = data; } }
class Element extends Node {
  constructor(tagName, attributes, parent) { super(parent); this.nodeType = 1; this.tagName = tagName.toUpperCase(); this.attributes = attributes; this.childNodes = []; }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get id() { return this.attributes.id || ''; }
  // Like a browser, block elements add line breaks and hidden elements add nothing.
  get innerText() {
    if (this.hiddenSelf()) return '';
    const inner = this.childNodes.map(child => child.nodeType === 3 ? child.data : child.innerText).join('');
    return BLOCK.has(this.tagName.toLowerCase()) ? `\n${inner}\n` : /^t[dh]$/i.test(this.tagName) ? `${inner}\t` : inner;
  }
  getAttribute(name) { return Object.hasOwn(this.attributes, name.toLowerCase()) ? this.attributes[name.toLowerCase()] : null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name.toLowerCase()); }
  hiddenSelf() { return this.hasAttribute('hidden') || /display\s*:\s*none/i.test(this.getAttribute('style') || ''); }
  getClientRects() { for (let node = this; node?.nodeType === 1; node = node.parentNode) if (node.hiddenSelf()) return []; return [{}]; }
  contains(other) { for (let node = other; node; node = node.parentNode) if (node === this) return true; return false; }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelectorAll(selector) { const groups = parseSelector(selector); return this.descendants().filter(el => groups.some(group => matchesComplex(el, group))); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  matches(selector) { return parseSelector(selector).some(group => matchesComplex(this, group)); }
  closest(selector) { for (let node = this; node?.nodeType === 1; node = node.parentNode) if (node.matches(selector)) return node; return null; }
}

export function parseHTML(html) {
  const root = new Element('#document', {}, null);
  let current = root;
  const pattern = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-z][\w-]*)\s*>|<([a-z][\w-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
  for (const match of html.matchAll(pattern)) {
    if (match[5] !== undefined) { current.childNodes.push(new Text(decode(match[5]), current)); continue; }
    if (match[1]) { const tag = match[1].toUpperCase(); for (let node = current; node !== root; node = node.parentNode) if (node.tagName === tag) { current = node.parentNode; break; } continue; }
    if (!match[2]) continue;
    const attributes = {};
    for (const attr of match[3].matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attributes[attr[1].toLowerCase()] = decode(attr[2] ?? attr[3] ?? attr[4] ?? '');
    const element = new Element(match[2], attributes, current);
    current.childNodes.push(element);
    if (!VOID.has(match[2].toLowerCase()) && !match[4]) current = element;
  }
  return root;
}

function parseSelector(selector) {
  return selector.split(/,(?![^\[]*\])/).map(group => {
    const parts = [];
    let combinator = ' ', separated = true;
    for (const token of group.trim().match(/\[[^\]]*\]|>|[^\s>\[]+|\s+/g) || []) {
      if (/^\s+$/.test(token)) { separated = true; continue; }
      if (token === '>') { combinator = '>'; separated = true; continue; }
      if (!separated) { parts[parts.length - 1].compound += token; continue; }
      parts.push({ compound: token, combinator });
      combinator = ' '; separated = false;
    }
    return parts.map(part => ({ combinator: part.combinator, test: compileCompound(part.compound) }));
  });
}
function compileCompound(compound) {
  const tests = [];
  const tag = compound.match(/^[a-z][\w-]*|^\*/i)?.[0];
  if (tag && tag !== '*') tests.push(el => el.tagName === tag.toUpperCase());
  for (const [, kind, name] of compound.matchAll(/([#.])([\w-]+)/g)) tests.push(kind === '#' ? el => el.id === name : el => (el.getAttribute('class') || '').split(/\s+/).includes(name));
  if (/:first-child/.test(compound)) tests.push(el => el.parentNode?.children?.[0] === el);
  for (const [, name, op, raw, flag] of compound.matchAll(/\[\s*([\w-]+)\s*(?:([~^$*|]?=)\s*("[^"]*"|'[^']*'|[^\s\]]+)\s*(i)?)?\s*\]/g)) {
    const expected = raw?.replace(/^["']|["']$/g, '');
    tests.push(el => {
      let actual = el.getAttribute(name);
      if (actual === null) return false;
      if (!op) return true;
      let want = expected;
      if (flag) { actual = actual.toLowerCase(); want = want.toLowerCase(); }
      return op === '=' ? actual === want : op === '^=' ? actual.startsWith(want) : op === '$=' ? actual.endsWith(want) : op === '*=' ? actual.includes(want) : actual.split(/\s+/).includes(want);
    });
  }
  return el => tests.every(test => test(el));
}
function matchesComplex(element, parts) {
  const walk = (el, index) => {
    if (!parts[index].test(el)) return false;
    if (index === 0) return true;
    const combinator = parts[index].combinator;
    for (let node = el.parentNode; node?.nodeType === 1 && node.tagName !== '#DOCUMENT'; node = node.parentNode) {
      if (walk(node, index - 1)) return true;
      if (combinator === '>') return false;
    }
    return false;
  };
  return walk(element, parts.length - 1);
}

// Loads a fixture as the page the reader sees: sets document and location globally.
export async function loadPage(file, url) {
  const document = parseHTML(await readFile(new URL(`../fixtures/${file}`, import.meta.url), 'utf8'));
  globalThis.document = document;
  globalThis.location = new URL(url);
  return document;
}

#!/usr/bin/env node

const fs = require('node:fs');
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { HTMLMathItem } = require('mathjax-full/js/handlers/html/HTMLMathItem.js');
const { SerializedMmlVisitor } = require('mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js');
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function createDocument() {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);

  const tex = new TeX({
    packages: AllPackages,
    processEscapes: true,
    processEnvironments: true,
  });
  const output = new SVG({ fontCache: 'none', internalSpeechTitles: false });
  const html = mathjax.document('', { InputJax: tex, OutputJax: output });
  return { adaptor, html, tex };
}

function compileToMml(latex) {
  const { html, tex } = createDocument();
  const item = new HTMLMathItem(latex, tex, true);
  item.compile(html);
  return item.root;
}

function renderMathML(latex) {
  return new SerializedMmlVisitor().visitTree(compileToMml(latex));
}

function renderUnicodeMath(latex) {
  return mmlToUnicodeMath(compileToMml(latex));
}

function renderSvg(latex) {
  const { adaptor, html } = createDocument();
  const node = html.convert(latex, { display: true });
  return adaptor.innerHTML(node) || adaptor.outerHTML(node);
}

const FENCE_PAIRS = new Set(['()', '[]', '{}', '⟨⟩', '||', '‖‖']);

function isTokenLike(node) {
  const k = node && node.kind;
  return k === 'mi' || k === 'mn' || k === 'mo' || k === 'mtext' || k === 'ms';
}

function getText(node) {
  if (!node) return '';
  if (typeof node.getText === 'function') {
    try {
      const value = node.getText();
      if (typeof value === 'string') return value;
    } catch (_) {}
  }
  if (node.kind === 'text') return node.text || '';
  if (!Array.isArray(node.childNodes)) return '';
  return node.childNodes.map(getText).join('');
}

function needsGroup(text) {
  if (!text) return true;
  if (text.length === 1) return false;
  return !/^[A-Za-z0-9]+$/.test(text) && !/^\([\s\S]*\)$/.test(text);
}

function group(text) {
  return needsGroup(text) ? `(${text})` : text;
}

function joinChildren(node) {
  if (!node || !Array.isArray(node.childNodes)) return '';
  return node.childNodes.map(mmlToUnicodeMath).join('');
}

function mmlToUnicodeMath(node) {
  if (!node) return '';
  const kind = node.kind;

  switch (kind) {
    case 'math':
    case 'mrow':
    case 'mstyle':
    case 'merror':
    case 'mpadded':
    case 'mphantom':
    case 'menclose':
    case 'semantics':
      return joinChildren(node);
    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext':
    case 'ms':
      return getText(node);
    case 'mspace':
      return ' ';
    case 'mfrac': {
      const [num, den] = node.childNodes || [];
      return `${group(mmlToUnicodeMath(num))}/${group(mmlToUnicodeMath(den))}`;
    }
    case 'msup': {
      const [base, sup] = node.childNodes || [];
      return `${group(mmlToUnicodeMath(base))}^${group(mmlToUnicodeMath(sup))}`;
    }
    case 'msub': {
      const [base, sub] = node.childNodes || [];
      return `${group(mmlToUnicodeMath(base))}_${group(mmlToUnicodeMath(sub))}`;
    }
    case 'msubsup': {
      const [base, sub, sup] = node.childNodes || [];
      return `${group(mmlToUnicodeMath(base))}_${group(mmlToUnicodeMath(sub))}^${group(mmlToUnicodeMath(sup))}`;
    }
    case 'munder': {
      const [base, under] = node.childNodes || [];
      return `${group(mmlToUnicodeMath(base))}_${group(mmlToUnicodeMath(under))}`;
    }
    case 'mover': {
      const [base, over] = node.childNodes || [];
      return `${group(mmlToUnicodeMath(base))}^${group(mmlToUnicodeMath(over))}`;
    }
    case 'munderover': {
      const [base, under, over] = node.childNodes || [];
      return `${group(mmlToUnicodeMath(base))}_${group(mmlToUnicodeMath(under))}^${group(mmlToUnicodeMath(over))}`;
    }
    case 'msqrt':
      return `√${group(joinChildren(node))}`;
    case 'mroot': {
      const [radicand, index] = node.childNodes || [];
      return `root(${mmlToUnicodeMath(index)})(${mmlToUnicodeMath(radicand)})`;
    }
    case 'mfenced': {
      const open = (node.attributes && node.attributes.get && node.attributes.get('open')) || '(';
      const close = (node.attributes && node.attributes.get && node.attributes.get('close')) || ')';
      const sep = (node.attributes && node.attributes.get && node.attributes.get('separators')) || ',';
      const parts = (node.childNodes || []).map(mmlToUnicodeMath);
      return `${open}${parts.join(sep || ',')}${close}`;
    }
    case 'mtable': {
      const rows = (node.childNodes || [])
        .map(row => {
          const cells = (row.childNodes || []).map(mmlToUnicodeMath);
          return cells.join('&');
        })
        .join('@');
      return `■(${rows})`;
    }
    case 'mtr':
      return (node.childNodes || []).map(mmlToUnicodeMath).join('&');
    case 'mtd':
      return joinChildren(node);
    default:
      return joinChildren(node);
  }
}

// eslint-disable-next-line no-unused-vars
const _fencePairs = FENCE_PAIRS; // reserved for future fence-aware simplification

try {
  const payload = JSON.parse(readStdin() || '{}');
  const latex = String(payload.latex || '').trim();
  const format = String(payload.format || 'svg').toLowerCase();

  if (!latex) {
    throw new Error('latex is required');
  }

  if (format === 'mathml') {
    process.stdout.write(renderMathML(latex));
  } else if (format === 'unicodemath' || format === 'um' || format === 'unicode') {
    const result = renderUnicodeMath(latex);
    if (!result) {
      throw new Error('Empty UnicodeMath output');
    }
    process.stdout.write(result);
  } else {
    process.stdout.write(renderSvg(latex));
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

module.exports = { mmlToUnicodeMath };

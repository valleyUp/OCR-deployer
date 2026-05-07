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

function renderMathML(latex) {
  const { html, tex } = createDocument();
  const item = new HTMLMathItem(latex, tex, true);
  item.compile(html);
  return new SerializedMmlVisitor().visitTree(item.root);
}

try {
  const payload = JSON.parse(readStdin() || '{}');
  const latex = String(payload.latex || '').trim();
  const format = String(payload.format || 'svg').toLowerCase();

  if (!latex) {
    throw new Error('latex is required');
  }

  if (format === 'mathml') {
    process.stdout.write(renderMathML(latex));
  } else {
    const { adaptor, html } = createDocument();
    const node = html.convert(latex, { display: true });
    process.stdout.write(adaptor.outerHTML(node));
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

let mathjaxPromise: Promise<void> | null = null

function loadMathJax(): Promise<void> {
  if (mathjaxPromise) return mathjaxPromise

  mathjaxPromise = new Promise((resolve, reject) => {
    const existing = (window as any).MathJax
    if (existing?.tex2svg) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-svg.js'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load MathJax'))
    document.head.appendChild(script)
  })

  return mathjaxPromise
}

function getMathJax(): any {
  return (window as any).MathJax
}

export function isMathJaxReady(): boolean {
  const mj = getMathJax()
  return !!(mj?.tex2svg)
}

export async function renderFormulaSvg(latex: string): Promise<string> {
  await loadMathJax()
  const mj = getMathJax()
  const node = mj.tex2svg(latex, { display: true })
  return node.outerHTML || mj.startup.adaptor.outerHTML(node)
}

export async function renderFormulaMathML(latex: string): Promise<string> {
  await loadMathJax()
  const mj = getMathJax()
  const node = mj.tex2mml(latex, { display: true })
  return new XMLSerializer().serializeToString(node)
}

export async function renderFormulaUnicodeMath(latex: string): Promise<string> {
  await loadMathJax()
  const mj = getMathJax()
  const mmlNode = mj.tex2mml(latex, { display: true })
  const result = mmlDomToUnicodeMath(mmlNode)
  if (!result) throw new Error('Empty UnicodeMath output')
  return result
}

// ---------------------------------------------------------------------------
// MathML DOM → UnicodeMath tree walker
// (same logic as render-formula.cjs but operates on DOM nodes)
// ---------------------------------------------------------------------------

export interface MathMLElement extends Element {
  childNodes: NodeListOf<ChildNode & MathMLElement>
}

function getNodeText(node: Node): string {
  return node.textContent || ''
}

function needsGroup(text: string): boolean {
  if (!text) return true
  if (text.length === 1) return false
  return !/^[A-Za-z0-9]+$/.test(text) && !/^\([\s\S]*\)$/.test(text)
}

function group(text: string): string {
  return needsGroup(text) ? `(${text})` : text
}

function joinChildren(node: Node): string {
  if (!node.childNodes?.length) return ''
  return Array.from(node.childNodes)
    .map(c => mmlDomToUnicodeMath(c))
    .join('')
}

function mmlDomToUnicodeMath(node: Node): string {
  if (!node) return ''
  const kind = node.nodeName?.toLowerCase()

  switch (kind) {
    case 'math':
    case 'mrow':
    case 'mstyle':
    case 'merror':
    case 'mpadded':
    case 'mphantom':
    case 'menclose':
    case 'semantics':
      return joinChildren(node)
    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext':
    case 'ms':
      return getNodeText(node)
    case 'mspace':
      return ' '
    case 'mfrac': {
      const [num, den] = Array.from(node.childNodes)
      return `${group(mmlDomToUnicodeMath(num))}/${group(mmlDomToUnicodeMath(den))}`
    }
    case 'msup': {
      const [base, sup] = Array.from(node.childNodes)
      return `${group(mmlDomToUnicodeMath(base))}^${group(mmlDomToUnicodeMath(sup))}`
    }
    case 'msub': {
      const [base, sub] = Array.from(node.childNodes)
      return `${group(mmlDomToUnicodeMath(base))}_${group(mmlDomToUnicodeMath(sub))}`
    }
    case 'msubsup': {
      const [base, sub, sup] = Array.from(node.childNodes)
      return `${group(mmlDomToUnicodeMath(base))}_${group(mmlDomToUnicodeMath(sub))}^${group(mmlDomToUnicodeMath(sup))}`
    }
    case 'munder': {
      const [base, under] = Array.from(node.childNodes)
      return `${group(mmlDomToUnicodeMath(base))}_${group(mmlDomToUnicodeMath(under))}`
    }
    case 'mover': {
      const [base, over] = Array.from(node.childNodes)
      return `${group(mmlDomToUnicodeMath(base))}^${group(mmlDomToUnicodeMath(over))}`
    }
    case 'munderover': {
      const [base, under, over] = Array.from(node.childNodes)
      return `${group(mmlDomToUnicodeMath(base))}_${group(mmlDomToUnicodeMath(under))}^${group(mmlDomToUnicodeMath(over))}`
    }
    case 'msqrt':
      return `√${group(joinChildren(node))}`
    case 'mroot': {
      const [radicand, index] = Array.from(node.childNodes)
      return `root(${mmlDomToUnicodeMath(index)})(${mmlDomToUnicodeMath(radicand)})`
    }
    case 'mfenced': {
      const el = node as Element
      const open = el.getAttribute('open') || '('
      const close = el.getAttribute('close') || ')'
      const sep = el.getAttribute('separators') || ','
      const parts = Array.from(node.childNodes).map(mmlDomToUnicodeMath)
      return `${open}${parts.join(sep || ',')}${close}`
    }
    case 'mtable': {
      const rows = Array.from(node.childNodes).map(row =>
        Array.from(row.childNodes).map(mmlDomToUnicodeMath).join('&')
      )
      return `■(${rows.join('@')})`
    }
    case 'mtr':
      return Array.from(node.childNodes).map(mmlDomToUnicodeMath).join('&')
    case 'mtd':
      return joinChildren(node)
    default:
      return joinChildren(node)
  }
}

export { mmlDomToUnicodeMath }

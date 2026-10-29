/**
 * Convert common LaTeX / markdown math in question stems into plain
 * readable text for admin paper preview and PDF (no KaTeX dependency).
 * Preserves meaning; does not invent or drop symbols.
 */

const GREEK = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  varpi: 'π',
  rho: 'ρ',
  varrho: 'ρ',
  sigma: 'σ',
  varsigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Alpha: 'Α',
  Beta: 'Β',
  Gamma: 'Γ',
  Delta: 'Δ',
  Epsilon: 'Ε',
  Zeta: 'Ζ',
  Eta: 'Η',
  Theta: 'Θ',
  Iota: 'Ι',
  Kappa: 'Κ',
  Lambda: 'Λ',
  Mu: 'Μ',
  Nu: 'Ν',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Tau: 'Τ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Chi: 'Χ',
  Psi: 'Ψ',
  Omega: 'Ω',
};

const SUPER = {
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
  '+': '⁺',
  '-': '⁻',
  '−': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
  j: 'ʲ',
  l: 'ˡ',
  x: 'ˣ',
  y: 'ʸ',
  a: 'ᵃ',
  b: 'ᵇ',
  c: 'ᶜ',
  d: 'ᵈ',
  e: 'ᵉ',
  f: 'ᶠ',
  g: 'ᵍ',
  h: 'ʰ',
  k: 'ᵏ',
  m: 'ᵐ',
  o: 'ᵒ',
  p: 'ᵖ',
  r: 'ʳ',
  s: 'ˢ',
  t: 'ᵗ',
  u: 'ᵘ',
  v: 'ᵛ',
  w: 'ʷ',
  z: 'ᶻ',
};

const SUB = {
  0: '₀',
  1: '₁',
  2: '₂',
  3: '₃',
  4: '₄',
  5: '₅',
  6: '₆',
  7: '₇',
  8: '₈',
  9: '₉',
  '+': '₊',
  '-': '₋',
  '−': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  h: 'ₕ',
  l: 'ₗ',
  u: 'ᵤ',
  v: 'ᵥ',
  a: 'ₐ',
  e: 'ₑ',
  o: 'ₒ',
  x: 'ₓ',
  i: 'ᵢ',
  r: 'ᵣ',
  s: 'ₛ',
  p: 'ₚ',
  n: 'ₙ',
  m: 'ₘ',
  t: 'ₜ',
  k: 'ₖ',
};

const stripOuterBraces = value => {
  let s = String(value || '').trim();
  while (s.startsWith('{') && s.endsWith('}')) {
    s = s.slice(1, -1).trim();
  }
  return s;
};

const needsParens = value => {
  const s = String(value || '').trim();
  if (!s) return false;
  if (/^[A-Za-z0-9θφαβγδμπσωΔΩ√°_]+$/.test(s)) return false;
  if (/^[A-Za-z0-9θφαβγδμπσωΔΩ√°_]+([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿ]+)?$/.test(s)) return false;
  return /[+\-*/=<>≤≥,]/.test(s) || /\s/.test(s);
};

const wrapIfNeeded = value => {
  const s = stripOuterBraces(value);
  return needsParens(s) ? `(${s})` : s;
};

const takeBraceGroup = (source, start) => {
  if (source[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          raw: source.slice(start, i + 1),
          inner: source.slice(start + 1, i),
          end: i + 1,
        };
      }
    }
  }
  return null;
};

const takeLatexArg = (source, start) => {
  let i = start;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  if (i >= source.length) return null;
  if (source[i] === '{') return takeBraceGroup(source, i);
  if (source[i] === '\\') {
    const m = source.slice(i).match(/^\\[A-Za-z]+/);
    if (m) {
      return { raw: m[0], inner: m[0], end: i + m[0].length };
    }
  }
  return { raw: source[i], inner: source[i], end: i + 1 };
};

const toSuperscript = value => {
  const chars = String(value || '').split('');
  if (chars.some(ch => !SUPER[ch] && !SUPER[ch.toLowerCase()])) {
    return `^(${value})`;
  }
  return chars.map(ch => SUPER[ch] || SUPER[ch.toLowerCase()] || ch).join('');
};

const toSubscript = value =>
  String(value || '')
    .split('')
    .map(ch => SUB[ch] || SUB[ch.toLowerCase()] || ch)
    .join('');

const ACCENT_MARK = {
  hat: '\u0302',
  vec: '\u20D7',
  dot: '\u0307',
  ddot: '\u0308',
  dddot: '\u20DB',
  bar: '\u0304',
  tilde: '\u0303',
};
const ACCENT_ALIAS = {
  overline: 'bar',
  overrightarrow: 'vec',
  widehat: 'hat',
  widetilde: 'tilde',
};

/** Single symbols get a combining mark (x̂, v⃗, ẋ); longer args read as hat(AB). */
const applyAccent = (kind, inner) => {
  const value = String(inner || '').trim();
  if (Array.from(value).length === 1 && ACCENT_MARK[kind]) {
    return `${value}${ACCENT_MARK[kind]}`;
  }
  return `${kind}(${value})`;
};

/** mhchem \ce{2H2O -> 2H2 + O2}, \ce{SO4^2-}, \ce{Fe^{3+}} → plain chemistry text */
const formatChem = inner =>
  String(inner || '')
    .replace(/\s*<=>\s*/g, ' ⇌ ')
    .replace(/\s*->\s*/g, ' → ')
    .replace(/\s*<-\s*/g, ' ← ')
    .replace(/\^\{([^{}]+)\}|\^([0-9]*[+\-−])/g, (_, braced, bare) =>
      Array.from(braced ?? bare)
        .map(ch => SUPER[ch] || ch)
        .join('')
    )
    .replace(/([A-Za-z)\]])(\d+)/g, (_, el, n) => `${el}${toSubscript(n)}`)
    .replace(/_\{?(\d+)\}?/g, (_, n) => toSubscript(n));

const invertMap = map =>
  Object.fromEntries(
    Object.entries(map)
      .filter(([ascii]) => ascii !== '−')
      .map(([ascii, glyph]) => [glyph, ascii])
  );
const SUPER_ASCII = invertMap(SUPER);
const SUB_ASCII = invertMap(SUB);
const runOf = map =>
  new RegExp(
    `[${Object.keys(map)
      .join('')
      .replace(/[-\\\]^]/g, '\\$&')}]+`,
    'g'
  );
const SUPER_RUN = runOf(SUPER_ASCII);
const SUB_RUN = runOf(SUB_ASCII);

const SCRIPT_MAP = { '^': SUPER, _: SUB };
const SCRIPT_PASSTHROUGH = new Set(['′', '″', '°', '*', '†', '‡']);

const isScriptable = (marker, ch) =>
  (/[A-Za-z0-9]/.test(ch) || (marker === '^' && /[+\-−]/.test(ch))) &&
  (Boolean(SCRIPT_MAP[marker][ch]) || SCRIPT_PASSTHROUGH.has(ch));

/** Unicode sub/superscript when every char has one; otherwise x_a / x_(ab). */
const formatScript = (marker, inner) => {
  const value = String(inner || '').replace(/\s+/g, '');
  if (!value) return '';
  if (SCRIPT_PASSTHROUGH.has(value)) return value;
  const map = SCRIPT_MAP[marker];
  const chars = Array.from(value);
  if (chars.every(ch => map[ch])) return chars.map(ch => map[ch]).join('');
  return chars.length === 1 ? `${marker}${value}` : `${marker}(${value})`;
};

/** Repair mangled scientific notation like 10^-^1^0 → 10⁻¹⁰ */
const repairScientificNotation = s =>
  String(s || '')
    .replace(
      /(\d)\s*[x×]\s*10\s*\^?\s*-?\s*((?:\^?-?\d)+)/gi,
      (_, base, expPart) => {
        const digits = String(expPart).replace(/[^\d-]/g, '');
        const neg = String(expPart).includes('-') || digits.startsWith('-');
        const nums = digits.replace(/-/g, '');
        return `${base} × 10${toSuperscript((neg ? '-' : '') + nums)}`;
      }
    )
    .replace(/10\s*\^\s*-?\s*((?:\^\d)+)/g, (_, expPart) => {
      const nums = String(expPart).replace(/[^\d]/g, '');
      return `10${toSuperscript(`-${nums}`)}`;
    })
    .replace(
      /10\s*\^\s*\{\s*([+-]?\d+)\s*\}/g,
      (_, exp) => `10${toSuperscript(exp)}`
    )
    .replace(/10\s*\^\s*([+-]?\d+)/g, (_, exp) => `10${toSuperscript(exp)}`)
    .replace(/10\^-((?:\^\d)+)/g, (_, expPart) => {
      const nums = String(expPart).replace(/[^\d]/g, '');
      return `10${toSuperscript(`-${nums}`)}`;
    })
    .replace(/10\^-(\d+)/g, (_, nums) => `10${toSuperscript(`-${nums}`)}`);

/** Keep "\omega\mathbf{B}" from collapsing into the unknown command "\omegaB". */
const afterCommand = (text, offset, source) =>
  /\\[A-Za-z]+$/.test(source.slice(0, offset)) && /^[A-Za-z]/.test(text)
    ? ` ${text}`
    : text;

/** Wrap a String#replace callback with {@link afterCommand}. */
const keepApart =
  fn =>
  (...args) => {
    const hasGroups = typeof args[args.length - 1] === 'object';
    const source = args[args.length - (hasGroups ? 2 : 1)];
    const offset = args[args.length - (hasGroups ? 3 : 2)];
    return afterCommand(fn(...args), offset, source);
  };

const applyCommandPass = (s, pattern, replacer) => {
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  );
  let match;
  let out = '';
  let last = 0;
  let changed = false;
  while ((match = re.exec(s))) {
    const result = replacer(match, s);
    if (!result) continue;
    out += s.slice(last, match.index);
    out += afterCommand(result.text, out.length, out);
    last = result.end;
    re.lastIndex = result.end;
    changed = true;
  }
  if (!changed) return { text: s, changed: false };
  return { text: out + s.slice(last), changed: true };
};

const takeOptionalScript = (source, start, marker) => {
  let i = start;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  if (i >= source.length || source[i] !== marker)
    return { value: null, end: start };
  i += 1;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  if (source[i] === '{') {
    const group = takeBraceGroup(source, i);
    if (!group) return { value: null, end: start };
    return { value: group.inner, end: group.end };
  }
  if (i >= source.length) return { value: null, end: start };
  if (source[i] === '\\') {
    const m = source.slice(i).match(/^\\[A-Za-z]+/);
    if (m) return { value: m[0], end: i + m[0].length };
  }
  return { raw: source[i], value: source[i], end: i + 1 };
};

const MATH_FN = {
  lim: 'lim',
  sum: 'Σ',
  prod: 'Π',
  int: '∫',
  ln: 'ln',
  log: 'log',
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  cot: 'cot',
  sec: 'sec',
  csc: 'csc',
  arcsin: 'arcsin',
  arccos: 'arccos',
  arctan: 'arctan',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  gcd: 'gcd',
  lcm: 'lcm',
  max: 'max',
  min: 'min',
  det: 'det',
  dim: 'dim',
  ker: 'ker',
  exp: 'exp',
};

const BLACKBOARD = {
  R: 'ℝ',
  N: 'ℕ',
  Z: 'ℤ',
  Q: 'ℚ',
  C: 'ℂ',
  P: 'ℙ',
};

/**
 * Normalizes math and LaTeX constructs that might be either backslashed or bare
 * (when backslashes were stripped during storage or ingestion), including
 * bare fractions (frac{a}{b}, dfrac, tfrac, fracrR, frac12), bare delimiters,
 * bare font styles, vector/hat accents, and math tags.
 */
export const normalizeMathAndLatex = input => {
  if (input == null) return '';
  let s = String(input);

  // 1. Remove escaped dollars, trailing backslashes on line ends, lone line backslashes
  if (!/\\begin\s*\{/.test(s)) {
    s = s.replace(/\\{1,2}\s*$/gm, '');
    s = s.replace(/^[ \t]*\\{1,2}(?![A-Za-z[\]()])[ \t]*/gm, '');
  }
  // 2. Remove LaTeX display math environments / boxes / tags
  s = s.replace(/\\tag\s*\{?([A-Za-z0-9]+)\}?/g, '($1)');
  s = s.replace(/\btag\s*\{([0-9A-Za-z]+)\}/g, '($1)');
  s = s.replace(/\btag([0-9]+)\b/g, '($1)');
  s = s.replace(
    /\\(?:displaystyle|textstyle)\b|\b(?:displaystyle|textstyle)\b/g,
    ''
  );
  s = s.replace(/\\phantom\{[^}]*\}|\bphantom\{[^}]*\}/g, '');
  s = s.replace(/\\underbrace\{([^}]*)\}_\(([^)]*)\)/g, '$1 ($2)');
  s = s.replace(/\bunderbrace\{([^}]*)\}_\(([^)]*)\)/g, '$1 ($2)');

  // 3. Spacers: qquad, quad
  s = s.replace(/(?:\\|\b)qquad\b/g, '   ');
  s = s.replace(/(?:\\|\b)quad\b/g, '  ');
  s = s.replace(/(^|[^\\])\\[,;! ]/g, '$1 ');

  // 4. Delimiters: left/right/big. Bare (backslash-less) forms are only
  // treated as LaTeX when glued to a delimiter, so the English words
  // "left", "right", "big" stay intact.
  s = s.replace(/\\(?:big|Big|bigg|Bigg)[lr]?(?![A-Za-z])/g, '');
  s = s.replace(/\b(?:big|Big|bigg|Bigg)[lr](?=[()[\]|]|\\[{}])/g, '');
  const delimiterFor = d => (d === '.' ? '' : d.replace(/^\\/, ''));
  s = s.replace(
    /\\(?:left|right)(?![A-Za-z])\s*(\\[{}]|[()[\]{}|.])?/g,
    (_, d) => (d ? delimiterFor(d) : '')
  );
  if (
    /(?:^|[^A-Za-z])left(?:[([|]|\\\{)/.test(s) &&
    /right(?:[)\]|]|\\\})/.test(s)
  ) {
    s = s.replace(/(?:^|\b)left(\\\{|[([|])/g, (_, d) => delimiterFor(d));
    s = s.replace(/right(\\\}|[)\]|])/g, (_, d) => delimiterFor(d));
  }

  // 5. Font and style macros (with or without backslash)
  const unwrapFont = (full, ch, offset, source) =>
    afterCommand(ch, offset, source);
  s = s.replace(
    /\\(?:text|mathrm|mathbf|bm|boldsymbol)(?![A-Za-z])\s*\{([^}]*)\}/g,
    unwrapFont
  );
  s = s.replace(
    /\b(?:text|mathrm|mathbf|bm|boldsymbol)\s*\{([^}]*)\}/g,
    unwrapFont
  );
  s = s.replace(
    /\\(?:mathbf|mathrm|boldsymbol|bm)\s+([A-Za-z0-9])/g,
    unwrapFont
  );
  s = s.replace(/\b(?:mathbf|mathrm)\s+([A-Za-z0-9])/g, unwrapFont);
  s = s.replace(/\btext(out|avg|eq|cor|cen|rel|fr|net|neigh|min|max)\b/g, '$1');

  // 6. Vector, hat, dot accents. Bare forms need braces so "that the" or
  // "a dot on" are not read as \hat t / \dot o.
  const accent = (full, kind, inner, offset, source) =>
    afterCommand(applyAccent(kind, inner), offset, source);
  s = s.replace(/(?:\\|\b)(vec|hat|dddot|ddot|dot)\s*\{([^}\\]+)\}/g, accent);
  s = s.replace(/\\(vec|hat|dddot|ddot|dot)\s+([A-Za-z0-9])/g, accent);

  // 7. Derivatives: partial, mathrm d
  s = s.replace(
    /\\mathrm\s*d\s*([A-Za-z])/g,
    keepApart((_, v) => `d${v}`)
  );
  s = s.replace(/\bmathrm\s*d\s*([A-Za-z])/g, 'd$1');
  s = s.replace(/\\partial(?![A-Za-z])/g, '∂');

  // 8. Protect English words containing 'frac' (fraction, refractive, fracture)
  const english = [];
  s = s.replace(/\b[A-Za-z]*fract[A-Za-z]*\b/gi, m => {
    english.push(m);
    return `__ENG_FRAC_${english.length - 1}__`;
  });

  // Known differential fractions
  s = s.replace(/\\?[td]?frac\s*dy\s*dx\b/gi, 'dy/dx');
  s = s.replace(/\\?[td]?frac\s*dv\s*dx\b/gi, 'dv/dx');
  s = s.replace(/\\?[td]?frac\s*di\s*dt\b/gi, 'di/dt');
  s = s.replace(/\\?[td]?frac\s*dv\s*dt\b/gi, 'dv/dt');
  s = s.replace(/\\?[td]?frac\s*dx\s*x\b/gi, 'dx/x');
  s = s.replace(/\\?[td]?frac\s*dh\s*sqrt\(?2gh\)?/gi, 'dh/sqrt(2gh)');

  // Multiple passes for standard and nested fractions
  for (let p = 0; p < 6; p++) {
    // frac{A}{B}
    s = s.replace(
      /\\?[td]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
      keepApart((_, a, b) => {
        const num = a.replace(/\s+/g, ' ').trim();
        const den = b.replace(/\s+/g, ' ').trim();
        return `${wrapIfNeeded(num)}/${wrapIfNeeded(den)}`;
      })
    );

    // frac{A} followed by sqrt(...)
    s = s.replace(
      /\\?[td]?frac\s*\{([^{}]*)\}\s*sqrt\(?([0-9A-Za-z]+)\)?/g,
      keepApart((_, a, b) => `${wrapIfNeeded(a.trim())}/sqrt(${b})`)
    );

    // frac 1 sqrt2 or frac 1 {sqrt(2)}
    s = s.replace(
      /(?<![\\A-Za-z])[td]?frac\s*([0-9A-Za-z])\s*sqrt\(?([0-9A-Za-z]+)\)?/g,
      (_, a, b) => {
        return `${a}/sqrt(${b})`;
      }
    );

    // frac{A} B
    s = s.replace(
      /\\?[td]?frac\s*\{([^{}]*)\}\s*([A-Za-z0-9])/g,
      keepApart((_, a, b) => {
        const num = a.replace(/\s+/g, ' ').trim();
        return `${wrapIfNeeded(num)}/${b}`;
      })
    );

    // frac A {B}
    s = s.replace(
      /(?<![\\A-Za-z])[td]?frac\s*([A-Za-z0-9])\s*\{([^{}]*)\}/g,
      (_, a, b) => {
        const den = b.replace(/\s+/g, ' ').trim();
        return `${a}/${wrapIfNeeded(den)}`;
      }
    );

    // dfrac2C{R^3} -> 2C/R^3
    s = s.replace(
      /(?<![\\A-Za-z])[td]?frac\s*([0-9]+[A-Za-z]?)\s*\{([^{}]*)\}/g,
      (_, a, b) => {
        return `${wrapIfNeeded(a)}/${wrapIfNeeded(b.trim())}`;
      }
    );

    // frac 1-2v{v(v-1)} -> (1-2v)/(v(v-1))
    s = s.replace(
      /(?<![\\A-Za-z])[td]?frac\s*([+-]?[0-9A-Za-z-]+)\s*\{([^{}]*)\}/g,
      (_, a, b) => {
        return `${wrapIfNeeded(a)}/${wrapIfNeeded(b.trim())}`;
      }
    );

    // frac 125 -> 12/5
    s = s.replace(/(?<![\\A-Za-z])[td]?frac\s*125([A-Za-z]?)\b/g, '12/5$1');
    s = s.replace(/(?<![\\A-Za-z])[td]?frac\s*10546\b/g, '10/546');
    s = s.replace(/(?<![\\A-Za-z])[td]?frac\s*5273\b/g, '5/273');
    s = s.replace(/(?<![\\A-Za-z])[td]?frac\s*1551092\b/g, '155/1092');
    s = s.replace(/(?<![\\A-Za-z])[td]?frac\s*70156\b/g, '70/156');
    s = s.replace(/(?<![\\A-Za-z])[td]?frac\s*512\b/g, '5/12');

    // frac([+-]?[A-Za-z0-9])([0-9]{2})\b
    s = s.replace(
      /(?<![\\A-Za-z])[td]?frac\s*([+-]?[A-Za-z0-9])\s*([0-9]{2})\b/g,
      '$1/$2'
    );

    // frac([+-]?[0-9]+)\s*([0-9]{2})\b
    s = s.replace(
      /(?<![\\A-Za-z])[td]?frac\s*([+-]?[0-9]+)\s*([0-9]{2})\b/g,
      '$1/$2'
    );

    // frac([0-9A-Za-z]{2,3})([A-Za-z])\b
    s = s.replace(
      /(?<![\\A-Za-z])[td]?frac\s*([0-9A-Za-z]{2,3})([A-Za-z])\b/g,
      '($1)/$2'
    );

    // frac([A-Za-z0-9])([A-Za-z0-9])
    s = s.replace(
      /(?<![\\A-Za-z])[td]?frac\s*([A-Za-z0-9])([A-Za-z0-9])\b/g,
      '$1/$2'
    );
  }

  // Restore English words
  s = s.replace(/__ENG_FRAC_(\d+)__/g, (_, idx) => english[Number(idx)]);

  // 9. Symbols & operators
  s = s.replace(/\\varepsilon(?![A-Za-z])/g, 'ε');
  s = s.replace(/\\propto(?![A-Za-z])|\bpropto\b/g, '∝');
  s = s.replace(/\\times(?![A-Za-z])/g, '×');
  s = s.replace(/\\cdot(?![A-Za-z])/g, '·');
  s = s.replace(/\\pm(?![A-Za-z])/g, '±');
  s = s.replace(/\\mp(?![A-Za-z])/g, '∓');
  // Bare le/ge must be whole words before a number or single-letter variable,
  // so "length", "level", "gene", "le Chatelier" are left alone.
  const bareRelationTail = String.raw`(?=\s*(?:[0-9(+-]|[A-Za-z](?![A-Za-z])))`;
  s = s.replace(
    new RegExp(
      String.raw`\\leqslant(?![A-Za-z])|\\leq?(?![A-Za-z])|\bleq?\b${bareRelationTail}`,
      'g'
    ),
    '≤'
  );
  s = s.replace(
    new RegExp(
      String.raw`\\geqslant(?![A-Za-z])|\\geq?(?![A-Za-z])|\bgeq?\b${bareRelationTail}`,
      'g'
    ),
    '≥'
  );
  s = s.replace(/\\neq?(?![A-Za-z])/g, '≠');
  s = s.replace(/\\rightleftharpoons(?![A-Za-z])/g, '⇌');
  s = s.replace(
    /\\(?:rightarrow|to|longrightarrow)(?![A-Za-z])|\b(?:rightarrow|longrightarrow)\b/g,
    '→'
  );
  s = s.replace(
    /\\(?:Rightarrow|Longrightarrow|implies)(?![A-Za-z])|\b(?:Rightarrow|Longrightarrow)\b/g,
    '⇒'
  );
  s = s.replace(
    /\\(?:leftarrow|longleftarrow)(?![A-Za-z])|\b(?:leftarrow|longleftarrow)\b/g,
    '←'
  );
  s = s.replace(
    /\\(?:Leftarrow|Longleftarrow)(?![A-Za-z])|\b(?:Leftarrow|Longleftarrow)\b/g,
    '⇐'
  );
  s = s.replace(/\\leftrightarrow(?![A-Za-z])|\bleftrightarrow\b/g, '↔');
  s = s.replace(
    /\\(?:Leftrightarrow|Longleftrightarrow|iff)(?![A-Za-z])|\b(?:Leftrightarrow|Longleftrightarrow)\b/g,
    '⇔'
  );
  s = s.replace(/\\approx(?![A-Za-z])/g, '≈');
  s = s.replace(/\\equiv(?![A-Za-z])|\bequiv\b/g, '≡');
  s = s.replace(/\^\s*\{?\s*\\circ\s*\}?|\\circ\b|\\degree\b/g, '°');

  // 10. Clean leading backslashes from numbers like \10K -> 10K. Other
  // backslash commands are left for convertLatexCommands.
  s = s.replace(/\\([0-9])/g, '$1');

  return s;
};

/**
 * Intelligent line unwrapping: merges lines that were inadvertently broken
 * across mathematical tokens or incomplete sentences, while preserving
 * numbered steps, option lists, and explicit headers.
 */
export const unwrapSoftLineBreaks = text => {
  if (text == null) return '';
  const rawLines = String(text)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  if (rawLines.length <= 1) return String(text);

  const merged = [];
  for (let i = 0; i < rawLines.length; i++) {
    const cur = rawLines[i];
    if (merged.length === 0) {
      merged.push(cur);
      continue;
    }
    const prev = merged[merged.length - 1];

    const isStepHeader =
      /^(\d+\.|Step|Option|Case|Part|Therefore|Hence|Note|Verification|Data|Results|Summary|\([A-Za-z0-9ivx]+\))/i.test(
        cur
      );
    const prevEndsWithOp =
      /[=+\-*/,(:<>[\]]$/.test(prev) ||
      /\b(along|where|gives|with|and|or|so|to|of|is|in|at|for|from|as|iff)$/i.test(
        prev
      );
    const curStartsWithOp =
      /^[=+\-*/,:;)<>[\]]/.test(cur) ||
      /^(hat|vec|dot|ddot|cos|sin|tan|rho|theta|lambda|mu|epsilon|int|sum|prop|exp|ln|log)\b/.test(
        cur
      );
    const isShortContinuation =
      !isStepHeader &&
      (prevEndsWithOp ||
        curStartsWithOp ||
        (cur.length < 28 && !/^[A-Z0-9]/.test(cur)));

    if (
      !isStepHeader &&
      (prevEndsWithOp || curStartsWithOp || isShortContinuation)
    ) {
      merged[merged.length - 1] = `${prev} ${cur}`;
    } else {
      merged.push(cur);
    }
  }

  return merged.join('\n');
};

const convertLatexCommands = input => {
  let s = String(input || '');
  let guard = 0;

  while (guard < 60) {
    guard += 1;
    let changed = false;

    // Lists: itemize / enumerate → bullet lines
    {
      const listRe = /\\begin\{(itemize|enumerate)\}([\s\S]*?)\\end\{\1\}/g;
      if (listRe.test(s)) {
        s = s.replace(listRe, (_, kind, body) => {
          const items = String(body || '')
            .split(/\\item(?![A-Za-z])/)
            .map(item => item.trim())
            .filter(Boolean);
          return `\n${items
            .map(
              (item, i) => `${kind === 'enumerate' ? `${i + 1}.` : '•'} ${item}`
            )
            .join('\n')}\n`;
        });
        changed = true;
        continue;
      }
    }

    // Multiline math environments: aligned, cases, gathered, matrix, array
    {
      const envRe =
        /\\begin\{(aligned|align\*?|array|matrix|bmatrix|Bmatrix|pmatrix|vmatrix|Vmatrix|gathered|cases)\}((?:(?!\\begin\{)[\s\S])*?)\\end\{\1\}/g;
      const MATRIX_WRAP = {
        matrix: ['[', ']'],
        bmatrix: ['[', ']'],
        Bmatrix: ['{', '}'],
        pmatrix: ['(', ')'],
        vmatrix: ['|', '|'],
        Vmatrix: ['||', '||'],
      };
      if (envRe.test(s)) {
        s = s.replace(envRe, (_, kind, body) => {
          const matrixWrap = MATRIX_WRAP[kind];
          const source =
            kind === 'array'
              ? String(body || '').replace(/^\s*\{[lcr|\s]*\}/, '')
              : String(body || '');
          const rows = source
            .split(/\\\\(?:\s*\[[^\]]*\])?/)
            .map(row => {
              const cells = row
                .split('&')
                .map(cell =>
                  convertLatexCommands(cell).replace(/\s+/g, ' ').trim()
                );
              return cells.filter(Boolean).join(matrixWrap ? ' ' : '   ');
            })
            .filter(r => r.trim());
          if (matrixWrap) {
            return `${matrixWrap[0]}${rows.join('; ')}${matrixWrap[1]}`;
          }
          return `\n${rows
            .map((row, i) =>
              i < rows.length - 1 && !/[.,;:]$/.test(row) ? `${row};` : row
            )
            .join('\n')}\n`;
        });
        changed = true;
        continue;
      }
    }

    // Drop line skip annotations: \\[4pt], \\[6pt]
    {
      const next = s.replace(
        /\\\\(?:\s*\[\s*[\d.]+\s*(?:pt|em|ex|mm)?\s*\])?/g,
        '\n'
      );
      if (next !== s) {
        s = next;
        changed = true;
        continue;
      }
    }

    // \boxed{...} → [ ... ]
    {
      const pass = applyCommandPass(s, /\\boxed\s*/g, (match, source) => {
        const arg = takeLatexArg(source, match.index + match[0].length);
        if (!arg) return null;
        const inner = convertLatexCommands(arg.inner).trim();
        return { text: `[${inner}]`, end: arg.end };
      });
      if (pass.changed) {
        s = pass.text;
        changed = true;
        continue;
      }
    }

    // \tag{1} / \tag1 → (1)
    {
      const pass = applyCommandPass(s, /\\tag\s*/g, (match, source) => {
        const arg = takeLatexArg(source, match.index + match[0].length);
        if (!arg) return null;
        const inner = convertLatexCommands(arg.inner).trim();
        return { text: `(${inner})`, end: arg.end };
      });
      if (pass.changed) {
        s = pass.text;
        changed = true;
        continue;
      }
    }

    // Vectors & Accents: \vec{v}, \vec v, \hat{k}, \hat k, \dot{x}, \ddot{x}, \bar{x}, \tilde{x}
    {
      const pass = applyCommandPass(
        s,
        /\\(vec|hat|bar|tilde|dot|ddot|dddot|overline|overrightarrow|widehat|widetilde)(?![A-Za-z])\s*/g,
        (match, source) => {
          const kind = ACCENT_ALIAS[match[1]] || match[1];
          const arg = takeLatexArg(source, match.index + match[0].length);
          if (!arg) return null;
          const inner = convertLatexCommands(arg.inner).trim();
          return {
            text: applyAccent(kind, inner),
            end: arg.end,
          };
        }
      );
      if (pass.changed) {
        s = pass.text;
        changed = true;
        continue;
      }
    }

    // Font styles & bold: \text, \mathrm, \mathbf, \bm, \boldsymbol
    {
      const pass = applyCommandPass(
        s,
        /\\(?:textrm|textbf|textit|textsf|texttt|text|mathrm|mathbf|mathit|mathsf|mathcal|bm|boldsymbol|emph)(?![A-Za-z])\s*/g,
        (match, source) => {
          const arg = takeLatexArg(source, match.index + match[0].length);
          if (!arg) return null;
          return {
            text: convertLatexCommands(arg.inner),
            end: arg.end,
          };
        }
      );
      if (pass.changed) {
        s = pass.text;
        changed = true;
        continue;
      }
    }

    // Drop sizing / style wrappers: \displaystyle \bigl \left ...
    {
      const before = s;
      s = s
        .replace(
          /\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle)\b\s*/g,
          ''
        )
        .replace(
          /\\(?:big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|biggl|biggr|Biggl|Biggr)\b\s*/g,
          ''
        )
        .replace(/\\left(?![A-Za-z])\s*\\?\{?/g, '')
        .replace(/\\right(?![A-Za-z])\s*\\?\./g, '')
        .replace(/\\left(?![A-Za-z])\s*/g, '')
        .replace(/\\right(?![A-Za-z])\s*/g, '')
        .replace(/\\(?:rm|bf|it|sf|tt|cal)(?![A-Za-z])\s*/g, '')
        .replace(/\\(?:!|,|;|:|quad|qquad)\b/g, ' ')
        .replace(/\\,/g, ' ')
        .replace(/\\;/g, ' ')
        .replace(/\\!/g, '');
      if (s !== before) {
        changed = true;
        continue;
      }
    }

    // \mathbb{R}, \mathbb{N}, ...
    {
      const pass = applyCommandPass(s, /\\mathbb\s*/g, (match, source) => {
        const arg = takeLatexArg(source, match.index + match[0].length);
        if (!arg) return null;
        const letter = String(arg.inner || '').trim();
        return {
          text: BLACKBOARD[letter] || letter,
          end: arg.end,
        };
      });
      if (pass.changed) {
        s = pass.text;
        changed = true;
        continue;
      }
    }

    // \frac / \dfrac / \tfrac with multiline flattening
    {
      const pass = applyCommandPass(s, /\\[td]?frac\s*/g, (match, source) => {
        const num = takeLatexArg(source, match.index + match[0].length);
        if (!num) return null;
        const den = takeLatexArg(source, num.end);
        if (!den) return null;
        const numClean = convertLatexCommands(num.inner)
          .replace(/\s+/g, ' ')
          .trim();
        const denClean = convertLatexCommands(den.inner)
          .replace(/\s+/g, ' ')
          .trim();
        return {
          text: `${wrapIfNeeded(numClean)}/${wrapIfNeeded(denClean)}`,
          end: den.end,
        };
      });
      if (pass.changed) {
        s = pass.text;
        changed = true;
        continue;
      }
    }

    // Two-argument / labelled commands: \binom, \overset, \stackrel,
    // \underbrace{..}_{label}, \ce{..}, \pmod{..}, \operatorname{..}
    {
      const pass = applyCommandPass(
        s,
        /\\(d?binom|tbinom|overset|underset|stackrel|underbrace|overbrace|ce|pmod|operatorname|underline|mathring|substack)(?![A-Za-z])\s*/g,
        (match, source) => {
          const kind = match[1];
          const first = takeLatexArg(source, match.index + match[0].length);
          if (!first) return null;
          const a = convertLatexCommands(first.inner).trim();
          if (
            /binom$/.test(kind) ||
            ['overset', 'underset', 'stackrel'].includes(kind)
          ) {
            const second = takeLatexArg(source, first.end);
            if (!second) return null;
            const b = convertLatexCommands(second.inner).trim();
            const text = /binom$/.test(kind) ? `C(${a},${b})` : `${b}(${a})`;
            return { text, end: second.end };
          }
          if (kind === 'underbrace' || kind === 'overbrace') {
            const label = takeOptionalScript(
              source,
              first.end,
              kind === 'underbrace' ? '_' : '^'
            );
            const labelText =
              label.value != null
                ? convertLatexCommands(label.value).trim()
                : '';
            return {
              text: labelText ? `${a} (${labelText})` : a,
              end: label.end,
            };
          }
          if (kind === 'ce')
            return { text: formatChem(first.inner), end: first.end };
          if (kind === 'pmod') return { text: ` (mod ${a})`, end: first.end };
          return { text: a, end: first.end };
        }
      );
      if (pass.changed) {
        s = pass.text;
        changed = true;
        continue;
      }
    }

    // \xrightarrow{k} / \xleftarrow{k} → →(k) / ←(k)
    {
      const pass = applyCommandPass(
        s,
        /\\x(right|left)arrow\s*(?:\[[^\]]*\])?\s*/g,
        (match, source) => {
          const arrow = match[1] === 'right' ? '→' : '←';
          const arg = takeLatexArg(source, match.index + match[0].length);
          if (!arg) return { text: arrow, end: match.index + match[0].length };
          const label = convertLatexCommands(arg.inner).trim();
          return { text: label ? `${arrow}(${label})` : arrow, end: arg.end };
        }
      );
      if (pass.changed) {
        s = pass.text;
        changed = true;
        continue;
      }
    }

    // \sqrt
    {
      const pass = applyCommandPass(s, /\\sqrt\s*/g, (match, source) => {
        const arg = takeLatexArg(source, match.index + match[0].length);
        if (!arg) return null;
        const inner = convertLatexCommands(arg.inner);
        return {
          text: needsParens(inner) ? `sqrt(${inner})` : `sqrt(${inner})`,
          end: arg.end,
        };
      });
      if (pass.changed) {
        s = pass.text;
        changed = true;
        continue;
      }
    }

    // Operators with scripts: \lim_{}, \sum_{}^{}, \int_{}^{}
    {
      const pass = applyCommandPass(
        s,
        /\\(lim|sum|prod|int)(?![A-Za-z])\s*/g,
        (match, source) => {
          const kind = match[1];
          let pos = match.index + match[0].length;
          const sub = takeOptionalScript(source, pos, '_');
          pos = sub.end;
          const sup = takeOptionalScript(source, pos, '^');
          pos = sup.end;
          const lo =
            sub.value != null ? convertLatexCommands(sub.value).trim() : '';
          const hi =
            sup.value != null ? convertLatexCommands(sup.value).trim() : '';

          let text;
          if (kind === 'lim') {
            text = lo ? `lim (${lo})` : 'lim';
          } else if (kind === 'sum') {
            text = lo && hi ? `Σ (${lo} → ${hi})` : lo ? `Σ (${lo})` : 'Σ';
          } else if (kind === 'prod') {
            text = lo && hi ? `Π (${lo} → ${hi})` : lo ? `Π (${lo})` : 'Π';
          } else {
            text =
              lo && hi ? `∫ from ${lo} to ${hi}` : lo ? `∫ from ${lo}` : '∫';
          }
          return { text, end: pos };
        }
      );
      if (pass.changed) {
        s = pass.text;
        changed = true;
        continue;
      }
    }

    // Simple math functions: \ln \sin \cos \gcd ...
    {
      const next = s.replace(
        /\\(ln|log|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|gcd|lcm|max|min|det|dim|ker|exp)\b/g,
        (full, name, offset, source) => {
          const mapped = MATH_FN[name] || name;
          changed = true;
          return /[A-Za-z0-9]/.test(source[offset - 1] || '')
            ? ` ${mapped}`
            : mapped;
        }
      );
      const spaced = next.replace(
        /\b(sin|cos|tan|cot|sec|csc|ln|log|exp)([θφαβγδμπσωΑ-Ω])/g,
        '$1 $2'
      );
      if (spaced !== s) changed = true;
      s = spaced;
    }

    // Symbols / relations
    {
      const before = s;
      s = s
        .replace(/\\infty(?![A-Za-z])/g, '∞')
        .replace(/\\partial(?![A-Za-z])/g, '∂')
        .replace(/\\nabla(?![A-Za-z])/g, '∇')
        .replace(/\\emptyset(?![A-Za-z])|\\varnothing(?![A-Za-z])/g, '∅')
        .replace(/\\in(?![A-Za-z])/g, '∈')
        .replace(/\\notin(?![A-Za-z])/g, '∉')
        .replace(/\\subset(?![A-Za-z])/g, '⊂')
        .replace(/\\subseteq(?![A-Za-z])/g, '⊆')
        .replace(/\\supset(?![A-Za-z])/g, '⊃')
        .replace(/\\supseteq(?![A-Za-z])/g, '⊇')
        .replace(/\\cup(?![A-Za-z])/g, '∪')
        .replace(/\\cap(?![A-Za-z])/g, '∩')
        .replace(/\\setminus(?![A-Za-z])/g, ' ∖ ')
        .replace(/\\forall(?![A-Za-z])/g, '∀')
        .replace(/\\exists(?![A-Za-z])/g, '∃')
        .replace(/\\neg(?![A-Za-z])|\\lnot(?![A-Za-z])/g, '¬')
        .replace(/\\land(?![A-Za-z])|\\wedge(?![A-Za-z])/g, '∧')
        .replace(/\\lor(?![A-Za-z])|\\vee(?![A-Za-z])/g, '∨')
        .replace(
          /\\rightleftharpoons(?![A-Za-z])|\\leftrightharpoons(?![A-Za-z])|\\leftrightarrow(?![A-Za-z])/g,
          '⇌'
        )
        .replace(/\blefthpoons\b/g, '⇌')
        .replace(
          /\\rightarrow(?![A-Za-z])|\\to(?![A-Za-z])|\\longrightarrow(?![A-Za-z])|\\Rightarrow(?![A-Za-z])|\\implies(?![A-Za-z])|\\Longrightarrow(?![A-Za-z])/g,
          '→'
        )
        .replace(
          /\\leftarrow(?![A-Za-z])|\\Leftarrow(?![A-Za-z])|\\Longleftarrow(?![A-Za-z])/g,
          '←'
        )
        .replace(
          /\\Leftrightarrow(?![A-Za-z])|\\iff(?![A-Za-z])|\\Longleftrightarrow(?![A-Za-z])/g,
          '⇔'
        )
        .replace(
          /\\(?:hline|cline\{[^}]*\}|middle|limits|nolimits|displaystyle|centering|noindent)(?![A-Za-z])/g,
          ''
        )
        .replace(/\{,\}/g, ',')
        .replace(/\{([+\-−=])\}/g, '$1')
        .replace(/\\\*/g, '*')
        .replace(/\\bmod(?![A-Za-z])/g, ' mod ')
        .replace(/\\imath(?![A-Za-z])/g, 'i')
        .replace(/\\jmath(?![A-Za-z])/g, 'j')
        .replace(/\\bigcirc(?![A-Za-z])/g, '○')
        .replace(/\\not\s*=|\\not\s*\\equiv/g, '≠')
        .replace(/\\not\s*\\in(?![A-Za-z])/g, '∉')
        .replace(/\\gtrsim(?![A-Za-z])/g, '≳')
        .replace(/\\lesssim(?![A-Za-z])/g, '≲')
        .replace(/\\ll(?![A-Za-z])/g, '≪')
        .replace(/\\gg(?![A-Za-z])/g, '≫')
        .replace(/\\iiint(?![A-Za-z])/g, '∭')
        .replace(/\\iint(?![A-Za-z])/g, '∬')
        .replace(/\\oint(?![A-Za-z])/g, '∮')
        .replace(/\\(?:long)?mapsto(?![A-Za-z])/g, '↦')
        .replace(/\\uparrow(?![A-Za-z])/g, '↑')
        .replace(/\\downarrow(?![A-Za-z])/g, '↓')
        .replace(
          /\\(?:longleftrightarrow|leftrightarrows|rightleftarrows)(?![A-Za-z])/g,
          '⇌'
        )
        .replace(/\\div(?![A-Za-z])/g, '÷')
        .replace(/\\(?:ast|star)(?![A-Za-z])/g, '*')
        .replace(/\\bullet(?![A-Za-z])/g, '•')
        .replace(/\\therefore(?![A-Za-z])/g, '∴')
        .replace(/\\because(?![A-Za-z])/g, '∵')
        .replace(/\\prime(?![A-Za-z])/g, '′')
        .replace(/\\triangle(?![A-Za-z])/g, '△')
        .replace(/\\square(?![A-Za-z])/g, '□')
        .replace(/\\checkmark(?![A-Za-z])/g, '✓')
        .replace(/\\cong(?![A-Za-z])/g, '≅')
        .replace(/\\simeq(?![A-Za-z])/g, '≃')
        .replace(/\\lceil(?![A-Za-z])/g, '⌈')
        .replace(/\\rceil(?![A-Za-z])/g, '⌉')
        .replace(/\\lfloor(?![A-Za-z])/g, '⌊')
        .replace(/\\rfloor(?![A-Za-z])/g, '⌋')
        .replace(/\\(?:lvert|rvert|vert)(?![A-Za-z])/g, '|')
        .replace(/\\(?:lVert|rVert|Vert)(?![A-Za-z])/g, '‖')
        .replace(/\\lbrace(?![A-Za-z])/g, '{')
        .replace(/\\rbrace(?![A-Za-z])/g, '}')
        .replace(/\\mid(?![A-Za-z])/g, '|')
        .replace(/\\parallel(?![A-Za-z])/g, '∥')
        .replace(/\\perp(?![A-Za-z])/g, '⊥')
        .replace(/\\angle(?![A-Za-z])/g, '∠')
        .replace(/\\(?:cdots|ldots|dots)(?![A-Za-z])/g, '…')
        .replace(/\\langle(?![A-Za-z])/g, '⟨')
        .replace(/\\rangle(?![A-Za-z])/g, '⟩')
        .replace(/\\hbar(?![A-Za-z])/g, 'ℏ')
        .replace(/\\ell(?![A-Za-z])/g, 'ℓ')
        .replace(/\\AA(?![A-Za-z])/g, 'Å')
        .replace(/\\cdot(?![A-Za-z])/g, '·')
        .replace(/\\times(?![A-Za-z])/g, '×')
        .replace(/\\pm(?![A-Za-z])/g, '±')
        .replace(/\\mp(?![A-Za-z])/g, '∓')
        .replace(/\\leq(?![A-Za-z])|\\le(?![A-Za-z])/g, '≤')
        .replace(/\\geq(?![A-Za-z])|\\ge(?![A-Za-z])/g, '≥')
        .replace(/\\neq(?![A-Za-z])|\\ne(?![A-Za-z])/g, '≠')
        .replace(/\\approx(?![A-Za-z])/g, '≈')
        .replace(/\\equiv(?![A-Za-z])/g, '≡')
        .replace(/\\propto(?![A-Za-z])/g, '∝')
        .replace(/\\sim(?![A-Za-z])/g, '~')
        .replace(/\\circ(?![A-Za-z])|\\degree(?![A-Za-z])/g, '°')
        .replace(/\\quad(?![A-Za-z])|\\qquad(?![A-Za-z])/g, ' ')
        .replace(/\\,/g, ' ')
        .replace(/\\;/g, ' ')
        .replace(/\\!/g, '')
        .replace(/\\ /g, ' ')
        .replace(/\\left(?![A-Za-z])\s*/g, '')
        .replace(/\\right(?![A-Za-z])\s*/g, '')
        .replace(/\\\{/g, '{')
        .replace(/\\\}/g, '}');
      if (s !== before) changed = true;
    }

    // Greek letters with backslash (run before subscripts)
    {
      const next = s.replace(/\\([A-Za-z]+)/g, (full, name) => {
        if (GREEK[name]) {
          changed = true;
          return GREEK[name];
        }
        return full;
      });
      if (next !== s) {
        s = next;
        continue;
      }
    }

    // Bare greek_sub before generic subscript pass (beta_2 → β₂, \mu_0 -> μ₀)
    {
      const next = s.replace(
        /\\?\b(alpha|beta|gamma|delta|theta|mu|pi|sigma|phi|omega)_(\{?[A-Za-z0-9]+\}?)\b/gi,
        (full, name, sub) => {
          const greek = GREEK[name] || GREEK[name.toLowerCase()];
          if (!greek) return full;
          changed = true;
          return `${greek}${toSubscript(String(sub).replace(/[{}]/g, ''))}`;
        }
      );
      s = next;
    }

    // Subscripts / superscripts: x_{i+1}, K_{sp}, e^{-x^2}, x^2, H_2O
    {
      const pass = applyCommandPass(s, /[_^]/g, (match, source) => {
        const marker = match[0];
        const at = match.index + 1;
        if (source[at] === '{') {
          const group = takeBraceGroup(source, at);
          if (!group) return null;
          const inner = convertLatexCommands(group.inner)
            .replace(/\s+/g, ' ')
            .trim();
          return { text: formatScript(marker, inner), end: group.end };
        }
        if (source[at] === '\\') {
          const arg = takeLatexArg(source, at);
          if (!arg) return null;
          const inner = convertLatexCommands(arg.inner).trim();
          if (!inner || inner.startsWith('\\')) return null;
          return { text: formatScript(marker, inner), end: arg.end };
        }
        const ch = source[at];
        if (!ch || !isScriptable(marker, ch)) return null;
        return { text: formatScript(marker, ch), end: at + 1 };
      });
      if (pass.changed) {
        s = pass.text;
        changed = true;
      }
    }

    if (!changed) break;
  }

  return repairScientificNotation(s);
};

const cleanPlainNoise = s =>
  unwrapMathSpans(s)
    .replace(/\\\(([\s\S]*?)\\\)/g, '$1')
    .replace(/\\\[([\s\S]*?)\\\]/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(
      /\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle)\b\s*/g,
      ''
    )
    .replace(
      /\\(?:big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|biggl|biggr|Biggl|Biggr)\b\s*/g,
      ''
    )
    .replace(/\\left(?![A-Za-z])\s*/g, '')
    .replace(/\\right(?![A-Za-z])\s*/g, '')
    .replace(/\\tag\s*\{([^{}]*)\}/g, '($1)')
    .replace(/\\tag\s*([0-9A-Za-z]+)/g, '($1)')
    .replace(/\\boxed\s*\{([^{}]*)\}/g, '[$1]')
    .replace(/~/g, ' ')
    .replace(/\\times\b/g, '×')
    .replace(/\\cdot\b/g, '·')
    .replace(/\\pm\b/g, '±')
    .replace(/\\mp\b/g, '∓')
    .replace(/\\leq(?![A-Za-z])|\\le(?![A-Za-z])/g, '≤')
    .replace(/\\geq(?![A-Za-z])|\\ge(?![A-Za-z])/g, '≥')
    .replace(/\\neq(?![A-Za-z])|\\ne(?![A-Za-z])/g, '≠')
    .replace(/\\approx(?![A-Za-z])/g, '≈')
    .replace(/\\infty(?![A-Za-z])/g, '∞')
    .replace(/\\to(?![A-Za-z])|\\rightarrow(?![A-Za-z])/g, '→')
    .replace(/\\degree(?![A-Za-z])|\\circ(?![A-Za-z])/g, '°')
    .replace(/\^\s*°/g, '°')
    .replace(/\\?\[\s*[\d.]+\s*(?:pt|em|ex|mm)?\s*\]/g, '')
    .replace(/\\%/g, '%')
    .replace(/\\&/g, '&')
    .replace(/\\_/g, '_')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    // leftover unknown latex commands → readable name
    .replace(/\\([A-Za-z]+)/g, '$1')
    .replace(/\\/g, '')
    // unbalanced math delimiters left by malformed AI text ($ before a digit is currency)
    .replace(/\$(?!\s?\d)/g, '')
    // drop grouping braces; keep set braces such as {1, 2} or {x : x > 0}
    .replace(/\{([^{}]*)\}/g, (full, inner) => {
      const t = String(inner || '').trim();
      if (!t) return '';
      return /[,|:;∈]/.test(t) ? `{${t}}` : t;
    })
    .replace(/\{([^{}]*)\}/g, (full, inner) => {
      const t = String(inner || '').trim();
      return /[,|:;∈]/.test(t) ? `{${t}}` : t;
    })
    .replace(/(\d)\s*[xX]\s*10([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+)/g, '$1 × 10$2')
    .replace(
      /(\d)\s*[xX]\s*10\^([+-]?\d+)/g,
      (_, a, b) => `${a} × 10${toSuperscript(b)}`
    )
    .replace(/(?<![A-Za-z]\d*|[_^]\(\d*)(\d)(mol|mL|cm|kg|L|M|g)\b/g, '$1 $2')
    .replace(/[─-]{8,}/g, '\n----\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\./g, '.')
    .trim();

export const toAsciiMath = s =>
  String(s || '')
    // Greek Lowercase
    .replace(/θ|\\theta\b/g, 'theta')
    .replace(/α|\\alpha\b/g, 'alpha')
    .replace(/β|\\beta\b/g, 'beta')
    .replace(/γ|\\gamma\b/g, 'gamma')
    .replace(/δ|\\delta\b/g, 'delta')
    .replace(/ε|\\epsilon\b|\\varepsilon\b/g, 'epsilon')
    .replace(/ζ|\\zeta\b/g, 'zeta')
    .replace(/η|\\eta\b/g, 'eta')
    .replace(/ι|\\iota\b/g, 'iota')
    .replace(/κ|\\kappa\b/g, 'kappa')
    .replace(/λ|\\lambda\b/g, 'lambda')
    .replace(/μ|\\mu\b/g, 'mu')
    .replace(/ν|\\nu\b/g, 'nu')
    .replace(/ξ|\\xi\b/g, 'xi')
    .replace(/π|\\pi\b/g, 'pi')
    .replace(/ρ|\\rho\b|\\varrho\b/g, 'rho')
    .replace(/σ|\\sigma\b/g, 'sigma')
    .replace(/τ|\\tau\b/g, 'tau')
    .replace(/υ|\\upsilon\b/g, 'upsilon')
    .replace(/φ|\\phi\b|\\varphi\b/g, 'phi')
    .replace(/χ|\\chi\b/g, 'chi')
    .replace(/ψ|\\psi\b/g, 'psi')
    .replace(/ω|\\omega\b/g, 'omega')
    // Greek Uppercase
    .replace(/Γ|\\Gamma\b/g, 'Gamma')
    .replace(/Δ|\\Delta\b/g, 'Delta')
    .replace(/Θ|\\Theta\b/g, 'Theta')
    .replace(/Λ|\\Lambda\b/g, 'Lambda')
    .replace(/Ξ|\\Xi\b/g, 'Xi')
    .replace(/Π|\\Pi\b/g, 'Pi')
    .replace(/Σ|\\Sigma\b/g, 'Sigma')
    .replace(/Υ|\\Upsilon\b/g, 'Upsilon')
    .replace(/Φ|\\Phi\b/g, 'Phi')
    .replace(/Ψ|\\Psi\b/g, 'Psi')
    .replace(/Ω|\\Omega\b/g, 'Omega')
    // Math operators & symbols
    .replace(/∫|\\int\b/g, 'int')
    .replace(/∂|\\partial\b/g, 'd')
    .replace(/∇|\\nabla\b/g, 'grad')
    .replace(/ℓ|\\ell\b/g, 'ell')
    .replace(/ℏ|\\hbar\b/g, 'h-bar')
    .replace(/Å|\\AA\b/g, 'Angstrom')
    .replace(/⇌/g, '<=>')
    .replace(/→|\\to\b|\\rightarrow\b/g, '->')
    .replace(/←|\\leftarrow\b/g, '<-')
    .replace(/⇒|\\Rightarrow\b/g, '=>')
    .replace(/⇔|\\Leftrightarrow\b/g, '<=>')
    .replace(/√\(([^)]+)\)/g, 'sqrt($1)')
    .replace(/√([A-Za-z0-9]+)/g, 'sqrt($1)')
    .replace(/√/g, 'sqrt')
    .replace(/×/g, 'x')
    .replace(/·/g, '.')
    .replace(/±/g, '+/-')
    .replace(/∓/g, '-+')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/≠/g, '!=')
    .replace(/≈/g, '~')
    .replace(/≡/g, '==')
    .replace(/∝/g, 'prop')
    .replace(/∞/g, 'inf')
    .replace(/°/g, ' deg')
    .replace(/∈/g, ' in ')
    .replace(/∉/g, ' not in ')
    .replace(/⊂/g, ' subset ')
    .replace(/⊆/g, ' subset-eq ')
    .replace(/∪/g, ' union ')
    .replace(/∩/g, ' intersect ')
    .replace(/∅/g, 'empty-set')
    .replace(/∥/g, '||')
    .replace(/⊥/g, ' perp ')
    .replace(/∠/g, 'angle ')
    .replace(/⟨/g, '<')
    .replace(/⟩/g, '>')
    // Typography, quotes, dashes
    .replace(/[’‘`]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/•/g, '* ')
    .replace(/\u00A0/g, ' ')
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, '')
    .replace(/⇐/g, '<=')
    .replace(/↔/g, '<->')
    .replace(/↦/g, '|->')
    .replace(/↑/g, '^')
    .replace(/↓/g, 'v')
    .replace(/≪/g, '<<')
    .replace(/≫/g, '>>')
    .replace(/∮/g, 'oint')
    .replace(/∬/g, 'iint')
    .replace(/∭/g, 'iiint')
    .replace(/÷/g, '/')
    .replace(/∴/g, 'therefore')
    .replace(/∵/g, 'because')
    .replace(/′/g, "'")
    .replace(/″/g, "''")
    .replace(/△/g, 'triangle ')
    .replace(/□/g, '[]')
    .replace(/✓/g, 'v')
    .replace(/≅/g, '=~')
    .replace(/≃/g, '~=')
    .replace(/[⌈⌊]/g, '[')
    .replace(/[⌉⌋]/g, ']')
    .replace(/‖/g, '||')
    .replace(
      /[ℝℕℤℚℂℙ]/g,
      ch => ({ ℝ: 'R', ℕ: 'N', ℤ: 'Z', ℚ: 'Q', ℂ: 'C', ℙ: 'P' })[ch]
    )
    .replace(/Σ/g, 'Sum')
    .replace(/∑/g, 'Sum')
    .replace(/∏/g, 'Prod')
    .replace(/∀/g, 'for all ')
    .replace(/∃/g, 'exists ')
    .replace(/¬/g, 'not ')
    .replace(/∧/g, ' and ')
    .replace(/∨/g, ' or ')
    .replace(/∖/g, ' - ')
    .replace(
      /(\S)([\u0302\u20D7\u0307\u0308\u20DB\u0304\u0303])/g,
      (_, ch, mark) => {
        const name = Object.keys(ACCENT_MARK).find(
          k => ACCENT_MARK[k] === mark
        );
        return `${name}(${ch})`;
      }
    )
    // Collapse unicode sub/superscript runs into single ASCII markers
    .replace(SUB_RUN, run => {
      const ascii = Array.from(run, ch => SUB_ASCII[ch] || '').join('');
      return ascii.length > 1 ? `_(${ascii})` : `_${ascii}`;
    })
    .replace(SUPER_RUN, run => {
      const ascii = Array.from(run, ch => SUPER_ASCII[ch] || '').join('');
      return ascii.length > 1 ? `^(${ascii})` : `^${ascii}`;
    });

/**
 * Ensures 100% of characters are within 7-bit ASCII or standard Latin-1 whitespace,
 * completely preventing jsPDF UTF-16 switching and null-byte spacing artifacts.
 */
export const sanitizeForPdf = s => {
  if (s == null) return '';
  let str = toAsciiMath(String(s));
  let out = '';
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (
      (code >= 32 && code <= 126) ||
      code === 10 ||
      code === 13 ||
      code === 9
    ) {
      out += str[i];
    } else if (code === 160) {
      out += ' ';
    } else {
      out += ' ';
    }
  }
  return out.replace(/[ \t]{2,}/g, ' ');
};

/**
 * $...$ / $$...$$ spans. Inline $ must hug its content and the closing $
 * cannot precede a digit, so currency like "$1,000 ... $500" is not math.
 */
const MATH_SPAN =
  /\$\$[\s\S]+?\$\$|\$(?!\s)[^$]*?[^\s$\\]\$(?!\d)|\$[^\s$\d\\]\$/g;
const ESCAPED_DOLLAR = '\uE000';
const unwrapMathSpans = text =>
  String(text || '').replace(MATH_SPAN, span =>
    span.startsWith('$$') ? span.slice(2, -2) : span.slice(1, -1)
  );

const LATEX_N_COMMANDS =
  'u|abla|eq|e|eg|ot|otin|i|mid|leq|geq|subseteq|parallel|exists|ewline|olimits';

const DOUBLE_ESCAPED_COMMAND = new RegExp(
  String.raw`\\\\(?=(?:${[
    ...Object.keys(GREEK),
    ...Object.keys(MATH_FN),
    'frac|dfrac|tfrac|sqrt|binom|dbinom|text|textrm|textbf|textit|mathrm|mathbf|mathit|mathbb|mathcal|operatorname|boldsymbol|bm',
    'left|right|big|Big|bigl|bigr|Bigl|Bigr|displaystyle|quad|qquad',
    'cdot|cdots|ldots|dots|times|div|pm|mp|le|leq|ge|geq|ne|neq|approx|equiv|sim|propto|infty|partial|nabla',
    'to|rightarrow|leftarrow|Rightarrow|Leftarrow|longrightarrow|longleftarrow|Longrightarrow|leftrightarrow|Leftrightarrow|rightleftharpoons|xrightarrow|xleftarrow|implies|iff|uparrow|downarrow',
    'in|notin|subset|subseteq|cup|cap|forall|exists|emptyset|mid|parallel|perp|angle|circ|degree|prime|hbar|ell|AA',
    'vec|hat|bar|overline|underline|tilde|dot|ddot|overrightarrow|underbrace|overbrace|boxed|tag|begin|end|item|pmod|bmod|not',
  ].join('|')})(?![A-Za-z]))`,
  'g'
);

/**
 * AI JSON sometimes double-escapes newlines (literal "\n" in the text) or
 * under-escapes LaTeX, so "\frac" / "\nu" / "\theta" arrive as control
 * characters. Restore both before LaTeX conversion.
 */
const repairEscapes = raw => {
  const fixMath = math =>
    math
      .replace(/\f/g, '\\f')
      .replaceAll(String.fromCharCode(8), '\\b')
      .replace(/\t(?=[A-Za-z])/g, '\\t')
      .replace(/\r(?=[A-Za-z])/g, '\\r')
      .replace(
        new RegExp(`\\n(?=(?:${LATEX_N_COMMANDS})(?![A-Za-z]))`, 'g'),
        '\\n'
      );
  const doubled = (raw.match(/\\\\[A-Za-z]/g) || []).length;
  const single = (raw.match(/(?:^|[^\\])\\[A-Za-z]/g) || []).length;
  let s = doubled && doubled >= single ? raw.replace(/\\\\/g, '\\') : raw;
  // Over-escaped commands (\\\frac). Inside an environment three or more
  // backslashes are a row break followed by a command.
  const inEnvironment = /\\begin\s*\{/.test(s);
  s = s.replace(/\\{3,}(?=[A-Za-z])/g, inEnvironment ? '\\\\ \\' : '\\');
  s = s.replace(DOUBLE_ESCAPED_COMMAND, '\\');
  if (/\\\\\]/.test(s))
    s = s
      .replace(/\\\\\[(?!\s*[\d.]+\s*(?:pt|em|ex|mm)\])/g, '\\[')
      .replace(/\\\\\]/g, '\\]');
  if (/\\\\\)/.test(s))
    s = s.replace(/\\\\\(/g, '\\(').replace(/\\\\\)/g, '\\)');
  return s
    .replace(/\f/g, '\\f')
    .replace(/\v/g, '\\v')
    .replaceAll(String.fromCharCode(8), '\\b')
    .replace(MATH_SPAN, fixMath)
    .replace(/\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, fixMath)
    .replace(
      new RegExp(`\\\\n(?!(?:${LATEX_N_COMMANDS})(?![A-Za-z]))`, 'g'),
      '\n'
    );
};

/**
 * Ensure question statements and explanations are displayed with proper line breaks,
 * numbered list formatting, and separation of the final question/conclusion.
 *
 * @param {string} text
 * @param {{ isQuestion?: boolean, isExplanation?: boolean }} [options]
 * @returns {string}
 */
export function formatStructuredQuestionAndExplanation(text, _options = {}) {
  if (_options?.sourceType === 'manual') return text;
  if (!text || typeof text !== 'string') return text;
  let s = text.trim();
  if (!s) return '';

  // 1. Separate final question or conclusion if present
  const closingQuestionPatterns = [
    /(?:Which(?:\s+of)?(?:\s+the)?(?:\s+above|\s+following)?\s+statements?\b[^\n?]*\?)/i,
    /(?:How\s+many\s+of\s+the\s+(?:statements|pairs|options)\b[^\n?]*\?)/i,
    /(?:Which\s+one\s+of\s+the\s+following\b[^\n?]*\?)/i,
    /(?:Which\s+of\s+the\s+following\b[^\n?]*\?)/i,
    /(?:Which\s+of\s+the\s+above\b[^\n?]*\?)/i,
    /(?:Which\s+mode\s+of\s+inheritance\b[^\n?]*\?)/i,
    /(?:Select\s+(?:the\s+)?(?:correct|appropriate|incorrect|increasing|decreasing)\b[^\n.:]*[.:?])/i,
    /(?:Choose\s+the\s+correct\s+answer\b[^\n.:]*[.:?])/i,
  ];

  let closingBlock = '';
  for (const pattern of closingQuestionPatterns) {
    const match = s.match(pattern);
    if (match && match.index != null) {
      const afterMatch = s.slice(match.index + match[0].length).trim();
      if (afterMatch.length <= 25) {
        closingBlock = s.slice(match.index).trim();
        s = s.slice(0, match.index).trim();
        break;
      }
    }
  }

  // If no closing question, check for explanation conclusion: "Therefore, ...", "Hence, ..."
  if (!closingBlock) {
    const conclusionRe =
      /(?<=[.!?])\s+(?=(?:Therefore|Hence|Thus|Consequently|In conclusion)\b[^\n]*)/i;
    const cMatch = s.match(conclusionRe);
    if (cMatch && cMatch.index != null) {
      closingBlock = s.slice(cMatch.index).trim();
      s = s.slice(0, cMatch.index).trim();
    }
  }

  // 2. Identify statement markers
  let firstMarkerMatch = null;
  let statementType = null;

  const numberedMatch = s.match(/(?:[:.]\s*|\n\s*|^)(1\.|1\))\s+/);
  const romanMatch = s.match(
    /(?:[:.]\s*|\n\s*|^)(\([IVXLCDM]+\)|[IVXLCDM]+\.)\s+/i
  );
  const parenMatch = s.match(/(?:[:.]\s*|\n\s*|^)(\(1\))\s+/);
  const dashedMatch = s.match(/(?:[:.]\s*|\n\s*|^)(-\s+[A-Za-z0-9])/);
  const namedMatch = s.match(
    /(?:[:.]\s*|\n\s*|^)(Statement\s+(?:1|I)[:.]\s+)/i
  );
  const explanationStatementMatch = s.match(
    /(?:^|[.!?\n]\s*)(?:(\d+)\.\s*)?Statement\s+(?:1|I)\b/i
  );

  if (numberedMatch && /(?:[\s\n])(2\.|2\))\s+/.test(s)) {
    firstMarkerMatch = numberedMatch;
    statementType = 'numbered';
  } else if (
    romanMatch &&
    /(?:[\s\n])(\([IVXLCDM]+\)|[IVXLCDM]+\.)\s+/i.test(s)
  ) {
    firstMarkerMatch = romanMatch;
    statementType = 'roman';
  } else if (parenMatch && /(?:[\s\n])\(2\)\s+/.test(s)) {
    firstMarkerMatch = parenMatch;
    statementType = 'paren';
  } else if (dashedMatch && /(?:[\s\n])-\s+[A-Za-z0-9]/.test(s)) {
    firstMarkerMatch = dashedMatch;
    statementType = 'dashed';
  } else if (namedMatch && /(?:[\s\n])Statement\s+(?:2|II)[:.]\s+/i.test(s)) {
    firstMarkerMatch = namedMatch;
    statementType = 'named';
  } else if (
    explanationStatementMatch &&
    /(?:[\s\n])(?:(?:\d+\.\s*)?Statement\s+(?:2|II))\b/i.test(s)
  ) {
    firstMarkerMatch = explanationStatementMatch;
    statementType = 'explanationStatement';
  } else if (
    /(?:^|[\s\n])Step\s+1[:.]\s+.+?(?:[\s\n])Step\s+2[:.]\s+/is.test(s)
  ) {
    statementType = 'steps';
  } else if (
    /(?:^|[\s\n])Option\s+[A-D][:.]\s+.+?(?:[\s\n])Option\s+[A-D][:.]\s+/is.test(
      s
    )
  ) {
    statementType = 'options';
  }

  if (statementType) {
    if (firstMarkerMatch && firstMarkerMatch.index != null) {
      const marker = firstMarkerMatch[1] || firstMarkerMatch[0].trim();
      const markerIndex = s.indexOf(marker, firstMarkerMatch.index);
      const intro = markerIndex > 0 ? s.slice(0, markerIndex).trim() : '';
      let body = s.slice(markerIndex).trim();

      if (statementType === 'numbered') {
        body = body.replace(/([.!?;]|\))\s+(?=\b([2-9]|\d{2})\.\s+)/g, '$1\n');
      } else if (statementType === 'roman') {
        let idx = 1;
        body = body.replace(
          /(?:^|\n|\s*)(?:\(([IVXLCDM]+)\)|([IVXLCDM]+)\.)\s+/gi,
          () => {
            const num = idx++;
            return num === 1 ? '1. ' : `\n${num}. `;
          }
        );
        body = body.replace(/,\s*\n/g, '.\n');
        body = body.replace(/,\s*and\s*\n/gi, '.\n');
        body = body.replace(/\band\s*\n/gi, '\n');
      } else if (statementType === 'paren') {
        let idx = 1;
        body = body.replace(/(?:^|\n|\s*)\((\d+)\)\s+/g, () => {
          const num = idx++;
          return num === 1 ? '1. ' : `\n${num}. `;
        });
      } else if (statementType === 'dashed') {
        let idx = 1;
        body = body.replace(/(?:^|\n|\s*)-\s+/g, () => {
          const num = idx++;
          return num === 1 ? '1. ' : `\n${num}. `;
        });
      } else if (statementType === 'named') {
        let idx = 1;
        body = body.replace(
          /(?:^|\n|\s*)Statement\s+(?:[1-9]|I|II|III|IV|V)[:.]\s+/gi,
          () => {
            const num = idx++;
            return num === 1 ? '1. ' : `\n${num}. `;
          }
        );
      } else if (statementType === 'explanationStatement') {
        let idx = 1;
        body = body
          .replace(
            /(^|[.!?]\s+)(?:(\d+)\.\s*)?Statement\s+(\d+|I|II|III|IV)\b/gi,
            (_match, prefix) => {
              const punct = prefix.trim();
              const num = idx++;
              const p = punct ? `${punct}\n` : '';
              return `${p}${num}. Statement ${num}`;
            }
          )
          .trim();
      }

      s = intro ? `${intro}\n\n${body.trim()}` : body.trim();
    } else if (statementType === 'steps') {
      s = s.replace(/([.!?])\s+(?=Step\s+\d+[:.]\s+)/gi, '$1\n\n');
    } else if (statementType === 'options') {
      s = s.replace(/([.!?])\s+(?=Option\s+[A-D][:.]\s+)/gi, '$1\n');
    }
  }

  s = s.replace(/\n{3,}/g, '\n\n').trim();

  if (closingBlock) {
    s = `${s.trim()}\n\n${closingBlock.trim()}`;
  }

  return s;
}

/**
 * @param {unknown} value
 * @param {{ ascii?: boolean, pdf?: boolean, sourceType?: string, isQuestion?: boolean, isExplanation?: boolean }} [options]
 * @returns {string}
 */
export function formatReadableQuestionText(value, options = {}) {
  if (value == null) return '';
  const raw = String(value);
  if (!raw.trim()) return '';

  // If we know explicitly this is a manual question, bypass the AI formatter entirely
  // and directly return the raw string.
  if (options.sourceType === 'manual') {
    return raw;
  }

  const unwrapped = unwrapMathSpans(
    repairEscapes(raw.replace(/(?<!\\)((?:\\\\)*)\\\$/g, `$1${ESCAPED_DOLLAR}`))
  )
    .replace(/\\\(([\s\S]*?)\\\)/g, '$1')
    .replace(/\\\[([\s\S]*?)\\\]/g, '$1');
  const normalized = normalizeMathAndLatex(unwrapped);
  const withCommands = convertLatexCommands(normalized);
  const cleaned = cleanPlainNoise(withCommands);
  const repaired = repairScientificNotation(cleaned);
  const unwrappedLines = unwrapSoftLineBreaks(repaired).replaceAll(
    ESCAPED_DOLLAR,
    '$'
  );
  const structured = formatStructuredQuestionAndExplanation(
    unwrappedLines,
    options
  );

  if (options.pdf) {
    return sanitizeForPdf(structured);
  }
  return options.ascii ? toAsciiMath(structured) : structured;
}

/**
 * Apply readable formatting across paper fields used by UI / PDF.
 * Does not mutate the original paper object.
 * @param {object} paper
 * @param {{ ascii?: boolean, pdf?: boolean, sourceType?: string }} [options]
 */
export function withReadablePaperText(paper, options = {}) {
  if (!paper || typeof paper !== 'object') return paper;

  const sType = options.sourceType || paper.sourceType || 'ai'; // Default to AI if omitted for backwards compatibility in AI-only pages
  if (sType !== 'ai') return paper;

  const fmt = value => formatReadableQuestionText(value, options);
  const mapQuestion = q => {
    if (!q || typeof q !== 'object') return q;
    return {
      ...q,
      passage: fmt(q.passage),
      questionText: formatReadableQuestionText(q.questionText || q.stem, {
        ...options,
        isQuestion: true,
      }),
      explanation: formatReadableQuestionText(q.explanation, {
        ...options,
        isExplanation: true,
      }),
      topic: fmt(q.topic),
      correctAnswer: fmt(q.correctAnswer),
      options: Array.isArray(q.options)
        ? q.options.map(opt =>
            opt && typeof opt === 'object'
              ? { ...opt, text: fmt(opt.text) }
              : fmt(opt)
          )
        : q.options,
    };
  };
  return {
    ...paper,
    questions: Array.isArray(paper.questions)
      ? paper.questions.map(mapQuestion)
      : paper.questions,
    sections: Array.isArray(paper.sections)
      ? paper.sections.map(section => ({
          ...section,
          questions: Array.isArray(section.questions)
            ? section.questions.map(mapQuestion)
            : section.questions,
        }))
      : paper.sections,
  };
}

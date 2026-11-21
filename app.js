/* ==========================================================================
   Private Fuzzy Left Join: didactic simulator (app.js)
   Concept: Han, Kim, Son, "Private Computation on Common Fuzzy Records", PoPETs 2025.

   Structure:
     1. Scenario defaults and metadata
     2. Pure functions: normalisation, phonetic key, features, shares, Circuit-PSI, OTO MPC, payload
     3. Application state
     4. Rendering (Steps 1 to 6)
     5. Event wiring (buttons, keyboard, swipe, help popup)
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   1. Scenario Defaults and Metadata
   -------------------------------------------------------------------------- */

const DEFAULT_R = [
  { id: 'P-017', name: 'Anna Mueller', birth: '12.03.1985', zip: '9000' },
  { id: 'P-018', name: 'Peter Frei',   birth: '',           zip: '9000' },
  { id: 'P-019', name: 'Lena Huber',   birth: '22.11.1978', zip: '9500' }
];

const DEFAULT_S = [
  { id: 'S-1', name: 'Marco Rossi', birth: '05.05.1969', zip: '9010', admissions: 3 },
  { id: 'S-2', name: 'Peter Frei',  birth: '01.07.1990', zip: '9000', admissions: 1 },
  { id: 'S-3', name: 'Anna Müller', birth: '12.03.1985', zip: '9000', admissions: 2 }
];

// Second candidate for the "Ordered" demo:
// - Phonetic key OFF: matches P-017 on f2 (earlier than Anna Müller's f3), so f2 wins (7).
// - Phonetic key ON:  Anna Müller matches P-017 on f1, this row on f2 (later), so f1 wins (2).
const EXTRA_CANDIDATE_S = {
  id: 'S-4',
  name: 'Anna Mueller',
  birth: '04.04.1980',
  zip: '9000',
  admissions: 7,
  isExtra: true
};

const FEATURES = [
  { key: 'f1', label: 'f1', desc: 'name + birth date' },
  { key: 'f2', label: 'f2', desc: 'name + ZIP' },
  { key: 'f3', label: 'f3', desc: 'birth date + ZIP' }
];

// Copy for the "?" popup. Short, plain, one idea per line.
const STEP_META = [
  {
    num: 1,
    short: 'Inputs',
    heading: 'Two tables, no shared ID',
    title: '1/6: Inputs',
    bullets: [
      "Hospital S and research team R each keep their own table. Neither sees the other's.",
      'R wants the admission count of its study participants.',
      'The data is messy: a typo here, a missing birth date there.',
      'Edit any cell to try your own case.'
    ]
  },
  {
    num: 2,
    short: 'Features',
    heading: 'Each side builds 3 match keys',
    title: '2/6: Features',
    bullets: [
      'Both sides combine their own fields into 3 keys, f1, f2 and f3.',
      'f1 is the strictest key. f3 is the loosest.',
      'An empty field breaks every key that needs it.',
      'Nothing has left either side yet.'
    ]
  },
  {
    num: 3,
    short: 'Circuit-PSI',
    heading: 'Is this key in the other table?',
    title: '3/6: Circuit-PSI',
    bullets: [
      'For every R row, Circuit-PSI checks if that key appears anywhere in S. Row order in S does not matter.',
      "Slot 1, 2, 3 on S are aligned to R's rows (not S's patients). In the real protocol, permute-and-share aligns the hash buckets across f1, f2 and f3.",
      'Nobody sees the yes/no bit. It is split into two random bits, s for S and r for R, with s ⊕ r = b.',
      'One person can still hit more than one key.'
    ]
  },
  {
    num: 4,
    short: 'Pick 1 (OTO)',
    heading: 'Keep only the first yes',
    title: '4/6: MPC (OTO)',
    bullets: [
      'Step 3 can give up to 3 yeses per person. A join needs exactly one partner.',
      'The rule is simple. f1 beats f2, f2 beats f3. Everything after the first yes is dropped.',
      'The result is again split into fresh random bits.',
      'Here one program does the maths. In the real protocol S and R compute it together, with secret-shared selector gates built from oblivious transfer.'
    ]
  },
  {
    num: 5,
    short: 'Payload',
    heading: 'Lock the admission count',
    title: '5/6: Payload',
    bullets: [
      'A matched row gets its admission count, split into two random numbers.',
      'A row without a match gets a random dummy instead.',
      'Both look like noise. Neither side can tell a match from a dummy.'
    ]
  },
  {
    num: 6,
    short: 'Output',
    heading: 'R unlocks the result',
    title: '6/6: Output',
    bullets: [
      'Until now both sides hold only shares. In our scenario S sends its numbers to R, and R combines them with its own: s ⊕ r.',
      'Match = 1 means R reads the admission count. Match = 0 means R drops the dummy.',
      'S learns nothing, not even how many people matched.'
    ]
  }
];

/* --------------------------------------------------------------------------
   2. Pure Functions
   -------------------------------------------------------------------------- */

function cloneRows(rows) {
  return rows.map((row) => ({ ...row }));
}

/**
 * Trim, NFC-normalise (so precomposed and decomposed umlauts match), lowercase,
 * and collapse internal whitespace.
 */
function normaliseText(value) {
  return String(value ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Simple Soundex-like phonetic key for a single word with German umlaut/digraph folding
 * (ü/ue -> u, ö/oe -> o, ä/ae -> a, ß -> ss), so "Mueller" and "Müller" agree.
 * Note: ae/oe/ue folding also simplifies names like "Manuel" or "Michael" identically on both sides.
 */
function soundexWord(rawWord) {
  const folded = normaliseText(rawWord)
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/[^a-z]/g, '');

  if (!folded) return '';

  const map = {
    b: '1', f: '1', p: '1', v: '1',
    c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
    d: '3', t: '3',
    l: '4',
    m: '5', n: '5',
    r: '6'
  };

  const first = folded[0].toUpperCase();
  let code = first;
  let prevDigit = map[folded[0]] || '';

  for (let i = 1; i < folded.length && code.length < 4; i++) {
    const ch = folded[i];
    const digit = map[ch] || '';
    if (digit && digit !== prevDigit) {
      code += digit;
    }
    if (ch !== 'h' && ch !== 'w') {
      prevDigit = digit;
    }
  }

  return code.padEnd(4, '0');
}

/**
 * Compute phonetic key for a full name (word by word).
 */
function phoneticNameKey(name) {
  const cleaned = normaliseText(name);
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map(soundexWord)
    .filter(Boolean)
    .join('-');
}

/**
 * Derive the three ordered features for one record.
 * Returns null for any feature that depends on an empty field.
 */
function computeRecordFeatures(record, usePhonetic) {
  const nameRaw = normaliseText(record.name);
  const nameKey = usePhonetic ? phoneticNameKey(record.name) : nameRaw;
  const birth = normaliseText(record.birth);
  const zip = normaliseText(record.zip);

  return {
    nameKey,
    birth,
    zip,
    f1: nameKey && birth ? `${nameKey} | ${birth}` : null,
    f2: nameKey && zip   ? `${nameKey} | ${zip}`   : null,
    f3: birth && zip     ? `${birth} | ${zip}`     : null
  };
}

/**
 * Random bit in {0, 1} (didactic only, not cryptographically secure).
 */
function randomBit() {
  return Math.random() < 0.5 ? 0 : 1;
}

/**
 * Random integer in [0, 2^bits - 1] (didactic only).
 */
function randomMask(bits) {
  return Math.floor(Math.random() * (1 << bits));
}

/**
 * Split a bit b into XOR shares (r, s) such that r ^ s === b.
 */
function splitBit(bit) {
  const r = randomBit();
  const s = bit ^ r;
  return { r, s };
}

/**
 * Split a non-negative integer payload into XOR shares (r, s) over `bits` bits.
 * If matched is false, return independent random noise shares.
 */
function splitPayload(value, matched, bits) {
  const r = randomMask(bits);
  if (!matched) {
    const s = randomMask(bits);
    return { r, s, isNoise: true };
  }
  const s = value ^ r;
  return { r, s, isNoise: false };
}

/**
 * Parse a payload cell safely into a non-negative integer.
 */
function parseAdmissions(value) {
  const n = parseInt(String(value ?? '').trim(), 10);
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.min(n, 65535);
}

/**
 * Choose an integer bit-width large enough for all payloads (8 bits by default).
 */
function payloadBitWidth(sRows) {
  const maxVal = sRows.reduce((acc, row) => Math.max(acc, parseAdmissions(row.admissions)), 0);
  return maxVal > 255 ? 16 : 8;
}

/**
 * Step 3: Circuit-PSI per feature.
 * For each R row and feature fk, b = 1 iff at least one S row has the same non-null feature value.
 */
function computeCircuitPsi(rFeatures, sFeatures) {
  return rFeatures.map((rf) => {
    const perFeature = {};
    for (const feat of FEATURES) {
      const val = rf[feat.key];
      const matchingSIndices = [];
      if (val !== null) {
        sFeatures.forEach((sf, sIdx) => {
          if (sf[feat.key] !== null && sf[feat.key] === val) {
            matchingSIndices.push(sIdx);
          }
        });
      }
      const trueBit = matchingSIndices.length > 0 ? 1 : 0;
      const shares = splitBit(trueBit);
      perFeature[feat.key] = {
        value: val,
        trueBit,
        matchingSIndices,
        rShare: shares.r,
        sShare: shares.s
      };
    }
    return perFeature;
  });
}

/**
 * Step 4: MPC on the shares (Ordered Threshold-One rule).
 * Earliest agreeing feature wins (f1 < f2 < f3). At most one S record is chosen.
 * Produces fresh XOR shares for the selection bits (w1, w2, w3) and combined match bit m.
 */
function computeOtoMpc(psiRows) {
  return psiRows.map((psi) => {
    const b1 = psi.f1.trueBit;
    const b2 = psi.f2.trueBit;
    const b3 = psi.f3.trueBit;

    // OTO selection logic: at most one w_k is 1
    const w1 = b1;
    const w2 = (1 - b1) & b2;
    const w3 = (1 - b1) & (1 - b2) & b3;
    const matchBit = w1 | w2 | w3;

    let winningFeature = null;
    let chosenSIndex = null;
    let sameFeatureTies = [];
    if (w1) {
      winningFeature = 'f1';
      chosenSIndex = psi.f1.matchingSIndices[0];
      sameFeatureTies = psi.f1.matchingSIndices.slice(1);
    } else if (w2) {
      winningFeature = 'f2';
      chosenSIndex = psi.f2.matchingSIndices[0];
      sameFeatureTies = psi.f2.matchingSIndices.slice(1);
    } else if (w3) {
      winningFeature = 'f3';
      chosenSIndex = psi.f3.matchingSIndices[0];
      sameFeatureTies = psi.f3.matchingSIndices.slice(1);
    }

    // Collect any other S candidates that matched on a later feature (deduped by sIndex)
    const beatenCandidates = [];
    const seenBeaten = new Set([chosenSIndex, ...sameFeatureTies]);
    if (winningFeature !== null) {
      const winRank = FEATURES.findIndex((f) => f.key === winningFeature);
      for (let k = winRank + 1; k < FEATURES.length; k++) {
        const fk = FEATURES[k].key;
        for (const sIdx of psi[fk].matchingSIndices) {
          if (!seenBeaten.has(sIdx)) {
            seenBeaten.add(sIdx);
            beatenCandidates.push({ sIndex: sIdx, feature: fk });
          }
        }
      }
    }

    const wShares = {
      f1: splitBit(w1),
      f2: splitBit(w2),
      f3: splitBit(w3)
    };
    const matchShares = splitBit(matchBit);

    return {
      wTrue: { f1: w1, f2: w2, f3: w3 },
      wShares,
      matchBit,
      matchShares,
      winningFeature,
      chosenSIndex,
      sameFeatureTies,
      beatenCandidates
    };
  });
}

/**
 * Step 5: Secret-share the selected payload (admissions) and match bit per R row.
 */
function computePayloadShares(otoRows, sRows, bits) {
  return otoRows.map((oto) => {
    const matched = oto.matchBit === 1 && oto.chosenSIndex !== null;
    const truePayload = matched ? parseAdmissions(sRows[oto.chosenSIndex].admissions) : null;
    const payloadShare = splitPayload(matched ? truePayload : 0, matched, bits);
    const matchShare = splitBit(matched ? 1 : 0);

    return {
      matched,
      truePayload,
      bits,
      rPayload: payloadShare.r,
      sPayload: payloadShare.s,
      isNoise: payloadShare.isNoise,
      rMatch: matchShare.r,
      sMatch: matchShare.s
    };
  });
}

/**
 * Run the full didactic pipeline from raw tables.
 */
function runSimulation(rRows, sRows, usePhonetic) {
  const rFeatures = rRows.map((row) => computeRecordFeatures(row, usePhonetic));
  const sFeatures = sRows.map((row) => computeRecordFeatures(row, usePhonetic));
  const psiRows = computeCircuitPsi(rFeatures, sFeatures);
  const otoRows = computeOtoMpc(psiRows);
  const bits = payloadBitWidth(sRows);
  const payloadRows = computePayloadShares(otoRows, sRows, bits);

  return {
    usePhonetic,
    bits,
    rFeatures,
    sFeatures,
    psiRows,
    otoRows,
    payloadRows
  };
}

/**
 * Redraw all random shares (Steps 3 to 5) while keeping the underlying true bits unchanged.
 */
function rerandomiseSimulationShares(sim, sRows) {
  const psiRows = sim.psiRows.map((psi) => {
    const next = {};
    for (const feat of FEATURES) {
      const entry = psi[feat.key];
      const shares = splitBit(entry.trueBit);
      next[feat.key] = { ...entry, rShare: shares.r, sShare: shares.s };
    }
    return next;
  });

  const otoRows = sim.otoRows.map((oto) => ({
    ...oto,
    wShares: {
      f1: splitBit(oto.wTrue.f1),
      f2: splitBit(oto.wTrue.f2),
      f3: splitBit(oto.wTrue.f3)
    },
    matchShares: splitBit(oto.matchBit)
  }));

  const payloadRows = computePayloadShares(otoRows, sRows, sim.bits);

  return {
    ...sim,
    psiRows,
    otoRows,
    payloadRows
  };
}

/* --------------------------------------------------------------------------
   3. Application State
   -------------------------------------------------------------------------- */

const state = {
  step: 1,
  usePhonetic: false,
  teacherView: false,
  hasExtraCandidate: false,
  statusHint: '',
  statusHintType: 'info',
  flashShares: false,
  rRows: cloneRows(DEFAULT_R),
  sRows: cloneRows(DEFAULT_S),
  sim: null
};

state.sim = runSimulation(state.rRows, state.sRows, state.usePhonetic);


/* --------------------------------------------------------------------------
   4. Rendering Helpers and Step Views
   -------------------------------------------------------------------------- */

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAdmissions(n) {
  return n === 1 ? '1 admission' : `${n} admissions`;
}

function formatFeatureCell(val, missingLabel) {
  if (val === null) {
    return `<span class="badge badge-unusable">${escapeHtml(missingLabel)}</span>`;
  }
  return `<span class="feature-val">${escapeHtml(val)}</span>`;
}

function missingReason(record, featureKey) {
  const noName = !normaliseText(record.name);
  const noBirth = !normaliseText(record.birth);
  const noZip = !normaliseText(record.zip);
  const missing = [];
  if ((featureKey === 'f1' || featureKey === 'f2') && noName) missing.push('name');
  if ((featureKey === 'f1' || featureKey === 'f3') && noBirth) missing.push('birth date');
  if ((featureKey === 'f2' || featureKey === 'f3') && noZip) missing.push('ZIP');
  return missing.length ? `no ${missing.join(' or ')}` : 'empty';
}

function shareChip(val, wide) {
  const cls = ['share-chip'];
  if (wide) cls.push('share-chip-wide');
  if (state.flashShares) cls.push('share-flash');
  return `<span class="${cls.join(' ')}">${escapeHtml(val)}</span>`;
}

/** Inline hospital cross emblem for Party S (zero external requests). */
const HOSPITAL_LOGO_SVG =
  '<span class="party-logo party-logo-hospital" aria-hidden="true">' +
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">' +
  '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z"/>' +
  '</svg></span>';

const HSG_LOGO_HTML =
  '<img src="hsg-mark.png" alt="HSG" class="party-logo party-logo-hsg">';

/** Panel header with Hospital / HSG icon. */
function panelHead(party, title, role, id) {
  const logo = party === 'S' ? HOSPITAL_LOGO_SVG : party === 'R' ? HSG_LOGO_HTML : '';
  const idAttr = id ? ` id="${id}"` : '';
  const roleHtml = role ? `<span class="panel-role">${role}</span>` : '';
  return `
    <div class="panel-header">
      <h3 class="panel-title"${idAttr}>${logo}<span>${title}</span></h3>
      ${roleHtml}
    </div>`;
}

function tableHtml(headers, body) {
  const head = headers.map((h) => `<th>${h}</th>`).join('');
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function panelHtml(cls, head, inner, extraAttrs) {
  return `
    <section class="panel ${cls}"${extraAttrs || ''}>
      ${head}
      <div class="panel-body">${inner}</div>
    </section>`;
}

function flowStrip(items) {
  const parts = items.map((item, i) => {
    const pill = `<span class="flow-pill${item.focus ? ' is-focus' : ''}">${item.text}</span>`;
    // Arrow and its pill wrap together, so a line never ends with a dangling arrow.
    return i === 0 ? pill : `<span class="flow-step"><span class="flow-arrow">→</span>${pill}</span>`;
  });
  return `<div class="flow-strip" aria-hidden="true">${parts.join('')}</div>`;
}

const FEATURE_HEADERS = ['f1 (name + birth)', 'f2 (name + ZIP)', 'f3 (birth + ZIP)'];

/* --- Step 1: Inputs (editable tables, S left, R right) --- */
function renderStep1() {
  const cell = (party, idx, field, value, label, extraCls) => {
    const empty = field !== 'admissions' && !normaliseText(value) ? ' is-empty' : '';
    const numAttrs = field === 'admissions' ? ' inputmode="numeric" pattern="[0-9]*"' : '';
    const placeholder = field === 'admissions' ? '' : ' placeholder="(empty)"';
    return `<input type="text" class="cell-input${extraCls || ''}${empty}"${numAttrs}
              data-party="${party}" data-index="${idx}" data-field="${field}"
              value="${escapeHtml(value)}"${placeholder} aria-label="${escapeHtml(label)}">`;
  };

  const sBody = state.sRows
    .map((row, idx) => {
      const extraClass = row.isExtra ? ' class="is-extra-row"' : '';
      const extraBadge = row.isExtra ? '<span class="badge badge-extra">2nd</span>' : '';
      const who = `S row ${idx + 1}`;
      return `
        <tr${extraClass}>
          <td><div class="cell-with-badge">${cell('S', idx, 'name', row.name, `${who} name`)}${extraBadge}</div></td>
          <td>${cell('S', idx, 'birth', row.birth, `${who} birth date`)}</td>
          <td>${cell('S', idx, 'zip', row.zip, `${who} ZIP`)}</td>
          <td>${cell('S', idx, 'admissions', row.admissions, `${who} admissions`, ' cell-input-num')}</td>
        </tr>`;
    })
    .join('');

  const rBody = state.rRows
    .map((row, idx) => {
      const who = `R row ${row.id || idx + 1}`;
      return `
        <tr>
          <td>${cell('R', idx, 'id', row.id, `R row ${idx + 1} study ID`, ' cell-input-id')}</td>
          <td>${cell('R', idx, 'name', row.name, `${who} name`)}</td>
          <td>${cell('R', idx, 'birth', row.birth, `${who} birth date`)}</td>
          <td>${cell('R', idx, 'zip', row.zip, `${who} ZIP`)}</td>
        </tr>`;
    })
    .join('');

  return `
    <div class="two-col">
      ${panelHtml('panel-s',
        panelHead('S', 'Hospital St. Gallen <span class="party-paren">(Sender S)</span>', '', 'panel-s-title'),
        tableHtml(['Name', 'Birth date', 'ZIP', 'Admissions'], sBody),
        ' aria-labelledby="panel-s-title"')}
      ${panelHtml('panel-r',
        panelHead('R', 'HSG research team <span class="party-paren">(Receiver R)</span>', '', 'panel-r-title'),
        tableHtml(['Study ID', 'Name', 'Birth date', 'ZIP'], rBody),
        ' aria-labelledby="panel-r-title"')}
    </div>
  `;
}

/* --- Step 2: Features (S left, R right) --- */
function renderStep2() {
  const modeBadge = state.usePhonetic ? 'Phonetic names (ü and ue count as u)' : 'Names compared letter by letter';
  const featureCells = (row, f) => FEATURES
    .map((feat) => `<td>${formatFeatureCell(f[feat.key], missingReason(row, feat.key))}</td>`)
    .join('');

  const sBody = state.sRows
    .map((row, idx) => {
      const extraClass = row.isExtra ? ' class="is-extra-row"' : '';
      return `
        <tr${extraClass}>
          <td><strong>${escapeHtml(row.name || '(empty)')}</strong></td>
          ${featureCells(row, state.sim.sFeatures[idx])}
        </tr>`;
    })
    .join('');

  const rBody = state.rRows
    .map((row, idx) => `
        <tr>
          <td class="mono"><strong>${escapeHtml(row.id)}</strong></td>
          ${featureCells(row, state.sim.rFeatures[idx])}
        </tr>`)
    .join('');

  return `
    <div class="two-col">
      ${panelHtml('panel-s', panelHead('S', 'Keys built by S', state.usePhonetic ? 'Phonetic' : ''),
        tableHtml(['Patient', ...FEATURE_HEADERS], sBody))}
      ${panelHtml('panel-r', panelHead('R', 'Keys built by R', state.usePhonetic ? 'Phonetic' : ''),
        tableHtml(['ID', ...FEATURE_HEADERS], rBody))}
    </div>
  `;
}

function revealedPanel(title, role, headers, body) {
  return panelHtml('panel-teacher',
    panelHead(null, title, role),
    tableHtml(headers, body),
    ' aria-label="Revealed values"');
}

/* --- Step 3: Circuit-PSI per feature (S left, R right) --- */
function renderStep3() {
  const sBody = state.rRows
    .map((row, idx) => {
      const psi = state.sim.psiRows[idx];
      return `
        <tr>
          <td class="mono">Slot ${idx + 1}</td>
          <td>${shareChip(psi.f1.sShare)}</td>
          <td>${shareChip(psi.f2.sShare)}</td>
          <td>${shareChip(psi.f3.sShare)}</td>
        </tr>`;
    })
    .join('');

  const rBody = state.rRows
    .map((row, idx) => {
      const psi = state.sim.psiRows[idx];
      return `
        <tr>
          <td class="mono"><strong>${escapeHtml(row.id)}</strong></td>
          <td>${shareChip(psi.f1.rShare)}</td>
          <td>${shareChip(psi.f2.rShare)}</td>
          <td>${shareChip(psi.f3.rShare)}</td>
        </tr>`;
    })
    .join('');

  let teacherPanel = '';
  if (state.teacherView) {
    const tBody = state.rRows
      .map((row, idx) => {
        const psi = state.sim.psiRows[idx];
        const cells = FEATURES.map((f) => {
          const e = psi[f.key];
          const badge = e.trueBit
            ? '<span class="badge badge-match">1 yes</span>'
            : '<span class="badge badge-muted">0 no</span>';
          return `<td class="xor-expr">${e.sShare} ⊕ ${e.rShare} = ${badge}</td>`;
        }).join('');
        return `
          <tr>
            <td class="mono"><strong>${escapeHtml(row.id)}</strong></td>
            ${cells}
          </tr>`;
      })
      .join('');

    teacherPanel = revealedPanel(
      'Revealed: the hidden yes/no answers',
      'Nobody sees this in the real protocol',
      ['R row', ...FEATURE_HEADERS],
      tBody
    );
  }

  return `
    ${flowStrip([
      { text: 'Test f1, f2, f3 one by one' },
      { text: 'Each answer split in two: s ⊕ r', focus: true },
      { text: 'Next: keep 1 winner' }
    ])}
    <div class="two-col">
      ${panelHtml('panel-s', panelHead('S', 'What S sees', "R's slots"),
        tableHtml(['Slot', 's for f1', 's for f2', 's for f3'], sBody))}
      ${panelHtml('panel-r', panelHead('R', 'What R sees', ''),
        tableHtml(['Study ID', 'r for f1', 'r for f2', 'r for f3'], rBody))}
    </div>
    ${teacherPanel}
  `;
}

/* --- Step 4: MPC on the shares, OTO rule (S left, R right) --- */
function renderStep4() {
  const row4 = (label, shares, matchShare) => `
        <tr>
          <td class="mono">${label}</td>
          <td>
            <span class="share-group">
              ${shareChip(shares.f1)}
              ${shareChip(shares.f2)}
              ${shareChip(shares.f3)}
            </span>
          </td>
          <td>${shareChip(matchShare)}</td>
        </tr>`;

  const sBody = state.rRows
    .map((row, idx) => {
      const oto = state.sim.otoRows[idx];
      return row4(`Slot ${idx + 1}`,
        { f1: oto.wShares.f1.s, f2: oto.wShares.f2.s, f3: oto.wShares.f3.s },
        oto.matchShares.s);
    })
    .join('');

  const rBody = state.rRows
    .map((row, idx) => {
      const oto = state.sim.otoRows[idx];
      return row4(`<strong>${escapeHtml(row.id)}</strong>`,
        { f1: oto.wShares.f1.r, f2: oto.wShares.f2.r, f3: oto.wShares.f3.r },
        oto.matchShares.r);
    })
    .join('');

  let teacherPanel = '';
  if (state.teacherView) {
    const tBody = state.rRows
      .map((row, idx) => {
        const psi = state.sim.psiRows[idx];
        const oto = state.sim.otoRows[idx];
        const step3Hits = FEATURES.filter((f) => psi[f.key].trueBit === 1).map((f) => f.label);
        const beforeText = step3Hits.length
          ? step3Hits.join(', ')
          : '<span class="badge badge-muted">none</span>';
        const afterText = oto.winningFeature
          ? `<span class="badge badge-match">${oto.winningFeature} wins</span> → ${escapeHtml(state.sRows[oto.chosenSIndex].name)}`
          : '<span class="badge badge-nomatch">no match</span>';
        const mXor = `${oto.matchShares.s} ⊕ ${oto.matchShares.r} = ${oto.matchBit}`;
        return `
          <tr>
            <td class="mono"><strong>${escapeHtml(row.id)}</strong></td>
            <td>${beforeText}</td>
            <td>${afterText}</td>
            <td class="xor-expr">${mXor}</td>
          </tr>`;
      })
      .join('');

    teacherPanel = revealedPanel(
      'Revealed: yeses from Step 3, winner in Step 4',
      'Only the first yes survives',
      ['R row', 'Yes in Step 3', 'Winner', 'Match (s ⊕ r)'],
      tBody
    );
  }

  return `
    ${flowStrip([
      { text: 'Up to 3 yeses per person' },
      { text: 'Keep the first: f1, then f2, then f3', focus: true },
      { text: 'At most 1 partner' }
    ])}
    <div class="two-col">
      ${panelHtml('panel-s', panelHead('S', 'What S sees', ''),
        tableHtml(['Slot', 'Winner? (f1, f2, f3)', 'Match?'], sBody))}
      ${panelHtml('panel-r', panelHead('R', 'What R sees', ''),
        tableHtml(['Study ID', 'Winner? (f1, f2, f3)', 'Match?'], rBody))}
    </div>
    ${teacherPanel}
  `;
}

/* --- Step 5: Payload shares (S left, R right) --- */
function renderStep5() {
  const sBody = state.rRows
    .map((row, idx) => {
      const p = state.sim.payloadRows[idx];
      return `
        <tr>
          <td class="mono">Slot ${idx + 1}</td>
          <td>${shareChip(p.sMatch)}</td>
          <td>${shareChip(p.sPayload, true)}</td>
        </tr>`;
    })
    .join('');

  const rBody = state.rRows
    .map((row, idx) => {
      const p = state.sim.payloadRows[idx];
      return `
        <tr>
          <td class="mono"><strong>${escapeHtml(row.id)}</strong></td>
          <td>${shareChip(p.rMatch)}</td>
          <td>${shareChip(p.rPayload, true)}</td>
        </tr>`;
    })
    .join('');

  let teacherPanel = '';
  if (state.teacherView) {
    const tBody = state.rRows
      .map((row, idx) => {
        const p = state.sim.payloadRows[idx];
        const recomb = p.sPayload ^ p.rPayload;
        const meaning = p.matched
          ? `<span class="badge badge-match">${escapeHtml(formatAdmissions(p.truePayload))}</span>`
          : `<span class="badge badge-nomatch">dummy ${recomb}, dropped in Step 6</span>`;
        return `
          <tr>
            <td class="mono"><strong>${escapeHtml(row.id)}</strong></td>
            <td class="xor-expr">${p.sMatch} ⊕ ${p.rMatch} = ${p.matched ? 1 : 0}</td>
            <td class="xor-expr">${p.sPayload} ⊕ ${p.rPayload} = ${recomb}</td>
            <td>${meaning}</td>
          </tr>`;
      })
      .join('');

    teacherPanel = revealedPanel(
      'Revealed: the locked numbers',
      'The dummies hide which rows did not match',
      ['R row', 'Match (s ⊕ r)', 'Number (s ⊕ r)', 'Meaning'],
      tBody
    );
  }

  return `
    ${flowStrip([
      { text: 'Match: s ⊕ r = admissions' },
      { text: 'No match: random dummy', focus: true },
      { text: 'Step 6 unlocks' }
    ])}
    <div class="two-col">
      ${panelHtml('panel-s', panelHead('S', 'What S sees', ''),
        tableHtml(['Slot', 'Match?', 'Admissions'], sBody))}
      ${panelHtml('panel-r', panelHead('R', 'What R sees', ''),
        tableHtml(['Study ID', 'Match?', 'Admissions'], rBody))}
    </div>
    ${teacherPanel}
  `;
}

/* --- Step 6: Output (S left, R right) --- */
function renderStep6() {
  const joinedBody = state.rRows
    .map((row, idx) => {
      const p = state.sim.payloadRows[idx];
      const mVal = p.sMatch ^ p.rMatch;
      const pVal = p.sPayload ^ p.rPayload;
      const resultCell = mVal === 1
        ? `<span class="badge badge-match">${escapeHtml(formatAdmissions(pVal))}</span>`
        : '<span class="badge badge-nomatch">no match</span>';
      const xorDetail = mVal === 1
        ? `${p.sPayload} ⊕ ${p.rPayload} = ${pVal}`
        : 'Match = 0, dummy dropped';

      return `
        <tr>
          <td class="mono"><strong>${escapeHtml(row.id)}</strong></td>
          <td>${escapeHtml(row.name || '(empty)')}</td>
          <td class="xor-expr">${xorDetail}</td>
          <td>${resultCell}</td>
        </tr>`;
    })
    .join('');

  const featureSummaryBody = state.rRows
    .map((row, idx) => {
      const oto = state.sim.otoRows[idx];
      let decidingCell = '<span class="badge badge-nomatch">none</span>';
      let matchedSCell = '<span class="muted">none</span>';
      let notesCell = 'No key matched.';

      if (oto.winningFeature !== null && oto.chosenSIndex !== null) {
        const featMeta = FEATURES.find((f) => f.key === oto.winningFeature);
        const sRec = state.sRows[oto.chosenSIndex];
        decidingCell = `<span class="badge badge-match">${featMeta.label} (${featMeta.desc})</span>`;
        matchedSCell = `${escapeHtml(sRec.name)} (${escapeHtml(formatAdmissions(parseAdmissions(sRec.admissions)))})`;

        const notes = [];
        if (oto.sameFeatureTies.length > 0) {
          const tied = oto.sameFeatureTies
            .map((sIdx) => escapeHtml(state.sRows[sIdx].name))
            .join(', ');
          notes.push(`Tie on ${featMeta.label} with ${tied}. The first S row wins.`);
        }
        if (oto.beatenCandidates.length > 0) {
          const beaten = oto.beatenCandidates
            .map((c) => `${escapeHtml(state.sRows[c.sIndex].name)} (${c.feature})`)
            .join(', ');
          notes.push(`${featMeta.label} beats the later hit ${beaten}.`);
        }
        notesCell = notes.length > 0 ? notes.join(' ') : 'First key that matched.';
      }

      return `
        <tr>
          <td class="mono"><strong>${escapeHtml(row.id)}</strong></td>
          <td>${decidingCell}</td>
          <td>${matchedSCell}</td>
          <td>${notesCell}</td>
        </tr>`;
    })
    .join('');

  const sLearns = `
    <div class="s-learns-box">
      <p class="s-learns-lead">Nothing about R or the matches.</p>
      <ul class="s-learns-list">
        <li>No names, birth dates or ZIP codes from R.</li>
        <li>Not which patients matched, not even how many.</li>
        <li>Only the table sizes and the number of keys are public (S has ${state.sRows.length} rows, R has ${state.rRows.length}, ${FEATURES.length} keys).</li>
      </ul>
    </div>`;

  return `
    <div class="two-col">
      ${panelHtml('panel-s', panelHead('S', 'What S learns', ''), sLearns)}
      ${panelHtml('panel-r', panelHead('R', 'What R learns', 's ⊕ r'),
        tableHtml(['Study ID', 'Participant', 's ⊕ r', 'Result'], joinedBody))}
    </div>
    ${panelHtml('panel-summary',
      panelHead(null, 'Behind the scenes: which key decided', 'teacher view'),
      `<p class="summary-note">For teaching only. In the real protocol neither party learns which key matched or which S record it was.</p>` +
      tableHtml(['Study ID', 'Deciding key', 'Matched S record', 'Note'], featureSummaryBody),
      ' aria-label="Behind the scenes: deciding key, not revealed by the protocol"')}
  `;
}

/* --- Help popup --- */
function renderHelp() {
  const meta = STEP_META[state.step - 1];
  document.getElementById('help-title').textContent = meta.title;
  document.getElementById('help-list').innerHTML = meta.bullets
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('');
}

function isHelpOpen() {
  return document.getElementById('help-backdrop').classList.contains('is-open');
}

function isSettingsOpen() {
  return document.getElementById('settings-backdrop').classList.contains('is-open');
}

function isAboutOpen() {
  return document.getElementById('about-backdrop').classList.contains('is-open');
}

function setAboutOpen(open, restoreFocus) {
  const backdrop = document.getElementById('about-backdrop');
  const btn = document.getElementById('btn-about');
  if (open) {
    setHelpOpen(false);
    setSettingsOpen(false);
  }
  backdrop.classList.toggle('is-open', open);
  backdrop.setAttribute('aria-hidden', String(!open));
  btn.setAttribute('aria-expanded', String(open));
  btn.classList.toggle('is-active', open);
  if (!open && restoreFocus) {
    btn.focus({ preventScroll: true });
  }
}

function setHelpOpen(open, restoreFocus) {
  const backdrop = document.getElementById('help-backdrop');
  const btn = document.getElementById('btn-help');
  if (open) {
    setSettingsOpen(false);
    setAboutOpen(false);
    renderHelp();
  }
  backdrop.classList.toggle('is-open', open);
  backdrop.setAttribute('aria-hidden', String(!open));
  btn.setAttribute('aria-expanded', String(open));
  btn.classList.toggle('is-active', open);
  if (!open && restoreFocus) {
    btn.focus({ preventScroll: true });
  }
}

function setSettingsOpen(open, restoreFocus) {
  const backdrop = document.getElementById('settings-backdrop');
  const btn = document.getElementById('btn-settings');
  if (open) {
    setHelpOpen(false);
    setAboutOpen(false);
  }
  backdrop.classList.toggle('is-open', open);
  backdrop.setAttribute('aria-hidden', String(!open));
  btn.setAttribute('aria-expanded', String(open));
  btn.classList.toggle('is-active', open);
  if (!open && restoreFocus) {
    btn.focus({ preventScroll: true });
  }
}

/* --- Master Render --- */
function render(direction) {
  // 1. Stepper
  const stepperList = document.getElementById('stepper-list');
  stepperList.innerHTML = STEP_META.map((s) => {
    let cls = 'step-btn';
    if (s.num === state.step) cls += ' is-current';
    else if (s.num < state.step) cls += ' is-done';
    const currentAttr = s.num === state.step ? ' aria-current="step"' : '';
    return `
      <li>
        <button type="button" class="${cls}" data-step="${s.num}"${currentAttr}>
          <span class="step-num">${s.num}</span>
          <span class="step-label">${escapeHtml(s.short)}</span>
        </button>
      </li>`;
  }).join('');

  // 1b. Mobile bottom dock step pills (1..6)
  const mobileSteps = document.getElementById('mobile-steps');
  if (mobileSteps) {
    mobileSteps.innerHTML = STEP_META.map((s) => {
      let cls = 'mobile-step-btn';
      if (s.num === state.step) cls += ' is-current';
      else if (s.num < state.step) cls += ' is-done';
      const currentAttr = s.num === state.step ? ' aria-current="step"' : '';
      return `
        <li>
          <button type="button" class="${cls}" data-step="${s.num}" aria-label="Step ${s.num}: ${escapeHtml(s.short)}"${currentAttr}>${s.num}</button>
        </li>`;
    }).join('');
  }

  // 2. Nav buttons (desktop + mobile dock) and contextual controls
  document.getElementById('btn-back').disabled = state.step === 1;
  document.getElementById('btn-next').disabled = state.step === 6;
  const btnBackMobile = document.getElementById('btn-back-mobile');
  const btnNextMobile = document.getElementById('btn-next-mobile');
  if (btnBackMobile) btnBackMobile.disabled = state.step === 1;
  if (btnNextMobile) btnNextMobile.disabled = state.step === 6;

  const isShareStep = state.step >= 3 && state.step <= 5;
  document.getElementById('btn-randomise').classList.toggle('hidden', !isShareStep);
  document.getElementById('teacher-toggle-wrap').classList.toggle('hidden', !isShareStep);

  document.getElementById('toggle-phonetic').checked = state.usePhonetic;
  document.getElementById('toggle-teacher').checked = state.teacherView;
  document.getElementById('toggle-second-candidate').checked = state.hasExtraCandidate;

  const hasActiveOption = state.usePhonetic || state.hasExtraCandidate || state.teacherView;
  document.getElementById('settings-dot').classList.toggle('hidden', !hasActiveOption);

  // 3. Status hint
  const hintEl = document.getElementById('status-hint');
  if (state.statusHint) {
    hintEl.textContent = state.statusHint;
    hintEl.classList.toggle('is-warn', state.statusHintType === 'warn');
    hintEl.classList.remove('hidden');
  } else {
    hintEl.textContent = '';
    hintEl.classList.remove('is-warn');
    hintEl.classList.add('hidden');
  }

  // 4. Step header and help popup content
  const meta = STEP_META[state.step - 1];
  document.getElementById('step-count').textContent = `Step ${meta.num} of 6: ${meta.short}`;
  document.getElementById('step-title').textContent = meta.heading;
  renderHelp();

  // 5. Stage content
  const stage = document.getElementById('stage');
  switch (state.step) {
    case 1: stage.innerHTML = renderStep1(); break;
    case 2: stage.innerHTML = renderStep2(); break;
    case 3: stage.innerHTML = renderStep3(); break;
    case 4: stage.innerHTML = renderStep4(); break;
    case 5: stage.innerHTML = renderStep5(); break;
    case 6: stage.innerHTML = renderStep6(); break;
  }

  // Subtle slide-in when the step changes (CSS turns it off for reduced motion)
  if (direction) {
    stage.classList.remove('enter-next', 'enter-prev');
    void stage.offsetWidth; // restart the animation
    stage.classList.add(direction > 0 ? 'enter-next' : 'enter-prev');
  }

  state.flashShares = false;

  // Keep the active step pill visible in the horizontal mobile stepper
  const activePill = document.querySelector('#stepper-list button.is-current');
  if (activePill && stepperList.scrollWidth > stepperList.clientWidth) {
    const left = activePill.offsetLeft - (stepperList.clientWidth - activePill.offsetWidth) / 2;
    stepperList.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* --------------------------------------------------------------------------
   5. Event Wiring
   -------------------------------------------------------------------------- */

function goToStep(stepNum, focusTarget) {
  const clamped = Math.max(1, Math.min(6, stepNum));
  if (clamped === state.step) return;

  const prevActive = document.activeElement;
  const direction = clamped > state.step ? 1 : -1;
  state.step = clamped;
  state.statusHint = '';
  state.statusHintType = 'info';
  render(direction);

  // On a phone scrolled far down, bring the new step's top back into view
  const stageTop = document.getElementById('stage').getBoundingClientRect().top;
  if (stageTop < 0) {
    window.scrollBy({ top: stageTop - 12, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  if (focusTarget === 'stepper') {
    // The stepper is rebuilt on render, so put focus back on the new current pill
    const btn = document.querySelector(`#stepper-list button[data-step="${state.step}"]`);
    if (btn) btn.focus({ preventScroll: true });
    return;
  }

  // Only when the focused button just got disabled (Back on step 1, Next on step 6)
  // hand focus to the other nav button. Never focus the stage itself.
  if (prevActive && prevActive.disabled) {
    const other = prevActive.id === 'btn-next'
      ? document.getElementById('btn-back')
      : document.getElementById('btn-next');
    if (other && !other.disabled) other.focus({ preventScroll: true });
  }
}

function buildSecondCandidateHint() {
  const contested = state.rRows
    .map((row, idx) => ({ row, oto: state.sim.otoRows[idx] }))
    .find(({ oto }) => oto.beatenCandidates.length > 0 || oto.sameFeatureTies.length > 0);

  if (!contested) {
    return 'Added a 2nd Anna Mueller to S (7 admissions). Step through to see who wins.';
  }

  const { row, oto } = contested;
  const winner = state.sRows[oto.chosenSIndex];
  const winnerAdmissions = formatAdmissions(parseAdmissions(winner.admissions));
  if (oto.beatenCandidates.length > 0) {
    const firstBeaten = oto.beatenCandidates[0];
    const loser = state.sRows[firstBeaten.sIndex];
    return `2nd candidate added. For ${row.id}, ${winner.name} (${winnerAdmissions}) wins on ${oto.winningFeature}. ${loser.name} loses because its first hit, ${firstBeaten.feature}, comes later.`;
  }
  return `2nd candidate added. ${row.id} now has two S candidates on ${oto.winningFeature}. The first S row wins: ${winner.name} (${winnerAdmissions}).`;
}

function handleTableEdit(event) {
  const input = event.target;
  if (!input.matches('.cell-input')) return;

  const party = input.dataset.party;
  const index = Number(input.dataset.index);
  const field = input.dataset.field;
  const rows = party === 'R' ? state.rRows : state.sRows;
  if (!rows[index]) return;

  if (field === 'admissions') {
    const cleaned = parseAdmissions(input.value);
    rows[index][field] = cleaned;
    if (event.type === 'change') {
      input.value = String(cleaned);
    }
  } else {
    rows[index][field] = input.value;
    input.classList.toggle('is-empty', !normaliseText(input.value));
  }

  // Recompute everything so later steps match the edited tables
  state.sim = runSimulation(state.rRows, state.sRows, state.usePhonetic);
  state.statusHint = 'Table changed. Press Next to follow it through the steps.';
  state.statusHintType = 'info';

  const hintEl = document.getElementById('status-hint');
  hintEl.textContent = state.statusHint;
  hintEl.classList.remove('is-warn');
  hintEl.classList.remove('hidden');
}

function isTypingTarget(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** True if the element sits inside a strip that really scrolls sideways. */
function insideHorizontalScroller(el) {
  if (!el || !el.closest) return false;
  const scroller = el.closest('.table-wrap, .stepper-list');
  return Boolean(scroller && scroller.scrollWidth > scroller.clientWidth + 1);
}

function initModals() {
  const aboutBtn = document.getElementById('btn-about');
  const aboutBackdrop = document.getElementById('about-backdrop');
  aboutBtn.addEventListener('click', () => setAboutOpen(!isAboutOpen()));
  document.getElementById('btn-about-close').addEventListener('click', () => setAboutOpen(false, true));
  aboutBackdrop.addEventListener('pointerdown', (event) => {
    if (event.target === aboutBackdrop) setAboutOpen(false);
  });

  const helpBtn = document.getElementById('btn-help');
  const helpBackdrop = document.getElementById('help-backdrop');
  helpBtn.addEventListener('click', () => setHelpOpen(!isHelpOpen()));
  document.getElementById('btn-help-close').addEventListener('click', () => setHelpOpen(false, true));
  helpBackdrop.addEventListener('pointerdown', (event) => {
    if (event.target === helpBackdrop) setHelpOpen(false);
  });

  const settingsBtn = document.getElementById('btn-settings');
  const settingsBackdrop = document.getElementById('settings-backdrop');
  settingsBtn.addEventListener('click', () => setSettingsOpen(!isSettingsOpen()));
  document.getElementById('btn-settings-close').addEventListener('click', () => setSettingsOpen(false, true));
  settingsBackdrop.addEventListener('pointerdown', (event) => {
    if (event.target === settingsBackdrop) setSettingsOpen(false);
  });
}

function initEvents() {
  document.getElementById('btn-back').addEventListener('click', () => goToStep(state.step - 1));
  document.getElementById('btn-next').addEventListener('click', () => goToStep(state.step + 1));

  const btnBackMobile = document.getElementById('btn-back-mobile');
  const btnNextMobile = document.getElementById('btn-next-mobile');
  if (btnBackMobile) btnBackMobile.addEventListener('click', () => goToStep(state.step - 1));
  if (btnNextMobile) btnNextMobile.addEventListener('click', () => goToStep(state.step + 1));

  const mobileSteps = document.getElementById('mobile-steps');
  if (mobileSteps) {
    mobileSteps.addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-step]');
      if (!btn) return;
      goToStep(Number(btn.dataset.step));
    });
  }

  document.getElementById('btn-reset').addEventListener('click', () => {
    const direction = state.step === 1 ? 0 : -1;
    state.step = 1;
    state.usePhonetic = false;
    state.teacherView = false;
    state.hasExtraCandidate = false;
    state.statusHint = 'Back to the default example.';
    state.statusHintType = 'info';
    state.rRows = cloneRows(DEFAULT_R);
    state.sRows = cloneRows(DEFAULT_S);
    state.sim = runSimulation(state.rRows, state.sRows, state.usePhonetic);
    render(direction);
  });

  document.getElementById('stepper-list').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-step]');
    if (!btn) return;
    goToStep(Number(btn.dataset.step), 'stepper');
  });

  document.getElementById('toggle-phonetic').addEventListener('change', (event) => {
    state.usePhonetic = event.target.checked;
    state.sim = runSimulation(state.rRows, state.sRows, state.usePhonetic);
    state.statusHint = state.usePhonetic
      ? 'Phonetic name key on. Mueller and Müller now give the same key.'
      : 'Phonetic name key off. Names must match letter by letter.';
    state.statusHintType = 'info';
    render();
  });

  document.getElementById('toggle-teacher').addEventListener('change', (event) => {
    state.teacherView = event.target.checked;
    render();
  });

  document.getElementById('btn-randomise').addEventListener('click', () => {
    state.sim = rerandomiseSimulationShares(state.sim, state.sRows);
    state.flashShares = true;
    state.statusHint = 'New random shares. The hidden answers stay the same.';
    state.statusHintType = 'info';
    render();
  });

  document.getElementById('toggle-second-candidate').addEventListener('change', (event) => {
    if (event.target.checked) {
      if (!state.hasExtraCandidate) state.sRows.push({ ...EXTRA_CANDIDATE_S });
      state.hasExtraCandidate = true;
      state.sim = runSimulation(state.rRows, state.sRows, state.usePhonetic);
      state.statusHint = buildSecondCandidateHint();
    } else {
      state.sRows = state.sRows.filter((row) => !row.isExtra);
      state.hasExtraCandidate = false;
      state.sim = runSimulation(state.rRows, state.sRows, state.usePhonetic);
      state.statusHint = 'Removed the 2nd candidate.';
    }
    state.statusHintType = 'info';
    render();
  });

  // Table edits on the stage (input for live recompute, change to tidy numbers)
  const stage = document.getElementById('stage');
  stage.addEventListener('input', handleTableEdit);
  stage.addEventListener('change', handleTableEdit);
  stage.addEventListener('animationend', () => stage.classList.remove('enter-next', 'enter-prev'));

  // Keyboard: arrows move, ? toggles step help, i toggles info, Escape closes open modal
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (isAboutOpen()) { setAboutOpen(false, true); return; }
      if (isHelpOpen()) { setHelpOpen(false, true); return; }
      if (isSettingsOpen()) { setSettingsOpen(false, true); return; }
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTypingTarget(event.target)) return;

    if (event.key === '?') {
      event.preventDefault();
      setHelpOpen(!isHelpOpen());
      return;
    }
    if (event.key === 'i' || event.key === 'I') {
      event.preventDefault();
      setAboutOpen(!isAboutOpen());
      return;
    }
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    if (insideHorizontalScroller(event.target)) return;
    event.preventDefault();
    goToStep(event.key === 'ArrowRight' ? state.step + 1 : state.step - 1);
  });

  initModals();
}

if (typeof document !== 'undefined') {
  initEvents();
  render();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_R, DEFAULT_S, EXTRA_CANDIDATE_S, FEATURES, STEP_META,
    phoneticNameKey, computeRecordFeatures, runSimulation, rerandomiseSimulationShares
  };
}

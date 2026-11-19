/* ==========================================================================
   Private Fuzzy Left Join — Didactic Simulator (app.js)
   Concept: Han, Kim, Son, "Private Computation on Common Fuzzy Records", PoPETs 2025.

   Structure:
     1. Scenario defaults & metadata
     2. Pure functions: normalisation, phonetic key, features, shares, Circuit-PSI, OTO MPC, payload
     3. Application state
     4. Rendering (Steps 1–6) & event wiring
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   1. Scenario Defaults & Metadata
   -------------------------------------------------------------------------- */

const DEFAULT_R = [
  { id: 'P-017', name: 'Anna Mueller', birth: '12.03.1985', zip: '9000' },
  { id: 'P-018', name: 'Peter Frei',   birth: '',           zip: '9000' },
  { id: 'P-019', name: 'Lena Huber',   birth: '22.11.1978', zip: '9500' }
];

const DEFAULT_S = [
  { id: 'S-1', name: 'Anna Müller', birth: '12.03.1985', zip: '9000', admissions: 2 },
  { id: 'S-2', name: 'Peter Frei',  birth: '01.07.1990', zip: '9000', admissions: 1 },
  { id: 'S-3', name: 'Marco Rossi', birth: '05.05.1969', zip: '9010', admissions: 3 }
];

// Second candidate for the "Ordered" demo:
// - With phonetic key OFF: matches P-017 on f2 (earlier than Anna Müller's f3) -> f2 wins (7).
// - With phonetic key ON:  Anna Müller matches P-017 on f1, this row on f2 (later) -> f1 wins (2).
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

const STEP_META = [
  {
    num: 1,
    short: 'Inputs',
    title: '1/6 · Inputs',
    caption:
      'S (left) holds hospital admissions; R (right) wants them for its participants. No shared ID, dirty data, neither side sees the other’s table.'
  },
  {
    num: 2,
    short: 'Features',
    title: '2/6 · Features',
    caption:
      'Both sides build 3 ordered features (f1 strongest → f3 weakest) locally. Empty fields make any feature containing them unusable.'
  },
  {
    num: 3,
    short: 'Circuit-PSI',
    title: '3/6 · Circuit-PSI',
    caption:
      'Test f1, f2, and f3 separately: does S have it? Each yes/no bit b is split into two random-looking shares (s for S, r for R, with s ⊕ r = b).'
  },
  {
    num: 4,
    short: 'Pick 1 (OTO)',
    title: '4/6 · MPC (OTO)',
    caption:
      'Step 3 gave 3 separate yes/no shares (multiple “yes” possible). MPC keeps only the EARLIEST “yes” (f1 → f2 → f3) and outputs fresh shares (simulated centrally).'
  },
  {
    num: 5,
    short: 'Payload',
    title: '5/6 · Payload',
    caption:
      'Each row gets a locked admissions number split into two shares (s ⊕ r = admissions). Unmatched rows get a random dummy number so neither side can tell who matched.'
  },
  {
    num: 6,
    short: 'Output',
    title: '6/6 · Output',
    caption:
      'S sends its shares to R. R computes s ⊕ r to read the joined table (admissions or no match ⊥). S learns nothing.'
  }
];

/* --------------------------------------------------------------------------
   2. Pure Functions (Normalisation, Features, Shares, Circuit-PSI, OTO, Payload)
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
 * Earliest agreeing feature wins (f1 < f2 < f3); at most one S record is chosen.
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
 * Redraw all random shares (Steps 3–5) while keeping the underlying true bits unchanged.
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
   4. Rendering Helpers & Step Views
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
    return `<span class="badge badge-unusable">— unusable (${escapeHtml(missingLabel)})</span>`;
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
  return missing.length ? `missing ${missing.join(' & ')}` : 'empty';
}

function shareChip(val, wide) {
  const cls = ['share-chip'];
  if (wide) cls.push('share-chip-wide');
  if (state.flashShares) cls.push('share-flash');
  return `<span class="${cls.join(' ')}">${escapeHtml(val)}</span>`;
}

/* --- Step 1: Inputs (editable tables; S left, R right) --- */
function renderStep1() {
  const sBody = state.sRows
    .map((row, idx) => {
      const extraClass = row.isExtra ? ' class="is-extra-row"' : '';
      const extraBadge = row.isExtra ? '<span class="badge badge-extra">2nd</span>' : '';
      const nameEmpty = !normaliseText(row.name) ? ' is-empty' : '';
      const birthEmpty = !normaliseText(row.birth) ? ' is-empty' : '';
      const zipEmpty = !normaliseText(row.zip) ? ' is-empty' : '';
      return `
        <tr${extraClass}>
          <td>
            <input type="text" class="cell-input${nameEmpty}" data-party="S" data-index="${idx}" data-field="name"
                   value="${escapeHtml(row.name)}" placeholder="(empty)" aria-label="S row ${idx + 1} name">
            ${extraBadge}
          </td>
          <td>
            <input type="text" class="cell-input${birthEmpty}" data-party="S" data-index="${idx}" data-field="birth"
                   value="${escapeHtml(row.birth)}" placeholder="(empty)" aria-label="S row ${idx + 1} birth date">
          </td>
          <td>
            <input type="text" class="cell-input${zipEmpty}" data-party="S" data-index="${idx}" data-field="zip"
                   value="${escapeHtml(row.zip)}" placeholder="(empty)" aria-label="S row ${idx + 1} ZIP">
          </td>
          <td>
            <input type="text" inputmode="numeric" pattern="[0-9]*" class="cell-input cell-input-num"
                   data-party="S" data-index="${idx}" data-field="admissions"
                   value="${escapeHtml(row.admissions)}" aria-label="S row ${idx + 1} admissions payload">
          </td>
        </tr>`;
    })
    .join('');

  const rBody = state.rRows
    .map((row, idx) => {
      const idEmpty = !normaliseText(row.id) ? ' is-empty' : '';
      const birthEmpty = !normaliseText(row.birth) ? ' is-empty' : '';
      const nameEmpty = !normaliseText(row.name) ? ' is-empty' : '';
      const zipEmpty = !normaliseText(row.zip) ? ' is-empty' : '';
      return `
        <tr>
          <td>
            <input type="text" class="cell-input cell-input-id${idEmpty}" data-party="R" data-index="${idx}" data-field="id"
                   value="${escapeHtml(row.id)}" placeholder="(empty)" aria-label="R row ${idx + 1} study ID">
          </td>
          <td>
            <input type="text" class="cell-input${nameEmpty}" data-party="R" data-index="${idx}" data-field="name"
                   value="${escapeHtml(row.name)}" placeholder="(empty)" aria-label="R row ${escapeHtml(row.id || String(idx + 1))} name">
          </td>
          <td>
            <input type="text" class="cell-input${birthEmpty}" data-party="R" data-index="${idx}" data-field="birth"
                   value="${escapeHtml(row.birth)}" placeholder="(empty)" aria-label="R row ${escapeHtml(row.id || String(idx + 1))} birth date">
          </td>
          <td>
            <input type="text" class="cell-input${zipEmpty}" data-party="R" data-index="${idx}" data-field="zip"
                   value="${escapeHtml(row.zip)}" placeholder="(empty)" aria-label="R row ${escapeHtml(row.id || String(idx + 1))} ZIP">
          </td>
        </tr>`;
    })
    .join('');

  return `
    <div class="two-col">
      <section class="panel panel-s" aria-labelledby="panel-s-title">
        <div class="panel-header">
          <h2 class="panel-title" id="panel-s-title">Sender S · Hospital St. Gallen</h2>
          <span class="panel-role">Patients + payload (editable)</span>
        </div>
        <div class="panel-body">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Birth date</th>
                  <th>ZIP</th>
                  <th>Admissions</th>
                </tr>
              </thead>
              <tbody>${sBody}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="panel panel-r" aria-labelledby="panel-r-title">
        <div class="panel-header">
          <h2 class="panel-title" id="panel-r-title">Receiver R · HSG research team</h2>
          <span class="panel-role">Study participants (editable)</span>
        </div>
        <div class="panel-body">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Study ID</th>
                  <th>Name</th>
                  <th>Birth date</th>
                  <th>ZIP</th>
                </tr>
              </thead>
              <tbody>${rBody}</tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
}

/* --- Step 2: Features (S left, R right) --- */
function renderStep2() {
  const modeBadge = state.usePhonetic ? 'Phonetic key ON (ü/ue → u)' : 'Plain lowercase';

  const sBody = state.sRows
    .map((row, idx) => {
      const f = state.sim.sFeatures[idx];
      const extraClass = row.isExtra ? ' class="is-extra-row"' : '';
      return `
        <tr${extraClass}>
          <td><strong>${escapeHtml(row.name || '(empty)')}</strong></td>
          <td>${formatFeatureCell(f.f1, missingReason(row, 'f1'))}</td>
          <td>${formatFeatureCell(f.f2, missingReason(row, 'f2'))}</td>
          <td>${formatFeatureCell(f.f3, missingReason(row, 'f3'))}</td>
        </tr>`;
    })
    .join('');

  const rBody = state.rRows
    .map((row, idx) => {
      const f = state.sim.rFeatures[idx];
      return `
        <tr>
          <td class="mono"><strong>${escapeHtml(row.id)}</strong></td>
          <td>${formatFeatureCell(f.f1, missingReason(row, 'f1'))}</td>
          <td>${formatFeatureCell(f.f2, missingReason(row, 'f2'))}</td>
          <td>${formatFeatureCell(f.f3, missingReason(row, 'f3'))}</td>
        </tr>`;
    })
    .join('');

  return `
    <div class="two-col">
      <section class="panel panel-s">
        <div class="panel-header">
          <h2 class="panel-title">Sender S · Local features</h2>
          <span class="panel-role">${modeBadge}</span>
        </div>
        <div class="panel-body">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>f1 (name + birth)</th>
                  <th>f2 (name + ZIP)</th>
                  <th>f3 (birth + ZIP)</th>
                </tr>
              </thead>
              <tbody>${sBody}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="panel panel-r">
        <div class="panel-header">
          <h2 class="panel-title">Receiver R · Local features</h2>
          <span class="panel-role">${modeBadge}</span>
        </div>
        <div class="panel-body">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>f1 (name + birth)</th>
                  <th>f2 (name + ZIP)</th>
                  <th>f3 (birth + ZIP)</th>
                </tr>
              </thead>
              <tbody>${rBody}</tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
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
            ? '<span class="badge badge-match">1 (yes)</span>'
            : '<span class="badge badge-muted">0</span>';
          return `<td class="xor-expr">${e.sShare} ⊕ ${e.rShare} = ${badge}</td>`;
        }).join('');
        return `
          <tr>
            <td class="mono"><strong>${escapeHtml(row.id)}</strong></td>
            ${cells}
          </tr>`;
      })
      .join('');

    teacherPanel = `
      <section class="panel panel-teacher" aria-label="Teacher view">
        <div class="panel-header">
          <h2 class="panel-title">Teacher view · True bits per feature (hidden in real protocol)</h2>
          <span class="panel-role">s ⊕ r = b</span>
        </div>
        <div class="panel-body">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>R row</th>
                  <th>f1 (name + birth)</th>
                  <th>f2 (name + ZIP)</th>
                  <th>f3 (birth + ZIP)</th>
                </tr>
              </thead>
              <tbody>${tBody}</tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  return `
    <div class="flow-strip" aria-hidden="true">
      <span class="flow-pill">f1, f2, f3 tested separately</span>
      <span class="flow-arrow">→</span>
      <span class="flow-pill is-focus">3 locked yes/no shares per row (s ⊕ r = b)</span>
      <span class="flow-arrow">→</span>
      <span class="flow-pill">Next: pick only 1 winner</span>
    </div>
    <div class="two-col">
      <section class="panel panel-s">
        <div class="panel-header">
          <h2 class="panel-title">What S sees (Sender)</h2>
          <span class="panel-role">Only S’s random share s ∈ {0, 1}</span>
        </div>
        <div class="panel-body">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>s(f1)</th>
                  <th>s(f2)</th>
                  <th>s(f3)</th>
                </tr>
              </thead>
              <tbody>${sBody}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="panel panel-r">
        <div class="panel-header">
          <h2 class="panel-title">What R sees (Receiver)</h2>
          <span class="panel-role">Only R’s random share r ∈ {0, 1}</span>
        </div>
        <div class="panel-body">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Study ID</th>
                  <th>r(f1)</th>
                  <th>r(f2)</th>
                  <th>r(f3)</th>
                </tr>
              </thead>
              <tbody>${rBody}</tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
    ${teacherPanel}
  `;
}

/* --- Step 4: MPC on the shares — OTO rule (S left, R right) --- */
function renderStep4() {
  const sBody = state.rRows
    .map((row, idx) => {
      const oto = state.sim.otoRows[idx];
      return `
        <tr>
          <td class="mono">Slot ${idx + 1}</td>
          <td>
            <span class="share-group">
              ${shareChip(oto.wShares.f1.s)}
              ${shareChip(oto.wShares.f2.s)}
              ${shareChip(oto.wShares.f3.s)}
            </span>
          </td>
          <td>${shareChip(oto.matchShares.s)}</td>
        </tr>`;
    })
    .join('');

  const rBody = state.rRows
    .map((row, idx) => {
      const oto = state.sim.otoRows[idx];
      return `
        <tr>
          <td class="mono"><strong>${escapeHtml(row.id)}</strong></td>
          <td>
            <span class="share-group">
              ${shareChip(oto.wShares.f1.r)}
              ${shareChip(oto.wShares.f2.r)}
              ${shareChip(oto.wShares.f3.r)}
            </span>
          </td>
          <td>${shareChip(oto.matchShares.r)}</td>
        </tr>`;
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
          ? `<span class="badge badge-match">only ${oto.winningFeature} wins</span> → ${escapeHtml(state.sRows[oto.chosenSIndex].name)}`
          : '<span class="badge badge-nomatch">no match (⊥)</span>';
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

    teacherPanel = `
      <section class="panel panel-teacher" aria-label="Teacher view">
        <div class="panel-header">
          <h2 class="panel-title">Teacher view · Step 3 hits → Step 4 single winner</h2>
          <span class="panel-role">At most 1 feature kept (earliest wins)</span>
        </div>
        <div class="panel-body">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>R row</th>
                  <th>Step 3 hits</th>
                  <th>Step 4 OTO winner</th>
                  <th>Match bit (s ⊕ r)</th>
                </tr>
              </thead>
              <tbody>${tBody}</tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  return `
    <div class="flow-strip" aria-hidden="true">
      <span class="flow-pill">3 shares from Step 3</span>
      <span class="flow-arrow">→</span>
      <span class="flow-pill is-focus">MPC keeps ONLY earliest “yes” (f1 → f2 → f3)</span>
      <span class="flow-arrow">→</span>
      <span class="flow-pill">Fresh shares (at most 1 winner)</span>
    </div>
    <div class="two-col">
      <section class="panel panel-s">
        <div class="panel-header">
          <h2 class="panel-title">What S sees (Sender)</h2>
          <span class="panel-role">Fresh OTO shares (s side)</span>
        </div>
        <div class="panel-body">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Winner share (f1 · f2 · f3)</th>
                  <th>Match? share</th>
                </tr>
              </thead>
              <tbody>${sBody}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="panel panel-r">
        <div class="panel-header">
          <h2 class="panel-title">What R sees (Receiver)</h2>
          <span class="panel-role">Fresh OTO shares (r side)</span>
        </div>
        <div class="panel-body">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Study ID</th>
                  <th>Winner share (f1 · f2 · f3)</th>
                  <th>Match? share</th>
                </tr>
              </thead>
              <tbody>${rBody}</tbody>
            </table>
          </div>
        </div>
      </section>
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
          : `<span class="badge badge-nomatch">dummy noise (${recomb}) — discarded in Step 6</span>`;
        return `
          <tr>
            <td class="mono"><strong>${escapeHtml(row.id)}</strong></td>
            <td class="xor-expr">${p.sMatch} ⊕ ${p.rMatch} = ${p.matched ? 1 : 0}</td>
            <td class="xor-expr">${p.sPayload} ⊕ ${p.rPayload} = ${recomb}</td>
            <td>${meaning}</td>
          </tr>`;
      })
      .join('');

    teacherPanel = `
      <section class="panel panel-teacher" aria-label="Teacher view">
        <div class="panel-header">
          <h2 class="panel-title">Teacher view · Unlocked values (s ⊕ r)</h2>
          <span class="panel-role">Dummy numbers hide non-matches from S</span>
        </div>
        <div class="panel-body">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>R row</th>
                  <th>Match? (s ⊕ r)</th>
                  <th>Locked value (s ⊕ r)</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>${tBody}</tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  return `
    <div class="flow-strip" aria-hidden="true">
      <span class="flow-pill">Match → s ⊕ r = admissions</span>
      <span class="flow-arrow">·</span>
      <span class="flow-pill is-focus">No match → random dummy number (hides non-matches)</span>
      <span class="flow-arrow">→</span>
      <span class="flow-pill">Step 6 unlocks</span>
    </div>
    <div class="two-col">
      <section class="panel panel-s">
        <div class="panel-header">
          <h2 class="panel-title">What S sees (Sender)</h2>
          <span class="panel-role">Random-looking shares (cannot tell match vs. dummy)</span>
        </div>
        <div class="panel-body">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Match? (share)</th>
                  <th>Admissions (locked share)</th>
                </tr>
              </thead>
              <tbody>${sBody}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="panel panel-r">
        <div class="panel-header">
          <h2 class="panel-title">What R sees (Receiver)</h2>
          <span class="panel-role">Random-looking shares (cannot tell match vs. dummy)</span>
        </div>
        <div class="panel-body">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Study ID</th>
                  <th>Match? (share)</th>
                  <th>Admissions (locked share)</th>
                </tr>
              </thead>
              <tbody>${rBody}</tbody>
            </table>
          </div>
        </div>
      </section>
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
        : `<span class="badge badge-nomatch">no match (⊥)</span>`;
      const xorDetail = mVal === 1
        ? `${p.sPayload} ⊕ ${p.rPayload} = ${pVal}`
        : `Match? = 0 → discard dummy`;

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
      let decidingCell = '<span class="badge badge-nomatch">none (⊥)</span>';
      let matchedSCell = '—';
      let notesCell = 'No feature agreed.';

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
          notes.push(`Tie in S on ${featMeta.label} (${tied}); first S row picked.`);
        }
        if (oto.beatenCandidates.length > 0) {
          const beaten = oto.beatenCandidates
            .map((c) => `${escapeHtml(state.sRows[c.sIndex].name)} (${c.feature})`)
            .join(', ');
          notes.push(`${featMeta.label} beat later: ${beaten}.`);
        }
        notesCell = notes.length > 0 ? notes.join(' ') : 'Earliest matching feature.';
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

  return `
    <div class="two-col">
      <section class="panel panel-s">
        <div class="panel-header">
          <h2 class="panel-title">What S learns (Hospital St. Gallen)</h2>
          <span class="panel-role">Nothing</span>
        </div>
        <div class="panel-body">
          <div class="s-learns-box">
            <p><strong>S learns nothing about R or matches.</strong></p>
            <ul class="s-learns-list">
              <li>Never sees R’s names, birth dates, or ZIP codes.</li>
              <li>Never learns how many or which patients matched (e.g. whether Anna Müller matched).</li>
              <li>Only table sizes (|S| = ${state.sRows.length}, |R| = ${state.rRows.length}) are public.</li>
            </ul>
          </div>
        </div>
      </section>

      <section class="panel panel-r">
        <div class="panel-header">
          <h2 class="panel-title">What R learns (HSG research team)</h2>
          <span class="panel-role">Joined table via s ⊕ r</span>
        </div>
        <div class="panel-body">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Study ID</th>
                  <th>Participant</th>
                  <th>s ⊕ r</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>${joinedBody}</tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <section class="panel panel-summary" aria-label="Deciding feature summary">
      <div class="panel-header">
        <h2 class="panel-title">Which feature decided each match?</h2>
        <span class="panel-role">Didactic summary (hidden inside MPC in the real protocol)</span>
      </div>
      <div class="panel-body">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Study ID</th>
                <th>Deciding feature</th>
                <th>Matched S record</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>${featureSummaryBody}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

/* --- Master Render --- */
function render() {
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

  // 2. Nav buttons & contextual controls
  document.getElementById('btn-back').disabled = state.step === 1;
  document.getElementById('btn-next').disabled = state.step === 6;

  const isShareStep = state.step >= 3 && state.step <= 5;
  document.getElementById('btn-randomise').classList.toggle('hidden', !isShareStep);
  document.getElementById('teacher-toggle-wrap').classList.toggle('hidden', !isShareStep);

  document.getElementById('toggle-phonetic').checked = state.usePhonetic;
  document.getElementById('toggle-teacher').checked = state.teacherView;

  const btnSecond = document.getElementById('btn-second-candidate');
  btnSecond.textContent = state.hasExtraCandidate
    ? 'Remove 2nd candidate'
    : 'Add 2nd candidate in S';
  btnSecond.classList.toggle('is-active', state.hasExtraCandidate);
  btnSecond.setAttribute('aria-pressed', String(state.hasExtraCandidate));

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

  // 4. Caption
  const meta = STEP_META[state.step - 1];
  document.getElementById('caption-step').textContent = meta.title;
  document.getElementById('caption-text').textContent = meta.caption;

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

  state.flashShares = false;
}

/* --------------------------------------------------------------------------
   5. Event Wiring
   -------------------------------------------------------------------------- */

function goToStep(stepNum, focusTarget) {
  const clamped = Math.max(1, Math.min(6, stepNum));
  if (clamped !== state.step) {
    const prevActive = document.activeElement;
    state.step = clamped;
    state.statusHint = '';
    state.statusHintType = 'info';
    render();

    // Preserve keyboard focus when stepper is rebuilt or a nav button becomes disabled/hidden
    if (focusTarget === 'stepper') {
      const btn = document.querySelector(`#stepper-list button[data-step="${state.step}"]`);
      if (btn) btn.focus();
    } else if (
      prevActive &&
      (prevActive.disabled || prevActive.classList.contains('hidden') || !document.body.contains(prevActive))
    ) {
      document.getElementById('stage').focus();
    }
  }
}

function buildSecondCandidateHint() {
  const contested = state.rRows
    .map((row, idx) => ({ row, oto: state.sim.otoRows[idx] }))
    .find(({ oto }) => oto.beatenCandidates.length > 0 || oto.sameFeatureTies.length > 0);

  if (!contested) {
    return 'Added second candidate in S (Anna Mueller, 7 admissions). Step through 1–6 to see the updated OTO match.';
  }

  const { row, oto } = contested;
  const winner = state.sRows[oto.chosenSIndex];
  const winnerAdmissions = formatAdmissions(parseAdmissions(winner.admissions));
  if (oto.beatenCandidates.length > 0) {
    const firstBeaten = oto.beatenCandidates[0];
    const loser = state.sRows[firstBeaten.sIndex];
    return `Added second candidate in S: for ${row.id}, ${winner.name} (${winnerAdmissions}) wins via ${oto.winningFeature}, beating ${loser.name} on later ${firstBeaten.feature}.`;
  }
  return `Added second candidate in S: ${row.id} now has multiple S candidates on ${oto.winningFeature}; ${winner.name} (${winnerAdmissions}) is picked.`;
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

  // Recompute everything consistently on Step 1
  state.sim = runSimulation(state.rRows, state.sRows, state.usePhonetic);
  state.statusHint = 'Table edited — all steps recomputed from Step 1. Click Next to walk through the updated protocol.';
  state.statusHintType = 'warn';

  const hintEl = document.getElementById('status-hint');
  hintEl.textContent = state.statusHint;
  hintEl.classList.add('is-warn');
  hintEl.classList.remove('hidden');
}

function initEvents() {
  document.getElementById('btn-back').addEventListener('click', () => goToStep(state.step - 1));
  document.getElementById('btn-next').addEventListener('click', () => goToStep(state.step + 1));

  document.getElementById('btn-reset').addEventListener('click', () => {
    state.step = 1;
    state.usePhonetic = false;
    state.teacherView = false;
    state.hasExtraCandidate = false;
    state.statusHint = 'Reset to default scenario.';
    state.statusHintType = 'info';
    state.rRows = cloneRows(DEFAULT_R);
    state.sRows = cloneRows(DEFAULT_S);
    state.sim = runSimulation(state.rRows, state.sRows, state.usePhonetic);
    render();
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
      ? 'Phonetic name key enabled: Mueller and Müller now map to the same key.'
      : 'Phonetic name key disabled: names are compared as plain normalised strings.';
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
    state.statusHint = 'Shares re-randomised: individual shares changed, while the underlying true bits stayed identical.';
    state.statusHintType = 'info';
    render();
  });

  document.getElementById('btn-second-candidate').addEventListener('click', () => {
    if (!state.hasExtraCandidate) {
      state.sRows.push({ ...EXTRA_CANDIDATE_S });
      state.hasExtraCandidate = true;
      state.sim = runSimulation(state.rRows, state.sRows, state.usePhonetic);
      state.statusHint = buildSecondCandidateHint();
      state.statusHintType = 'info';
    } else {
      state.sRows = state.sRows.filter((row) => !row.isExtra);
      state.hasExtraCandidate = false;
      state.sim = runSimulation(state.rRows, state.sRows, state.usePhonetic);
      state.statusHint = 'Removed second candidate from S.';
      state.statusHintType = 'info';
    }
    render();
  });

  // Delegate table edits on the stage (input for live recompute, change to normalise numeric display)
  const stage = document.getElementById('stage');
  stage.addEventListener('input', handleTableEdit);
  stage.addEventListener('change', handleTableEdit);

  // Keyboard navigation: Left/Right arrows when not typing or scrolling a table
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const tag = target && target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (target && target.closest && target.closest('.table-wrap')) return;
    if (event.key === 'ArrowRight') {
      goToStep(state.step + 1);
    } else if (event.key === 'ArrowLeft') {
      goToStep(state.step - 1);
    }
  });
}

initEvents();
render();

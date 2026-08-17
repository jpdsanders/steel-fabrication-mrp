/**
 * 1D Cutting-Stock Nesting Engine
 *
 * Algorithm: Best-Fit-Decreasing (BFD) heuristic with kerf-awareness.
 * Remnants are offered as zero-cost bins before new stock is opened.
 * For each profile group, all candidate stock lengths are solved independently so
 * the caller can compare options (waste%, bars needed) and pick the best one.
 *
 * Kerf convention (per spike): each cut AFTER the first on a bar costs kerfIn.
 * Bar feasibility = sum(parts) + kerf × (N_cuts − 1) ≤ stock length.
 */

export interface DemandItem {
  partId: number;
  lengthIn: number;
  quantity: number;
  label: string;
}

export interface RemnantItem {
  ref: string;
  lengthIn: number;
}

export interface StockOption {
  vendorId: number;
  vendorName: string;
  lengthIn: number;
}

export interface Cut {
  partId: number | null;
  lengthIn: number;
  quantity: number;
  label: string;
}

export interface Bar {
  source: "stock" | "remnant";
  vendorId: number | null;
  vendorName: string | null;
  stockLengthIn: number;
  wasteIn: number;
  remnantRef: string | null;
  cuts: Cut[];
}

export interface MissingPart {
  partId: number;
  lengthIn: number;
  label: string;
  reason: string;
}

export interface NestingOption {
  vendorId: number;
  vendorName: string;
  stockLengthIn: number;
  /**
   * Whether every demanded piece is accounted for in this option.
   * An option is incomplete when one or more pieces exceed this stock length
   * and cannot be placed. Incomplete options must not be accepted.
   */
  isComplete: boolean;
  /**
   * Pieces that cannot fit on this stock length (empty when isComplete = true).
   */
  missingParts: MissingPart[];
  bars: Bar[];
  totalStockIn: number;
  totalUsedIn: number;
  totalWasteIn: number;
  wastePercent: number;
}

export interface UnnestableItem {
  partId: number;
  lengthIn: number;
  label: string;
  reason: string;
}

export interface GroupNestingResult {
  profileType: string;
  profileSize: string;
  grade: string;
  /**
   * Options ranked by wastePercent ascending (complete options first, then incomplete).
   */
  options: NestingOption[];
  /**
   * Pieces that cannot fit on ANY available stock length.
   */
  unnestable: UnnestableItem[];
}

export interface NestingInput {
  profileType: string;
  profileSize: string;
  grade: string;
  demand: DemandItem[];
  remnants: RemnantItem[];
  stockOptions: StockOption[];
  kerfIn: number;
}

// ---------------------------------------------------------------------------
// Core BFD solver for a single (demand set, bin length) pair
// ---------------------------------------------------------------------------

type Piece = { partId: number; lengthIn: number; label: string };

/** Expand demand into individual pieces, sorted descending by length. */
function expandDemand(demand: DemandItem[]): Piece[] {
  const pieces: Piece[] = [];
  for (const d of demand) {
    for (let i = 0; i < d.quantity; i++) {
      pieces.push({ partId: d.partId, lengthIn: d.lengthIn, label: d.label });
    }
  }
  pieces.sort((a, b) => b.lengthIn - a.lengthIn);
  return pieces;
}

interface MutableBar {
  stockLengthIn: number;
  usedIn: number;
  cuts: Piece[];
}

/**
 * Remaining capacity of a bar.
 * Kerf convention: first cut is free; each additional cut costs kerfIn.
 * remaining = stock − usedIn − kerf × (cuts − 1)
 */
function barRemaining(bar: MutableBar, kerfIn: number): number {
  const kerfUsed = bar.cuts.length > 1 ? (bar.cuts.length - 1) * kerfIn : 0;
  return bar.stockLengthIn - bar.usedIn - kerfUsed;
}

// ---------------------------------------------------------------------------
// Seeded LCG for deterministic multi-start shuffles
// ---------------------------------------------------------------------------

/** Tiny deterministic pseudo-random generator (Knuth linear congruential). */
function makeLCG(seed: number): () => number {
  let s = (seed >>> 0) || 1; // never zero
  return () => {
    s = Math.imul(s, 1664525) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
}

/**
 * Produce a piece order for a given restart index.
 *   - restart 0: pure descending (deterministic BFD baseline).
 *   - restart > 0: within each group of equally-long pieces, shuffle
 *     randomly using a seeded LCG so each restart explores a different order.
 */
function perturbedPieces(pieces: Piece[], restart: number, globalSeed: number): Piece[] {
  if (restart === 0) return pieces; // baseline: no shuffle
  const rng = makeLCG(globalSeed ^ (restart * 2654435761));
  const out = [...pieces];
  // Fisher-Yates within same-length groups
  let i = 0;
  while (i < out.length) {
    let j = i + 1;
    while (j < out.length && Math.abs(out[j]!.lengthIn - out[i]!.lengthIn) < 0.001) j++;
    // Shuffle [i, j)
    for (let k = j - 1; k > i; k--) {
      const pick = i + Math.floor(rng() * (k - i + 1));
      [out[k], out[pick]] = [out[pick]!, out[k]!];
    }
    i = j;
  }
  return out;
}

/** Total waste (inches) across bars — used to break ties between equal bar-count results. */
function totalWasteOf(bars: MutableBar[], kerfIn: number): number {
  return bars.reduce((s, b) => {
    const kerfTotal = b.cuts.length > 1 ? (b.cuts.length - 1) * kerfIn : 0;
    return s + Math.max(0, b.stockLengthIn - b.usedIn - kerfTotal);
  }, 0);
}

/** Number of restarts for the multi-start BFD solver. */
const NUM_BFD_STARTS = 8;

/**
 * One BFD pass over pieces that fit within binLength. Returns bars used.
 *
 * Feasibility rule: a piece fits an existing bar only when
 *   remaining ≥ piece.lengthIn + kerf_for_this_cut
 * where kerf_for_this_cut = kerfIn if the bar already has ≥1 cut (first cut
 * is free), else 0.  This prevents over-committing a bar and producing
 * negative waste that gets clamped to zero.
 */
function runBFD(pieces: Piece[], binLength: number, kerfIn: number): MutableBar[] {
  const bars: MutableBar[] = [];
  for (const piece of pieces) {
    if (piece.lengthIn > binLength) continue; // caller filters unnestables before calling
    let bestIdx = -1;
    let bestRem = Infinity;
    for (let i = 0; i < bars.length; i++) {
      const rem = barRemaining(bars[i], kerfIn);
      // Charge kerf for this new cut if the bar already has at least one cut
      const kerfForThisCut = bars[i].cuts.length > 0 ? kerfIn : 0;
      const needed = piece.lengthIn + kerfForThisCut;
      if (rem >= needed && rem < bestRem) {
        bestRem = rem;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      bars[bestIdx].cuts.push(piece);
      bars[bestIdx].usedIn += piece.lengthIn;
    } else {
      bars.push({ stockLengthIn: binLength, usedIn: piece.lengthIn, cuts: [piece] });
    }
  }
  return bars;
}

/** Collapse consecutive identical cuts and compute waste. */
function finalizeMutableBars(
  bars: MutableBar[],
  kerfIn: number,
  vendorId: number,
  vendorName: string,
): Bar[] {
  return bars.map((b) => {
    // kerf: (N cuts − 1) × kerf, minimum 0
    const kerfTotal = b.cuts.length > 1 ? (b.cuts.length - 1) * kerfIn : 0;
    const wasteIn = Math.max(0, b.stockLengthIn - b.usedIn - kerfTotal);
    const collapsed = collapseCuts(b.cuts);
    return { source: "stock", vendorId, vendorName, stockLengthIn: b.stockLengthIn, wasteIn, remnantRef: null, cuts: collapsed };
  });
}

function collapseCuts(pieces: Piece[]): Cut[] {
  const out: Cut[] = [];
  for (const c of pieces) {
    const last = out[out.length - 1];
    if (last && last.partId === c.partId && Math.abs(last.lengthIn - c.lengthIn) < 0.001) {
      last.quantity += 1;
    } else {
      out.push({ partId: c.partId, lengthIn: c.lengthIn, quantity: 1, label: c.label });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Remnant-first pass
// ---------------------------------------------------------------------------

function placeOnRemnants(
  pieces: Piece[],
  remnants: RemnantItem[],
  kerfIn: number,
): { remnantBars: Bar[]; remaining: Piece[] } {
  const bins: MutableBar[] = remnants.map((r) => ({ stockLengthIn: r.lengthIn, usedIn: 0, cuts: [] }));
  const unplaced: Piece[] = [];

  for (const piece of pieces) {
    let bestIdx = -1;
    let bestRem = Infinity;
    for (let i = 0; i < bins.length; i++) {
      const rem = barRemaining(bins[i], kerfIn);
      // Charge kerf for this new cut if the remnant bin already has at least one cut
      const kerfForThisCut = bins[i].cuts.length > 0 ? kerfIn : 0;
      const needed = piece.lengthIn + kerfForThisCut;
      if (rem >= needed && rem < bestRem) {
        bestRem = rem;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      bins[bestIdx].cuts.push(piece);
      bins[bestIdx].usedIn += piece.lengthIn;
    } else {
      unplaced.push(piece);
    }
  }

  const remnantBars: Bar[] = bins
    .filter((b) => b.cuts.length > 0)
    .map((b, i) => {
      const kerfTotal = b.cuts.length > 1 ? (b.cuts.length - 1) * kerfIn : 0;
      const wasteIn = Math.max(0, b.stockLengthIn - b.usedIn - kerfTotal);
      return {
        source: "remnant",
        vendorId: null,
        vendorName: null,
        stockLengthIn: remnants[i]?.lengthIn ?? b.stockLengthIn,
        wasteIn,
        remnantRef: remnants[i]?.ref ?? null,
        cuts: collapseCuts(b.cuts),
      };
    });

  return { remnantBars, remaining: unplaced };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Nest one profile group.
 *
 * For each stock option:
 * - Pieces that exceed this option's stock length are reported as missingParts
 *   and isComplete = false. These options can be shown for comparison but
 *   must not be accepted.
 * - Pieces that fit are placed via BFD; remnant bars are shared across options.
 *
 * Options are returned sorted: complete options first (by wastePercent asc),
 * then incomplete options (also by wastePercent asc on the placeable subset).
 */
export function nestGroup(input: NestingInput): GroupNestingResult {
  const { profileType, profileSize, grade, demand, remnants, stockOptions, kerfIn } = input;

  const allPieces = expandDemand(demand);

  // Pieces that exceed ALL stock lengths → group-level unnestable
  const maxStockLen = stockOptions.length > 0 ? Math.max(...stockOptions.map((s) => s.lengthIn)) : 0;
  const groupUnnestable: UnnestableItem[] = [];
  const nestable: Piece[] = [];

  for (const p of allPieces) {
    const canFitAny = maxStockLen > 0 && p.lengthIn <= maxStockLen;
    if (!canFitAny) {
      if (!groupUnnestable.some((u) => u.partId === p.partId)) {
        groupUnnestable.push({
          partId: p.partId,
          lengthIn: p.lengthIn,
          label: p.label,
          reason: `Part length ${(p.lengthIn / 12).toFixed(2)}' exceeds all available stock lengths`,
        });
      }
    } else {
      nestable.push(p);
    }
  }

  // Remnant-first pass on pieces that can fit at least one stock option
  const { remnantBars, remaining: afterRemnants } = placeOnRemnants(nestable, remnants, kerfIn);

  // Per-option solve
  const options: NestingOption[] = [];

  for (const stock of stockOptions) {
    // Separate: fits this option vs cannot fit (missing for this option)
    const fitsThis: Piece[] = [];
    const doesntFit: Piece[] = [];
    for (const p of afterRemnants) {
      if (p.lengthIn <= stock.lengthIn) {
        fitsThis.push(p);
      } else {
        doesntFit.push(p);
      }
    }

    // Build missing parts list for this option (deduplicated by partId)
    const seenMissing = new Set<number>();
    const missingParts: MissingPart[] = [];
    for (const p of doesntFit) {
      if (!seenMissing.has(p.partId)) {
        seenMissing.add(p.partId);
        missingParts.push({
          partId: p.partId,
          lengthIn: p.lengthIn,
          label: p.label,
          reason: `Part length ${(p.lengthIn / 12).toFixed(2)}' exceeds this stock length (${(stock.lengthIn / 12).toFixed(2)}')`,
        });
      }
    }

    // Multi-start BFD: run NUM_BFD_STARTS seeded passes, pick fewest bars then least waste.
    // The seed is derived from the group identity so results are deterministic per-group.
    const groupSeed = Array.from(`${profileType}|${profileSize}|${grade}`)
      .reduce((h, c) => Math.imul(h, 31) + c.charCodeAt(0), 0);
    let bestMutable: MutableBar[] | null = null;
    for (let start = 0; start < NUM_BFD_STARTS; start++) {
      const ordered = perturbedPieces(fitsThis, start, groupSeed);
      const candidate = runBFD(ordered, stock.lengthIn, kerfIn);
      if (
        bestMutable === null ||
        candidate.length < bestMutable.length ||
        (candidate.length === bestMutable.length &&
          totalWasteOf(candidate, kerfIn) < totalWasteOf(bestMutable, kerfIn))
      ) {
        bestMutable = candidate;
      }
    }
    const stockBars = finalizeMutableBars(bestMutable ?? [], kerfIn, stock.vendorId, stock.vendorName);
    const allBars: Bar[] = [...remnantBars, ...stockBars];

    const totalStockIn = stockBars.reduce((s, b) => s + b.stockLengthIn, 0);
    const totalUsedIn = allBars.reduce((s, b) => s + (b.stockLengthIn - b.wasteIn), 0);
    const totalWasteIn = stockBars.reduce((s, b) => s + b.wasteIn, 0);
    const wastePercent = totalStockIn > 0 ? (totalWasteIn / totalStockIn) * 100 : 0;

    // Group-level unnestables also make this option incomplete — those parts
    // can't fit on any stock length, so no option can fully nest the group.
    const allMissing: MissingPart[] = [
      ...groupUnnestable.map((u) => ({
        partId: u.partId,
        lengthIn: u.lengthIn,
        label: u.label,
        reason: u.reason,
      })),
      ...missingParts,
    ];

    options.push({
      vendorId: stock.vendorId,
      vendorName: stock.vendorName,
      stockLengthIn: stock.lengthIn,
      isComplete: allMissing.length === 0,
      missingParts: allMissing,
      bars: allBars,
      totalStockIn,
      totalUsedIn,
      totalWasteIn,
      wastePercent,
    });
  }

  // Sort: complete options first (by waste asc), then incomplete (by waste asc)
  options.sort((a, b) => {
    if (a.isComplete !== b.isComplete) return a.isComplete ? -1 : 1;
    return a.wastePercent - b.wastePercent;
  });

  return { profileType, profileSize, grade, options, unnestable: groupUnnestable };
}

/** Nest an entire BOM: group by profile/size/grade, solve each group. */
export function nestBom(bomGroups: NestingInput[]): GroupNestingResult[] {
  return bomGroups.map(nestGroup);
}

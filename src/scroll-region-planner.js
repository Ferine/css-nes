/**
 * Compresses per-scanline state into contiguous scroll/visibility regions.
 */
export function planScrollRegions(scanlineModel, fallbackState, options = {}) {
  const maxRegions = Math.max(1, options.maxRegions ?? 2);
  const minRegionHeight = Math.max(1, options.minRegionHeight ?? 6);
  const compress = options.compress !== false;
  const scanlines = scanlineModel?.scanlines;
  if (!Array.isArray(scanlines) || scanlines.length === 0) {
    return [_singleRegionFromFallback(fallbackState)];
  }

  const regions = [];
  let start = 0;
  let active = scanlines[0];

  for (let y = 1; y <= 240; y++) {
    const next = y < 240 ? scanlines[y] : null;
    if (y === 240 || !_sameRegionState(active, next)) {
      regions.push(_toRegion(start, y, active));
      if (y < 240) {
        start = y;
        active = next;
      }
    }
  }

  if (regions.length === 0) {
    return [_singleRegionFromFallback(fallbackState)];
  }

  if (compress) {
    _coalesceTinyRegions(regions, minRegionHeight);
    _limitRegions(regions, maxRegions);
  }
  _normalizeBounds(regions);

  return regions;
}

function _toRegion(yStart, yEnd, state) {
  const scroll = {
    coarseX: state.scroll.coarseX,
    coarseY: state.scroll.coarseY,
    fineX: state.scroll.fineX,
    fineY: state.scroll.fineY,
    nameTableH: state.scroll.nameTableH,
    nameTableV: state.scroll.nameTableV,
  };

  return {
    yStart,
    yEnd,
    scroll,
    scrollX: scroll.coarseX * 8 + scroll.fineX + scroll.nameTableH * 256,
    scrollY: scroll.coarseY * 8 + scroll.fineY + scroll.nameTableV * 240,
    bgVisible: state.bgVisible,
    spritesVisible: state.spritesVisible,
    bgPatternBase: state.bgPatternBase,
    sprPatternBase: state.sprPatternBase,
    spriteSize: state.spriteSize,
    mirrorMap: _normalizeMirrorMap(state.mirrorMap),
    chrSignature: _normalizeCHRSignature(state.chrSignature),
  };
}

function _singleRegionFromFallback(state) {
  const scroll = {
    coarseX: state?.scroll?.coarseX ?? 0,
    coarseY: state?.scroll?.coarseY ?? 0,
    fineX: state?.scroll?.fineX ?? 0,
    fineY: state?.scroll?.fineY ?? 0,
    nameTableH: state?.scroll?.nameTableH ?? 0,
    nameTableV: state?.scroll?.nameTableV ?? 0,
  };

  return {
    yStart: 0,
    yEnd: 240,
    scroll,
    scrollX: scroll.coarseX * 8 + scroll.fineX + scroll.nameTableH * 256,
    scrollY: scroll.coarseY * 8 + scroll.fineY + scroll.nameTableV * 240,
    bgVisible: state?.bgVisible ?? true,
    spritesVisible: state?.spritesVisible ?? true,
    bgPatternBase: state?.bgPatternBase ?? 0,
    sprPatternBase: state?.sprPatternBase ?? 0,
    spriteSize: state?.spriteSize ?? 0,
    mirrorMap: _normalizeMirrorMap(state?.mirrorMap),
    chrSignature: _normalizeCHRSignature(state?.chrSignature || state?.chrBankSignature),
  };
}

function _sameRegionState(a, b) {
  if (!a || !b) return false;
  return (
    a.scroll.coarseX === b.scroll.coarseX &&
    a.scroll.coarseY === b.scroll.coarseY &&
    a.scroll.fineX === b.scroll.fineX &&
    a.scroll.fineY === b.scroll.fineY &&
    a.scroll.nameTableH === b.scroll.nameTableH &&
    a.scroll.nameTableV === b.scroll.nameTableV &&
    a.bgVisible === b.bgVisible &&
    a.spritesVisible === b.spritesVisible &&
    a.bgPatternBase === b.bgPatternBase &&
    a.sprPatternBase === b.sprPatternBase &&
    a.spriteSize === b.spriteSize &&
    _sameFour(a.mirrorMap, b.mirrorMap) &&
    _sameEight(a.chrSignature, b.chrSignature)
  );
}

function _coalesceTinyRegions(regions, minRegionHeight) {
  let i = 0;
  while (i < regions.length && regions.length > 1) {
    const region = regions[i];
    const h = region.yEnd - region.yStart;
    if (h >= minRegionHeight) {
      i++;
      continue;
    }

    if (i === 0) {
      regions[1].yStart = region.yStart;
      regions.splice(i, 1);
      continue;
    }

    if (i === regions.length - 1) {
      regions[i - 1].yEnd = region.yEnd;
      regions.splice(i, 1);
      i = Math.max(0, i - 1);
      continue;
    }

    const prev = regions[i - 1];
    const next = regions[i + 1];
    const prevCost = _mergeCost(prev, region);
    const nextCost = _mergeCost(region, next);

    if (prevCost <= nextCost) {
      prev.yEnd = region.yEnd;
      regions.splice(i, 1);
      i = Math.max(0, i - 1);
    } else {
      next.yStart = region.yStart;
      regions.splice(i, 1);
    }
  }
}

function _limitRegions(regions, maxRegions) {
  while (regions.length > maxRegions) {
    let idx = 0;
    let minHeight = Infinity;
    for (let i = 0; i < regions.length; i++) {
      const h = regions[i].yEnd - regions[i].yStart;
      if (h < minHeight) {
        minHeight = h;
        idx = i;
      }
    }

    if (idx === 0) {
      regions[1].yStart = regions[0].yStart;
      regions.splice(0, 1);
      continue;
    }

    if (idx === regions.length - 1) {
      regions[idx - 1].yEnd = regions[idx].yEnd;
      regions.splice(idx, 1);
      continue;
    }

    const prev = regions[idx - 1];
    const curr = regions[idx];
    const next = regions[idx + 1];
    const prevCost = _mergeCost(prev, curr);
    const nextCost = _mergeCost(curr, next);

    if (prevCost <= nextCost) {
      prev.yEnd = curr.yEnd;
      regions.splice(idx, 1);
    } else {
      next.yStart = curr.yStart;
      regions.splice(idx, 1);
    }
  }
}

function _mergeCost(a, b) {
  const scrollDelta =
    Math.abs(a.scrollX - b.scrollX) +
    Math.abs(a.scrollY - b.scrollY);
  const flagPenalty =
    (a.bgVisible !== b.bgVisible ? 512 : 0) +
    (a.spritesVisible !== b.spritesVisible ? 512 : 0) +
    (a.bgPatternBase !== b.bgPatternBase ? 256 : 0) +
    (a.sprPatternBase !== b.sprPatternBase ? 256 : 0) +
    (a.spriteSize !== b.spriteSize ? 128 : 0) +
    (_sameFour(a.mirrorMap, b.mirrorMap) ? 0 : 1024) +
    _chrMergePenalty(a.chrSignature, b.chrSignature);
  return scrollDelta + flagPenalty;
}

function _normalizeBounds(regions) {
  if (regions.length === 0) return;
  regions[0].yStart = 0;
  for (let i = 1; i < regions.length; i++) {
    regions[i].yStart = regions[i - 1].yEnd;
  }
  regions[regions.length - 1].yEnd = 240;
}

function _normalizeMirrorMap(mirrorMap) {
  const out = [0, 1, 2, 3];
  if (!Array.isArray(mirrorMap)) return out;
  for (let i = 0; i < 4; i++) out[i] = mirrorMap[i] ?? out[i];
  return out;
}

function _normalizeCHRSignature(signature) {
  const out = new Array(8);
  if (!Array.isArray(signature)) {
    for (let i = 0; i < 8; i++) out[i] = [null, null, null, null];
    return out;
  }
  for (let i = 0; i < 8; i++) {
    const region = signature[i];
    if (!Array.isArray(region)) {
      out[i] = [region ?? null, null, null, null];
      continue;
    }
    out[i] = [
      region[0] ?? null,
      region[1] ?? null,
      region[2] ?? null,
      region[3] ?? null,
    ];
  }
  return out;
}

function _sameFour(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return !a && !b;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function _sameEight(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return !a && !b;
  for (let i = 0; i < 8; i++) {
    if (!_sameChrRegion(a[i], b[i])) return false;
  }
  return true;
}

function _chrMergePenalty(a, b) {
  let delta = 0;
  for (let i = 0; i < 8; i++) {
    if (!_sameChrRegion(a[i], b[i])) delta += 256;
  }
  return delta;
}

function _sameChrRegion(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  return (
    a[0] === b[0] &&
    a[1] === b[1] &&
    a[2] === b[2] &&
    a[3] === b[3]
  );
}

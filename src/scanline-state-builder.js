/**
 * Replays timed PPU + mapper writes into effective per-scanline state.
 * Model output is canonical (no region-budget compression).
 */
export function buildScanlineState(timingTrace, fallbackState, options = {}) {
  const applyWithinScanline = options.applyWithinScanline === true;
  const mapperApplyWithinScanline = options.mapperApplyWithinScanline !== false;
  const includeMapperWrites = options.includeMapperWrites !== false;

  const base = _normalizeState(fallbackState);
  const start = timingTrace?.startState
    ? _stateFromSnapshot(timingTrace.startState, base)
    : base;

  const events = Array.isArray(timingTrace?.events)
    ? [...timingTrace.events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    : [];

  const segments = [{ yStart: 0, state: start, source: 'initial', event: null }];
  let activeState = start;
  let relevantEventCount = 0;
  let appliedEventCount = 0;
  const domainCounts = { ppu: 0, mapper: 0 };

  for (const event of events) {
    if (!_isTimingRelevant(event.address, includeMapperWrites)) continue;
    if (!event.after) continue;

    relevantEventCount++;
    if (_isMapperAddress(event.address)) domainCounts.mapper++;
    else domainCounts.ppu++;

    const nextState = _stateFromSnapshot(event.after, activeState);
    if (_stateEquals(nextState, activeState)) continue;

    const yStart = _resolveApplyScanline(event, {
      applyWithinScanline,
      mapperApplyWithinScanline,
    });
    activeState = nextState;

    if (yStart >= 240) continue;
    appliedEventCount++;

    if (yStart <= 0) {
      segments[0] = {
        yStart: 0,
        state: nextState,
        source: _eventDomain(event.address),
        event,
      };
      continue;
    }

    const last = segments[segments.length - 1];
    if (last.yStart === yStart) {
      last.state = nextState;
      last.source = _eventDomain(event.address);
      last.event = event;
      continue;
    }

    segments.push({
      yStart,
      state: nextState,
      source: _eventDomain(event.address),
      event,
    });
  }

  const canonicalSegments = _resolveSegments(segments);
  const scanlines = _materializeScanlines(canonicalSegments);

  return {
    scanlines,
    segments: canonicalSegments,
    canonicalSegments,
    eventCount: events.length,
    relevantEventCount,
    appliedEventCount,
    domainCounts,
  };
}

function _resolveSegments(segments) {
  const resolved = [];
  for (let i = 0; i < segments.length; i++) {
    const yStart = segments[i].yStart;
    const yEnd = i + 1 < segments.length ? segments[i + 1].yStart : 240;
    resolved.push({
      yStart,
      yEnd,
      state: segments[i].state,
      source: segments[i].source,
      event: segments[i].event,
    });
  }
  return resolved;
}

function _materializeScanlines(segments) {
  const scanlines = new Array(240);
  let segIdx = 0;
  for (let y = 0; y < 240; y++) {
    while (segIdx + 1 < segments.length && segments[segIdx + 1].yStart <= y) {
      segIdx++;
    }
    scanlines[y] = segments[segIdx].state;
  }
  return scanlines;
}

function _isTimingRelevant(address, includeMapperWrites) {
  if (address === 0x2000 || address === 0x2001 || address === 0x2005 || address === 0x2006) {
    return true;
  }
  return includeMapperWrites && _isMapperAddress(address);
}

function _isMapperAddress(address) {
  return address >= 0x8000 && address <= 0xffff;
}

function _eventDomain(address) {
  return _isMapperAddress(address) ? 'mapper' : 'ppu';
}

function _resolveApplyScanline(event, options) {
  const applyWithinScanline = options.applyWithinScanline;
  const mapperApplyWithinScanline = options.mapperApplyWithinScanline;

  if (event.phase === 'prerender') return 0;
  if (event.phase === 'vblank') return 240;

  const y = typeof event.screenY === 'number' ? event.screenY : event.scanline - 21;
  const isMapper = _isMapperAddress(event.address);
  const sameScanline = isMapper ? mapperApplyWithinScanline : applyWithinScanline;

  if (sameScanline) return _clamp(y, 0, 239);
  return _clamp(y + 1, 0, 239);
}

function _normalizeState(state) {
  if (!state) {
    return {
      scroll: {
        coarseX: 0,
        coarseY: 0,
        fineX: 0,
        fineY: 0,
        nameTableH: 0,
        nameTableV: 0,
      },
      bgVisible: true,
      spritesVisible: true,
      bgPatternBase: 0,
      sprPatternBase: 0,
      spriteSize: 0,
      mirrorMap: [0, 1, 2, 3],
      chrSignature: _emptyCHRSignature(),
    };
  }

  return {
    scroll: {
      coarseX: state.scroll?.coarseX ?? 0,
      coarseY: state.scroll?.coarseY ?? 0,
      fineX: state.scroll?.fineX ?? 0,
      fineY: state.scroll?.fineY ?? 0,
      nameTableH: state.scroll?.nameTableH ?? 0,
      nameTableV: state.scroll?.nameTableV ?? 0,
    },
    bgVisible: !!state.bgVisible,
    spritesVisible: !!state.spritesVisible,
    bgPatternBase: state.bgPatternBase === 256 ? 256 : 0,
    sprPatternBase: state.sprPatternBase === 256 ? 256 : 0,
    spriteSize: state.spriteSize === 1 ? 1 : 0,
    mirrorMap: _normalizeMirrorMap(state.mirrorMap),
    chrSignature: _normalizeCHRSignature(state.chrSignature || state.chrBankSignature),
  };
}

function _stateFromSnapshot(snapshot, fallback) {
  return {
    scroll: {
      coarseX: snapshot.regHT ?? fallback.scroll.coarseX,
      coarseY: snapshot.regVT ?? fallback.scroll.coarseY,
      fineX: snapshot.regFH ?? fallback.scroll.fineX,
      fineY: snapshot.regFV ?? fallback.scroll.fineY,
      nameTableH: snapshot.regH ?? fallback.scroll.nameTableH,
      nameTableV: snapshot.regV ?? fallback.scroll.nameTableV,
    },
    bgVisible: (snapshot.f_bgVisibility ?? (fallback.bgVisible ? 1 : 0)) === 1,
    spritesVisible: (snapshot.f_spVisibility ?? (fallback.spritesVisible ? 1 : 0)) === 1,
    bgPatternBase: (snapshot.f_bgPatternTable ?? (fallback.bgPatternBase === 256 ? 1 : 0)) === 1 ? 256 : 0,
    sprPatternBase: (snapshot.f_spPatternTable ?? (fallback.sprPatternBase === 256 ? 1 : 0)) === 1 ? 256 : 0,
    spriteSize: (snapshot.f_spriteSize ?? fallback.spriteSize) === 1 ? 1 : 0,
    mirrorMap: _normalizeMirrorMap(snapshot.mirrorMap ?? fallback.mirrorMap),
    chrSignature: _normalizeCHRSignature(snapshot.chrSignature ?? snapshot.chrBankSignature ?? fallback.chrSignature),
  };
}

function _stateEquals(a, b) {
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

function _normalizeMirrorMap(mirrorMap) {
  const out = [0, 1, 2, 3];
  if (!Array.isArray(mirrorMap)) return out;
  for (let i = 0; i < 4; i++) {
    out[i] = mirrorMap[i] ?? out[i];
  }
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
  return (
    a[0] === b[0] &&
    a[1] === b[1] &&
    a[2] === b[2] &&
    a[3] === b[3]
  );
}

function _sameEight(a, b) {
  for (let i = 0; i < 8; i++) {
    if (!_sameChrRegion(a[i], b[i])) return false;
  }
  return true;
}

function _sameChrRegion(a, b) {
  return (
    a[0] === b[0] &&
    a[1] === b[1] &&
    a[2] === b[2] &&
    a[3] === b[3]
  );
}

function _emptyCHRSignature() {
  return [
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
  ];
}

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

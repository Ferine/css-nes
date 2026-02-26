/**
 * Replays timed PPU register writes into effective per-scanline state.
 * The model is scanline-granular: writes become visible on the next visible scanline.
 */
export function buildScanlineState(timingTrace, fallbackState, options = {}) {
  const applyWithinScanline = options.applyWithinScanline === true;

  const base = _normalizeState(fallbackState);
  const start = timingTrace?.startState
    ? _stateFromSnapshot(timingTrace.startState, base)
    : base;

  const events = Array.isArray(timingTrace?.events)
    ? [...timingTrace.events].sort((a, b) => a.seq - b.seq)
    : [];

  const segments = [{ yStart: 0, state: start }];
  let activeState = start;

  for (const event of events) {
    if (!_isTimingRelevant(event.address)) continue;
    if (!event.after) continue;

    const nextState = _stateFromSnapshot(event.after, activeState);
    if (_stateEquals(nextState, activeState)) continue;

    const yStart = _resolveApplyScanline(event, applyWithinScanline);
    activeState = nextState;

    if (yStart >= 240) continue;

    if (yStart <= 0) {
      segments[0] = { yStart: 0, state: nextState };
      continue;
    }

    const last = segments[segments.length - 1];
    if (last.yStart === yStart) {
      last.state = nextState;
      continue;
    }

    segments.push({ yStart, state: nextState });
  }

  const scanlines = new Array(240);
  let segIdx = 0;
  for (let y = 0; y < 240; y++) {
    while (segIdx + 1 < segments.length && segments[segIdx + 1].yStart <= y) {
      segIdx++;
    }
    scanlines[y] = segments[segIdx].state;
  }

  const resolvedSegments = [];
  for (let i = 0; i < segments.length; i++) {
    const yStart = segments[i].yStart;
    const yEnd = i + 1 < segments.length ? segments[i + 1].yStart : 240;
    resolvedSegments.push({ yStart, yEnd, state: segments[i].state });
  }

  return {
    scanlines,
    segments: resolvedSegments,
  };
}

function _isTimingRelevant(address) {
  return address === 0x2000 || address === 0x2001 || address === 0x2005 || address === 0x2006;
}

function _resolveApplyScanline(event, applyWithinScanline) {
  if (event.phase === 'prerender') return 0;
  if (event.phase === 'vblank') return 240;

  const y = typeof event.screenY === 'number' ? event.screenY : event.scanline - 21;
  if (applyWithinScanline) {
    return _clamp(y, 0, 239);
  }
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
    a.spriteSize === b.spriteSize
  );
}

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

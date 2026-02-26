/**
 * Captures frame-local timed writes relevant to rendering state.
 * We patch mapper regWrite()/write() at runtime to avoid modifying jsnes.
 */
export class PPUWriteTracer {
  constructor(nes) {
    this.nes = nes;
    this._installed = false;
    this._mapper = null;
    this._originalRegWrite = null;
    this._originalWrite = null;
    this._trackMapperWrites = false;
    this._tileRefIds = new WeakMap();
    this._nextTileRefId = 1;

    this._frameOpen = false;
    this._seq = 0;
    this._startState = null;
    this._events = [];
    this._chrStatesByKey = new Map();
  }

  install() {
    const mapper = this.nes?.mmap;
    if (!mapper || typeof mapper.regWrite !== 'function') return false;
    if (this._installed && this._mapper === mapper) return true;

    this.uninstall();

    this._mapper = mapper;
    this._originalRegWrite = mapper.regWrite;
    this._originalWrite = typeof mapper.write === 'function' ? mapper.write : null;

    const tracer = this;
    mapper.regWrite = function patchedRegWrite(address, value) {
      const track = tracer._frameOpen && tracer._isTrackedAddress(address);
      let before = null;
      let timing = null;

      if (track) {
        before = tracer._snapshotPPU({ includeChrSignature: false });
        timing = tracer._snapshotTiming();
      }

      const ret = tracer._originalRegWrite.call(this, address, value);

      if (track) {
        const after = tracer._snapshotPPU({ includeChrSignature: false });
        tracer._events.push({
          seq: tracer._seq++,
          address,
          value,
          ...timing,
          before,
          after,
          firstWriteBefore: !!before.firstWrite,
          firstWriteAfter: !!after.firstWrite,
        });
      }

      return ret;
    };

    if (this._originalWrite) {
      mapper.write = function patchedWrite(address, value) {
        const track = tracer._frameOpen && tracer._isMapperAddress(address);
        let before = null;
        let timing = null;

        if (track) {
          before = tracer._snapshotPPU({ includeChrSignature: false });
          timing = tracer._snapshotTiming();
        }

        const ret = tracer._originalWrite.call(this, address, value);

        if (track) {
          const after = tracer._snapshotPPU();
          tracer._events.push({
            seq: tracer._seq++,
            address,
            value,
            ...timing,
            before,
            after,
            firstWriteBefore: !!before.firstWrite,
            firstWriteAfter: !!after.firstWrite,
          });
          tracer._captureCurrentCHRStates(after.chrSignature);
        }

        return ret;
      };
    }

    this._installed = true;
    return true;
  }

  uninstall() {
    if (!this._installed || !this._mapper) return;
    this._mapper.regWrite = this._originalRegWrite;
    if (this._originalWrite) {
      this._mapper.write = this._originalWrite;
    }
    this._installed = false;
    this._mapper = null;
    this._originalRegWrite = null;
    this._originalWrite = null;
  }

  beginFrame() {
    this._events.length = 0;
    this._seq = 0;
    this._chrStatesByKey.clear();
    this._startState = this._snapshotPPU();
    this._captureCurrentCHRStates(this._startState?.chrSignature);
    this._frameOpen = true;
  }

  consumeFrameTrace() {
    const trace = {
      startState: this._startState || this._snapshotPPU(),
      events: this._events.slice(),
      chrStates: Array.from(this._chrStatesByKey.values()),
    };

    this._frameOpen = false;
    this._events.length = 0;
    this._startState = null;
    this._chrStatesByKey.clear();

    return trace;
  }

  setTrackMapperWrites(enabled) {
    this._trackMapperWrites = !!enabled;
  }

  _isTrackedAddress(address) {
    return (
      address === 0x2000 || // PPUCTRL
      address === 0x2001 || // PPUMASK
      address === 0x2005 || // PPUSCROLL
      address === 0x2006    // PPUADDR
    );
  }

  _isMapperAddress(address) {
    return this._trackMapperWrites && address >= 0x8000 && address <= 0xffff;
  }

  _snapshotTiming() {
    const ppu = this.nes.ppu;
    const screenY = ppu.scanline - 21;
    let phase = 'vblank';
    if (screenY < 0) phase = 'prerender';
    else if (screenY < 240) phase = 'visible';

    return {
      scanline: ppu.scanline,
      dot: ppu.curX,
      screenY,
      phase,
    };
  }

  _snapshotPPU(options = {}) {
    const includeChrSignature = options.includeChrSignature !== false;
    const ppu = this.nes.ppu;
    const mirrorMap = ppu.ntable1
      ? [ppu.ntable1[0], ppu.ntable1[1], ppu.ntable1[2], ppu.ntable1[3]]
      : [0, 1, 2, 3];

    return {
      regHT: ppu.regHT,
      regVT: ppu.regVT,
      regFH: ppu.regFH,
      regFV: ppu.regFV,
      regH: ppu.regH,
      regV: ppu.regV,
      f_bgVisibility: ppu.f_bgVisibility,
      f_spVisibility: ppu.f_spVisibility,
      f_bgPatternTable: ppu.f_bgPatternTable,
      f_spPatternTable: ppu.f_spPatternTable,
      f_spriteSize: ppu.f_spriteSize,
      mirrorMap,
      chrSignature: includeChrSignature ? this._computeCHRSignature(ppu.ptTile) : undefined,
      firstWrite: ppu.firstWrite,
      scanline: ppu.scanline,
      dot: ppu.curX,
    };
  }

  _tileRefId(tile) {
    if (!tile || (typeof tile !== 'object' && typeof tile !== 'function')) return 0;
    let id = this._tileRefIds.get(tile);
    if (!id) {
      id = this._nextTileRefId++;
      this._tileRefIds.set(tile, id);
    }
    return id;
  }

  _computeCHRSignature(tiles) {
    const signature = new Array(8);
    if (!Array.isArray(tiles)) {
      for (let i = 0; i < 8; i++) signature[i] = 0;
      return signature;
    }

    for (let i = 0; i < 8; i++) {
      const base = i * 64;
      let h = 0x811c9dc5;
      for (let j = 0; j < 64; j++) {
        const id = this._tileRefId(tiles[base + j]);
        h ^= id;
        h = Math.imul(h, 0x01000193);
      }
      signature[i] = h >>> 0;
    }
    return signature;
  }

  _captureCurrentCHRStates(signature = null) {
    const ppu = this.nes.ppu;
    const tiles = ppu.ptTile;
    if (!Array.isArray(tiles) || tiles.length < 512) return;

    const sig = Array.isArray(signature) && signature.length === 8
      ? signature
      : this._computeCHRSignature(tiles);
    this._storeCHRState(0, sig, 0, tiles, 0);
    this._storeCHRState(256, sig, 4, tiles, 256);
  }

  _storeCHRState(bgBase, fullSignature, sigOffset, tiles, tileOffset) {
    const signatureSlice = [
      fullSignature[sigOffset + 0] ?? 0,
      fullSignature[sigOffset + 1] ?? 0,
      fullSignature[sigOffset + 2] ?? 0,
      fullSignature[sigOffset + 3] ?? 0,
    ];
    const key = `${bgBase}:${signatureSlice.join(',')}`;
    if (this._chrStatesByKey.has(key)) return;
    const tileSlice = new Array(256);
    for (let i = 0; i < 256; i++) {
      tileSlice[i] = tiles[tileOffset + i];
    }
    this._chrStatesByKey.set(key, {
      key,
      bgBase,
      signature: signatureSlice,
      tiles: tileSlice,
    });
  }
}

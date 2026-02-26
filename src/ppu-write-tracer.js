/**
 * Captures frame-local PPU register writes with timing metadata.
 * We patch the active mapper's regWrite() at runtime to avoid modifying jsnes.
 */
export class PPUWriteTracer {
  constructor(nes) {
    this.nes = nes;
    this._installed = false;
    this._mapper = null;
    this._originalRegWrite = null;
    this._originalWrite = null;
    this._trackMapperWrites = false;

    this._frameOpen = false;
    this._seq = 0;
    this._startState = null;
    this._events = [];
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
        before = tracer._snapshotPPU();
        timing = tracer._snapshotTiming();
      }

      const ret = tracer._originalRegWrite.call(this, address, value);

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
      }

      return ret;
    };

    if (this._originalWrite) {
      mapper.write = function patchedWrite(address, value) {
        const track = tracer._frameOpen && tracer._isMapperAddress(address);
        let before = null;
        let timing = null;

        if (track) {
          before = tracer._snapshotPPU();
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
    this._startState = this._snapshotPPU();
    this._frameOpen = true;
  }

  consumeFrameTrace() {
    const trace = {
      startState: this._startState || this._snapshotPPU(),
      events: this._events.slice(),
    };

    this._frameOpen = false;
    this._events.length = 0;
    this._startState = null;

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

  _snapshotPPU() {
    const ppu = this.nes.ppu;
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
      firstWrite: ppu.firstWrite,
      scanline: ppu.scanline,
      dot: ppu.curX,
    };
  }
}

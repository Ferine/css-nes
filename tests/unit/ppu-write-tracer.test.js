import { describe, it, expect } from 'vitest';
import { PPUWriteTracer } from '../../src/ppu-write-tracer.js';

function createMockNES() {
  const ppu = {
    regHT: 0,
    regVT: 0,
    regFH: 0,
    regFV: 0,
    regH: 0,
    regV: 0,
    f_bgVisibility: 1,
    f_spVisibility: 1,
    f_bgPatternTable: 0,
    f_spPatternTable: 0,
    f_spriteSize: 0,
    firstWrite: true,
    scanline: 30,
    curX: 120,
  };

  const mapper = {
    write(address, value) {
      this.regWrite(address, value);
    },
    regWrite(address, value) {
      if (address === 0x2000) {
        ppu.f_bgPatternTable = (value >> 4) & 1;
        ppu.f_spPatternTable = (value >> 3) & 1;
        ppu.f_spriteSize = (value >> 5) & 1;
        ppu.regV = (value >> 1) & 1;
        ppu.regH = value & 1;
      } else if (address === 0x2001) {
        ppu.f_spVisibility = (value >> 4) & 1;
        ppu.f_bgVisibility = (value >> 3) & 1;
      } else if (address === 0x2005) {
        if (ppu.firstWrite) {
          ppu.regHT = (value >> 3) & 31;
          ppu.regFH = value & 7;
        } else {
          ppu.regVT = (value >> 3) & 31;
          ppu.regFV = value & 7;
        }
        ppu.firstWrite = !ppu.firstWrite;
      } else if (address === 0x2006) {
        ppu.firstWrite = !ppu.firstWrite;
      }
    },
  };

  return {
    ppu,
    mmap: mapper,
  };
}

describe('PPUWriteTracer', () => {
  it('captures tracked writes with before/after snapshots', () => {
    const nes = createMockNES();
    const tracer = new PPUWriteTracer(nes);

    expect(tracer.install()).toBe(true);

    tracer.beginFrame();
    nes.mmap.regWrite(0x2005, 0x2d);
    nes.mmap.regWrite(0x4015, 0xff); // ignored
    nes.mmap.regWrite(0x2001, 0x00);
    const trace = tracer.consumeFrameTrace();

    expect(trace.events).toHaveLength(2);
    expect(trace.events[0].address).toBe(0x2005);
    expect(trace.events[0].screenY).toBe(9);
    expect(trace.events[0].before.regHT).toBe(0);
    expect(trace.events[0].after.regHT).toBe(5);
    expect(trace.events[0].firstWriteBefore).toBe(true);
    expect(trace.events[0].firstWriteAfter).toBe(false);

    expect(trace.events[1].address).toBe(0x2001);
    expect(trace.events[1].after.f_bgVisibility).toBe(0);
  });

  it('seals frame data on consume', () => {
    const nes = createMockNES();
    const tracer = new PPUWriteTracer(nes);
    tracer.install();

    tracer.beginFrame();
    nes.mmap.regWrite(0x2000, 0x18);
    const trace1 = tracer.consumeFrameTrace();
    expect(trace1.events).toHaveLength(1);

    const trace2 = tracer.consumeFrameTrace();
    expect(trace2.events).toHaveLength(0);
  });

  it('tracks mapper register writes only when enabled', () => {
    const nes = createMockNES();
    const tracer = new PPUWriteTracer(nes);
    tracer.install();

    tracer.beginFrame();
    nes.mmap.write(0x8000, 0x80);
    let trace = tracer.consumeFrameTrace();
    expect(trace.events).toHaveLength(0);

    tracer.setTrackMapperWrites(true);
    tracer.beginFrame();
    nes.mmap.write(0x8000, 0x81);
    trace = tracer.consumeFrameTrace();
    expect(trace.events).toHaveLength(1);
    expect(trace.events[0].address).toBe(0x8000);
  });
});

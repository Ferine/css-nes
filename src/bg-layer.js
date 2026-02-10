/**
 * Background layer: 4 logical quadrant containers (each 32×30 CSS Grid).
 * Each quadrant maps to a physical nametable via the mirror map.
 * Quadrants are repositioned each frame to handle scroll wrapping — the NES
 * nametable space is 512×480 and tiles seamlessly.
 */
export class BGLayer {
  constructor(container) {
    this.container = container;

    this.bgLayer = document.createElement('div');
    this.bgLayer.className = 'bg-layer';
    this.bgLayer.dataset.layer = 'background';
    container.appendChild(this.bgLayer);

    // 4 logical quadrants: [0]=top-left, [1]=top-right, [2]=bot-left, [3]=bot-right
    this.quadrants = [];
    this.quadTileDivs = [];   // [q][slot] → div
    this.prevTile = [];        // [q][slot] → tile index
    this.prevAttrib = [];      // [q][slot] → palette attrib

    for (let q = 0; q < 4; q++) {
      const qDiv = document.createElement('div');
      qDiv.className = 'nametable';
      qDiv.dataset.quadrant = q;
      qDiv.dataset.layer = `nametable-q${q}`;
      this.bgLayer.appendChild(qDiv);

      const divs = new Array(960);
      const prevT = new Int16Array(960).fill(-1);
      const prevA = new Int8Array(960).fill(-1);

      for (let i = 0; i < 960; i++) {
        const col = i % 32;
        const row = (i / 32) | 0;
        const d = document.createElement('div');
        d.className = 'bg-tile';
        d.dataset.type = 'bg-tile';
        d.dataset.col = col;
        d.dataset.row = row;
        d.dataset.quadrant = q;
        d.dataset.pxX = col * 8;
        d.dataset.pxY = row * 8;
        d.dataset.ntAddr = '$' + (0x2000 + q * 0x400 + i).toString(16);
        qDiv.appendChild(d);
        divs[i] = d;
      }

      this.quadrants.push(qDiv);
      this.quadTileDivs.push(divs);
      this.prevTile.push(prevT);
      this.prevAttrib.push(prevA);
    }
  }

  update(ppuState, tileCache) {
    const { nameTables, mirrorMap, scroll, bgVisible } = ppuState;

    this.bgLayer.style.display = bgVisible ? '' : 'none';
    if (!bgVisible) return;

    // Update tile data for each quadrant
    for (let q = 0; q < 4; q++) {
      const physNT = mirrorMap[q];
      const ntData = nameTables[physNT];
      if (!ntData) continue;
      this.quadrants[q].dataset.physNt = physNT;
      this._updateQuadrant(q, ntData, tileCache);
    }

    // Compute scroll pixel position
    const scrollX = scroll.coarseX * 8 + scroll.fineX + scroll.nameTableH * 256;
    const scrollY = scroll.coarseY * 8 + scroll.fineY + scroll.nameTableV * 240;

    // Reposition quadrants to handle wrapping.
    // Each quadrant has a base position in the 512×480 nametable space.
    // If a quadrant's right/bottom edge falls behind the scroll origin,
    // shift it forward by one full wrap (512px / 480px) so the viewport
    // always has content.
    for (let q = 0; q < 4; q++) {
      const col = q & 1;
      const row = q >> 1;
      let qx = col * 256;
      let qy = row * 240;

      // Wrap horizontally: if quadrant is fully left of scroll, move it right
      if (qx + 256 <= scrollX) qx += 512;
      // Wrap vertically: if quadrant is fully above scroll, move it down
      if (qy + 240 <= scrollY) qy += 480;

      this.quadrants[q].style.left = `${qx}px`;
      this.quadrants[q].style.top = `${qy}px`;
    }

    this.bgLayer.style.transform = `translate(${-scrollX}px, ${-scrollY}px)`;
  }

  _updateQuadrant(q, ntData, tileCache) {
    const divs = this.quadTileDivs[q];
    const prevT = this.prevTile[q];
    const prevA = this.prevAttrib[q];

    for (let i = 0; i < 960; i++) {
      const tileIdx = ntData.tile[i];
      const rawAttrib = ntData.attrib[i];
      const palGroup = rawAttrib >> 2;

      const tileChanged = tileIdx !== prevT[i];
      const attribChanged = rawAttrib !== prevA[i];
      const sheetChanged = tileCache.bgSheetUpdated(palGroup);

      if (!tileChanged && !attribChanged && !sheetChanged) continue;

      const div = divs[i];

      if (tileChanged || sheetChanged) {
        div.style.backgroundPosition = tileCache.getTilePosition(tileIdx);
        prevT[i] = tileIdx;
      }

      if (attribChanged) {
        div.className = `bg-tile bg-pal-${palGroup}`;
        div.dataset.tileIdx = tileIdx;
        div.dataset.tileHex = '$' + tileIdx.toString(16).padStart(2, '0');
        div.dataset.palette = palGroup;
        prevA[i] = rawAttrib;
      } else if (tileChanged) {
        div.dataset.tileIdx = tileIdx;
        div.dataset.tileHex = '$' + tileIdx.toString(16).padStart(2, '0');
      }
    }
  }
}

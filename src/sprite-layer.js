/**
 * Sprite layer: 64 absolutely-positioned sprite divs.
 * All sprites are updated every frame (OAM is volatile).
 * Supports both 8x8 and 8x16 sprite modes.
 */
export class SpriteLayer {
  constructor(container) {
    this.container = container;

    this.spriteLayer = document.createElement('div');
    this.spriteLayer.className = 'sprite-layer';
    this.spriteLayer.dataset.layer = 'sprites';
    this.spriteLayer.dataset.count = '64';
    container.appendChild(this.spriteLayer);

    // Pre-create 64 sprite divs
    this.spriteDivs = new Array(64);
    // For 8x16 mode, each sprite has two child divs
    this.spriteTopDivs = new Array(64);
    this.spriteBotDivs = new Array(64);

    for (let i = 0; i < 64; i++) {
      const div = document.createElement('div');
      div.className = 'sprite';
      div.dataset.type = 'sprite';
      div.dataset.idx = i;
      div.dataset.oamAddr = '$' + (i * 4).toString(16).padStart(2, '0');
      div.style.display = 'none';

      // Create 8x16 child divs (hidden by default)
      const top = document.createElement('div');
      top.className = 'sprite-half';
      top.dataset.half = 'top';
      const bot = document.createElement('div');
      bot.className = 'sprite-half';
      bot.dataset.half = 'bottom';
      div.appendChild(top);
      div.appendChild(bot);

      this.spriteDivs[i] = div;
      this.spriteTopDivs[i] = top;
      this.spriteBotDivs[i] = bot;
      this.spriteLayer.appendChild(div);
    }

    this.prevSpriteSize = -1;
  }

  /**
   * Update all 64 sprites from PPU state.
   */
  update(ppuState, tileCache) {
    const { sprites, sprPatternBase, spriteSize, spritesVisible } = ppuState;

    this.spriteLayer.style.display = spritesVisible ? '' : 'none';
    if (!spritesVisible) return;

    const is8x16 = spriteSize === 1;

    // If sprite size mode changed, update div structure
    if (spriteSize !== this.prevSpriteSize) {
      this._updateSpriteMode(is8x16);
      this.prevSpriteSize = spriteSize;
    }

    for (let i = 0; i < 64; i++) {
      const spr = sprites[i];
      const div = this.spriteDivs[i];

      // Hide sprites off screen (y >= 240 or y === 0 means unused in many games)
      const sprY = spr.y + 1; // NES sprites offset by +1 scanline
      const sprHeight = is8x16 ? 16 : 8;
      if (sprY >= 240 || sprY + sprHeight <= 0) {
        div.style.display = 'none';
        continue;
      }

      div.style.display = '';
      div.style.left = `${spr.x}px`;
      div.style.top = `${sprY}px`;

      // Palette group: sprCol values are 0, 4, 8, 12 → divide by 4 for group index
      const palGroup = spr.palette >> 2;

      // Flip transforms
      const scaleX = spr.flipH ? -1 : 1;
      const scaleY = spr.flipV ? -1 : 1;

      // Z-index: behind BG = -1, in front = 1
      div.style.zIndex = spr.behindBg ? -1 : 1;

      // Data attributes for DevTools inspection
      div.dataset.x = spr.x;
      div.dataset.y = sprY;
      div.dataset.tileIdx = spr.tileIndex;
      div.dataset.tileHex = '$' + spr.tileIndex.toString(16).padStart(2, '0');
      div.dataset.palette = palGroup;
      div.dataset.flipH = spr.flipH ? 1 : 0;
      div.dataset.flipV = spr.flipV ? 1 : 0;
      div.dataset.priority = spr.behindBg ? 'behind-bg' : 'in-front';

      if (is8x16) {
        this._update8x16(i, spr, palGroup, scaleX, scaleY, sprPatternBase, tileCache);
      } else {
        this._update8x8(i, spr, palGroup, scaleX, scaleY, sprPatternBase, tileCache);
      }
    }
  }

  _update8x8(i, spr, palGroup, scaleX, scaleY, sprBase, tileCache) {
    const div = this.spriteDivs[i];
    const bankIdx = sprBase === 0 ? 0 : 1;
    div.className = `sprite spr-b${bankIdx}-pal-${palGroup}`;
    div.style.backgroundPosition = tileCache.getTilePosition(spr.tileIndex);
    div.style.transform = `scale(${scaleX}, ${scaleY})`;

    // Hide child divs in 8x8 mode
    this.spriteTopDivs[i].style.display = 'none';
    this.spriteBotDivs[i].style.display = 'none';
  }

  _update8x16(i, spr, palGroup, scaleX, scaleY, sprBase, tileCache) {
    const div = this.spriteDivs[i];
    div.className = `sprite-8x16`;
    div.style.transform = `scale(${scaleX}, ${scaleY})`;
    // No background on container in 8x16 mode
    div.style.backgroundImage = 'none';
    div.style.backgroundPosition = '';

    // In 8x16, tile index bit 0 selects pattern table, bits 1-7 select tile pair
    // Bank: even tile from (tileIndex & 0xFE), odd tile is that +1
    // Pattern table: (tileIndex & 1) ? 256 : 0
    const bank = (spr.tileIndex & 1) ? 256 : 0;
    const bankIdx = bank === 0 ? 0 : 1;
    const topTileIdx = spr.tileIndex & 0xFE;
    const botTileIdx = topTileIdx + 1;

    const topDiv = this.spriteTopDivs[i];
    const botDiv = this.spriteBotDivs[i];
    topDiv.style.display = '';
    botDiv.style.display = '';

    const palClass = `spr-b${bankIdx}-pal-${palGroup}`;
    topDiv.className = `sprite-half ${palClass}`;
    botDiv.className = `sprite-half ${palClass}`;

    // If vertically flipped, swap top/bottom tiles
    if (spr.flipV) {
      topDiv.style.backgroundPosition = tileCache.getTilePosition(botTileIdx);
      botDiv.style.backgroundPosition = tileCache.getTilePosition(topTileIdx);
    } else {
      topDiv.style.backgroundPosition = tileCache.getTilePosition(topTileIdx);
      botDiv.style.backgroundPosition = tileCache.getTilePosition(botTileIdx);
    }
  }

  _updateSpriteMode(is8x16) {
    for (let i = 0; i < 64; i++) {
      const div = this.spriteDivs[i];
      if (is8x16) {
        div.style.width = '8px';
        div.style.height = '16px';
      } else {
        div.style.width = '8px';
        div.style.height = '8px';
      }
    }
  }
}

/**
 * Stub TileCache for layer tests that don't need real canvas rendering.
 */
export function createMockTileCache() {
  const updatedBgSheets = new Set();
  const updatedSprSheets = new Set();

  return {
    getTilePosition(index) {
      const col = index & 15;
      const row = (index >> 4) & 15;
      return `-${col * 8}px -${row * 8}px`;
    },

    bgSheetUpdated(palGroup) {
      return updatedBgSheets.has(palGroup);
    },

    sprSheetUpdated(palGroup) {
      return updatedSprSheets.has(palGroup);
    },

    // Test helpers to control which sheets appear updated
    _markBgSheetUpdated(palGroup) {
      updatedBgSheets.add(palGroup);
    },

    _markSprSheetUpdated(palGroup) {
      updatedSprSheets.add(palGroup);
    },

    _clearUpdated() {
      updatedBgSheets.clear();
      updatedSprSheets.clear();
    },
  };
}

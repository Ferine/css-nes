/**
 * DOM Mutation Counter — observes DOM mutations on the NES viewport subtree
 * and provides per-frame counts. Leaning into the project's unique identity
 * of using the DOM as a rendering target.
 *
 * The display span lives in the toolbar (outside the viewport), so updating
 * the counter text doesn't trigger self-referential mutations.
 */
export class MutationCounter {
  constructor(targetEl) {
    this._count = 0;

    this._observer = new MutationObserver((records) => {
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.type === 'attributes') {
          this._count++;
        } else {
          // childList: count added + removed nodes
          this._count += r.addedNodes.length + r.removedNodes.length;
        }
      }
    });

    this._observer.observe(targetEl, {
      childList: true,
      attributes: true,
      subtree: true,
    });
  }

  /**
   * Called once per frame after renderFrame().
   * Synchronously flushes pending records and returns the accumulated count.
   * Resets counter to 0 for the next frame.
   */
  snapshot() {
    // Flush any pending records that haven't been delivered yet
    const pending = this._observer.takeRecords();
    for (let i = 0; i < pending.length; i++) {
      const r = pending[i];
      if (r.type === 'attributes') {
        this._count++;
      } else {
        this._count += r.addedNodes.length + r.removedNodes.length;
      }
    }

    const count = this._count;
    this._count = 0;
    return count;
  }

  /**
   * Format a count for display.
   */
  static format(count) {
    if (count >= 1000) {
      return (count / 1000).toFixed(1) + 'k';
    }
    return String(count);
  }

  /**
   * Return a CSS class name based on mutation count severity.
   */
  static severity(count) {
    if (count > 3000) return 'mut-red';
    if (count >= 1000) return 'mut-yellow';
    return 'mut-green';
  }
}

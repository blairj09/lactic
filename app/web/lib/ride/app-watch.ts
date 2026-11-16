// Start with Zwift: when to get a free ride ready, from what's open on the computer. Once each
// time a training app (Zwift, Rouvy, MyWhoosh) opens, and never over a ride already under way. Pure,
// so it tests in Node.

export class AppWatch {
  /** The app a free ride was last got ready for; cleared once it closes, so the next open counts. */
  private handled: string | null = null;

  /**
   * One look at the computer: the training app open now (null for none) and whether a ride is under
   * way. True when a free ride should be got ready now.
   */
  update(app: string | null, riding: boolean): boolean {
    if (!app) {
      this.handled = null;
      return false;
    }
    if (this.handled === app) return false;
    // Mid-ride, leave it: the ride carries on, and Zwift opening later in it isn't a new ride.
    this.handled = app;
    return !riding;
  }
}

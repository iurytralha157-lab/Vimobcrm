/** Keeps native controls and delayed callbacks on the same submission fence. */
export class PropertyFormSubmission {
  private sequence = 0;
  private active: number | null = null;

  begin(): number | null {
    if (this.active !== null) return null;
    this.active = ++this.sequence;
    return this.active;
  }

  canEdit(): boolean {
    return this.active === null;
  }

  finish(sequence: number): void {
    if (sequence === this.active) this.active = null;
  }
}

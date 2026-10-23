export type PropertyCepRequest = {
  sequence: number;
  controller: AbortController;
};

/** A manual address change invalidates a lookup even if fetch ignores abort. */
export class PropertyCepRequests {
  private sequence = 0;
  private active: PropertyCepRequest | null = null;

  begin(): PropertyCepRequest {
    this.invalidate();
    const request = { sequence: this.sequence, controller: new AbortController() };
    this.active = request;
    return request;
  }

  invalidate(): void {
    this.sequence += 1;
    this.active?.controller.abort();
    this.active = null;
  }

  isCurrent(request: PropertyCepRequest): boolean {
    return this.owns(request)
      && !request.controller.signal.aborted;
  }

  owns(request: PropertyCepRequest): boolean {
    return this.active === request && request.sequence === this.sequence;
  }

  finish(request: PropertyCepRequest): void {
    if (this.active === request) this.active = null;
  }
}

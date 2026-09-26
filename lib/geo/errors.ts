/** Why places couldn't be found. Kept apart from the finder so the page can check for it without loading the towns. */
export class LookupError extends Error {
  /** True when this site's Google key was refused or is missing, as opposed to Google being unreachable. */
  readonly denied: boolean;
  constructor(message: string, denied: boolean) {
    super(message);
    this.name = "LookupError";
    this.denied = denied;
  }
}

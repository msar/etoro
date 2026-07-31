/** Cached after first schema-cache miss so we don't spam PostgREST. */
let schemaMissing = false;

export function isSchemaMissing(): boolean {
  return schemaMissing;
}

export function markSchemaMissing(errMessage: string): boolean {
  if (
    /Could not find the table/i.test(errMessage) ||
    /schema cache/i.test(errMessage) ||
    /relation .* does not exist/i.test(errMessage)
  ) {
    schemaMissing = true;
    return true;
  }
  return false;
}

/** Clear the cached miss so the next request re-probes (e.g. after migration). */
export function clearSchemaMissing(): void {
  schemaMissing = false;
}

export function schemaMissingHint(): string {
  return (
    'History tables are missing. If you use local storage, restart the app to recreate the SQLite schema. ' +
    'If you use Supabase, run the SQL in server/supabase/migrations/ (001–004) in the SQL editor, then reload.'
  );
}

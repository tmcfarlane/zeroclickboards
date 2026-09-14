import { v5 as uuidv5 } from 'uuid';

/** A source occurrence has one successor, even across clients, retries, or
 * restore/rearchive. Derive it from source identity, never clocks or schedules.
 * Each successor is itself a new source, so successive occurrences stay unique. */
export function recurringCardId(sourceId: string): string {
  return uuidv5(`zeroboard:recurring-successor:${sourceId}`, uuidv5.URL);
}

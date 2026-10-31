/** Executable indicator budgets, shared by publication checks and consumers. */
export const INDICATOR_INPUT_ROWS = 20_000;
export const INDICATOR_TOTAL_INPUT_ROWS = 100_000;
export const INDICATOR_INPUT_BYTES = 8 * 1024 * 1024;
export const INDICATOR_OUTPUT_POINTS = 100_000;

export function checkIndicatorInput(input) {
  if (!Number.isSafeInteger(input.lookback) || input.lookback < 0 || input.lookback > INDICATOR_INPUT_ROWS) throw Error(`Indicator lookback exceeds ${INDICATOR_INPUT_ROWS} row budget`);
  if (input.window !== undefined && (!Number.isSafeInteger(input.window) || input.window < Math.max(1, input.lookback) || input.window > INDICATOR_INPUT_ROWS)) throw Error('Indicator window must cover lookback within the input row budget');
}
/** lookback is minimum warm-up. Only an explicit window truncates samples. */
export function indicatorRows(input, rows) {
  checkIndicatorInput(input);
  const eligible = input.kind === 'bars' && input.forming === 'closed_only' ? rows.filter(row => row.isClosed) : rows;
  const selected = input.window === undefined ? eligible : eligible.slice(-input.window);
  if (selected.length > INDICATOR_INPUT_ROWS) throw Error(`Indicator ${input.id} exceeds ${INDICATOR_INPUT_ROWS} rows; declare a fixed window or narrow the viewport`);
  const required = input.window ?? input.lookback;
  if (selected.length < required) throw Error(`Indicator ${input.id} needs ${required} rows; only ${selected.length} available`);
  return selected;
}
export function checkIndicatorInputBudget(inputs) {
  const count = Object.values(inputs).reduce((sum, input) => sum + input.rows.length, 0);
  if (count > INDICATOR_TOTAL_INPUT_ROWS) throw Error(`Indicator inputs exceed ${INDICATOR_TOTAL_INPUT_ROWS} total row budget`);
  if (new TextEncoder().encode(JSON.stringify(inputs)).byteLength > INDICATOR_INPUT_BYTES) throw Error(`Indicator inputs exceed ${INDICATOR_INPUT_BYTES} byte budget`);
}

// Complete indicator entry: plot the source's actual Decimal close values.
export function compute(input) {
  const rows = input.inputs.price.rows;
  return {
    status: rows.length ? 'ready' : 'not_ready',
    series: [{
      seriesId: 'close',
      points: rows.map(bar => ({ key: bar.id, time: bar.openTime, value: { status: 'value', value: bar.close } })),
    }],
    diagnostics: [],
  };
}

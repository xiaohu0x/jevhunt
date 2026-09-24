export async function mapLimit(values, limit, fn) {
  const result = new Array(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) { const i = cursor++; result[i] = await fn(values[i], i); }
  }));
  return result;
}

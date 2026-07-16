export async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(text || response.statusText);
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.message || response.statusText);
  }
  return data;
}

export async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(text || response.statusText);
  }

  if (!response.ok || data.ok === false) {
    const details = [];

    if (data.apiStatus) details.push(`HTTP ${data.apiStatus}`);
    if (data.apiDetail) details.push(data.apiDetail);

    let message = data.error || response.statusText || 'API error';

    if (details.length) {
      message += ` (${details.join(' - ')})`;
    }

    throw new Error(message);
  }

  return data;
}

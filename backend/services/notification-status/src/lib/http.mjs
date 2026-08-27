export function response(status, body, headers = {}) {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body,
  };
}

export function errorResponse(error) {
  const status = Number(error?.statusCode || 500);
  const code = status >= 500 ? "INTERNAL_ERROR" : String(error?.message || "REQUEST_ERROR");
  return response(status, { error: code });
}

export function parseJson(value) {
  if (value == null || value === "") return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { throw Object.assign(new Error("INVALID_JSON"), { statusCode: 400 }); }
}

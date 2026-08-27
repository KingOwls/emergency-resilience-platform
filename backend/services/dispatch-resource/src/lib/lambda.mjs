import { route } from "../app.mjs";
import { errorResponse, parseJson } from "./http.mjs";
import { log } from "./log.mjs";

export async function apiHandler(event) {
  try {
    const result = await route({
      method: event.httpMethod || event.requestContext?.http?.method || "GET",
      path: event.path || event.rawPath || "/",
      query: event.queryStringParameters || {},
      headers: event.headers || {},
      body: parseJson(event.body),
    });
    return { statusCode: result.status, headers: result.headers, body: JSON.stringify(result.body) };
  } catch (error) {
    log("error", "lambda_request_failed", { error: error?.message });
    const result = errorResponse(error);
    return { statusCode: result.status, headers: result.headers, body: JSON.stringify(result.body) };
  }
}

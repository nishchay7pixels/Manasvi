export interface NativeGoogleApiClient {
  get<T>(url: string, accessToken: string): Promise<T>;
  post<T>(url: string, body: unknown, accessToken: string): Promise<T>;
  patch<T>(url: string, body: unknown, accessToken: string): Promise<T>;
  delete(url: string, accessToken: string): Promise<void>;
}

async function readGoogleResponse<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${label} failed (${response.status})${body.trim() ? `: ${body.trim().slice(0, 300)}` : ""}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export class FetchNativeGoogleApiClient implements NativeGoogleApiClient {
  async get<T>(url: string, accessToken: string): Promise<T> {
    const response = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    return readGoogleResponse<T>(response, "Google API GET");
  }

  async post<T>(url: string, body: unknown, accessToken: string): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    return readGoogleResponse<T>(response, "Google API POST");
  }

  async patch<T>(url: string, body: unknown, accessToken: string): Promise<T> {
    const response = await fetch(url, {
      method: "PATCH",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    return readGoogleResponse<T>(response, "Google API PATCH");
  }

  async delete(url: string, accessToken: string): Promise<void> {
    const response = await fetch(url, {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    await readGoogleResponse<void>(response, "Google API DELETE");
  }
}

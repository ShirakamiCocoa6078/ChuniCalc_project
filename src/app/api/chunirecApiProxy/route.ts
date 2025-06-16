
import { type NextRequest, NextResponse } from 'next/server';

const CHUNIREC_API_BASE_URL = 'https://api.chunirec.net/2.0';
const SERVER_FETCH_TIMEOUT_MS = 25000; // 25 seconds for server-side fetch

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const proxyEndpoint = searchParams.get('proxyEndpoint');
  const clientProvidedToken = searchParams.get('localApiToken');
  
  const serverApiKeySetting1 = process.env.CHUNIREC_API_KEY;
  const serverApiKeySetting2 = process.env.CHUNIREC_API_TOKEN;
  let serverApiKey = "";
  if (serverApiKeySetting1 && serverApiKeySetting1.trim() !== "") {
    serverApiKey = serverApiKeySetting1.trim();
  } else if (serverApiKeySetting2 && serverApiKeySetting2.trim() !== "") {
    serverApiKey = serverApiKeySetting2.trim();
  }

  let apiKeyToUse: string | null = null;
  let usingKeySource: string = "";

  if (clientProvidedToken && clientProvidedToken.trim() !== "") {
    apiKeyToUse = clientProvidedToken.trim();
    usingKeySource = "client-provided localApiToken";
  } else if (serverApiKey && serverApiKey.trim() !== "") {
    apiKeyToUse = serverApiKey;
    usingKeySource = `server-side environment variable (${serverApiKeySetting1 ? 'CHUNIREC_API_KEY' : 'CHUNIREC_API_TOKEN'})`;
  }

  console.log(
    `[PROXY_KEY_SELECTION] Attempting to use API key from: ${usingKeySource || "N/A (No key found)"}. Client token was: ${clientProvidedToken ? 'Present' : 'Absent'}. Server env key was: ${serverApiKey ? 'Present' : 'Absent'}`
  );

  if (!apiKeyToUse) {
    console.error('[PROXY_ERROR] No API key available. Neither client-provided token nor server API key (CHUNIREC_API_KEY or CHUNIREC_API_TOKEN) is set/valid.');
    return NextResponse.json({ error: 'Server configuration error: API key for Chunirec is missing or not accessible by the server, and no valid client token was provided.' }, { status: 500 });
  }
  
  if (!proxyEndpoint) {
    return NextResponse.json({ error: 'proxyEndpoint query parameter is required.' }, { status: 400 });
  }

  const targetUrl = new URL(`${CHUNIREC_API_BASE_URL}/${proxyEndpoint}`);
  
  searchParams.forEach((value, key) => {
    if (key !== 'proxyEndpoint' && key !== 'localApiToken') {
      targetUrl.searchParams.append(key, value);
    }
  });
  targetUrl.searchParams.append('token', apiKeyToUse);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, SERVER_FETCH_TIMEOUT_MS);

  let chunirecResponse;
  try {
    console.log(`[PROXY_INFO] Fetching from Chunirec using ${usingKeySource}: ${targetUrl.toString().replace(apiKeyToUse, "REDACTED_API_KEY")}`);
    chunirecResponse = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if ((error as Error).name === 'AbortError') {
      console.error(`[PROXY_ERROR] Fetch operation to Chunirec API (${proxyEndpoint}) timed out after ${SERVER_FETCH_TIMEOUT_MS}ms.`);
      return NextResponse.json({ error: `Chunirec API request timed out. Endpoint: ${proxyEndpoint}` }, { status: 504 }); // Gateway Timeout
    }
    console.error(`[PROXY_FATAL_ERROR] Network/fetch error during operation to Chunirec API (${proxyEndpoint}) using key from ${usingKeySource}:`, error);
    let errorMessage = 'Failed to fetch data from Chunirec API via proxy due to a network or unexpected error.';
    if (error instanceof Error) errorMessage = error.message;
    return NextResponse.json({ error: errorMessage, details: error instanceof Error ? error.stack : undefined }, { status: 503 }); // Service Unavailable
  } finally {
    clearTimeout(timeoutId);
  }

  const responseHeaders = new Headers();
  const rateLimitLimit = chunirecResponse.headers.get('X-Rate-Limit-Limit');
  const rateLimitRemaining = chunirecResponse.headers.get('X-Rate-Limit-Remaining');
  const rateLimitReset = chunirecResponse.headers.get('X-Rate-Limit-Reset');

  if (rateLimitLimit) responseHeaders.set('X-Rate-Limit-Limit', rateLimitLimit);
  if (rateLimitRemaining) responseHeaders.set('X-Rate-Limit-Remaining', rateLimitRemaining);
  if (rateLimitReset) responseHeaders.set('X-Rate-Limit-Reset', rateLimitReset);
  responseHeaders.set('Content-Type', 'application/json');

  if (!chunirecResponse.ok) {
    console.error(`[PROXY_ERROR] Chunirec API returned non-OK status: ${chunirecResponse.status} for ${proxyEndpoint}. Key source: ${usingKeySource}.`);
    let errorBodyText = `Raw error response from Chunirec API (status ${chunirecResponse.status}) was not readable.`;
    let errorJsonDetails: any = null;
    try {
        const clonedResponseForText = chunirecResponse.clone();
        errorBodyText = await clonedResponseForText.text();
        console.error(`[PROXY_ERROR_DETAIL] Chunirec raw error body for ${proxyEndpoint}: ${errorBodyText.substring(0, 500)}...`);
        try {
            errorJsonDetails = JSON.parse(errorBodyText); // Try to parse the read text
        } catch (e) {
            // Not JSON, text is already captured
        }
    } catch (textReadError) {
        console.error(`[PROXY_ERROR_DETAIL] Failed to read Chunirec error response body as text for ${proxyEndpoint}:`, textReadError);
    }

    const upstreamErrorMessage = errorJsonDetails?.message || errorJsonDetails?.error?.message || errorJsonDetails?.error || errorBodyText.substring(0,200);
    return NextResponse.json({
        error: `Chunirec API Error (status ${chunirecResponse.status}): ${upstreamErrorMessage}`
    }, { status: chunirecResponse.status, headers: responseHeaders });
  }

  // If chunirecResponse.ok is true
  try {
    const responseData = await chunirecResponse.json();
    return NextResponse.json(responseData, {
      status: chunirecResponse.status, // Should be 200-299 here
      headers: responseHeaders,
    });
  } catch (jsonError) {
    console.error(`[PROXY_ERROR] Failed to parse JSON from Chunirec for ${proxyEndpoint} (Status: ${chunirecResponse.status}, which was OK, but body invalid): ${(jsonError as Error).message}. Key source: ${usingKeySource}.`);
    // This indicates Chunirec sent a 2xx status but malformed JSON.
    let responseTextForDebug = "Could not read response text after JSON parse failure.";
    try {
        const clonedResponseForText = chunirecResponse.clone(); // Clone again if needed, or ensure original is readable
        responseTextForDebug = await clonedResponseForText.text();
    } catch (e) { /* ignore */ }

    return NextResponse.json({ 
        error: `Chunirec API Error: Successfully connected but received malformed JSON response.`,
        details: `Original status: ${chunirecResponse.status}. Response starts with: ${responseTextForDebug.substring(0, 100)}...`
    }, { status: 502, headers: responseHeaders }); // 502 Bad Gateway
  }
}

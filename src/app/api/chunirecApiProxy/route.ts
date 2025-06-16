
import { type NextRequest, NextResponse } from 'next/server';

const CHUNIREC_API_BASE_URL = 'https://api.chunirec.net/2.0';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const proxyEndpoint = searchParams.get('proxyEndpoint');
  const clientProvidedToken = searchParams.get('localApiToken');
  const serverApiKey = process.env.CHUNIREC_API_KEY;

  let apiKeyToUse: string | null = null;
  let usingKeySource: string = "";

  if (clientProvidedToken && clientProvidedToken.trim() !== "") {
    apiKeyToUse = clientProvidedToken.trim();
    usingKeySource = "client-provided localApiToken";
  } else if (serverApiKey && serverApiKey.trim() !== "") {
    apiKeyToUse = serverApiKey.trim();
    usingKeySource = "server-side CHUNIREC_API_KEY environment variable";
  }

  // --- 임시 디버깅 로그 시작 ---
  console.log(
    `[PROXY_KEY_SELECTION] Attempting to use API key from: ${usingKeySource || "N/A (No key found)"}. Client token was: ${clientProvidedToken ? 'Present' : 'Absent'}. Server env key was: ${serverApiKey ? 'Present' : 'Absent'}`
  );
  // --- 임시 디버깅 로그 끝 ---

  if (!apiKeyToUse) {
    console.error('[PROXY_ERROR] No API key available. Neither client-provided token nor server CHUNIREC_API_KEY is set/valid.');
    return NextResponse.json({ error: 'Server configuration error: API key for Chunirec is missing or not accessible by the server, and no valid client token was provided.' }, { status: 500 });
  }
  
  if (!proxyEndpoint) {
    return NextResponse.json({ error: 'proxyEndpoint query parameter is required.' }, { status: 400 });
  }

  const targetUrl = new URL(`${CHUNIREC_API_BASE_URL}/${proxyEndpoint}`);
  
  searchParams.forEach((value, key) => {
    if (key !== 'proxyEndpoint' && key !== 'localApiToken') { // Exclude localApiToken from being passed to Chunirec
      targetUrl.searchParams.append(key, value);
    }
  });
  targetUrl.searchParams.append('token', apiKeyToUse);

  try {
    // console.log(`[PROXY_INFO] Fetching from Chunirec using ${usingKeySource}: ${targetUrl.toString().replace(apiKeyToUse, "REDACTED_API_KEY")}`);
    const chunirecResponse = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    const data = await chunirecResponse.json().catch(err => {
      console.warn(`[PROXY_WARN] Failed to parse JSON from Chunirec for ${proxyEndpoint} (Status: ${chunirecResponse.status}): ${err.message}. Chunirec response text might follow.`);
      return chunirecResponse.text().then(text => {
        console.warn(`[PROXY_WARN] Chunirec non-JSON response text for ${proxyEndpoint}: ${text.substring(0, 200)}...`);
        return { error: `Chunirec API Error (non-JSON or parsing failed for status ${chunirecResponse.status}): ${text.substring(0,100)}...`};
      });
    });
    
    const responseHeaders = new Headers();
    const rateLimitLimit = chunirecResponse.headers.get('X-Rate-Limit-Limit');
    const rateLimitRemaining = chunirecResponse.headers.get('X-Rate-Limit-Remaining');
    const rateLimitReset = chunirecResponse.headers.get('X-Rate-Limit-Reset');

    if (rateLimitLimit) responseHeaders.set('X-Rate-Limit-Limit', rateLimitLimit);
    if (rateLimitRemaining) responseHeaders.set('X-Rate-Limit-Remaining', rateLimitRemaining);
    if (rateLimitReset) responseHeaders.set('X-Rate-Limit-Reset', rateLimitReset);
    responseHeaders.set('Content-Type', 'application/json');

    return NextResponse.json(data, {
      status: chunirecResponse.status,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error(`[PROXY_FATAL_ERROR] Error during fetch operation to Chunirec API (${proxyEndpoint}) using key from ${usingKeySource}:`, error);
    let errorMessage = 'Failed to fetch data from Chunirec API via proxy due to a network or unexpected error.';
    if (error instanceof Error) {
        errorMessage = error.message;
    }
    return NextResponse.json({ error: errorMessage, details: error instanceof Error ? error.stack : undefined }, { status: 503 });
  }
}

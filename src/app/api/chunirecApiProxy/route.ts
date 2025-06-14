
import { type NextRequest, NextResponse } from 'next/server';

const CHUNIREC_API_BASE_URL = 'https://api.chunirec.net/2.0';

export async function GET(request: NextRequest) {
  const apiKey = process.env.CHUNIREC_API_KEY; // This is the expected environment variable name

  if (!apiKey) {
    console.error('[PROXY_ERROR] CHUNIREC_API_KEY is not set in server environment variables. This is a server configuration issue.');
    return NextResponse.json({ error: 'Server configuration error: API key for Chunirec is missing or not accessible by the server.' }, { status: 500 });
  }
  // console.log('[PROXY_INFO] CHUNIREC_API_KEY found. Proceeding with proxy request.');


  const { searchParams } = new URL(request.url);
  const proxyEndpoint = searchParams.get('proxyEndpoint');

  if (!proxyEndpoint) {
    return NextResponse.json({ error: 'proxyEndpoint query parameter is required.' }, { status: 400 });
  }

  // Construct the target URL for Chunirec API
  const targetUrl = new URL(`${CHUNIREC_API_BASE_URL}/${proxyEndpoint}`);
  
  // Append all original search parameters except 'proxyEndpoint', and add the API token
  searchParams.forEach((value, key) => {
    if (key !== 'proxyEndpoint') {
      targetUrl.searchParams.append(key, value);
    }
  });
  targetUrl.searchParams.append('token', apiKey);

  try {
    // console.log(`[PROXY_INFO] Fetching from Chunirec: ${targetUrl.toString().replace(apiKey, "REDACTED_API_KEY")}`);
    const chunirecResponse = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        // Add any other headers Chunirec might expect
      },
    });

    // Extract data and headers from Chunirec response
    const data = await chunirecResponse.json().catch(err => {
      // If JSON parsing fails, it might be an empty response or non-JSON error
      console.warn(`[PROXY_WARN] Failed to parse JSON from Chunirec for ${proxyEndpoint} (Status: ${chunirecResponse.status}): ${err.message}. Chunirec response text might follow.`);
      // Try to get text if JSON fails
      return chunirecResponse.text().then(text => {
        console.warn(`[PROXY_WARN] Chunirec non-JSON response text for ${proxyEndpoint}: ${text.substring(0, 200)}...`);
        // Return an error structure that the client might expect
        return { error: `Chunirec API Error (non-JSON or parsing failed for status ${chunirecResponse.status}): ${text.substring(0,100)}...`};
      });
    });
    
    const responseHeaders = new Headers();
    // Copy relevant headers from Chunirec response to our proxy response
    const rateLimitLimit = chunirecResponse.headers.get('X-Rate-Limit-Limit');
    const rateLimitRemaining = chunirecResponse.headers.get('X-Rate-Limit-Remaining');
    const rateLimitReset = chunirecResponse.headers.get('X-Rate-Limit-Reset');

    if (rateLimitLimit) responseHeaders.set('X-Rate-Limit-Limit', rateLimitLimit);
    if (rateLimitRemaining) responseHeaders.set('X-Rate-Limit-Remaining', rateLimitRemaining);
    if (rateLimitReset) responseHeaders.set('X-Rate-Limit-Reset', rateLimitReset);
    responseHeaders.set('Content-Type', 'application/json');


    // Return the data with the original status code and copied headers
    return NextResponse.json(data, {
      status: chunirecResponse.status,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error(`[PROXY_FATAL_ERROR] Error during fetch operation to Chunirec API (${proxyEndpoint}):`, error);
    let errorMessage = 'Failed to fetch data from Chunirec API via proxy due to a network or unexpected error.';
    if (error instanceof Error) {
        errorMessage = error.message;
    }
    // For network errors or other unexpected errors during the fetch itself
    return NextResponse.json({ error: errorMessage, details: error instanceof Error ? error.stack : undefined }, { status: 503 }); // Service Unavailable
  }
}

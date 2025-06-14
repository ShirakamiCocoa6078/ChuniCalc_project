import { type NextRequest, NextResponse } from 'next/server';

const CHUNIREC_API_BASE_URL = 'https://api.chunirec.net/2.0';

export async function GET(request: NextRequest) {
  const apiKey = process.env.CHUNIREC_API_KEY;

  if (!apiKey) {
    console.error('CHUNIREC_API_KEY is not set in environment variables.');
    return NextResponse.json({ error: 'Server configuration error: API key missing.' }, { status: 500 });
  }

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
    const chunirecResponse = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        // Add any other headers Chunirec might expect, though typically not many for GET
      },
    });

    // Extract data and headers from Chunirec response
    const data = await chunirecResponse.json().catch(err => {
      // If JSON parsing fails, it might be an empty response or non-JSON error
      console.warn(`[PROXY] Failed to parse JSON from Chunirec for ${proxyEndpoint}: ${err.message}`);
      // Try to get text if JSON fails for non-200, or return minimal error for 200s with bad JSON
      if (!chunirecResponse.ok) {
        return chunirecResponse.text().then(text => ({ error: `Chunirec API Error (non-JSON): ${text}`}));
      }
      return { error: 'Failed to parse JSON response from Chunirec API.' };
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
    console.error(`[PROXY] Error fetching from Chunirec API (${proxyEndpoint}):`, error);
    let errorMessage = 'Failed to fetch data from Chunirec API via proxy.';
    if (error instanceof Error) {
        errorMessage = error.message;
    }
    return NextResponse.json({ error: errorMessage, details: error instanceof Error ? error.stack : undefined }, { status: 503 }); // Service Unavailable
  }
}

import { type NextRequest, NextResponse } from 'next/server';
// import * as cheerio from 'cheerio'; // Cheerio is no longer used as fetching is disabled

export async function GET(request: NextRequest) {
  // Jacket image fetching is disabled.
  // Returning a 404 or a specific "disabled" response.
  return NextResponse.json({ error: 'Jacket image fetching is currently disabled.' }, { status: 404 });

  /*
  // Original scraping logic is commented out below:

  const { searchParams } = new URL(request.url);
  const musicId = searchParams.get('musicId');

  if (!musicId) {
    return NextResponse.json({ error: 'musicId is required' }, { status: 400 });
  }

  try {
    const targetUrl = `https://db.chunirec.net/music/${musicId}`;
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch page for musicId ${musicId}: ${response.status} ${response.statusText} from ${targetUrl}`);
      return NextResponse.json({ error: `Failed to fetch page: ${response.status}` }, { status: response.status });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    let imageUrlPath: string | undefined;

    const jacketDivSpecific = $('.unidb-jacket[style*="background-image"]');
    if (jacketDivSpecific.length > 0) {
      const styleAttr = jacketDivSpecific.first().attr('style');
      if (styleAttr) {
        const match = styleAttr.match(/background-image:url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/);
        if (match && match[1]) {
          imageUrlPath = match[1];
        }
      }
    }

    if (!imageUrlPath) {
      $('div[style*="background-image"]').each((i, el) => {
        const styleAttr = $(el).attr('style');
        if (styleAttr && (styleAttr.includes('/lmg/music/jkt/') || styleAttr.includes('/lmg/music/jkt-sm/'))) {
          const match = styleAttr.match(/background-image:url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/);
          if (match && match[1]) {
            imageUrlPath = match[1];
            return false; 
          }
        }
      });
    }

    if (imageUrlPath) {
      let finalImageUrl = imageUrlPath;
      if (finalImageUrl.startsWith('/')) {
        finalImageUrl = `https://db.chunirec.net${finalImageUrl}`;
      }
      return NextResponse.json({ imageUrl: finalImageUrl });
    } else {
      console.warn(`Jacket image URL not found in page structure for musicId ${musicId}. HTML length: ${html.length}`);
      return NextResponse.json({ error: 'Jacket image URL not found in page structure.' }, { status: 404 });
    }

  } catch (error) {
    let errorMessage = 'Failed to scrape jacket image';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    console.error(`Error scraping jacket image for musicId ${musicId}:`, error);
    return NextResponse.json({ error: errorMessage, details: error instanceof Error ? error.stack : undefined }, { status: 500 });
  }
  */
}

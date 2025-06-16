
"use client";

import { getLocalReferenceApiToken } from "@/lib/get-api-token";

// Helper function to find the smallest valid JSON block containing the term
export const findSmallestEnclosingBlockHelper = (jsonDataStr: string, term: string): string | null => {
    if (!term || term.trim() === "") return jsonDataStr; // Return full data if no term
    const lowerTerm = term.toLowerCase();

    let matchIndices: number[] = [];
    let i = -1;
    // Find all occurrences of the term (case-insensitive)
    while ((i = jsonDataStr.toLowerCase().indexOf(lowerTerm, i + 1)) !== -1) {
        matchIndices.push(i);
    }

    if (matchIndices.length === 0) return `Term "${term}" not found in the provided JSON data.`;

    let smallestValidBlock: string | null = null;
    let smallestBlockLength = Infinity;

    for (const matchIndex of matchIndices) {
        let openBraceIndex = -1;
        let openBracketIndex = -1;

        // Search backwards for the opening brace/bracket
        for (let startIdx = matchIndex; startIdx >= 0; startIdx--) {
            if (jsonDataStr[startIdx] === '{') {
                openBraceIndex = startIdx;
                break;
            }
            if (jsonDataStr[startIdx] === '[') {
                openBracketIndex = startIdx;
                break;
            }
        }
        
        const startCharIndex = Math.max(openBraceIndex, openBracketIndex);
        
        let startParseIndex = startCharIndex !== -1 ? startCharIndex : 0;
        
        // If no opening char found before the term, or if it's not the start of a valid JSON object/array root
        if (startCharIndex === -1 && (jsonDataStr[0] !== '[' && jsonDataStr[0] !== '{')) {
             continue; 
        }
        
        const startChar = jsonDataStr[startParseIndex];
        if (startChar !== '{' && startChar !== '[') { // Ensure we start from a valid JSON structure
            continue;
        }
        const endChar = startChar === '{' ? '}' : ']';
        let balance = 0;

        // Search forwards for the corresponding closing brace/bracket
        for (let endIdx = startParseIndex; endIdx < jsonDataStr.length; endIdx++) {
            if (jsonDataStr[endIdx] === startChar) balance++;
            else if (jsonDataStr[endIdx] === endChar) balance--;

            if (balance === 0 && endIdx >= matchIndex) { // Found a balanced block that contains the matchIndex
                const currentBlock = jsonDataStr.substring(startParseIndex, endIdx + 1);
                // Double check term is within this specific block AND it's valid JSON
                if (currentBlock.toLowerCase().includes(lowerTerm)) { 
                    try {
                        JSON.parse(currentBlock); 
                        if (currentBlock.length < smallestBlockLength) {
                            smallestValidBlock = currentBlock;
                            smallestBlockLength = currentBlock.length; // Corrected: assign to smallestBlockLength
                        }
                    } catch (e) { 
                        // console.warn("Skipping invalid JSON block snippet:", currentBlock.substring(0,100));
                    }
                }
                break; 
            }
        }
    }
    
    try {
        return smallestValidBlock ? JSON.stringify(JSON.parse(smallestValidBlock), null, 2) : `Could not find a valid JSON block containing "${term}".`;
    } catch {
        return smallestValidBlock || `Could not find a valid JSON block containing "${term}".`; 
    }
};


export type ApiHelperEndpointString =
  | "/2.0/records/profile.json"
  | "/2.0/records/rating_data.json"
  | "/2.0/records/showall.json"
  | "/2.0/records/course.json"
  | "/2.0/music/showall.json";

export type DisplayFilteredDataEndpointType =
  | ApiHelperEndpointString
  | "N20_DEBUG_GLOBAL"
  | "N20_DEBUG_USER"
  | "N20_DEBUG_POOL"
  | "N20_DEBUG_USER_FILTERED"
  | "RELEASE_FILTER_RAW"
  | "RELEASE_FILTER_RESULT"
  | "SONG_BY_ID_RESULT"
  | "SONG_BY_ID_RAW";

export const displayFilteredData = (
    data: any,
    searchTerm: string | undefined,
    endpoint: DisplayFilteredDataEndpointType
): { content: string; summary?: string } => {
  if (data === null || data === undefined) return { content: "No data to display." };

  const lowerSearchTerm = searchTerm?.toLowerCase().trim();
  
  if (endpoint === "SONG_BY_ID_RAW") {
    return { content: typeof data === 'string' ? data : JSON.stringify(data, null, 2) };
  }
  
  let originalStringifiedData: string;
  try {
    originalStringifiedData = JSON.stringify(data, null, 2);
  } catch (e) {
    // If data is already a string (e.g., malformed JSON from API), use it as is
    originalStringifiedData = typeof data === 'string' ? data : "Error: Could not stringify data.";
  }


  if (!lowerSearchTerm || lowerSearchTerm === "") {
    const needsLineNumbers = 
        endpoint === "/2.0/records/rating_data.json" || 
        endpoint === "/2.0/records/showall.json" || 
        endpoint === "N20_DEBUG_USER" || 
        endpoint === "N20_DEBUG_USER_FILTERED" ||
        endpoint === "N20_DEBUG_POOL";

    if (needsLineNumbers) {
          const lines = originalStringifiedData.split('\n');
          const numDigits = String(lines.length).length;
          const content = lines.map((line, index) => `  ${String(index + 1).padStart(numDigits, ' ')}. ${line}`).join('\n');
          let summary: string | undefined = undefined;
          if (endpoint === "N20_DEBUG_POOL" && Array.isArray(data)) {
            summary = `Total ${data.length} songs in N20 debug pool.`;
          }
          return { content, summary };
    }
    return { content: originalStringifiedData };
  }

  // Search logic for various endpoints
  if (endpoint === "/2.0/records/rating_data.json" || 
      endpoint === "/2.0/records/showall.json" || 
      endpoint === "N20_DEBUG_USER" || 
      endpoint === "N20_DEBUG_USER_FILTERED") {
    const lines = originalStringifiedData.split('\n');
    const numDigits = String(lines.length).length;
    let summaryText: string | undefined = undefined;
    const matchingLineNumbers: number[] = [];

    const processedLines = lines.map((line, index) => {
      const lineNumber = index + 1;
      const displayLineNumber = `  ${String(lineNumber).padStart(numDigits, ' ')}. `;
      if (line.toLowerCase().includes(lowerSearchTerm)) {
        matchingLineNumbers.push(lineNumber);
        return `* ${String(lineNumber).padStart(numDigits, ' ')}. ${line}`;
      }
      return displayLineNumber + line;
    });
    const content = processedLines.join('\n');

    if (matchingLineNumbers.length > 0) {
        const maxLinesToShowInSummary = 5;
        const linesToShow = matchingLineNumbers.slice(0, maxLinesToShowInSummary).join(', ');
        const remainingCount = matchingLineNumbers.length - maxLinesToShowInSummary;
        summaryText = `Matching lines: ${linesToShow}`;
        if (remainingCount > 0) summaryText += ` (+ ${remainingCount} more)`;
    } else {
        summaryText = `"${searchTerm}" not found.`;
    }
    return { content, summary: summaryText };
  }
  
  if (endpoint === "N20_DEBUG_POOL" && Array.isArray(data)) {
      const filteredPool = data.filter(item => JSON.stringify(item).toLowerCase().includes(lowerSearchTerm));
      const content = JSON.stringify(filteredPool, null, 2);
      return { 
        content, 
        summary: `Found ${filteredPool.length} matching songs in the N20 debug pool for "${searchTerm}".`
      };
  }

  if (endpoint === "/2.0/music/showall.json" || 
      endpoint === "N20_DEBUG_GLOBAL" || 
      endpoint === "RELEASE_FILTER_RAW" || 
      endpoint === "RELEASE_FILTER_RESULT" || 
      endpoint === "SONG_BY_ID_RESULT") {
    
    let searchResultContent: string;
    let dataToSearch = data;
    // music/showall.json's proxy returns direct array, not {records: ...} usually
    // but handle if data is already parsed or a string.
    if (typeof data === 'string' && endpoint !== "SONG_BY_ID_RESULT") {
        try { dataToSearch = JSON.parse(data); } catch { /* use original stringified data */ }
    }


    if (Array.isArray(dataToSearch)) {
        const matchedBlocks: string[] = [];
        dataToSearch.forEach(item => {
            const itemStringForSearch = JSON.stringify(item); 
            if (itemStringForSearch.toLowerCase().includes(lowerSearchTerm)) {
                const prettyItemString = JSON.stringify(item, null, 2);
                const smallestBlock = findSmallestEnclosingBlockHelper(prettyItemString, lowerSearchTerm);
                if (smallestBlock && smallestBlock.startsWith("{") && smallestBlock.endsWith("}")) { // Basic check
                    matchedBlocks.push(smallestBlock);
                } else if (smallestBlock) { // If it's an error message or partial
                    matchedBlocks.push(prettyItemString); // Fallback to full item
                }
            }
        });
        searchResultContent = matchedBlocks.length > 0 ? matchedBlocks.join('\n\n---\n\n') : `"${searchTerm}" not found in any entry.`;
        return { content: searchResultContent, summary: `Found ${matchedBlocks.length} entries containing "${searchTerm}". Displaying relevant blocks.` };
    } else if (typeof dataToSearch === 'object' && dataToSearch !== null) { 
        const prettyItemString = JSON.stringify(dataToSearch, null, 2);
        if (prettyItemString.toLowerCase().includes(lowerSearchTerm)){
            searchResultContent = findSmallestEnclosingBlockHelper(prettyItemString, lowerSearchTerm) || prettyItemString;
        } else {
            searchResultContent = `"${searchTerm}" not found in the item. Full item: \n${prettyItemString}`;
        }
        return { content: searchResultContent, summary: `Searching within the item for "${searchTerm}".`};
    } else { 
        const block = findSmallestEnclosingBlockHelper(originalStringifiedData, lowerSearchTerm);
        return { content: block || `Could not process or find term in data. Defaulting to full data if search term is present, else original data.`, summary: `Generic search in raw data for "${searchTerm}".`};
    }
  }
  
  // Default fallback search if term is present but no specific endpoint logic matched
  if (lowerSearchTerm) {
      const block = findSmallestEnclosingBlockHelper(originalStringifiedData, lowerSearchTerm);
      return { content: block || `"${searchTerm}" not found or no specific block could be isolated.`, summary: `Generic search for "${searchTerm}".` };
  }

  return { content: originalStringifiedData };
};

export type FetchApiForDebugEndpointType =
  | "/2.0/records/profile.json"
  | "/2.0/records/rating_data.json"
  | "/2.0/records/showall.json"
  | "/2.0/music/showall.json";

export const fetchApiForDebug = async (
    proxyEndpoint: FetchApiForDebugEndpointType,
    userName?: string
  ): Promise<any> => {
  
    const params: Record<string, string> = { region: "jp2" };
    if (userName) {
      params.user_name = userName;
    }
    
    const endpointParam = proxyEndpoint.startsWith('/') ? proxyEndpoint.substring(1) : proxyEndpoint;

    const url = new URL(`/api/chunirecApiProxy`, window.location.origin);
    url.searchParams.append('proxyEndpoint', endpointParam);
    for (const key in params) {
      url.searchParams.append(key, params[key]);
    }

    const localToken = getLocalReferenceApiToken();
    if (localToken) {
      url.searchParams.append('localApiToken', localToken);
      console.log(`[fetchApiForDebug] Using local reference API token for endpoint: ${proxyEndpoint}`);
    } else {
      console.log(`[fetchApiForDebug] No local reference API token found for endpoint: ${proxyEndpoint}, relying on server-side key.`);
    }
  
    try {
      const response = await fetch(url.toString());
      const responseData = await response.json().catch(err => {
        console.warn(`[API_DEBUG_HELPER] Failed to parse JSON from proxy for ${proxyEndpoint}: ${err.message}`);
        if (!response.ok) {
          return response.text().then(text => ({ error: `API Error (non-JSON): ${text}`}));
        }
        return { error: 'Failed to parse JSON response from proxy.' };
      });

      if (!response.ok) {
        console.error(`[API_DEBUG_HELPER] API Error for ${proxyEndpoint}:`, response.status, responseData);
        throw new Error(`API request to ${proxyEndpoint} failed with status ${response.status}: ${responseData.error || JSON.stringify(responseData)}`);
      }
      
      console.log(`[API_DEBUG_HELPER] API Success for ${proxyEndpoint}:`, responseData);
      return responseData;
    } catch (error) {
      console.error(`[API_DEBUG_HELPER] Fetch/Network Error for ${proxyEndpoint}:`, error);
      throw error;
    }
  };



"use client";

import { getApiToken } from "@/lib/get-api-token";

// Helper function to find the smallest valid JSON block containing the term
export const findSmallestEnclosingBlockHelper = (jsonDataStr: string, term: string): string | null => {
    if (!term || term.trim() === "") return jsonDataStr;
    const lowerTerm = term.toLowerCase();

    let matchIndices: number[] = [];
    let i = -1;
    // Find all occurrences of the term (case-insensitive)
    while ((i = jsonDataStr.toLowerCase().indexOf(lowerTerm, i + 1)) !== -1) {
        matchIndices.push(i);
    }

    if (matchIndices.length === 0) return `"${term}" not found.`;

    let smallestValidBlock: string | null = null;

    for (const matchIndex of matchIndices) {
        // Search backwards for the opening brace/bracket
        let openBraceIndex = -1;
        let openBracketIndex = -1;

        for (let startIdx = matchIndex; startIdx >= 0; startIdx--) {
            if (jsonDataStr[startIdx] === '{') {
                openBraceIndex = startIdx;
                break;
            }
            if (jsonDataStr[startIdx] === '[') { // Also consider arrays
                openBracketIndex = startIdx;
                break;
            }
        }
        
        const startCharIndex = Math.max(openBraceIndex, openBracketIndex);

        // If no opening char found before the term in this path, or if it's not the start of a valid JSON
        if (startCharIndex === -1 && jsonDataStr[0] !== '[' && jsonDataStr[0] !== '{') {
             continue; // This term occurrence isn't inside a clear JSON object/array start
        }
        
        let startParseIndex = startCharIndex !== -1 ? startCharIndex : 0; // If -1, implies it might be the root [] or {}
        
        const startChar = jsonDataStr[startParseIndex];
        const endChar = startChar === '{' ? '}' : ']';
        let balance = 0;

        // Search forwards for the corresponding closing brace/bracket
        for (let endIdx = startParseIndex; endIdx < jsonDataStr.length; endIdx++) {
            if (jsonDataStr[endIdx] === startChar) balance++;
            else if (jsonDataStr[endIdx] === endChar) balance--;

            if (balance === 0) { // Found a balanced block
                const currentBlock = jsonDataStr.substring(startParseIndex, endIdx + 1);
                // Ensure the term is actually within this specific block
                if (currentBlock.toLowerCase().includes(lowerTerm)) {
                    try {
                        JSON.parse(currentBlock); // Check if it's valid JSON
                        if (!smallestValidBlock || currentBlock.length < smallestValidBlock.length) {
                            smallestValidBlock = currentBlock;
                        }
                    } catch (e) { /* ignore invalid JSON snippets for this path */ }
                }
                break; // Move to the next matchIndex
            }
        }
    }
    // Return the smallest valid block found, pretty-printed, or an error message.
    try {
        return smallestValidBlock ? JSON.stringify(JSON.parse(smallestValidBlock), null, 2) : `Could not find a valid JSON block for "${term}".`;
    } catch {
        return smallestValidBlock || `Could not find a valid JSON block for "${term}".`; // Fallback if re-parsing for stringify fails
    }
};

export type ApiEndpointString =
  | "/2.0/records/profile.json"
  | "/2.0/records/rating_data.json"
  | "/2.0/records/showall.json"
  | "/2.0/records/course.json"
  | "/2.0/music/showall.json";

export type DisplayFilteredDataEndpointType =
  | ApiEndpointString
  | "N20_DEBUG_GLOBAL"
  | "N20_DEBUG_USER"
  | "N20_DEBUG_POOL"
  | "RELEASE_FILTER_RAW"
  | "RELEASE_FILTER_RESULT"
  | "SONG_BY_ID_RESULT"
  | "SONG_BY_ID_RAW";

export const displayFilteredData = (
    data: any,
    searchTerm: string | undefined,
    endpoint: DisplayFilteredDataEndpointType
): { content: string; summary?: string } => {
  if (data === null || data === undefined) return { content: "" };

  const lowerSearchTerm = searchTerm?.toLowerCase().trim();
  
  // For SONG_BY_ID_RAW, if data is string, display as is. Otherwise, stringify.
  if (endpoint === "SONG_BY_ID_RAW") {
    return { content: typeof data === 'string' ? data : JSON.stringify(data, null, 2) };
  }
  
  const originalStringifiedData = JSON.stringify(data, null, 2);


  if (endpoint === "/2.0/records/rating_data.json" || endpoint === "/2.0/records/showall.json" || endpoint === "N20_DEBUG_USER") {
    const lines = originalStringifiedData.split('\n');
    const numDigits = String(lines.length).length;
    let summaryText: string | undefined = undefined;
    const matchingLineNumbers: number[] = [];

    const processedLines = lines.map((line, index) => {
      const lineNumber = index + 1;
      const displayLineNumber = `  ${String(lineNumber).padStart(numDigits, ' ')}. `;
      if (lowerSearchTerm && line.toLowerCase().includes(lowerSearchTerm)) {
        matchingLineNumbers.push(lineNumber);
        return `* ${String(lineNumber).padStart(numDigits, ' ')}. ${line}`;
      }
      return displayLineNumber + line;
    });

    const content = processedLines.join('\n');

    if (lowerSearchTerm) {
        if (matchingLineNumbers.length > 0) {
            const maxLinesToShowInSummary = 5;
            const linesToShow = matchingLineNumbers.slice(0, maxLinesToShowInSummary).join(', ');
            const remainingCount = matchingLineNumbers.length - maxLinesToShowInSummary;
            summaryText = `일치하는 라인: ${linesToShow}`;
            if (remainingCount > 0) {
                summaryText += ` (+ ${remainingCount}개 더보기)`;
            }
        } else {
            summaryText = `"${searchTerm}" 검색 결과 없음.`;
        }
    }
    return { content, summary: summaryText };
  }
  
  if (endpoint === "N20_DEBUG_POOL" && Array.isArray(data)) {
      const lines = JSON.stringify(data, null, 2).split('\n');
      const numDigits = String(lines.length).length;
      const processedLines = lines.map((line, index) => `  ${String(index + 1).padStart(numDigits, ' ')}. ${line}`);
      return { content: processedLines.join('\n'), summary: `총 ${data.length}개의 악곡이 정의된 신곡 풀에 포함됨.` };
  }


  if (endpoint === "/2.0/music/showall.json" || endpoint === "N20_DEBUG_GLOBAL" || endpoint === "RELEASE_FILTER_RAW" || endpoint === "RELEASE_FILTER_RESULT" || endpoint === "SONG_BY_ID_RESULT") {
    if (!lowerSearchTerm || lowerSearchTerm === "" || endpoint === "SONG_BY_ID_RESULT") { 
        return { content: originalStringifiedData };
    }

    let searchResultContent: string;
    const dataToSearch = typeof data === 'string' ? JSON.parse(data) : data;

    if (Array.isArray(dataToSearch)) {
        const matchedResults: string[] = [];
        dataToSearch.forEach(item => {
            const itemStr = JSON.stringify(item); 
            if (itemStr.toLowerCase().includes(lowerSearchTerm)) {
                // Pass the original pretty-printed item string for block finding
                const smallestBlock = findSmallestEnclosingBlockHelper(JSON.stringify(item, null, 2), lowerSearchTerm);
                matchedResults.push(smallestBlock || JSON.stringify(item, null, 2));
            }
        });
        searchResultContent = matchedResults.length > 0 ? matchedResults.map(r => { try { return JSON.stringify(JSON.parse(r), null, 2); } catch { return r; }}).join('\n\n---\n\n') : `"${searchTerm}" not found.`;
    } else if (typeof dataToSearch === 'object' && dataToSearch !== null) {
        const stringifiedObject = JSON.stringify(dataToSearch, null, 2);
        if (stringifiedObject.toLowerCase().includes(lowerSearchTerm)) {
            const smallest = findSmallestEnclosingBlockHelper(stringifiedObject, lowerSearchTerm);
             searchResultContent = smallest
                ? (() => {
                    try {
                        return JSON.stringify(JSON.parse(smallest), null, 2);
                    } catch (e) {
                        return smallest; 
                    }
                })()
                : stringifiedObject;
        } else {
            searchResultContent = `"${searchTerm}" not found.`;
        }
    } else {
        searchResultContent = originalStringifiedData;
    }
    return {
        content: searchResultContent,
        summary: `검색어 "${searchTerm}"에 대한 결과 (일치하는 최소 단위 객체):`
    };
  }

  return { content: originalStringifiedData };
};


export type FetchApiForDebugEndpointType =
  | "/2.0/music/showall.json"
  | "/2.0/records/showall.json";

export const fetchApiForDebug = async (endpoint: FetchApiForDebugEndpointType, nickname?: string): Promise<any> => {
    const apiToken = getApiToken();
    if (!apiToken) {
      throw new Error("API 토큰이 없습니다.");
    }
    let url = `https://api.chunirec.net${endpoint}?token=${apiToken}&region=jp2`;
    if (endpoint === "/2.0/records/showall.json" && nickname) {
      url += `&user_name=${encodeURIComponent(nickname)}`;
    }
    const response = await fetch(url);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({error: {message: `Response not JSON from ${url}`}}));
      throw new Error(`API 오류 (${endpoint}, 상태: ${response.status}): ${errorData.error?.message || response.statusText}. 응답: ${JSON.stringify(errorData)}`);
    }
    return response.json();
};

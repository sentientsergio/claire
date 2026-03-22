/**
 * Web Tools
 * 
 * Provides web_fetch for reading URLs.
 */

import * as cheerio from 'cheerio';

const MAX_CONTENT_LENGTH = 16000; // ~16KB text limit (controls token cost)
const FETCH_TIMEOUT = 10000; // 10 seconds

/**
 * Fetch a URL and extract readable text content
 */
export async function webFetch(url: string): Promise<string> {
  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  
  // Only allow http/https
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
  }
  
  // Fetch with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Claire/1.0)',
        'Accept': 'text/html,application/xhtml+xml,text/plain,application/json',
      },
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    
    // Handle different content types
    if (contentType.includes('application/json')) {
      // Return formatted JSON
      try {
        const json = JSON.parse(text);
        return JSON.stringify(json, null, 2).slice(0, MAX_CONTENT_LENGTH);
      } catch {
        return text.slice(0, MAX_CONTENT_LENGTH);
      }
    }
    
    if (contentType.includes('text/plain')) {
      return text.slice(0, MAX_CONTENT_LENGTH);
    }
    
    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      return extractReadableText(text);
    }
    
    // Default: return raw text
    return text.slice(0, MAX_CONTENT_LENGTH);
    
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        throw new Error(`Fetch timeout after ${FETCH_TIMEOUT}ms`);
      }
      throw err;
    }
    throw new Error('Unknown fetch error');
  }
}

/**
 * Extract readable text from HTML
 */
function extractReadableText(html: string): string {
  const $ = cheerio.load(html);
  
  // Remove script, style, nav, footer, aside elements
  $('script, style, nav, footer, aside, header, noscript, iframe').remove();
  
  // Get the title
  const title = $('title').text().trim();
  
  // Try to find the main content area
  let mainContent = '';
  
  // Common article selectors
  const articleSelectors = [
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.content',
    '#content',
    '.post',
    '.article',
  ];
  
  for (const selector of articleSelectors) {
    const el = $(selector);
    if (el.length > 0) {
      mainContent = el.text();
      break;
    }
  }
  
  // Fallback to body if no article found
  if (!mainContent) {
    mainContent = $('body').text();
  }
  
  // Clean up whitespace
  mainContent = mainContent
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
  
  // Compose result
  let result = '';
  if (title) {
    result = `# ${title}\n\n`;
  }
  result += mainContent;
  
  return result.slice(0, MAX_CONTENT_LENGTH);
}

/**
 * Get tool definition for the Anthropic API
 */
export function getWebToolDefinitions() {
  return [
    {
      name: 'web_fetch',
      description: 'Fetch and read content from a URL. Returns extracted text for HTML pages, or raw content for JSON/text. Use this when someone shares a link you want to read.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch (must be http or https)',
          },
        },
        required: ['url'],
      },
    },
  ];
}

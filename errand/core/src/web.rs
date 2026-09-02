//! Pulling search results out of a results page.
//!
//! There is no search API behind this — a key would be a running cost, and the
//! whole pricing argument is that there isn't one. So we read DuckDuckGo's
//! no-JavaScript HTML endpoint, which is stable and doesn't require an account.
//! It is scraping, and scraping breaks: every function here degrades to "no
//! results" rather than an error, and `search_web` says so honestly.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchHit {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Decode `%2F`-style escapes. DuckDuckGo wraps every result URL in a redirect
/// whose real destination is percent-encoded in the `uddg` parameter.
pub(crate) fn percent_decode_public(input: &str) -> String {
    percent_decode(input)
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => match u8::from_str_radix(&input[i + 1..i + 3], 16) {
                Ok(byte) => {
                    out.push(byte);
                    i += 3;
                }
                Err(_) => {
                    out.push(bytes[i]);
                    i += 1;
                }
            },
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Unwrap `//duckduckgo.com/l/?uddg=https%3A%2F%2Freal.site%2Fpage&rut=…`.
fn unwrap_redirect(href: &str) -> String {
    let Some(start) = href.find("uddg=") else {
        return if href.starts_with("//") {
            format!("https:{href}")
        } else {
            href.to_string()
        };
    };
    let rest = &href[start + 5..];
    let encoded = rest.split('&').next().unwrap_or(rest);
    percent_decode(encoded)
}

/// The value of an attribute on the tag starting at `from`, e.g. `href`.
fn attribute(html: &str, from: usize, name: &str) -> Option<String> {
    let tag_end = html[from..].find('>')? + from;
    let tag = &html[from..tag_end];
    let key = format!("{name}=\"");
    let start = tag.find(&key)? + key.len();
    let end = tag[start..].find('"')? + start;
    Some(tag[start..end].replace("&amp;", "&"))
}

/// The text between this tag's `>` and its closing `</a>`, tags stripped.
fn inner_text(html: &str, from: usize) -> String {
    let Some(open_end) = html[from..].find('>').map(|i| i + from + 1) else {
        return String::new();
    };
    let close = html[open_end..]
        .find("</a")
        .map(|i| i + open_end)
        .unwrap_or(html.len());
    crate::text::html_to_text(&html[open_end..close])
        .replace('\n', " ")
        .trim()
        .to_string()
}

/// Every `class="…"` occurrence of a marker, as byte offsets of its `<a`.
fn anchors_with_class(html: &str, class: &str) -> Vec<usize> {
    let needle = format!("class=\"{class}\"");
    let mut out = Vec::new();
    let mut cursor = 0;
    while let Some(found) = html[cursor..].find(&needle) {
        let at = cursor + found;
        // Walk back to the opening '<' of this tag.
        if let Some(open) = html[..at].rfind('<') {
            out.push(open);
        }
        cursor = at + needle.len();
    }
    out
}

/// Parse a DuckDuckGo HTML results page. Returns an empty list — never an
/// error — if the markup has changed under us.
pub fn parse_results(html: &str, limit: usize) -> Vec<SearchHit> {
    let links = anchors_with_class(html, "result__a");
    let snippets = anchors_with_class(html, "result__snippet");

    links
        .iter()
        .take(limit)
        .enumerate()
        .filter_map(|(i, &at)| {
            let href = attribute(html, at, "href")?;
            let title = inner_text(html, at);
            if title.is_empty() {
                return None;
            }
            let snippet = snippets
                .get(i)
                .map(|&s| inner_text(html, s))
                .unwrap_or_default();
            Some(SearchHit {
                title,
                url: unwrap_redirect(&href),
                snippet,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Trimmed from a real DuckDuckGo HTML response.
    const PAGE: &str = r##"
    <div class="results">
      <div class="result results_links">
        <h2 class="result__title">
          <a rel="nofollow" class="result__a"
             href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.gov.uk%2Fbin%2Dcollection&amp;rut=abc">
             When are my <b>bins</b> collected?</a>
        </h2>
        <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">
          Find your <b>collection</b> day by postcode.</a>
      </div>
      <div class="result results_links">
        <h2 class="result__title">
          <a rel="nofollow" class="result__a"
             href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Frecycling">Recycling rules</a>
        </h2>
        <a class="result__snippet" href="#">What goes in which bin.</a>
      </div>
    </div>"##;

    #[test]
    fn pulls_out_titles_urls_and_snippets() {
        let hits = parse_results(PAGE, 10);
        assert_eq!(hits.len(), 2, "{hits:#?}");
        assert_eq!(hits[0].title, "When are my bins collected?");
        assert_eq!(hits[0].url, "https://www.gov.uk/bin-collection");
        assert_eq!(hits[0].snippet, "Find your collection day by postcode.");
        assert_eq!(hits[1].url, "https://example.org/recycling");
    }

    #[test]
    fn respects_the_limit() {
        assert_eq!(parse_results(PAGE, 1).len(), 1);
    }

    #[test]
    fn changed_markup_yields_nothing_rather_than_nonsense() {
        assert!(parse_results("<html><body>redesigned</body></html>", 5).is_empty());
        assert!(parse_results("", 5).is_empty());
    }

    #[test]
    fn decodes_escapes_and_bare_protocol_relative_links() {
        assert_eq!(percent_decode("a%20b%2Fc"), "a b/c");
        assert_eq!(percent_decode("100%"), "100%"); // truncated escape, left alone
        assert_eq!(unwrap_redirect("//example.com/x"), "https://example.com/x");
    }
}

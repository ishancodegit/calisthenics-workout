//! Turning messy formats into something a small model can actually read.
//!
//! Both of these exist because context is the scarcest resource on a laptop
//! model: an 8B model with an 8k window can't be handed raw HTML or a 5MB CSV,
//! so we strip and cap before the model ever sees it.

/// Extract readable text from an HTML page.
///
/// Not a parser — a stripper. Script and style bodies are dropped entirely
/// (they're the bulk of a modern page and pure noise to a model), tags are
/// removed, and the common entities are decoded.
pub fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 4);
    let bytes = html.as_bytes();
    let lower = html.to_lowercase();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'<' {
            // Drop the entire body of tags whose content is never prose.
            for tag in ["script", "style", "noscript", "svg"] {
                if lower[i..].starts_with(&format!("<{tag}")) {
                    let close = format!("</{tag}");
                    match lower[i..].find(&close) {
                        Some(end) => {
                            i += end;
                            break;
                        }
                        None => return finish(out),
                    }
                }
            }
            // Treat block-level tags as line breaks so structure survives.
            if is_block_boundary(&lower[i..]) {
                out.push('\n');
            }
            match lower[i..].find('>') {
                Some(end) => {
                    i += end + 1;
                    continue;
                }
                None => break,
            }
        }
        out.push(html[i..].chars().next().unwrap_or(' '));
        i += html[i..].chars().next().map(char::len_utf8).unwrap_or(1);
    }
    finish(out)
}

fn is_block_boundary(rest: &str) -> bool {
    for tag in [
        "<p", "</p", "<br", "<div", "</div", "<li", "</li", "<tr", "</tr", "<h1", "<h2", "<h3",
        "<h4", "</h1", "</h2", "</h3", "</h4", "<section", "<article",
    ] {
        if rest.starts_with(tag) {
            return true;
        }
    }
    false
}

fn finish(raw: String) -> String {
    let decoded = raw
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");

    // Collapse the acres of whitespace that tag removal leaves behind.
    let mut lines: Vec<String> = Vec::new();
    for line in decoded.lines() {
        let trimmed = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if trimmed.is_empty() {
            continue;
        }
        lines.push(trimmed);
    }
    lines.join("\n")
}

/// Parse CSV, including quoted cells containing commas, newlines and `""`.
pub fn parse_csv(input: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    cell.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                cell.push(c);
            }
            continue;
        }
        match c {
            '"' => quoted = true,
            ',' => row.push(std::mem::take(&mut cell)),
            '\n' => {
                row.push(std::mem::take(&mut cell));
                rows.push(std::mem::take(&mut row));
            }
            '\r' => {}
            _ => cell.push(c),
        }
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row);
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_tags_and_keeps_the_prose() {
        let html = r#"<html><head><style>p{color:red}</style>
            <script>var x = "<p>not text</p>";</script></head>
            <body><h1>Bin collection</h1><p>Recycling is on &amp; Tuesday.</p>
            <div>Garden waste is Friday.</div></body></html>"#;
        let text = html_to_text(html);
        assert!(text.contains("Bin collection"), "{text}");
        assert!(text.contains("Recycling is on & Tuesday."), "{text}");
        assert!(text.contains("Garden waste is Friday."), "{text}");
        assert!(!text.contains("color:red"), "style leaked: {text}");
        assert!(!text.contains("not text"), "script leaked: {text}");
        assert!(!text.contains('<'), "tags leaked: {text}");
    }

    #[test]
    fn an_unclosed_script_does_not_swallow_everything_silently() {
        // Malformed pages are common; we must return something, not hang.
        let text = html_to_text("<p>Before</p><script>oops");
        assert!(text.contains("Before"), "{text}");
    }

    #[test]
    fn parses_quoted_cells_with_commas_and_quotes() {
        let rows = parse_csv("Item,Cost\n\"Rent, monthly\",900\n\"He said \"\"hi\"\"\",5\n");
        assert_eq!(rows[0], vec!["Item", "Cost"]);
        assert_eq!(rows[1], vec!["Rent, monthly", "900"]);
        assert_eq!(rows[2], vec!["He said \"hi\"", "5"]);
        assert_eq!(rows.len(), 3, "trailing newline produced a phantom row");
    }

    #[test]
    fn handles_empty_and_ragged_input() {
        assert!(parse_csv("").is_empty());
        let rows = parse_csv("a,b\nc\n");
        assert_eq!(rows[1], vec!["c"]);
    }
}

//! Signing in to Google, the way a desktop app is supposed to.
//!
//! Installed apps can't keep a secret — anything shipped in the binary is
//! readable by anyone who downloads it — so this uses the authorization code
//! flow with PKCE (RFC 7636) and no client secret at all. The client ID is
//! public by design.
//!
//! Everything here is pure: build a URL, build a form body, verify a
//! challenge. The socket work and the browser live in the desktop shell, so
//! this can be tested against the RFC's own vectors.

use sha2::{Digest, Sha256};

/// URL-safe base64 with no padding — what PKCE and JWTs both use.
pub fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        let indices = [n >> 18 & 63, n >> 12 & 63, n >> 6 & 63, n & 63];
        // 1 input byte -> 2 output chars, 2 -> 3, 3 -> 4. Padding is dropped.
        for index in indices.iter().take(chunk.len() + 1) {
            out.push(ALPHABET[*index as usize] as char);
        }
    }
    out
}

/// Percent-encode everything that isn't unreserved, for query strings.
pub fn urlencode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// The secret half of a PKCE exchange. Created per sign-in, never stored.
#[derive(Debug, Clone)]
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn challenge_for(verifier: &str) -> String {
    base64url(&Sha256::digest(verifier.as_bytes()))
}

impl Pkce {
    pub fn generate() -> Self {
        use rand::Rng;
        // 43-128 characters from the unreserved set, per RFC 7636 §4.1.
        const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
        let mut rng = rand::thread_rng();
        let verifier: String = (0..64)
            .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
            .collect();
        let challenge = challenge_for(&verifier);
        Self {
            verifier,
            challenge,
        }
    }
}

/// Read-only scopes. Errand can see the inbox and the calendar; it cannot send
/// mail, delete anything, or move an appointment — a 7B model should not be
/// one hallucination away from emailing somebody's boss.
pub const SCOPES: &[&str] = &[
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
];

pub fn authorize_url(client_id: &str, redirect_uri: &str, pkce: &Pkce, state: &str) -> String {
    let scope = urlencode(&SCOPES.join(" "));
    format!(
        "https://accounts.google.com/o/oauth2/v2/auth\
         ?client_id={client}\
         &redirect_uri={redirect}\
         &response_type=code\
         &scope={scope}\
         &code_challenge={challenge}\
         &code_challenge_method=S256\
         &access_type=offline\
         &prompt=consent\
         &state={state}",
        client = urlencode(client_id),
        redirect = urlencode(redirect_uri),
        challenge = urlencode(&pkce.challenge),
        state = urlencode(state),
    )
}

/// Form body swapping the one-time code for tokens.
pub fn token_exchange_body(
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> String {
    format!(
        "client_id={}&code={}&code_verifier={}&grant_type=authorization_code&redirect_uri={}",
        urlencode(client_id),
        urlencode(code),
        urlencode(verifier),
        urlencode(redirect_uri),
    )
}

/// Form body trading a long-lived refresh token for a fresh access token.
pub fn token_refresh_body(client_id: &str, refresh_token: &str) -> String {
    format!(
        "client_id={}&refresh_token={}&grant_type=refresh_token",
        urlencode(client_id),
        urlencode(refresh_token),
    )
}

/// A random value echoed back by Google, so a different local process can't
/// race us to the loopback port and feed us a code of its own.
pub fn random_state() -> String {
    use rand::Rng;
    let bytes: [u8; 16] = rand::thread_rng().gen();
    base64url(&bytes)
}

/// Pull the query parameters out of the single GET the browser makes to our
/// loopback server, e.g. `GET /?code=4/0Ab...&state=xyz HTTP/1.1`.
pub fn query_params(request_line: &str) -> Vec<(String, String)> {
    let Some(target) = request_line.split_whitespace().nth(1) else {
        return Vec::new();
    };
    let Some((_, query)) = target.split_once('?') else {
        return Vec::new();
    };
    query
        .split('&')
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            Some((key.to_string(), crate::web::percent_decode_public(value)))
        })
        .collect()
}

/// The code, but only if the state matches the one we sent.
pub fn code_from_request(request_line: &str, expected_state: &str) -> Option<String> {
    let params = query_params(request_line);
    let get = |name: &str| {
        params
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
    };
    if get("error").is_some() {
        return None;
    }
    if get("state").as_deref() != Some(expected_state) {
        return None; // not our redirect
    }
    get("code")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_rfc_7636_test_vector() {
        // Appendix B of RFC 7636 — if this passes, Google will accept it.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge_for(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn base64url_handles_every_chunk_remainder() {
        assert_eq!(base64url(b""), "");
        assert_eq!(base64url(b"f"), "Zg");
        assert_eq!(base64url(b"fo"), "Zm8");
        assert_eq!(base64url(b"foo"), "Zm9v");
        assert_eq!(base64url(b"foob"), "Zm9vYg");
        assert_eq!(base64url(b"fooba"), "Zm9vYmE");
        assert_eq!(base64url(b"foobar"), "Zm9vYmFy");
        // URL-safe alphabet: no '+' or '/' may appear.
        let encoded = base64url(&[251, 255, 190]);
        assert!(
            !encoded.contains('+') && !encoded.contains('/'),
            "{encoded}"
        );
    }

    #[test]
    fn generated_verifiers_are_unique_and_self_consistent() {
        let a = Pkce::generate();
        let b = Pkce::generate();
        assert_ne!(a.verifier, b.verifier, "verifier is not random");
        assert_eq!(a.challenge, challenge_for(&a.verifier));
        assert!((43..=128).contains(&a.verifier.len()));
    }

    #[test]
    fn the_authorize_url_carries_no_secret_and_asks_only_to_read() {
        let pkce = Pkce::generate();
        let url = authorize_url(
            "123.apps.googleusercontent.com",
            "http://127.0.0.1:8123",
            &pkce,
            "st4te",
        );
        assert!(url.contains("code_challenge_method=S256"));
        assert!(
            url.contains("access_type=offline"),
            "no refresh token would come back"
        );
        assert!(
            !url.contains("client_secret"),
            "installed apps have no secret"
        );
        assert!(url.contains("gmail.readonly"));
        assert!(!url.contains("gmail.send"), "asked for more than we need");
        assert!(url.contains("127.0.0.1"));
        assert!(url.contains("state=st4te"));
    }

    #[test]
    fn reads_the_code_out_of_the_browsers_redirect() {
        assert_eq!(
            code_from_request("GET /?code=4%2F0AbC-d&state=st4te HTTP/1.1", "st4te"),
            Some("4/0AbC-d".to_string())
        );
        // The user pressed Cancel.
        assert_eq!(
            code_from_request("GET /?error=access_denied&state=st4te HTTP/1.1", "st4te"),
            None
        );
        assert_eq!(code_from_request("GET / HTTP/1.1", "st4te"), None);
    }

    #[test]
    fn a_code_arriving_without_our_state_is_ignored() {
        // Another process on this machine racing us to the loopback port.
        assert_eq!(
            code_from_request("GET /?code=attacker&state=wrong HTTP/1.1", "st4te"),
            None
        );
        assert_eq!(
            code_from_request("GET /?code=attacker HTTP/1.1", "st4te"),
            None
        );
        assert_ne!(random_state(), random_state());
    }
}

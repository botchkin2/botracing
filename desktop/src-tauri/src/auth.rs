// Sign in through the web app, with no Google client of the tray's own. The tray
// opens the site's /tray-sign-in page in the browser (the person signs in there
// as on the rest of the site and confirms); the page sends the browser back to
// a loopback port of this tray with a ONE-TIME CODE. The code is useless
// without the verifier that only this process holds (PKCE, the same shape as
// OAuth's authorization code), so a code read from history or a log signs
// nobody in. The tray trades code + verifier for a Firebase custom token in a
// response body (never a URL), then for a refresh token with Firebase's own
// `signInWithCustomToken`. Refresh is Firebase's own token endpoint.
// The rules are in functions/src/trayCodeCore.ts; the page is
// src/features/trayLink.
//
// Nothing here touches the disk or the tray; account.rs keeps what it returns.
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, SystemTime};

/// Where everything is called. The defaults are the real services; tests point
/// them at a local stub.
#[derive(Clone)]
pub struct Config {
    pub firebase_key: String,
    pub firebase_custom: String,
    pub firebase_refresh: String,
    /// The site's page the tray opens in the browser.
    pub web_sign_in: String,
    /// `POST <tray_api>/token` trades the code and verifier for a custom token.
    pub tray_api: String,
    pub api: String,
}

impl Config {
    /// What the build embedded (build.rs). Empty when it was built without.
    pub fn from_build() -> Config {
        Config {
            firebase_key: env!("BOTRACING_FIREBASE_API_KEY").into(),
            firebase_custom:
                "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken".into(),
            firebase_refresh: "https://securetoken.googleapis.com/v1/token".into(),
            web_sign_in: "https://botracing-61.web.app/tray-sign-in".into(),
            tray_api: "https://botracing-61.web.app/api/tray".into(),
            api: "https://botracing-61.web.app/api/upload".into(),
        }
    }

    /// Why sign-in cannot work in this build, if it cannot.
    pub fn missing(&self) -> Option<&'static str> {
        if self.firebase_key.is_empty() {
            Some("built without the Firebase web key")
        } else {
            None
        }
    }
}

/// A signed-in Firebase session.
#[derive(Clone, Debug, PartialEq)]
pub struct Session {
    pub id_token: String,
    pub refresh_token: String,
    pub uid: String,
    pub email: String,
    pub expires_at: SystemTime,
}

impl Session {
    /// True when the ID token has less than `margin` left.
    pub fn expires_within(&self, margin: Duration) -> bool {
        self.expires_at
            .duration_since(SystemTime::now())
            .map(|left| left < margin)
            .unwrap_or(true)
    }
}

/// RFC 7636: BASE64URL(SHA256(verifier)), no padding.
pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// `bytes` random bytes as URL-safe text (a PKCE verifier needs 43+ chars: 32
/// bytes give 43).
pub fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).expect("the system has no random source");
    URL_SAFE_NO_PAD.encode(buf)
}

/// The page the tray opens: the site's sign-in page with this tray's loopback
/// port, a `state` the answer must echo, and the PKCE challenge. None of the
/// three is secret (the verifier never leaves this process).
pub fn sign_in_url(cfg: &Config, port: u16, state: &str, challenge: &str) -> String {
    format!(
        "{}?port={port}&state={state}&challenge={challenge}",
        cfg.web_sign_in
    )
}

/// The one-time code in the browser's request, only if it is exactly what the
/// sign-in page sends: `GET /callback?code=..&state=..` for OUR state, to our
/// own address (`Host: 127.0.0.1:<port>`, which also refuses a page that
/// reaches this port through a name it controls). Anything else is None and
/// the caller answers it with a 404.
pub fn parse_callback(request: &str, state: &str, port: u16) -> Option<String> {
    let mut lines = request.lines();
    let mut first = lines.next()?.split_whitespace();
    if first.next()? != "GET" {
        return None;
    }
    let target = first.next()?;
    let (path, query) = target.split_once('?')?;
    if path != "/callback" {
        return None;
    }
    let host_ok = lines
        .take_while(|l| !l.is_empty())
        .filter_map(|l| l.split_once(':'))
        .any(|(name, value)| {
            name.eq_ignore_ascii_case("host") && value.trim() == format!("127.0.0.1:{port}")
        });
    if !host_ok {
        return None;
    }
    let get = |name: &str| -> Option<String> {
        query.split('&').find_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            (k == name).then(|| urlencoding::decode(v).map(|c| c.into_owned()).ok())?
        })
    };
    if get("state").as_deref() != Some(state) {
        return None;
    }
    get("code").filter(|code| !code.is_empty())
}

/// Waits on the loopback listener for the sign-in page's callback, answers the
/// browser with a page saying so, and returns the code. The listener is the
/// caller's (bound to 127.0.0.1 only). Any other request, a favicon, a probe,
/// a wrong state, gets a bare 404 and the wait goes on; a hostile page can
/// probe the port but cannot end or complete the sign-in. Gives up at the
/// deadline.
pub fn wait_for_callback(
    listener: &TcpListener,
    state: &str,
    timeout: Duration,
) -> Result<String, String> {
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).into_owned();
                match parse_callback(&request, state, port) {
                    Some(code) => {
                        let body =
                            "<h3>Back to the BotRacing tray.</h3><p>You can close this tab.</p>";
                        let _ = write!(
                            stream,
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        );
                        return Ok(code);
                    }
                    None => {
                        let _ = stream.write_all(
                            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        );
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() > deadline {
                    return Err("no answer from the browser (timed out)".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// One client for every call, with timeouts: the tray must not hang on a dead
/// connection.
fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(20))
        .build()
}

/// A sentence from a failed HTTP call: the service's own message when it sent
/// one (`error_description` for Google, `error.message` for Firebase).
fn describe(error: ureq::Error) -> String {
    match error {
        ureq::Error::Status(code, response) => {
            let body: Value = response.into_json().unwrap_or(Value::Null);
            let message = body["error_description"]
                .as_str()
                .or_else(|| body["error"]["message"].as_str())
                .or_else(|| body["error"].as_str())
                .unwrap_or("no details");
            format!("{code}: {message}")
        }
        other => other.to_string(),
    }
}

/// What the server hands back for a valid code and verifier.
#[derive(Debug, PartialEq)]
pub struct Exchanged {
    pub custom_token: String,
    pub uid: String,
    pub email: String,
}

/// Trades the one-time code and this tray's verifier for a Firebase custom
/// token. The answer is in the response body, never a URL. A refusal (the code
/// expired, was used, or is not this tray's) is one sentence.
pub fn exchange_code(cfg: &Config, code: &str, verifier: &str) -> Result<Exchanged, String> {
    let body: Value = match agent()
        .post(&format!("{}/token", cfg.tray_api))
        .send_json(serde_json::json!({"code": code, "verifier": verifier}))
    {
        Ok(response) => response.into_json().map_err(|e| e.to_string())?,
        Err(ureq::Error::Status(400, _)) => {
            return Err("the sign-in expired or was already used: sign in again".into())
        }
        Err(other) => return Err(describe(other)),
    };
    let text = |k: &str| body[k].as_str().unwrap_or_default().to_string();
    let custom_token = text("customToken");
    let uid = text("uid");
    if custom_token.is_empty() || uid.is_empty() {
        return Err("the server's answer was missing the sign-in".into());
    }
    Ok(Exchanged {
        custom_token,
        uid,
        email: text("email"),
    })
}

/// Firebase's `signInWithCustomToken`: the custom token for a session with a
/// refresh token. The answer carries no uid or email, so those come from the
/// exchange.
pub fn custom_sign_in(cfg: &Config, exchanged: &Exchanged) -> Result<Session, String> {
    let mut body: Value = agent()
        .post(&format!("{}?key={}", cfg.firebase_custom, cfg.firebase_key))
        .send_json(serde_json::json!({
            "token": exchanged.custom_token,
            "returnSecureToken": true,
        }))
        .map_err(describe)?
        .into_json()
        .map_err(|e| e.to_string())?;
    body["localId"] = Value::String(exchanged.uid.clone());
    body["email"] = Value::String(exchanged.email.clone());
    session_from(&body, "")
}

fn session_from(body: &Value, fallback_email: &str) -> Result<Session, String> {
    let text = |k: &str| body[k].as_str().unwrap_or_default().to_string();
    let uid = if body["localId"].is_string() {
        text("localId")
    } else {
        text("user_id")
    };
    let id_token = text("idToken");
    let id_token = if id_token.is_empty() {
        text("id_token")
    } else {
        id_token
    };
    let refresh_token = if body["refreshToken"].is_string() {
        text("refreshToken")
    } else {
        text("refresh_token")
    };
    if uid.is_empty() || id_token.is_empty() || refresh_token.is_empty() {
        return Err("Firebase's answer was missing the user or a token".into());
    }
    let seconds: u64 = body["expiresIn"]
        .as_str()
        .or_else(|| body["expires_in"].as_str())
        .and_then(|s| s.parse().ok())
        .unwrap_or(3600);
    let email = if body["email"].is_string() {
        text("email")
    } else {
        fallback_email.to_string()
    };
    Ok(Session {
        id_token,
        refresh_token,
        uid,
        email,
        expires_at: SystemTime::now() + Duration::from_secs(seconds),
    })
}

/// Why a refresh failed. Only a refusal from Firebase means the sign-in is
/// over; a dropped connection, a timeout or a 5xx says nothing about the
/// credential, so it is kept and tried again (marshal #85).
#[derive(Debug, PartialEq)]
pub enum RefreshError {
    /// Firebase answered 400, 401 or 403: TOKEN_EXPIRED, USER_DISABLED, ...
    Rejected(String),
    /// The network failed: no connection, a timeout.
    Transient(String),
    /// Firebase answered, but not with one of the errors that end a sign-in
    /// (a wrong web key, a 5xx, a 429, a body that is not what it should be):
    /// the credential is kept and the call tried again, and the user is told
    /// the service is the problem, not their connection.
    Service(String),
}

impl std::fmt::Display for RefreshError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RefreshError::Rejected(m) | RefreshError::Transient(m) | RefreshError::Service(m) => {
                f.write_str(m)
            }
        }
    }
}

/// The Firebase errors that mean this user's sign-in is over: the refresh
/// token has expired or been revoked, or the account is gone or disabled.
/// Anything else, including other 4xx answers such as a wrong or rotated web
/// key (400 API_KEY_INVALID), says nothing about the user's credential and must
/// never delete it (marshal #186).
pub const ENDS_SIGN_IN: [&str; 4] = [
    "TOKEN_EXPIRED",
    "INVALID_REFRESH_TOKEN",
    "USER_DISABLED",
    "USER_NOT_FOUND",
];

/// Whether a Firebase error message names one of those. The code is the first
/// word: Firebase sometimes adds " : details" after it.
pub fn ends_sign_in(message: &str) -> bool {
    let code = message
        .split(|c: char| c == ' ' || c == ':')
        .next()
        .unwrap_or("");
    ENDS_SIGN_IN.contains(&code)
}

fn refresh_error(error: ureq::Error) -> RefreshError {
    match error {
        ureq::Error::Status(status, response) => {
            let body: Value = response.into_json().unwrap_or(Value::Null);
            let message = body["error"]["message"]
                .as_str()
                .or_else(|| body["error_description"].as_str())
                .or_else(|| body["error"].as_str())
                .unwrap_or("no details");
            let text = format!("{status}: {message}");
            if ends_sign_in(message) {
                RefreshError::Rejected(text)
            } else {
                RefreshError::Service(text)
            }
        }
        other => RefreshError::Transient(other.to_string()),
    }
}

pub fn refresh(cfg: &Config, previous: &Session) -> Result<Session, RefreshError> {
    let body: Value = agent()
        .post(&format!(
            "{}?key={}",
            cfg.firebase_refresh, cfg.firebase_key
        ))
        .send_form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", &previous.refresh_token),
        ])
        .map_err(refresh_error)?
        .into_json()
        .map_err(|e| RefreshError::Service(e.to_string()))?;
    session_from(&body, &previous.email).map_err(RefreshError::Service)
}

/// The owner key the server keeps for this user (GET /me).
pub fn owner_key(cfg: &Config, id_token: &str) -> Result<String, String> {
    let body: Value = agent()
        .get(&format!("{}/me", cfg.api))
        .set("authorization", &format!("Bearer {id_token}"))
        .call()
        .map_err(describe)?
        .into_json()
        // A 200 that is not JSON is another page answering (the web app's
        // index.html when the /api/upload route is not deployed), not a server
        // that cannot be reached.
        .map_err(|_| "unexpected answer from the server (not JSON)".to_string())?;
    body["ownerKey"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "the server sent no owner key".into())
}

/// The whole interactive sign-in: loopback listener on an ephemeral port,
/// the site's page in the browser, the one-time code, the tokens. `open` shows
/// the URL to the user (their default browser).
pub fn sign_in(
    cfg: &Config,
    open: impl FnOnce(&str),
    timeout: Duration,
) -> Result<Session, String> {
    if let Some(reason) = cfg.missing() {
        return Err(format!("Can't sign in: {reason}"));
    }
    // 127.0.0.1 only, never 0.0.0.0, and a port the system picks: a port that
    // is taken is never a failure.
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let verifier = random_token(32);
    let state = random_token(16);
    open(&sign_in_url(cfg, port, &state, &pkce_challenge(&verifier)));
    let code = wait_for_callback(&listener, &state, timeout)?;
    // Done listening: nothing else may reach this port.
    drop(listener);
    let exchanged = exchange_code(cfg, &code, &verifier)?;
    custom_sign_in(cfg, &exchanged)
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use std::sync::{Arc, Mutex};

    pub fn cfg(base: &str) -> Config {
        Config {
            firebase_key: "fbkey".into(),
            firebase_custom: format!("{base}/custom"),
            firebase_refresh: format!("{base}/refresh"),
            web_sign_in: "https://site.example/tray-sign-in".into(),
            tray_api: format!("{base}/api/tray"),
            api: format!("{base}/api/upload"),
        }
    }

    // A one-route-at-a-time stand-in server: each request is recorded, and the
    // handler decides the answer.
    pub type Seen = Arc<Mutex<Vec<(String, String, String)>>>;
    pub fn stub(handler: impl Fn(&str, &str) -> (u16, String) + Send + 'static) -> (String, Seen) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let seen: Seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let mut buf = vec![0u8; 16384];
                let mut n = 0;
                // Read until the headers and the declared body have arrived.
                loop {
                    let got = stream.read(&mut buf[n..]).unwrap_or(0);
                    if got == 0 {
                        break;
                    }
                    n += got;
                    let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                    if let Some((head, body)) = text.split_once("\r\n\r\n") {
                        let len = head
                            .lines()
                            .find_map(|l| {
                                l.to_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                            })
                            .unwrap_or(0);
                        if body.len() >= len {
                            break;
                        }
                    }
                }
                let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
                let first = head.lines().next().unwrap_or("");
                let path = first.split_whitespace().nth(1).unwrap_or("").to_string();
                let auth = head
                    .lines()
                    .find(|l| l.to_lowercase().starts_with("authorization:"))
                    .unwrap_or("")
                    .to_string();
                log.lock()
                    .unwrap()
                    .push((path.clone(), body.to_string(), auth));
                let (status, reply) = handler(&path, body);
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}",
                    reply.len()
                );
            }
        });
        (base, seen)
    }

    pub const FB_OK: &str = r#"{"localId":"UID1","email":"a@b.c","idToken":"FID","refreshToken":"FREF","expiresIn":"3600"}"#;
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;

    #[test]
    fn pkce_matches_the_rfc_7636_example() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let v = random_token(32);
        assert_eq!(v.len(), 43);
        assert_ne!(v, random_token(32));
    }

    #[test]
    fn refresh_keeps_the_email_and_returns_new_tokens() {
        let (base, seen) = stub(|_, _| {
            (200, r#"{"id_token":"NEWID","refresh_token":"NEWREF","user_id":"UID1","expires_in":"3600"}"#.into())
        });
        let old = Session {
            id_token: "OLD".into(),
            refresh_token: "OLDREF".into(),
            uid: "UID1".into(),
            email: "a@b.c".into(),
            expires_at: SystemTime::now(),
        };
        let s = refresh(&cfg(&base), &old).unwrap();
        assert_eq!(
            (
                s.id_token.as_str(),
                s.refresh_token.as_str(),
                s.email.as_str()
            ),
            ("NEWID", "NEWREF", "a@b.c")
        );
        let seen = seen.lock().unwrap();
        assert!(seen[0]
            .1
            .contains("grant_type=refresh_token&refresh_token=OLDREF"));
    }

    fn old_session() -> Session {
        Session {
            id_token: "OLD".into(),
            refresh_token: "OLDREF".into(),
            uid: "UID1".into(),
            email: "a@b.c".into(),
            expires_at: SystemTime::now(),
        }
    }

    #[test]
    fn only_the_errors_that_mean_the_sign_in_is_over_reject_it() {
        for code in [
            "TOKEN_EXPIRED",
            "INVALID_REFRESH_TOKEN",
            "USER_DISABLED",
            "USER_NOT_FOUND",
        ] {
            let (base, _) =
                stub(move |_, _| (400, format!(r#"{{"error":{{"message":"{code}"}}}}"#)));
            let err = refresh(&cfg(&base), &old_session()).unwrap_err();
            assert!(matches!(err, RefreshError::Rejected(_)), "{code}: {err:?}");
        }
        // Firebase sometimes adds details after the code.
        let (base, _) = stub(|_, _| {
            (
                400,
                r#"{"error":{"message":"TOKEN_EXPIRED : the token is stale"}}"#.into(),
            )
        });
        assert!(matches!(
            refresh(&cfg(&base), &old_session()).unwrap_err(),
            RefreshError::Rejected(_)
        ));
    }

    #[test]
    fn a_wrong_key_or_any_other_answer_never_ends_a_sign_in() {
        // The same HTTP statuses as the real refusals, with other codes: a
        // wrong or rotated web key is a 400 too.
        for (status, body) in [
            (400, r#"{"error":{"message":"API_KEY_INVALID"}}"#),
            (400, r#"{"error":{"message":"INVALID_GRANT_TYPE"}}"#),
            (400, r#"{"error":{"message":"MISSING_REFRESH_TOKEN"}}"#),
            (403, r#"{"error":{"message":"PERMISSION_DENIED"}}"#),
            (401, r#"{"error":{"message":"UNAUTHENTICATED"}}"#),
            (400, "not json at all"),
            (400, r#"{"error":{}}"#),
            (
                429,
                r#"{"error":{"message":"TOO_MANY_ATTEMPTS_TRY_LATER"}}"#,
            ),
        ] {
            let (base, _) = stub(move |_, _| (status, body.to_string()));
            let err = refresh(&cfg(&base), &old_session()).unwrap_err();
            assert!(
                matches!(err, RefreshError::Service(_)),
                "{status} {body}: {err:?}"
            );
        }
        assert!(!ends_sign_in("API_KEY_INVALID"));
        assert!(!ends_sign_in("TOKEN_EXPIRED_SOON"));
        assert!(!ends_sign_in(""));
        assert!(ends_sign_in("USER_DISABLED"));
    }

    #[test]
    fn the_owner_key_is_read_with_the_bearer_token() {
        let (base, seen) = stub(|_, _| (200, r#"{"ownerKey":"botkin"}"#.into()));
        assert_eq!(owner_key(&cfg(&base), "TOK").unwrap(), "botkin");
        assert!(seen.lock().unwrap()[0]
            .2
            .to_lowercase()
            .contains("bearer tok"));
        let (base, _) = stub(|_, _| (200, "{}".into()));
        assert!(owner_key(&cfg(&base), "TOK").is_err());
    }

    #[test]
    fn a_page_instead_of_json_is_an_unexpected_answer_not_unreachable() {
        let (base, _) = stub(|_, _| (200, "<!doctype html><title>BotRacing</title>".into()));
        let err = owner_key(&cfg(&base), "TOK").unwrap_err();
        assert!(
            err.starts_with("unexpected answer from the server"),
            "{err}"
        );
        let (down, _) = stub(|_, _| (503, r#"{"error":{"message":"overloaded"}}"#.into()));
        let err = owner_key(&cfg(&down), "TOK").unwrap_err();
        assert!(err.contains("503"), "{err}");
    }

    #[test]
    fn the_sign_in_url_carries_port_state_and_challenge_and_nothing_secret() {
        let url = sign_in_url(&cfg("x"), 5555, "ST", "CHAL");
        assert_eq!(
            url,
            "https://site.example/tray-sign-in?port=5555&state=ST&challenge=CHAL"
        );
    }

    fn get(target: &str, host: &str) -> String {
        format!("GET {target} HTTP/1.1\r\nHost: {host}\r\nAccept: */*\r\n\r\n")
    }

    #[test]
    fn a_callback_gives_its_code_only_for_our_state_path_and_address() {
        let own = "127.0.0.1:5555";
        let ok = get("/callback?code=4%2F0AbC_x&state=ST", own);
        assert_eq!(parse_callback(&ok, "ST", 5555).as_deref(), Some("4/0AbC_x"));
        // Wrong state, wrong path, no code, an empty code.
        for target in [
            "/callback?code=C&state=NO",
            "/?code=C&state=ST",
            "/callback/x?code=C&state=ST",
            "/callback?state=ST",
            "/callback?code=&state=ST",
            "/callback",
        ] {
            assert_eq!(
                parse_callback(&get(target, own), "ST", 5555),
                None,
                "{target}"
            );
        }
        // Not GET.
        let post = "POST /callback?code=C&state=ST HTTP/1.1\r\nHost: 127.0.0.1:5555\r\n\r\n";
        assert_eq!(parse_callback(post, "ST", 5555), None);
        // Reached through a name or port that is not this tray's own address.
        for host in [
            "evil.example",
            "evil.example:5555",
            "localhost:5555",
            "127.0.0.1:5556",
            "127.0.0.1",
            "",
        ] {
            let request = get("/callback?code=C&state=ST", host);
            assert_eq!(parse_callback(&request, "ST", 5555), None, "{host}");
        }
        assert_eq!(parse_callback("", "ST", 5555), None);
        assert_eq!(parse_callback("garbage", "ST", 5555), None);
    }

    #[test]
    fn the_listener_answers_only_the_callback_and_404s_everything_else() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || {
            let ask = |target: &str, host: String| {
                let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
                write!(s, "{}", get(target, &host)).unwrap();
                let mut out = String::new();
                s.read_to_string(&mut out).unwrap();
                out
            };
            let own = format!("127.0.0.1:{port}");
            let favicon = ask("/favicon.ico", own.clone());
            let forged = ask("/callback?code=EVIL&state=FORGED", own.clone());
            let rebound = ask("/callback?code=EVIL&state=ST", "evil.example".into());
            let answer = ask("/callback?code=THE_CODE&state=ST", own);
            (favicon, forged, rebound, answer)
        });
        let code = wait_for_callback(&listener, "ST", Duration::from_secs(5)).unwrap();
        assert_eq!(code, "THE_CODE");
        let (favicon, forged, rebound, answer) = browser.join().unwrap();
        for refused in [&favicon, &forged, &rebound] {
            assert!(refused.starts_with("HTTP/1.1 404"));
            // No CORS headers: a page cannot read what the port says.
            assert!(!refused.to_lowercase().contains("access-control"));
        }
        assert!(answer.starts_with("HTTP/1.1 200"));
        assert!(answer.contains("Back to the BotRacing tray"));
        assert!(!answer.to_lowercase().contains("access-control"));
    }

    #[test]
    fn the_listener_times_out_when_nobody_answers() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let err = wait_for_callback(&listener, "ST", Duration::from_millis(300)).unwrap_err();
        assert!(err.contains("timed out"));
    }

    #[test]
    fn the_code_is_traded_with_the_verifier_and_nothing_else_secret() {
        let (base, seen) = stub(|_, _| {
            (
                200,
                r#"{"customToken":"CT","uid":"UID1","email":"a@b.c"}"#.into(),
            )
        });
        let got = exchange_code(&cfg(&base), "CODE1", "VERIF1").unwrap();
        assert_eq!(
            got,
            Exchanged {
                custom_token: "CT".into(),
                uid: "UID1".into(),
                email: "a@b.c".into()
            }
        );
        let seen = seen.lock().unwrap();
        assert_eq!(seen[0].0, "/api/tray/token");
        let body: Value = serde_json::from_str(&seen[0].1).unwrap();
        assert_eq!(
            body,
            serde_json::json!({"code": "CODE1", "verifier": "VERIF1"})
        );
    }

    #[test]
    fn a_refused_code_is_one_sentence_to_sign_in_again() {
        let (base, _) = stub(|_, _| (400, r#"{"error":"sign in again"}"#.into()));
        let err = exchange_code(&cfg(&base), "C", "V").unwrap_err();
        assert!(err.contains("sign in again"), "{err}");
        let (down, _) = stub(|_, _| (503, r#"{"error":"overloaded"}"#.into()));
        assert!(exchange_code(&cfg(&down), "C", "V")
            .unwrap_err()
            .contains("503"));
        let (empty, _) = stub(|_, _| (200, "{}".into()));
        assert!(exchange_code(&cfg(&empty), "C", "V").is_err());
    }

    #[test]
    fn firebase_turns_the_custom_token_into_a_session_for_that_user() {
        let (base, seen) = stub(|_, _| {
            (
                200,
                r#"{"idToken":"FID","refreshToken":"FREF","expiresIn":"3600"}"#.into(),
            )
        });
        let exchanged = Exchanged {
            custom_token: "CT".into(),
            uid: "UID1".into(),
            email: "a@b.c".into(),
        };
        let s = custom_sign_in(&cfg(&base), &exchanged).unwrap();
        assert_eq!(
            (
                s.uid.as_str(),
                s.email.as_str(),
                s.id_token.as_str(),
                s.refresh_token.as_str()
            ),
            ("UID1", "a@b.c", "FID", "FREF")
        );
        assert!(!s.expires_within(Duration::from_secs(3000)));
        let seen = seen.lock().unwrap();
        assert!(seen[0].0.contains("key=fbkey"));
        let body: Value = serde_json::from_str(&seen[0].1).unwrap();
        assert_eq!(body["token"], "CT");
        assert_eq!(body["returnSecureToken"], true);
    }

    #[test]
    fn the_whole_sign_in_goes_through_the_browser_and_the_server_with_no_token_in_a_url() {
        let (base, seen) = stub(|path, _| {
            if path.starts_with("/api/tray/token") {
                (
                    200,
                    r#"{"customToken":"CT-SECRET","uid":"UID1","email":"a@b.c"}"#.into(),
                )
            } else {
                (
                    200,
                    r#"{"idToken":"FID","refreshToken":"FREF","expiresIn":"3600"}"#.into(),
                )
            }
        });
        let opened = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let seen_url = opened.clone();
        let session = sign_in(
            &cfg(&base),
            move |url| {
                *seen_url.lock().unwrap() = url.to_string();
                // The page does what the site's page does: sends the browser
                // to the tray's own address with a code and the state.
                let query = url.split_once('?').unwrap().1.to_string();
                let param = |name: &str| {
                    query
                        .split('&')
                        .find_map(|p| p.strip_prefix(&format!("{name}=")).map(str::to_string))
                        .unwrap()
                };
                let (port, state) = (param("port"), param("state"));
                std::thread::spawn(move || {
                    let mut s = std::net::TcpStream::connect(format!("127.0.0.1:{port}")).unwrap();
                    write!(
                        s,
                        "GET /callback?code=CODE1&state={state} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"
                    )
                    .unwrap();
                    let mut out = String::new();
                    s.read_to_string(&mut out).unwrap();
                });
            },
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(
            (session.uid.as_str(), session.email.as_str()),
            ("UID1", "a@b.c")
        );
        // The verifier sent to the server is the one the challenge in the URL
        // was made from, and it never appeared in the URL.
        let url = opened.lock().unwrap().clone();
        let challenge = url.split("challenge=").nth(1).unwrap().to_string();
        let seen = seen.lock().unwrap();
        let body: Value = serde_json::from_str(&seen[0].1).unwrap();
        let verifier = body["verifier"].as_str().unwrap();
        assert_eq!(pkce_challenge(verifier), challenge);
        assert!(!url.contains(verifier));
        // The custom token is in a response body and a request body, in no URL.
        assert!(seen.iter().all(|(path, _, _)| !path.contains("CT-SECRET")));
        assert!(!url.contains("CT-SECRET"));
    }

    #[test]
    fn a_build_without_the_firebase_key_refuses_to_sign_in() {
        let mut c = cfg("x");
        c.firebase_key.clear();
        assert!(c.missing().is_some());
        let err = sign_in(
            &c,
            |_| panic!("must not open a browser"),
            Duration::from_secs(1),
        )
        .unwrap_err();
        assert!(err.starts_with("Can't sign in"));
    }
}

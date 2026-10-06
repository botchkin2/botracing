// Sign in with Google for a desktop app, then trade that for a Firebase
// session: OAuth authorization code with PKCE on a loopback redirect, then
// Firebase `signInWithIdp`. Refresh is Firebase's own token endpoint.
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
    pub client_id: String,
    pub client_secret: String,
    pub firebase_key: String,
    pub google_auth: String,
    pub google_token: String,
    pub firebase_idp: String,
    pub firebase_refresh: String,
    pub api: String,
}

impl Config {
    /// What the build embedded (build.rs). Empty when it was built without.
    pub fn from_build() -> Config {
        Config {
            client_id: env!("BOTRACING_OAUTH_CLIENT_ID").into(),
            client_secret: env!("BOTRACING_OAUTH_CLIENT_SECRET").into(),
            firebase_key: env!("BOTRACING_FIREBASE_API_KEY").into(),
            google_auth: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            google_token: "https://oauth2.googleapis.com/token".into(),
            firebase_idp: "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp".into(),
            firebase_refresh: "https://securetoken.googleapis.com/v1/token".into(),
            api: "https://botracing-61.web.app/api/upload".into(),
        }
    }

    /// Why sign-in cannot work in this build, if it cannot.
    pub fn missing(&self) -> Option<&'static str> {
        if self.client_id.is_empty() || self.client_secret.is_empty() {
            Some("built without the Google OAuth client")
        } else if self.firebase_key.is_empty() {
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

/// What Google handed back for the authorization code.
#[derive(Debug, PartialEq)]
pub struct GoogleTokens {
    pub id_token: String,
    pub access_token: String,
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

pub fn auth_url(cfg: &Config, redirect: &str, challenge: &str, state: &str) -> String {
    use urlencoding::encode;
    format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&state={}&access_type=online&prompt=select_account",
        cfg.google_auth,
        encode(&cfg.client_id),
        encode(redirect),
        encode("openid email profile"),
        challenge,
        state
    )
}

/// The authorization code in the browser's redirect, from the request's first
/// line ("GET /?code=...&state=... HTTP/1.1"). A wrong state, or an error from
/// Google, is an Err with a sentence for the user.
pub fn parse_redirect(request: &str, state: &str) -> Result<String, String> {
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or("the browser sent something that is not a request")?;
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
    let get = |name: &str| -> Option<String> {
        query.split('&').find_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            (k == name).then(|| urlencoding::decode(v).map(|c| c.into_owned()).ok())?
        })
    };
    if let Some(error) = get("error") {
        return Err(format!("Google said: {error}"));
    }
    if get("state").as_deref() != Some(state) {
        return Err("the sign-in answer was not for this request".into());
    }
    get("code").ok_or_else(|| "Google sent no code".into())
}

/// Waits on the loopback listener for the redirect, answers the browser with a
/// page saying so, and returns the code.
pub fn wait_for_code(
    listener: &TcpListener,
    state: &str,
    timeout: Duration,
) -> Result<String, String> {
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
                // The browser also asks for /favicon.ico; only a request that
                // carries a code or an error is the answer.
                if !request.contains("code=") && !request.contains("error=") {
                    let _ =
                        stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
                    continue;
                }
                let result = parse_redirect(&request, state);
                let body = match &result {
                    Ok(_) => "<h3>Signed in to BotRacing.</h3><p>You can close this tab.</p>",
                    Err(_) => "<h3>BotRacing could not sign you in.</h3><p>Go back to the tray app and try again.</p>",
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                return result;
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

pub fn exchange_code(
    cfg: &Config,
    code: &str,
    verifier: &str,
    redirect: &str,
) -> Result<GoogleTokens, String> {
    let body: Value = agent()
        .post(&cfg.google_token)
        .send_form(&[
            ("client_id", &cfg.client_id),
            ("client_secret", &cfg.client_secret),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect),
        ])
        .map_err(describe)?
        .into_json()
        .map_err(|e| e.to_string())?;
    let text = |k: &str| body[k].as_str().unwrap_or_default().to_string();
    Ok(GoogleTokens {
        id_token: text("id_token"),
        access_token: text("access_token"),
    })
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

/// Which Google token Firebase accepted, for the PR note (marshal #75): the
/// ID token first, the access token when Firebase rejects the ID token's
/// audience.
#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Accepted {
    IdToken,
    AccessToken,
}

pub fn firebase_sign_in(
    cfg: &Config,
    google: &GoogleTokens,
) -> Result<(Session, Accepted), String> {
    let attempt = |post_body: String| -> Result<Session, String> {
        let body: Value = agent()
            .post(&format!("{}?key={}", cfg.firebase_idp, cfg.firebase_key))
            .send_json(serde_json::json!({
                "postBody": post_body,
                "requestUri": "http://localhost",
                "returnIdpCredential": true,
                "returnSecureToken": true,
            }))
            .map_err(describe)?
            .into_json()
            .map_err(|e| e.to_string())?;
        session_from(&body, "")
    };
    let by_id = attempt(format!(
        "id_token={}&providerId=google.com",
        urlencoding::encode(&google.id_token)
    ));
    match by_id {
        Ok(session) => Ok((session, Accepted::IdToken)),
        Err(first) if !google.access_token.is_empty() => attempt(format!(
            "access_token={}&providerId=google.com",
            urlencoding::encode(&google.access_token)
        ))
        .map(|session| (session, Accepted::AccessToken))
        .map_err(|second| format!("id_token: {first}; access_token: {second}")),
        Err(first) => Err(first),
    }
}

/// Why a refresh failed. Only a refusal from Firebase means the sign-in is
/// over; a dropped connection, a timeout or a 5xx says nothing about the
/// credential, so it is kept and tried again (marshal #85).
#[derive(Debug, PartialEq)]
pub enum RefreshError {
    /// Firebase answered 400, 401 or 403: TOKEN_EXPIRED, USER_DISABLED, ...
    Rejected(String),
    Transient(String),
}

impl std::fmt::Display for RefreshError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RefreshError::Rejected(m) | RefreshError::Transient(m) => f.write_str(m),
        }
    }
}

fn refresh_error(error: ureq::Error) -> RefreshError {
    let definitive = matches!(&error, ureq::Error::Status(400..=403, _));
    let message = describe(error);
    if definitive {
        RefreshError::Rejected(message)
    } else {
        RefreshError::Transient(message)
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
        .map_err(|e| RefreshError::Transient(e.to_string()))?;
    session_from(&body, &previous.email).map_err(RefreshError::Transient)
}

/// The owner key the server keeps for this user (GET /me).
pub fn owner_key(cfg: &Config, id_token: &str) -> Result<String, String> {
    let body: Value = agent()
        .get(&format!("{}/me", cfg.api))
        .set("authorization", &format!("Bearer {id_token}"))
        .call()
        .map_err(describe)?
        .into_json()
        .map_err(|e| e.to_string())?;
    body["ownerKey"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "the server sent no owner key".into())
}

/// The whole interactive sign-in: loopback listener, browser, code, tokens.
/// `open` shows the URL to the user (their default browser).
pub fn sign_in(
    cfg: &Config,
    open: impl FnOnce(&str),
    timeout: Duration,
) -> Result<(Session, Accepted), String> {
    if let Some(reason) = cfg.missing() {
        return Err(format!("Can't sign in: {reason}"));
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let redirect = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let verifier = random_token(32);
    let state = random_token(16);
    open(&auth_url(
        cfg,
        &redirect,
        &pkce_challenge(&verifier),
        &state,
    ));
    let code = wait_for_code(&listener, &state, timeout)?;
    let google = exchange_code(cfg, &code, &verifier, &redirect)?;
    firebase_sign_in(cfg, &google)
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use std::sync::{Arc, Mutex};

    pub fn cfg(base: &str) -> Config {
        Config {
            client_id: "cid.apps.googleusercontent.com".into(),
            client_secret: "shh".into(),
            firebase_key: "fbkey".into(),
            google_auth: "https://accounts.example/auth".into(),
            google_token: format!("{base}/google/token"),
            firebase_idp: format!("{base}/idp"),
            firebase_refresh: format!("{base}/refresh"),
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
    fn the_auth_url_carries_pkce_state_and_the_loopback_redirect() {
        let url = auth_url(&cfg("x"), "http://127.0.0.1:5555", "CHAL", "ST");
        for part in [
            "client_id=cid.apps.googleusercontent.com",
            "redirect_uri=http%3A%2F%2F127.0.0.1%3A5555",
            "response_type=code",
            "scope=openid%20email%20profile",
            "code_challenge=CHAL",
            "code_challenge_method=S256",
            "state=ST",
        ] {
            assert!(url.contains(part), "{part} missing from {url}");
        }
        assert!(!url.contains("shh"), "the secret must not be in the URL");
    }

    #[test]
    fn a_redirect_gives_its_code_only_for_our_state() {
        let ok = "GET /?state=ST&code=4%2F0AbC&scope=x HTTP/1.1\r\nHost: 127.0.0.1\r\n";
        assert_eq!(parse_redirect(ok, "ST").unwrap(), "4/0AbC");
        assert!(parse_redirect(ok, "OTHER")
            .unwrap_err()
            .contains("not for this request"));
        let denied = "GET /?error=access_denied&state=ST HTTP/1.1\r\n";
        assert_eq!(
            parse_redirect(denied, "ST").unwrap_err(),
            "Google said: access_denied"
        );
        assert!(parse_redirect("GET / HTTP/1.1\r\n", "ST").is_err());
        assert!(parse_redirect("", "ST").is_err());
    }

    #[test]
    fn the_loopback_listener_answers_the_browser_and_ignores_favicon() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || {
            let get = |path: &str| {
                let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
                write!(s, "GET {path} HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
                let mut out = String::new();
                s.read_to_string(&mut out).unwrap();
                out
            };
            let favicon = get("/favicon.ico");
            let answer = get("/?state=ST&code=THE_CODE");
            (favicon, answer)
        });
        let code = wait_for_code(&listener, "ST", Duration::from_secs(5)).unwrap();
        assert_eq!(code, "THE_CODE");
        let (favicon, answer) = browser.join().unwrap();
        assert!(favicon.starts_with("HTTP/1.1 404"));
        assert!(answer.contains("Signed in to BotRacing"));
    }

    #[test]
    fn the_listener_refuses_an_answer_for_another_state() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || {
            let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
            write!(
                s,
                "GET /?state=FORGED&code=EVIL HTTP/1.1
Host: x

"
            )
            .unwrap();
            let mut out = String::new();
            s.read_to_string(&mut out).unwrap();
            out
        });
        let err = wait_for_code(&listener, "ST", Duration::from_secs(5)).unwrap_err();
        assert!(err.contains("not for this request"), "{err}");
        assert!(browser.join().unwrap().contains("could not sign you in"));
    }

    #[test]
    fn the_listener_times_out_when_nobody_answers() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let err = wait_for_code(&listener, "ST", Duration::from_millis(300)).unwrap_err();
        assert!(err.contains("timed out"));
    }

    #[test]
    fn the_code_is_exchanged_with_the_verifier_and_the_secret() {
        let (base, seen) = stub(|_, _| (200, r#"{"id_token":"GID","access_token":"GACC"}"#.into()));
        let t = exchange_code(&cfg(&base), "CODE", "VERIF", "http://127.0.0.1:1").unwrap();
        assert_eq!(
            t,
            GoogleTokens {
                id_token: "GID".into(),
                access_token: "GACC".into()
            }
        );
        let seen = seen.lock().unwrap();
        let body = &seen[0].1;
        for part in [
            "code=CODE",
            "code_verifier=VERIF",
            "client_secret=shh",
            "grant_type=authorization_code",
        ] {
            assert!(body.contains(part), "{part} missing from {body}");
        }
    }

    #[test]
    fn firebase_takes_the_id_token_first() {
        let (base, seen) = stub(|_, _| (200, FB_OK.into()));
        let google = GoogleTokens {
            id_token: "GID".into(),
            access_token: "GACC".into(),
        };
        let (s, accepted) = firebase_sign_in(&cfg(&base), &google).unwrap();
        assert_eq!(accepted, Accepted::IdToken);
        assert_eq!(
            (s.uid.as_str(), s.email.as_str(), s.id_token.as_str()),
            ("UID1", "a@b.c", "FID")
        );
        assert!(!s.expires_within(Duration::from_secs(3000)));
        assert!(s.expires_within(Duration::from_secs(4000)));
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert!(seen[0].0.contains("key=fbkey"));
        assert!(seen[0].1.contains("id_token=GID&providerId=google.com"));
    }

    #[test]
    fn firebase_falls_back_to_the_access_token_when_the_id_token_is_refused() {
        let (base, seen) = stub(|_, body| {
            if body.contains("id_token=") {
                (
                    400,
                    r#"{"error":{"message":"INVALID_IDP_RESPONSE : audience mismatch"}}"#.into(),
                )
            } else {
                (200, FB_OK.into())
            }
        });
        let google = GoogleTokens {
            id_token: "GID".into(),
            access_token: "GACC".into(),
        };
        let (s, accepted) = firebase_sign_in(&cfg(&base), &google).unwrap();
        assert_eq!(accepted, Accepted::AccessToken);
        assert_eq!(s.uid, "UID1");
        assert_eq!(seen.lock().unwrap().len(), 2);
    }

    #[test]
    fn a_firebase_refusal_is_a_sentence_with_both_reasons() {
        let (base, _) = stub(|_, _| {
            (
                400,
                r#"{"error":{"message":"OPERATION_NOT_ALLOWED"}}"#.into(),
            )
        });
        let google = GoogleTokens {
            id_token: "GID".into(),
            access_token: "GACC".into(),
        };
        let err = firebase_sign_in(&cfg(&base), &google).unwrap_err();
        assert!(err.contains("OPERATION_NOT_ALLOWED"), "{err}");
        assert!(
            err.contains("id_token") && err.contains("access_token"),
            "{err}"
        );
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
    fn a_build_without_the_client_refuses_to_sign_in() {
        let mut c = cfg("x");
        c.client_secret.clear();
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

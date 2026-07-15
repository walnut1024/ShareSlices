use std::{
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use shareslices_worker::thumbnail::render_thumbnail;

#[test]
fn chromium_capture_waits_for_delayed_artifact_content() {
    let Ok(chromium_path) = std::env::var("CHROMIUM_TEST_PATH") else {
        return;
    };
    let page = TcpListener::bind("127.0.0.1:0").expect("page server");
    let page_address = page.local_addr().expect("page address");
    let html = r"<!doctype html>
      <style>html,body{margin:0;width:100%;height:100%;background:#c00}</style>
      <script>setTimeout(() => {
        const image = new Image();
        image.onload = () => document.body.style.background = '#00c853';
        image.src = 'cover.svg';
        document.body.appendChild(image);
      }, 1000)</script>";
    let page_thread = thread::spawn(move || {
        for mut stream in page.incoming().flatten().take(2) {
            let mut request = [0_u8; 1024];
            let read = stream.read(&mut request).unwrap_or(0);
            let request = String::from_utf8_lossy(&request[..read]);
            let (content_type, body) = if request
                .starts_with("GET /internal/thumbnail-captures/version-1/content/cover.svg")
            {
                thread::sleep(Duration::from_secs(3));
                (
                    "image/svg+xml",
                    "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>",
                )
            } else {
                ("text/html; charset=utf-8", html)
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });

    let output = render_thumbnail(
        &PathBuf::from(chromium_path),
        &format!("http://{page_address}/internal/thumbnail-captures/version-1/content/"),
    )
    .expect("render thumbnail");
    let decoded = image::load_from_memory_with_format(&output, image::ImageFormat::WebP)
        .expect("decode WebP")
        .to_rgb8();
    eprintln!("delayed_artifact_thumbnail_bytes={}", output.len());
    assert_eq!((decoded.width(), decoded.height()), (800, 450));
    let center = decoded.get_pixel(400, 225);

    assert!(
        center[1] > 150 && center[0] < 80,
        "expected delayed green content, got {center:?}"
    );
    page_thread.join().expect("page server thread");
}

#[test]
fn chromium_capture_is_webp_and_blocks_another_origin() {
    let Ok(chromium_path) = std::env::var("CHROMIUM_TEST_PATH") else {
        return;
    };
    let external_hits = Arc::new(AtomicUsize::new(0));
    let external = TcpListener::bind("127.0.0.1:0").expect("external server");
    external
        .set_nonblocking(true)
        .expect("nonblocking external server");
    let external_address = external.local_addr().expect("external address");
    let counter = Arc::clone(&external_hits);
    let external_thread = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(4);
        while Instant::now() < deadline {
            match external.accept() {
                Ok((_stream, _)) => {
                    counter.fetch_add(1, Ordering::SeqCst);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(_) => return,
            }
        }
    });

    let page = TcpListener::bind("127.0.0.1:0").expect("page server");
    let page_address = page.local_addr().expect("page address");
    let same_origin_escape_hits = Arc::new(AtomicUsize::new(0));
    let same_origin_counter = Arc::clone(&same_origin_escape_hits);
    let html = format!(
        "<!doctype html><style>body{{margin:0;background:#123;animation:pulse 1s infinite}}@keyframes pulse{{to{{opacity:.5}}}}</style><img src=\"http://{external_address}/tracking.png\"><img src=\"/api/users/me\"><h1>Artifact</h1>"
    );
    let page_thread = thread::spawn(move || {
        for mut stream in page.incoming().flatten().take(3) {
            let mut request = [0_u8; 1024];
            let read = stream.read(&mut request).unwrap_or(0);
            if String::from_utf8_lossy(&request[..read]).starts_with("GET /api/") {
                same_origin_counter.fetch_add(1, Ordering::SeqCst);
            }
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                html.len(),
                html
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });

    let output = render_thumbnail(
        &PathBuf::from(chromium_path),
        &format!("http://{page_address}/internal/thumbnail-captures/version-1/content/"),
    )
    .expect("render thumbnail");
    let decoded = image::load_from_memory_with_format(&output, image::ImageFormat::WebP)
        .expect("decode WebP");
    eprintln!("isolated_artifact_thumbnail_bytes={}", output.len());
    assert_eq!((decoded.width(), decoded.height()), (800, 450));
    external_thread.join().expect("external server thread");
    assert_eq!(external_hits.load(Ordering::SeqCst), 0);
    assert_eq!(same_origin_escape_hits.load(Ordering::SeqCst), 0);
    drop(page_thread);
}

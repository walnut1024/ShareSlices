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
    assert_eq!((decoded.width(), decoded.height()), (480, 300));
    external_thread.join().expect("external server thread");
    assert_eq!(external_hits.load(Ordering::SeqCst), 0);
    assert_eq!(same_origin_escape_hits.load(Ordering::SeqCst), 0);
    drop(page_thread);
}

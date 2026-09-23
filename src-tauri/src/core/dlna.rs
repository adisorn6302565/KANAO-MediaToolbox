//! ส่งคลิปขึ้น Smart TV ผ่าน DLNA/UPnP (Samsung, LG, Sony, Android TV, กล่องทีวี, Kodi, VLC)
//!
//! 1) ค้นหาทีวีในบ้านด้วย SSDP
//! 2) อ่านคำอธิบายอุปกรณ์หา AVTransport
//! 3) สั่ง SetAVTransportURI + Play
//!
//! ทีวีจะดึงไฟล์เองจาก Media Server ของเรา (ต้องเปิดเซิร์ฟเวอร์ในหน้าสตรีมมิ่งก่อน)
use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs, UdpSocket};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Renderer {
    pub name: String,
    pub location: String,
    pub av_transport: String,
    pub rendering: String,
}

/// HTTP แบบย่อ (ไม่ต้องพึ่งไลบรารีเพิ่ม) — คืน (status, body)
fn http(method: &str, url: &str, headers: &[(&str, String)], body: &str) -> Result<(u16, String), String> {
    let rest = url.strip_prefix("http://").ok_or("รองรับเฉพาะ http://")?;
    let (hostport, path) = rest.split_once('/').map(|(h, p)| (h, format!("/{p}"))).unwrap_or((rest, "/".into()));
    let addr = if hostport.contains(':') { hostport.to_string() } else { format!("{hostport}:80") };
    let sock = addr.to_socket_addrs().map_err(|e| e.to_string())?.next().ok_or("ที่อยู่ไม่ถูกต้อง")?;
    let mut s = TcpStream::connect_timeout(&sock, Duration::from_secs(3)).map_err(|e| format!("ต่อทีวีไม่ได้: {e}"))?;
    s.set_read_timeout(Some(Duration::from_secs(8))).ok();
    let mut req = format!("{method} {path} HTTP/1.1\r\nHost: {hostport}\r\nConnection: close\r\nContent-Length: {}\r\n", body.len());
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    req.push_str("\r\n");
    req.push_str(body);
    s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    let _ = s.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf).to_string();
    let status = text.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    let body = text.split_once("\r\n\r\n").map(|x| x.1.to_string()).unwrap_or_default();
    Ok((status, body))
}

/// ดึงข้อความในแท็กแรกที่ชื่อตรง (ไม่สน namespace prefix)
fn tag(xml: &str, name: &str) -> Option<String> {
    let re = regex::Regex::new(&format!(r"(?s)<(?:\w+:)?{name}(?:\s[^>]*)?>(.*?)</(?:\w+:)?{name}>")).ok()?;
    re.captures(xml).map(|c| c[1].trim().to_string())
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn absolute(location: &str, url: &str) -> String {
    if url.starts_with("http") {
        return url.to_string();
    }
    let base = location.strip_prefix("http://").and_then(|r| r.split('/').next()).unwrap_or("");
    format!("http://{base}/{}", url.trim_start_matches('/'))
}

/// อ่านคำอธิบายอุปกรณ์ → หา controlURL ของ AVTransport / RenderingControl
pub fn describe(location: &str) -> Option<Renderer> {
    let (_, xml) = http("GET", location, &[], "").ok()?;
    let name = tag(&xml, "friendlyName").unwrap_or_else(|| "ทีวี".into());
    let mut av = String::new();
    let mut rc = String::new();
    let re = regex::Regex::new(r"(?s)<(?:\w+:)?service>(.*?)</(?:\w+:)?service>").ok()?;
    for c in re.captures_iter(&xml) {
        let svc = &c[1];
        let ty = tag(svc, "serviceType").unwrap_or_default();
        let ctl = tag(svc, "controlURL").unwrap_or_default();
        if ty.contains(":AVTransport:") {
            av = absolute(location, &ctl);
        } else if ty.contains(":RenderingControl:") {
            rc = absolute(location, &ctl);
        }
    }
    (!av.is_empty()).then(|| Renderer { name: xml_unescape(&name), location: location.into(), av_transport: av, rendering: rc })
}

fn xml_unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

/// ค้นหาทีวี/เครื่องเล่น DLNA ในวง LAN (รอคำตอบประมาณ `secs` วินาที)
pub fn discover(secs: u64) -> Vec<Renderer> {
    let Ok(sock) = UdpSocket::bind("0.0.0.0:0") else { return vec![] };
    let _ = sock.set_read_timeout(Some(Duration::from_millis(300)));
    let _ = sock.set_multicast_ttl_v4(2);
    for st in ["urn:schemas-upnp-org:device:MediaRenderer:1", "urn:schemas-upnp-org:service:AVTransport:1"] {
        let msg = format!("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: {st}\r\n\r\n");
        let _ = sock.send_to(msg.as_bytes(), "239.255.255.250:1900");
    }
    let mut locations: Vec<String> = Vec::new();
    let end = Instant::now() + Duration::from_secs(secs.clamp(1, 10));
    let mut buf = [0u8; 2048];
    while Instant::now() < end {
        if let Ok((n, _)) = sock.recv_from(&mut buf) {
            let text = String::from_utf8_lossy(&buf[..n]);
            for line in text.lines() {
                if let Some((k, v)) = line.split_once(':') {
                    if k.trim().eq_ignore_ascii_case("location") {
                        let v = v.trim().to_string();
                        if !locations.contains(&v) {
                            locations.push(v);
                        }
                    }
                }
            }
        }
    }
    // อ่านคำอธิบายทุกเครื่องพร้อมกัน
    let handles: Vec<_> = locations.into_iter().map(|l| std::thread::spawn(move || describe(&l))).collect();
    let mut out: Vec<Renderer> = handles.into_iter().filter_map(|h| h.join().ok().flatten()).collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out.dedup_by(|a, b| a.av_transport == b.av_transport);
    out
}

fn soap(control: &str, service: &str, action: &str, args: &str) -> Result<String, String> {
    let body = format!(
        r#"<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:{action} xmlns:u="urn:schemas-upnp-org:service:{service}:1">{args}</u:{action}></s:Body></s:Envelope>"#
    );
    let headers = [
        ("Content-Type", "text/xml; charset=\"utf-8\"".to_string()),
        ("SOAPAction", format!("\"urn:schemas-upnp-org:service:{service}:1#{action}\"")),
    ];
    let (status, resp) = http("POST", control, &headers, &body)?;
    if status == 200 {
        Ok(resp)
    } else {
        let why = tag(&resp, "errorDescription").unwrap_or_default();
        Err(format!("ทีวีตอบกลับ {status} {why}").trim().to_string())
    }
}

/// ส่งไฟล์ขึ้นทีวีแล้วเริ่มเล่น
pub fn cast(control: &str, media_url: &str, title: &str, mime: &str) -> Result<(), String> {
    let class = if mime.starts_with("audio") { "object.item.audioItem.musicTrack" } else if mime.starts_with("image") { "object.item.imageItem.photo" } else { "object.item.videoItem" };
    let didl = format!(
        r#"<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="1" parentID="0" restricted="1"><dc:title>{}</dc:title><upnp:class>{class}</upnp:class><res protocolInfo="http-get:*:{mime}:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000">{}</res></item></DIDL-Lite>"#,
        xml_escape(title),
        xml_escape(media_url)
    );
    // ทีวีบางรุ่นไม่ยอมเปลี่ยนไฟล์ระหว่างเล่น → หยุดก่อน (ไม่สนผล)
    let _ = soap(control, "AVTransport", "Stop", "<InstanceID>0</InstanceID>");
    soap(
        control,
        "AVTransport",
        "SetAVTransportURI",
        &format!("<InstanceID>0</InstanceID><CurrentURI>{}</CurrentURI><CurrentURIMetaData>{}</CurrentURIMetaData>", xml_escape(media_url), xml_escape(&didl)),
    )?;
    soap(control, "AVTransport", "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>").map(|_| ())
}

/// play | pause | stop | seek:<วินาที>
pub fn control(control: &str, action: &str) -> Result<(), String> {
    match action {
        "play" => soap(control, "AVTransport", "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>"),
        "pause" => soap(control, "AVTransport", "Pause", "<InstanceID>0</InstanceID>"),
        "stop" => soap(control, "AVTransport", "Stop", "<InstanceID>0</InstanceID>"),
        a if a.starts_with("seek:") => {
            let s: u64 = a[5..].parse().unwrap_or(0);
            let t = format!("{:02}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60);
            soap(control, "AVTransport", "Seek", &format!("<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>{t}</Target>"))
        }
        _ => Err("คำสั่งไม่ถูกต้อง".into()),
    }
    .map(|_| ())
}

/// ปรับเสียงทีวี 0–100
pub fn volume(rendering: &str, v: u32) -> Result<(), String> {
    soap(rendering, "RenderingControl", "SetVolume", &format!("<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>{}</DesiredVolume>", v.min(100))).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// ทีวีจำลอง: ตอบคำอธิบายอุปกรณ์ + รับคำสั่ง SOAP
    #[test]
    fn cast_to_mock_tv() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let got: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let g2 = got.clone();
        std::thread::spawn(move || {
            for mut req in server.incoming_requests() {
                if req.url() == "/desc.xml" {
                    let xml = r#"<root xmlns="urn:schemas-upnp-org:device-1-0"><device><friendlyName>[TV] Samsung &amp; ห้องนั่งเล่น</friendlyName><serviceList>
<service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/rc</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/upnp/control/AVTransport1</controlURL></service>
</serviceList></device></root>"#;
                    let _ = req.respond(tiny_http::Response::from_string(xml));
                } else {
                    let action = req.headers().iter().find(|h| h.field.equiv("SOAPAction")).map(|h| h.value.to_string()).unwrap_or_default();
                    let mut body = String::new();
                    let _ = req.as_reader().read_to_string(&mut body);
                    g2.lock().unwrap().push(format!("{} {}", req.url(), action));
                    if action.contains("SetAVTransportURI") {
                        assert!(body.contains("http://192.168.1.5:8787/files/%E0%B8%AB.mp4"), "{body}");
                        assert!(body.contains("&lt;DIDL-Lite"), "metadata ต้อง escape");
                    }
                    let _ = req.respond(tiny_http::Response::from_string("<ok/>"));
                }
            }
        });
        let r = describe(&format!("http://127.0.0.1:{port}/desc.xml")).expect("ต้องอ่านคำอธิบายได้");
        assert_eq!(r.name, "[TV] Samsung & ห้องนั่งเล่น");
        assert_eq!(r.av_transport, format!("http://127.0.0.1:{port}/upnp/control/AVTransport1"));
        cast(&r.av_transport, "http://192.168.1.5:8787/files/%E0%B8%AB.mp4", "หนัง <ตอน 1>", "video/mp4").unwrap();
        control(&r.av_transport, "seek:3725").unwrap();
        volume(&r.rendering, 30).unwrap();
        let log = got.lock().unwrap().join("\n");
        for a in ["#Stop", "#SetAVTransportURI", "#Play", "#Seek", "#SetVolume"] {
            assert!(log.contains(a), "ขาด {a}: {log}");
        }
        // ค้นหาจริงในวง LAN ต้องไม่พัง (อาจไม่เจออะไรเลย)
        let _ = discover(1);
    }
}

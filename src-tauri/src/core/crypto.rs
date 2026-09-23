//! เข้ารหัสไฟล์ AES-256-GCM แบบแบ่งก้อน (ไฟล์ใหญ่ก็ไม่กินแรม) + ลบถาวร + hash PIN
//!
//! รูปแบบไฟล์ .mtbx:
//!   "MTBX1" | salt(16) | nonce_prefix(7) | [len(u32 LE) | ciphertext]...
//!   nonce ของก้อนที่ i = nonce_prefix | i(u32 BE) | last(0/1)
use crate::error::{AppError, AppResult};
use aes_gcm::aead::{AeadInPlace, KeyInit};
use aes_gcm::Aes256Gcm;
use rand::RngCore;
use sha2::Sha256;
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

const MAGIC: &[u8; 5] = b"MTBX1";
const CHUNK: usize = 1024 * 1024;
const ITER: u32 = 200_000;

fn derive(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, ITER, &mut key);
    key
}

fn nonce(prefix: &[u8; 7], i: u32, last: bool) -> [u8; 12] {
    let mut n = [0u8; 12];
    n[..7].copy_from_slice(prefix);
    n[7..11].copy_from_slice(&i.to_be_bytes());
    n[11] = last as u8;
    n
}

/// อ่านให้เต็ม buffer (หรือจนจบไฟล์)
fn read_full(r: &mut impl Read, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        match r.read(&mut buf[n..])? {
            0 => break,
            k => n += k,
        }
    }
    Ok(n)
}

pub fn encrypt_file(src: &Path, dst: &Path, password: &str) -> AppResult<()> {
    let mut rng = rand::thread_rng();
    let mut salt = [0u8; 16];
    let mut prefix = [0u8; 7];
    rng.fill_bytes(&mut salt);
    rng.fill_bytes(&mut prefix);
    let cipher = Aes256Gcm::new(&derive(password, &salt).into());

    let len = std::fs::metadata(src)?.len();
    let mut r = BufReader::new(File::open(src)?);
    let mut w = BufWriter::new(File::create(dst)?);
    w.write_all(MAGIC)?;
    w.write_all(&salt)?;
    w.write_all(&prefix)?;
    let mut buf = vec![0u8; CHUNK];
    let mut done: u64 = 0;
    let mut i: u32 = 0;
    loop {
        let n = read_full(&mut r, &mut buf)?;
        done += n as u64;
        // n < CHUNK = ถึงท้ายไฟล์แล้ว (กันวนไม่จบถ้าไฟล์หดขนาดระหว่างเข้ารหัส)
        let last = done >= len || n < CHUNK;
        let mut ct = buf[..n].to_vec();
        cipher
            .encrypt_in_place(&nonce(&prefix, i, last).into(), MAGIC, &mut ct)
            .map_err(|_| AppError::Msg("เข้ารหัสไม่สำเร็จ".into()))?;
        w.write_all(&(ct.len() as u32).to_le_bytes())?;
        w.write_all(&ct)?;
        i += 1;
        if last {
            break;
        }
    }
    w.flush()?;
    Ok(())
}

pub fn decrypt_file(src: &Path, dst: &Path, password: &str) -> AppResult<()> {
    let mut r = BufReader::new(File::open(src)?);
    let mut magic = [0u8; 5];
    r.read_exact(&mut magic)?;
    if &magic != MAGIC {
        return Err(AppError::Msg("ไฟล์นี้ไม่ได้เข้ารหัสด้วยมีเดียทูลบ็อกซ์".into()));
    }
    let mut salt = [0u8; 16];
    let mut prefix = [0u8; 7];
    r.read_exact(&mut salt)?;
    r.read_exact(&mut prefix)?;
    let cipher = Aes256Gcm::new(&derive(password, &salt).into());
    let tmp = dst.with_extension("mtbx-part");
    let result = (|| -> AppResult<()> {
        let mut w = BufWriter::new(File::create(&tmp)?);
        let mut i: u32 = 0;
        loop {
            let mut lb = [0u8; 4];
            if read_full(&mut r, &mut lb)? < 4 {
                return Err(AppError::BadPassword);
            }
            let clen = u32::from_le_bytes(lb) as usize;
            if clen > CHUNK + 64 {
                return Err(AppError::BadPassword);
            }
            let mut ct = vec![0u8; clen];
            r.read_exact(&mut ct)?;
            // ลองว่าเป็นก้อนสุดท้ายหรือไม่ (แท็ก GCM จะผ่านเฉพาะค่าที่ถูก)
            let try_open = |last: bool| {
                let mut v = ct.clone();
                cipher.decrypt_in_place(&nonce(&prefix, i, last).into(), MAGIC, &mut v).map(|_| v)
            };
            let (pt, last) = match try_open(false) {
                Ok(p) => (p, false),
                Err(_) => (try_open(true).map_err(|_| AppError::BadPassword)?, true),
            };
            w.write_all(&pt)?;
            i += 1;
            if last {
                break;
            }
        }
        w.flush()?;
        Ok(())
    })();
    match result {
        Ok(()) => {
            std::fs::rename(&tmp, dst)?;
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// ลบถาวร: เขียนทับด้วยข้อมูลสุ่ม/ศูนย์หลายรอบ แล้วลบไฟล์
pub fn shred_file(path: &Path, passes: u32) -> AppResult<()> {
    let len = std::fs::metadata(path)?.len();
    let mut f = std::fs::OpenOptions::new().write(true).open(path)?;
    let mut rng = rand::thread_rng();
    let mut buf = vec![0u8; CHUNK];
    for pass in 0..passes.clamp(1, 35) {
        f.seek(SeekFrom::Start(0))?;
        let mut left = len;
        while left > 0 {
            let n = left.min(CHUNK as u64) as usize;
            match pass % 3 {
                0 => rng.fill_bytes(&mut buf[..n]),
                1 => buf[..n].fill(0x00),
                _ => buf[..n].fill(0xFF),
            }
            f.write_all(&buf[..n])?;
            left -= n as u64;
        }
        f.sync_all()?;
    }
    drop(f);
    // เปลี่ยนชื่อก่อนลบ เพื่อไม่ให้เหลือชื่อไฟล์เดิม
    let renamed = path.with_file_name(format!("{:x}.del", rand::random::<u64>()));
    std::fs::rename(path, &renamed)?;
    std::fs::remove_file(renamed)?;
    Ok(())
}

pub fn hash_pin(pin: &str) -> String {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    format!("{}${}", hex::encode(salt), hex::encode(derive(pin, &salt)))
}

pub fn verify_pin(pin: &str, stored: &str) -> bool {
    let Some((s, h)) = stored.split_once('$') else { return false };
    let Ok(salt) = hex::decode(s) else { return false };
    hex::encode(derive(pin, &salt)) == h
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_encrypt() {
        let dir = std::env::temp_dir().join(format!("mtb-test-{}", rand::random::<u32>()));
        std::fs::create_dir_all(&dir).unwrap();
        for size in [0usize, 10, CHUNK, CHUNK + 5, CHUNK * 2] {
            let src = dir.join("ไฟล์ทดสอบ.bin");
            let enc = dir.join("a.mtbx");
            let dec = dir.join("b.bin");
            let data: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
            std::fs::write(&src, &data).unwrap();
            encrypt_file(&src, &enc, "รหัสผ่าน").unwrap();
            assert!(decrypt_file(&enc, &dec, "ผิด").is_err());
            decrypt_file(&enc, &dec, "รหัสผ่าน").unwrap();
            assert_eq!(std::fs::read(&dec).unwrap(), data);
        }
        let s = dir.join("shred.bin");
        std::fs::write(&s, b"secret").unwrap();
        shred_file(&s, 3).unwrap();
        assert!(!s.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn pin() {
        let h = hash_pin("1234");
        assert!(verify_pin("1234", &h));
        assert!(!verify_pin("0000", &h));
    }
}

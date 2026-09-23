# 🇹🇭 มีเดียทูลบ็อกซ์ (MediaToolbox)

โปรแกรมจัดการสื่อครบวงจรสำหรับคนไทยบน Windows 10/11 — โหลดคลิป แปลงไฟล์ บีบอัด ตัดต่อ ดูคลิป และเครื่องมืออีก 30+ อย่าง ในโปรแกรมเดียว

- ภาษาไทยทั้งโปรแกรม รองรับชื่อไฟล์และพาธภาษาไทย แสดงปี พ.ศ. ได้
- ใช้คนเดียว ไม่ต้องล็อกอิน ทำงานออฟไลน์ได้ (ยกเว้นตอนโหลดคลิปหรืออัปโหลดคลาวด์)
- ไม่ใช้ AI ไม่ใช้ API แบบเสียเงิน
- ติดตั้ง yt-dlp และ ffmpeg มาในตัว

## หน้าทั้งหมด (21 หน้า)

| หน้า | ทำอะไรได้ |
|---|---|
| 🏠 หน้าแรก | สถิติ งานที่กำลังทำ ไฟล์ล่าสุด กราฟระบบ ทางลัด (ลากจัด widget ได้) |
| 📥 โหลดคลิป | YouTube / Facebook (รวมกลุ่ม) / IG / TikTok ไม่ติดลายน้ำ / X / +1000 เว็บ, คิว หยุด-ทำต่อ, คุกกี้, proxy, ตั้งเวลา |
| 🔄 แปลงไฟล์ | วิดีโอ เสียง รูป, H.264/H.265/VP9/AV1/ProRes, NVENC/QSV/AMF, ตัด ครอป หมุน ความเร็ว ลายน้ำ ฝังซับ, ส่งออก ZIP |
| 🗜️ บีบอัดไฟล์ | PDF (ลด/แยก/รวม/หมุน/ใส่รหัส/ลายน้ำ), รูปเป็นกลุ่ม, วิดีโอ two-pass, เปลี่ยนชื่อกลุ่ม |
| ✂️ ตัดต่อมีเดีย | ไทม์ไลน์ ทรานซิชัน เพลง ข้อความ LUT Ken Burns Chroma key / แต่งเสียง EQ / แต่งรูปแบบเลเยอร์ |
| ▶️ ดูคลิป | เพลย์ลิสต์ ซับ SRT/VTT/ASS เล่นต่อจากเดิม bookmark วน A-B จับภาพ PiP |
| ⚙️ อัตโนมัติ | เวิร์กโฟลว์ เฝ้าโฟลเดอร์ กฎ ถ้า-แล้ว ตั้งเวลา จัดเรียงไฟล์ |
| ☁️ ซิงก์คลาวด์ | อัปโหลดผ่าน rclone, แชร์ LAN + QR, โอนไฟล์ P2P, FTP server |
| 📊 วิเคราะห์ | สถิติ heatmap treemap ไฟล์ซ้ำ ไฟล์ใหญ่ โฟลเดอร์ว่าง ส่งออก CSV/JSON |
| 🗂️ คลังไฟล์ | แกลเลอรี กรอง เรียง แท็ก รายการโปรด สไลด์โชว์ |
| 🧰 เครื่องมือ | 30 อย่าง: อัดจอ GIF มีม QR บาร์โค้ด สี ฟอนต์ EXIF hash รหัสผ่าน ZIP ซับ BPM เมโทรนอม JSON/YAML Regex ฯลฯ |
| 📡 สตรีมมิ่ง | Media server + RSS พอดแคสต์, อัดไลฟ์, อัดวิทยุออนไลน์ |
| 🔒 ความปลอดภัย | เข้ารหัส AES-256, ลบถาวร, ลบ EXIF/GPS, ลายน้ำ, PIN, ล็อกอัตโนมัติ, ปุ่มฉุกเฉิน |
| 📱 โซเชียล | รีล/สตอรี่/รูปโปรไฟล์/ภาพปก, นับแฮชแท็ก, ดึงแคปชัน, บันทึกตารางโพสต์ |
| 🧑‍💻 นักพัฒนา | ทดสอบ API, API key, webhook, CLI, ปลั๊กอิน JS, log, cron |
| 🎉 สนุก | เครื่องเล่นเพลง + visualizer + เนื้อเพลง .lrc, สั่งด้วยเสียง, Pomodoro, แมวเดินเล่น, Konami code, ความสำเร็จ |
| ❓ ช่วยเหลือ | ทัวร์แนะนำ บทเรียน FAQ คีย์ลัด (กด `?`) บันทึกการเปลี่ยนแปลง |
| 🖥️ ระบบ | CPU/RAM/GPU/ดิสก์/เครือข่าย, คิวงาน, log, สำรอง-กู้คืน |
| 🎨 ปรับแต่ง | widget, โปรไฟล์, เสียงแจ้งเตือน, คีย์ลัด, ภาษา, สร้างธีมเอง |
| 🕘 ประวัติ | กรอง ค้นหา เปิดไฟล์/โฟลเดอร์ ส่งออก CSV/JSON |
| ⚙️ ตั้งค่า | โฟลเดอร์ คุกกี้ งานพร้อมกัน พาธ ffmpeg/yt-dlp proxy ธีม ภาษา ฯลฯ |

## สถาปัตยกรรม

```
React + TypeScript + Tailwind (หน้าจอ)
        │  invoke() / event "job://progress"
        ▼
Rust + Tauri 2 (src-tauri)
  ├─ core/jobs.rs      คิวงาน (จำกัดจำนวนพร้อมกัน, หยุด/ทำต่อ/ยกเลิก)
  ├─ core/binaries.rs  หา yt-dlp / ffmpeg (ตั้งเอง → ในตัว → PATH)
  ├─ core/db.rs        SQLite (ประวัติ, แท็ก, ค่าต่าง ๆ)
  ├─ core/crypto.rs    AES-256-GCM + PBKDF2-SHA256
  ├─ core/pdf.rs       จัดการ PDF (lopdf)
  ├─ core/server.rs    Media server / แชร์ LAN / RSS
  └─ core/ftp.rs       FTP server
```

```
src/
  components/   Layout, ui (ปุ่ม การ์ด แถบเลื่อน ลากจัดลำดับ ...)
  lib/          api (เรียก Rust), ffmpeg (สร้างคำสั่ง), subtitle, format, automation
  pages/        21 หน้า + tools/ (เครื่องมือย่อย)
src-tauri/
  src/commands/ คำสั่งที่หน้าจอเรียกใช้
  src/core/     ระบบหลัก
  bin/          yt-dlp.exe ffmpeg.exe ffprobe.exe (ใส่ก่อน build)
tests/          ทดสอบ (vitest) + ทดสอบ ffmpeg จริง
scripts/        fetch-binaries.ps1, build.ps1
```

ข้อมูลผู้ใช้ (ตั้งค่า ฐานข้อมูล log) เก็บที่ `%APPDATA%\th.mediatoolbox.app`
ไฟล์ที่โหลดหรือแปลงแล้ว บันทึกไว้ที่ `Documents\MediaToolbox` เป็นค่าเริ่มต้น

## พัฒนา

ต้องมี: Node.js 20+, Rust (stable), Visual Studio Build Tools (C++), WebView2 (มีใน Windows 11 แล้ว)

```bash
npm install
```

```bash
powershell -ExecutionPolicy Bypass -File scripts/fetch-binaries.ps1
```

```bash
npm run app:dev
```

`npm run dev` เปิดเฉพาะหน้าเว็บในเบราว์เซอร์ได้ (ใช้ข้อมูลจำลอง ไม่เรียก Rust)

### ทดสอบ

```bash
npm run typecheck
```

```bash
npm test
```

```bash
cd src-tauri && cargo test
```

`npm test` จะรัน ffmpeg จริงกับไฟล์ตัวอย่างด้วย ถ้ามี ffmpeg ใน PATH (ถ้าไม่มีจะข้ามส่วนนั้น)

## Build ตัวติดตั้ง

```bash
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
```

ได้ไฟล์ที่ `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/` ทั้ง `nsis/*.exe` และ `msi/*.msi`
สำหรับ ARM64 ใช้ `-Target aarch64-pc-windows-msvc` (ต้อง `rustup target add aarch64-pc-windows-msvc`)

GitHub Actions (`.github/workflows/build.yml`) จะทดสอบและ build ทั้ง x64 และ ARM64 ให้อัตโนมัติ ถ้า push tag `v*` จะสร้าง Release แบบร่างให้

## ข้อจำกัดที่ควรรู้

- **rclone** (ซิงก์คลาวด์) และ **Ghostscript** (บีบอัด PDF แบบลดคุณภาพรูป) ต้องติดตั้งเอง ถ้าไม่มี Ghostscript โปรแกรมจะใช้วิธีบีบอัดแบบไม่เสียคุณภาพในตัวแทน
- DLNA / Chromecast: ยังไม่ค้นหาอุปกรณ์อัตโนมัติ ให้เปิด Media server แล้วเปิดลิงก์จากทีวีหรือมือถือ
- สั่งงานด้วยเสียงใช้ Web Speech ของ Windows ซึ่งบางเครื่องอาจต้องต่อเน็ต
- ตั้งเวลาโพสต์โซเชียลเป็นแค่การเตือน ไม่โพสต์ให้อัตโนมัติ
- LINE Notify ปิดบริการไปแล้วในปี 2025 — webhook รองรับ Discord / Slack / URL ทั่วไป
- แตกไฟล์ 7z / RAR ใช้ `tar` ที่มากับ Windows 10 1803 ขึ้นไป
- ถ้ารวม ffmpeg ไว้ในตัว ตัวติดตั้งจะใหญ่กว่า 60 MB (ffmpeg เองประมาณ 100 MB ก่อนบีบอัด)
- โหลดคลิปจาก Facebook / Instagram ที่ต้องล็อกอิน ต้องตั้งค่าคุกกี้ในหน้า ตั้งค่า และควรปิด Chrome / Edge ก่อนโหลด

## สัญญาอนุญาต

MIT — yt-dlp (Unlicense) และ ffmpeg (GPL/LGPL) เป็นลิขสิทธิ์ของผู้พัฒนาแต่ละโครงการ
ใช้โหลดเฉพาะเนื้อหาที่คุณมีสิทธิ์ และปฏิบัติตามเงื่อนไขของแต่ละเว็บไซต์

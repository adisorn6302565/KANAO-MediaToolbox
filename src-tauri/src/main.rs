// ซ่อนหน้าต่าง console ตอน release บน Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    media_toolbox_lib::run()
}
